import os
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from openai import OpenAI
from pypdf import PdfReader
from sqlalchemy.orm import Session

# Import database Base for Alembic to discover models
from database import Base, SessionLocal, get_db
import models  # Import models so Alembic can see them
from auth import hash_password, decode_token, verify_password, create_access_token

app = FastAPI(title="Group Chat Prototype")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def init_demo_data():
    """
    Initialize demo data in the database if it's empty.
    Only runs if no users exist in the database.
    """
    db = SessionLocal()
    try:
        # Check if any users exist
        existing_user = db.query(models.User).first()
        if existing_user:
            print("Database already has data. Skipping demo data initialization.")
            return

        print("Initializing demo data...")

        # Create Users
        # 1 coordinator
        coordinator = models.User(
            username="coordinator",
            password_hash=hash_password("coordinator1"),
            role="coordinator"
        )
        db.add(coordinator)

        # 2 supervisors
        supervisor1 = models.User(
            username="supervisor1",
            password_hash=hash_password("supervisor1"),
            role="supervisor"
        )
        supervisor2 = models.User(
            username="supervisor2",
            password_hash=hash_password("supervisor2"),
            role="supervisor"
        )
        db.add(supervisor1)
        db.add(supervisor2)

        # 8 students
        students = []
        for i in range(1, 9):
            student = models.User(
                username=f"student{i}",
                password_hash=hash_password(f"student{i}"),
                role="student"
            )
            students.append(student)
            db.add(student)

        # Flush to get IDs assigned
        db.flush()

        # Create Groups
        group1 = models.Group(name="Group 1")
        group2 = models.Group(name="Group 2")
        group3 = models.Group(name="Group 3")
        group4 = models.Group(name="Group 4")
        db.add_all([group1, group2, group3, group4])
        db.flush()

        # Create Group Memberships
        # Group 1: supervisor1, student1, student2
        db.add(models.GroupMember(user_id=supervisor1.id, group_id=group1.id))
        db.add(models.GroupMember(user_id=students[0].id, group_id=group1.id))
        db.add(models.GroupMember(user_id=students[1].id, group_id=group1.id))

        # Group 2: supervisor1, student3, student4
        db.add(models.GroupMember(user_id=supervisor1.id, group_id=group2.id))
        db.add(models.GroupMember(user_id=students[2].id, group_id=group2.id))
        db.add(models.GroupMember(user_id=students[3].id, group_id=group2.id))

        # Group 3: supervisor2, student5, student6
        db.add(models.GroupMember(user_id=supervisor2.id, group_id=group3.id))
        db.add(models.GroupMember(user_id=students[4].id, group_id=group3.id))
        db.add(models.GroupMember(user_id=students[5].id, group_id=group3.id))

        # Group 4: supervisor2, student7, student8
        db.add(models.GroupMember(user_id=supervisor2.id, group_id=group4.id))
        db.add(models.GroupMember(user_id=students[6].id, group_id=group4.id))
        db.add(models.GroupMember(user_id=students[7].id, group_id=group4.id))

        # Commit all changes
        db.commit()
        print("Demo data initialized successfully!")

    except Exception as e:
        db.rollback()
        print(f"Error initializing demo data: {str(e)}")
        raise
    finally:
        db.close()


@app.on_event("startup")
async def startup_event():
    """Run initialization tasks when the app starts."""
    init_demo_data()

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
    "group-c": {
        "id": "group-c",
        "name": "Group 3",
        "messages": [],
    },
    "group-d": {
        "id": "group-d",
        "name": "Group 4",
        "messages": [],
    },
}

# In-memory storage for PDF metadata: {group_id: [{"id": int, "filename": str, "uploaded_at": str, "file_path": str}, ...]}
group_documents = {
    "group-a": [],
    "group-b": [],
    "group-c": [],
    "group-d": [],
}


class NewMessage(BaseModel):
    sender: str
    text: str


class LoginRequest(BaseModel):
    username: str
    password: str


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


