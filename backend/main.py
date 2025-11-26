import os
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from openai import OpenAI
from pypdf import PdfReader

app = FastAPI(title="Group Chat Prototype")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client with API key from environment variable
openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    print("WARNING: OPENAI_API_KEY environment variable not set. AI features will not work.")
    openai_client = None
else:
    openai_client = OpenAI(api_key=openai_api_key)

# Setup PDF storage directory
PDF_STORAGE_DIR = Path("uploads/pdfs")
PDF_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# In-memory data store for hard-coded groups and messages
groups = {
    "group-a": {
        "id": "group-a",
        "name": "Group 1",
        "messages": [
            {"id": 1, "sender": "Alice", "text": "Hey everyone!", "is_bot": False},
            {"id": 2, "sender": "Bob", "text": "Hi Alice!", "is_bot": False},
        ],
    },
    "group-b": {
        "id": "group-b",
        "name": "Group 2",
        "messages": [
            {"id": 1, "sender": "Charlie", "text": "Who's ready for lunch?", "is_bot": False},
        ],
    },
}

# In-memory storage for PDF metadata: {group_id: [{"id": int, "filename": str, "uploaded_at": str, "file_path": str}, ...]}
group_documents = {
    "group-a": [],
    "group-b": [],
}


class NewMessage(BaseModel):
    sender: str
    text: str


def extract_text_from_pdfs(group_id: str) -> str:
    """
    Extract text from all PDFs uploaded for a group.
    Returns concatenated text from all PDFs, or empty string if no PDFs.
    """
    documents = group_documents.get(group_id, [])
    if not documents:
        return ""
    
    all_text = []
    for doc in documents:
        file_path = Path(doc["file_path"])
        if not file_path.exists():
            continue
        
        try:
            reader = PdfReader(file_path)
            pdf_text = []
            for page in reader.pages:
                pdf_text.append(page.extract_text())
            combined_text = "\n".join(pdf_text)
            if combined_text.strip():
                all_text.append(f"--- Content from {doc['filename']} ---\n{combined_text}")
        except Exception as e:
            # If PDF reading fails, skip this document
            print(f"Error reading PDF {doc['filename']}: {str(e)}")
            continue
    
    return "\n\n".join(all_text)


def generate_ai_reply(group_id: str, question: str, next_message_id: int):
    """
    Background task to generate AI reply and append it to the group's messages.
    This runs asynchronously after the POST endpoint returns.
    """
    group = groups.get(group_id)
    if not group:
        return  # Group doesn't exist, skip
    
    if not openai_client:
        # If OpenAI client is not initialized, add error message
        ai_response = {
            "id": next_message_id,
            "sender": "AI Bot",
            "text": "Error: OPENAI_API_KEY environment variable not set. Please configure your API key.",
            "is_bot": True
        }
        group["messages"].append(ai_response)
        return
    
    try:
        # Extract text from PDFs uploaded for this group
        pdf_context = extract_text_from_pdfs(group_id)
        
        # Build system message based on whether PDFs exist
        if pdf_context:
            system_message = (
                "You are a helpful assistant in a group chat. "
                "Answer questions based on the following documents provided for this group. "
                "If the answer is not in the documents, say so clearly. "
                "Provide concise and helpful responses based on the document content.\n\n"
                f"Documents for this group:\n{pdf_context}"
            )
        else:
            system_message = "You are a helpful assistant in a group chat. Provide concise and helpful responses."
        
        # Call OpenAI API
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": question}
            ],
            max_tokens=500,
            temperature=0.7
        )
        
        # Extract the AI's response text
        ai_text = response.choices[0].message.content
        
        # Create AI bot response
        ai_response = {
            "id": next_message_id,
            "sender": "AI Bot",
            "text": ai_text,
            "is_bot": True
        }
        group["messages"].append(ai_response)
    except Exception as e:
        # Handle API errors gracefully
        ai_response = {
            "id": next_message_id,
            "sender": "AI Bot",
            "text": f"Error: Failed to get AI response. {str(e)}",
            "is_bot": True
        }
        group["messages"].append(ai_response)


@app.get("/groups")
def list_groups():
    return list(groups.values())


@app.get("/groups/{group_id}/messages")
def list_messages(group_id: str):
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group["messages"]


@app.post("/groups/{group_id}/messages")
def add_message(group_id: str, message: NewMessage, background_tasks: BackgroundTasks):
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    # Save the user message with is_bot = False
    next_id = (group["messages"][-1]["id"] + 1) if group["messages"] else 1
    new_entry = {"id": next_id, "sender": message.sender, "text": message.text, "is_bot": False}
    group["messages"].append(new_entry)

    # Check if message starts with "@ai" and schedule AI response in background
    if message.text.startswith("@ai"):
        # Extract the question (remove "@ai" prefix and strip whitespace)
        question = message.text[3:].strip()
        
        if question:
            # Schedule AI reply generation as a background task
            # The AI response will be appended to messages when ready
            ai_id = next_id + 1
            background_tasks.add_task(generate_ai_reply, group_id, question, ai_id)

    # Return immediately without waiting for AI response
    return new_entry


@app.get("/groups/{group_id}/documents")
def list_documents(group_id: str):
    """List all PDF documents for a group"""
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Return documents for this group (or empty list if none)
    documents = group_documents.get(group_id, [])
    return documents


@app.post("/groups/{group_id}/documents")
async def upload_document(group_id: str, file: UploadFile = File(...)):
    """Upload a PDF document for a group"""
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Validate file type
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    # Generate unique filename to avoid conflicts
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"{timestamp}_{file.filename}"
    file_path = PDF_STORAGE_DIR / group_id / safe_filename
    
    # Create group-specific directory
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Save file to disk
    try:
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    
    # Store metadata in memory
    if group_id not in group_documents:
        group_documents[group_id] = []
    
    next_doc_id = max([doc.get("id", 0) for doc in group_documents[group_id]], default=0) + 1
    document_metadata = {
        "id": next_doc_id,
        "filename": file.filename,
        "uploaded_at": datetime.now().isoformat(),
        "file_path": str(file_path),
    }
    group_documents[group_id].append(document_metadata)
    
    return document_metadata


@app.get("/groups/{group_id}/documents/{document_id}")
def download_document(group_id: str, document_id: int):
    """Download a PDF document"""
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Find the document
    documents = group_documents.get(group_id, [])
    document = next((doc for doc in documents if doc["id"] == document_id), None)
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    file_path = Path(document["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    
    return FileResponse(
        path=file_path,
        filename=document["filename"],
        media_type="application/pdf"
    )