# Authentication dependency
def get_current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db)
) -> models.User:
    """
    Dependency to get the current authenticated user from JWT token.
    Expects Authorization header in format: "Bearer <token>"
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    
    try:
        # Extract token from "Bearer <token>"
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid authentication scheme")
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid authorization header format")
    
    # Decode token
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    # Get username from token (assuming it's stored as "sub" or "username")
    username = payload.get("sub") or payload.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Token missing username")
    
    # Get user from database
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    return user


@app.post("/auth/login")
def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """
    Login endpoint that verifies username and password, then returns a JWT token.
    """
    # Find user by username
    user = db.query(models.User).filter(models.User.username == login_data.username).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    # Verify password
    if not verify_password(login_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    # Create access token with username in the payload
    access_token = create_access_token(data={"sub": user.username}, expires_minutes=60)
    
    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


@app.get("/auth/me")
def get_current_user_info(current_user: models.User = Depends(get_current_user)):
    """
    Get the current logged-in user's username and role.
    """
    return {
        "username": current_user.username,
        "role": current_user.role
    }


@app.get("/my-groups")
def get_my_groups(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get groups the current user is allowed to see.
    Returns in-memory groups (with string IDs like "group-a") that match database groups.
    - Coordinator: sees all groups
    - Supervisor: sees only groups they are a member of
    - Student: sees only their own group
    """
    # Map database group IDs to in-memory group keys
    # Database Group 1 -> "group-a", Group 2 -> "group-b", Group 3 -> "group-c", Group 4 -> "group-d"
    db_to_mem_map = {
        1: "group-a",
        2: "group-b",
        3: "group-c",
        4: "group-d",
    }
    
    if current_user.role == "coordinator":
        # Coordinator sees all in-memory groups
        return list(groups.values())
    
    elif current_user.role == "supervisor":
        # Supervisor sees groups they are a member of (map database groups to in-memory groups)
        group_memberships = db.query(models.GroupMember).filter(
            models.GroupMember.user_id == current_user.id
        ).all()
        db_group_ids = {membership.group.id for membership in group_memberships}
        
        # Map database group IDs to in-memory groups
        result = []
        for db_group_id in db_group_ids:
            mem_key = db_to_mem_map.get(db_group_id)
            if mem_key and mem_key in groups:
                result.append(groups[mem_key])
        return result
    
    elif current_user.role == "student":
        # Student sees only their own group
        group_membership = db.query(models.GroupMember).filter(
            models.GroupMember.user_id == current_user.id
        ).first()
        if group_membership:
            # Map database group ID to in-memory group
            db_group_id = group_membership.group.id
            mem_key = db_to_mem_map.get(db_group_id)
            if mem_key and mem_key in groups:
                return [groups[mem_key]]
        return []
    
    else:
        raise HTTPException(status_code=403, detail="Unknown user role")


@app.get("/groups")
def list_groups():
    return list(groups.values())


def check_group_access(group_id: str, current_user: models.User, db: Session) -> bool:
    """
    Check if the current user has access to the specified group.
    Returns True if access is allowed, False otherwise.
    """
    # Check if group exists in in-memory groups
    if group_id not in groups:
        return False
    
    # Coordinator has access to all groups
    if current_user.role == "coordinator":
        return True
    
    # Map in-memory group_id to database group ID
    # "group-a" -> 1, "group-b" -> 2, "group-c" -> 3, "group-d" -> 4
    mem_to_db_map = {
        "group-a": 1,
        "group-b": 2,
        "group-c": 3,
        "group-d": 4,
    }
    db_group_id = mem_to_db_map.get(group_id)
    if not db_group_id:
        return False
    
    # Check if user is a member of this group
    membership = db.query(models.GroupMember).filter(
        models.GroupMember.user_id == current_user.id,
        models.GroupMember.group_id == db_group_id
    ).first()
    
    return membership is not None


@app.get("/groups/{group_id}/messages")
def list_messages(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    return group["messages"]


@app.post("/groups/{group_id}/messages")
def add_message(
    group_id: str,
    message: NewMessage,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

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
def list_documents(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all PDF documents for a group"""
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Return documents for this group (or empty list if none)
    documents = group_documents.get(group_id, [])
    return documents


@app.post("/groups/{group_id}/documents")
async def upload_document(
    group_id: str,
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload a PDF document for a group"""
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
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
