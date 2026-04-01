import os
import re
import json
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from openai import OpenAI
from pypdf import PdfReader
from sqlalchemy.orm import Session
from tavily import TavilyClient

# Import database Base for Alembic to discover models
from database import Base, SessionLocal, get_db, engine
import models  # Import models so Alembic can see them
from auth import hash_password, decode_token, verify_password, create_access_token

app = FastAPI(title="Group Chat Prototype")

# CORS configuration - allow localhost for development and frontend URL from environment for production
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://ms3015-chatbot.vercel.app"
]

# Add frontend URL from environment if it's different from localhost
if frontend_url not in allowed_origins:
    allowed_origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
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

        # Create Groups with string_id mapping
        group1 = models.Group(name="Group 1", string_id="group-a")
        group2 = models.Group(name="Group 2", string_id="group-b")
        group3 = models.Group(name="Group 3", string_id="group-c")
        group4 = models.Group(name="Group 4", string_id="group-d")
        db.add_all([group1, group2, group3, group4])
        db.flush()
        
        # Seed a few initial messages (only if no messages exist)
        if db.query(models.Message).count() == 0:
            # Group 1 messages
            db.add(models.Message(
                group_id=group1.id,
                user_id=students[0].id,
                content="Hey everyone!",
                is_AI=False
            ))
            db.add(models.Message(
                group_id=group1.id,
                user_id=students[1].id,
                content="Hi Alice!",
                is_AI=False
            ))
            # Group 2 message
            db.add(models.Message(
                group_id=group2.id,
                user_id=students[2].id,
                content="Who's ready for lunch?",
                is_AI=False
            ))
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
    # Create all database tables
    Base.metadata.create_all(bind=engine)
    # Ensure uploads directory exists
    PDF_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    # Only initialize demo data if SKIP_DEMO_DATA is not set (i.e., in local development)
    if not os.getenv("SKIP_DEMO_DATA"):
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

# In-memory storage removed - documents are now persisted in PostgreSQL


class NewMessage(BaseModel):
    sender: str
    text: str


class LoginRequest(BaseModel):
    username: str
    password: str


class StudentSummaryRequest(BaseModel):
    summary_text: str


def extract_text_from_pdfs(group_id: str, db: Session) -> str:
    """
    Extract text from all PDFs uploaded for a group.
    Returns concatenated text from all PDFs, or empty string if no PDFs.
    """
    # Query documents from database for this group
    documents = db.query(models.Document).filter(
        models.Document.group_id == group_id
    ).all()
    
    if not documents:
        return ""
    
    all_text = []
    for doc in documents:
        file_path = Path(doc.stored_path)
        if not file_path.exists():
            continue
        
        try:
            reader = PdfReader(file_path)
            pdf_text = []
            for page in reader.pages:
                pdf_text.append(page.extract_text())
            combined_text = "\n".join(pdf_text)
            if combined_text.strip():
                all_text.append(f"--- Content from {doc.filename} ---\n{combined_text}")
        except Exception as e:
            # If PDF reading fails, skip this document
            print(f"Error reading PDF {doc.filename}: {str(e)}")
            continue
    
    return "\n\n".join(all_text)


def web_search(query: str, max_results: int = 5) -> str:
    """
    Search the web using Tavily API and return formatted results.
    
    Args:
        query: Search query string
        max_results: Maximum number of results to return (default: 5)
    
    Returns:
        Formatted string with search results (title, content, URL) or error message
    """
    try:
        tavily_api_key = os.getenv("TAVILY_API_KEY")
        if not tavily_api_key:
            return "Error: TAVILY_API_KEY environment variable not set."
        
        client = TavilyClient(api_key=tavily_api_key)
        response = client.search(query=query, max_results=max_results)
        
        if not response.get("results"):
            return "No search results found."
        
        formatted_results = []
        for result in response["results"]:
            title = result.get("title", "No title")
            content = result.get("content", "No content available")
            url = result.get("url", "No URL available")
            formatted_results.append(f"Title: {title}\nContent: {content}\nSource: {url}\n")
        
        return "\n---\n".join(formatted_results)
    except Exception as e:
        return f"Error performing web search: {str(e)}"


def generate_ai_reply(group_id: str, question: str, db_group_id: int, username: str = None):
    """
    Background task to generate AI reply and save it to the database.
    This runs asynchronously after the POST endpoint returns.
    username: The username of the user who asked the question (for mention in response)
    """
    db = SessionLocal()
    try:
        # Verify group exists
        db_group = db.query(models.Group).filter(models.Group.id == db_group_id).first()
        if not db_group:
            return  # Group doesn't exist, skip
        
        if not openai_client:
            # If OpenAI client is not initialized, save error message
            error_message = "Error: OPENAI_API_KEY environment variable not set. Please configure your API key."
            if username:
                error_message = f"@{username}: {error_message}"
            
            ai_message = models.Message(
                group_id=db_group_id,
                user_id=None,  # AI messages have no user
                content=error_message,
                is_AI=True
            )
            db.add(ai_message)
            db.commit()
            return
        
        try:
            # Extract text from PDFs uploaded for this group (for RAG - documents influence answers silently)
            pdf_context = extract_text_from_pdfs(group_id, db)
            
            # Build system message based on whether PDFs exist
            if pdf_context:
                system_message = """IMPORTANT: The complete text content from uploaded documents is provided below. When users ask about documents or topics covered in these documents, search through this content and cite it as [filename.pdf].

If the user's question is NOT covered in the provided documents, you should:
1. Check if it's a current events question → use web_search tool
2. If it's general knowledge → use your training data
3. Be clear about which source you're using

DO NOT say you cannot access documents - the full text is provided below. However, DO acknowledge when information is not in the documents and you're using other sources.

Formatting guidelines:
- Use markdown formatting: **bold** for emphasis, bullet points for lists

Document content:

""" + f"{pdf_context}"
            else:
                system_message = """You are an AI assistant in a university group chat for a Materials Science module.

Guidelines:
- Provide detailed, comprehensive, and well-structured responses
- Use markdown formatting: **bold** for emphasis, bullet points for lists, numbered lists for steps
- Break down complex topics into clear, understandable explanations
- If you don't know something, explicitly say so - never make up information
- Be professional but conversational for an academic setting

Your goal: Help students with their Materials Science coursework through thorough, accurate, and helpful responses."""
            
            # Define tools for function calling
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": "web_search",
                        "description": "Search the web for current information. Use this when users ask about recent events, news, current data, or topics requiring up-to-date information.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "The search query to look up on the web"
                                },
                                "max_results": {
                                    "type": "integer",
                                    "description": "Maximum number of search results to return",
                                    "default": 5
                                }
                            },
                            "required": ["query"]
                        }
                    }
                }
            ]
            
            # Fetch last 10 messages from this group for conversation context
            recent_messages = db.query(models.Message).filter(
                models.Message.group_id == db_group_id
            ).order_by(models.Message.timestamp.desc()).limit(10).all()
            
            # Reverse to get chronological order (oldest first)
            recent_messages.reverse()
            
            # Build conversation history
            conversation_history = []
            for msg in recent_messages:
                if msg.is_AI:
                    # AI messages: format as assistant role
                    conversation_history.append({
                        "role": "assistant",
                        "content": msg.content
                    })
                else:
                    # User messages: format as user role with username
                    username = msg.user.username if msg.user else "Unknown"
                    conversation_history.append({
                        "role": "user",
                        "content": f"{username}: {msg.content}"
                    })
            
            # Initialize messages list with system message, conversation history, and current question
            messages = [
                {"role": "system", "content": system_message}
            ]
            # Add conversation history
            messages.extend(conversation_history)
            # Add current user question
            messages.append({"role": "user", "content": question})
            
            # Debug logging before API call
            print(f"DEBUG: User question: {question}")
            print(f"DEBUG: Tools available: {len(tools)} tool(s)")
            
            # Call OpenAI API with function calling
            response = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                tools=tools,
                tool_choice="auto",
                max_tokens=500,
                temperature=0.7
            )
            
            # Debug logging after API call
            print(f"DEBUG: Tool calls: {response.choices[0].message.tool_calls}")
            
            # Handle tool calls if present
            message = response.choices[0].message
            if message.tool_calls:
                # Execute web_search tool call
                for tool_call in message.tool_calls:
                    if tool_call.function.name == "web_search":
                        function_args = json.loads(tool_call.function.arguments)
                        search_query = function_args.get("query", "")
                        max_results = function_args.get("max_results", 5)
                        
                        # Execute web search
                        search_results = web_search(search_query, max_results)
                        
                        # Append tool result to messages
                        messages.append({
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": tool_call.id,
                                    "type": "function",
                                    "function": {
                                        "name": "web_search",
                                        "arguments": tool_call.function.arguments
                                    }
                                }
                            ]
                        })
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": "web_search",
                            "content": search_results
                        })
                
                # Get final response with search results
                final_response = openai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                    max_tokens=500,
                    temperature=0.7
                )
                ai_text = final_response.choices[0].message.content
            else:
                # No tool calls, use response directly
                ai_text = message.content
            
            # Prepend username mention if available
            if username:
                ai_text = f"@{username}: {ai_text}"
            
            # Save AI bot response to database
            ai_message = models.Message(
                group_id=db_group_id,
                user_id=None,  # AI messages have no user
                content=ai_text,
                is_AI=True
            )
            db.add(ai_message)
            db.commit()
        except Exception as e:
            # Handle API errors gracefully
            error_message = f"Error: Failed to get AI response. {str(e)}"
            if username:
                error_message = f"@{username}: {error_message}"
            
            ai_message = models.Message(
                group_id=db_group_id,
                user_id=None,
                content=error_message,
                is_AI=True
            )
            db.add(ai_message)
            db.commit()
    except Exception as e:
        db.rollback()
        print(f"Error saving AI reply: {str(e)}")
    finally:
        db.close()


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
    Returns groups with string IDs like "group-a" from database, sorted by group number.
    - Coordinator: sees all groups
    - Supervisor: sees only groups they are a member of
    - Student: sees only groups they are a member of
    """
    def extract_group_number(group_name):
        """Extract numeric part from group name (e.g., 'Group 1' -> 1)"""
        match = re.search(r'\d+', group_name)
        return int(match.group()) if match else 999
    
    if current_user.role == "coordinator":
        # Coordinator sees all groups
        all_groups = db.query(models.Group).all()
        # Sort by group number extracted from name
        sorted_groups = sorted(all_groups, key=lambda g: extract_group_number(g.name))
        return [{"id": group.string_id, "name": group.name} for group in sorted_groups]
    
    elif current_user.role == "supervisor" or current_user.role == "student":
        # Supervisor/Student sees groups they are a member of
        group_memberships = db.query(models.GroupMember).filter(
            models.GroupMember.user_id == current_user.id
        ).all()
        user_groups = [membership.group for membership in group_memberships]
        # Sort by group number extracted from name
        sorted_groups = sorted(user_groups, key=lambda g: extract_group_number(g.name))
        return [{"id": group.string_id, "name": group.name} for group in sorted_groups]
    
    else:
        raise HTTPException(status_code=403, detail="Unknown user role")


@app.get("/groups")
def list_groups(db: Session = Depends(get_db)):
    """List all groups (legacy endpoint - frontend uses /my-groups)"""
    all_groups = db.query(models.Group).all()
    return [{"id": group.string_id, "name": group.name} for group in all_groups]


def check_group_access(group_id: str, current_user: models.User, db: Session) -> bool:
    """
    Check if the current user has access to the specified group.
    Returns True if access is allowed, False otherwise.
    """
    # Find group by string_id
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        return False
    
    # Coordinator has access to all groups
    if current_user.role == "coordinator":
        return True
    
    # Check if user is a member of this group
    membership = db.query(models.GroupMember).filter(
        models.GroupMember.user_id == current_user.id,
        models.GroupMember.group_id == db_group.id
    ).first()
    
    return membership is not None


def check_summary_access(group_id: str, current_user: models.User, db: Session) -> bool:
    """
    Check if the current user has access to summaries for the specified group.
    Returns True if access is allowed, False otherwise.
    Access rules: coordinator OR (member of group - includes supervisors and students).
    """
    # Find group by string_id
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        return False
    
    # Coordinator has access to all groups
    if current_user.role == "coordinator":
        return True
    
    # All group members (supervisors and students) have access
    membership = db.query(models.GroupMember).filter(
        models.GroupMember.user_id == current_user.id,
        models.GroupMember.group_id == db_group.id
    ).first()
    return membership is not None


@app.get("/groups/{group_id}/messages")
def list_messages(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Find group by string_id
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Query messages from database
    messages = db.query(models.Message).filter(
        models.Message.group_id == db_group.id
    ).order_by(models.Message.timestamp).all()
    
    # Convert to API format: [{id, sender, text, is_bot}]
    result = []
    for msg in messages:
        sender = "AI Bot" if msg.is_AI else (msg.user.username if msg.user else "Unknown")
        result.append({
            "id": msg.id,
            "sender": sender,
            "text": msg.content,
            "is_bot": msg.is_AI
        })
    
    return result


@app.post("/groups/{group_id}/messages")
def add_message(
    group_id: str,
    message: NewMessage,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Find group by string_id
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    # Save the user message to database
    new_message = models.Message(
        group_id=db_group.id,
        user_id=current_user.id,
        content=message.text,
        is_AI=False
    )
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    # Check if message starts with "@ai" and schedule AI response in background
    if message.text.startswith("@ai"):
        # Extract the question (remove "@ai" prefix and strip whitespace)
        question = message.text[3:].strip()
        
        if question:
            # Schedule AI reply generation as a background task
            # Pass the username so the AI can mention them in the response
            background_tasks.add_task(generate_ai_reply, group_id, question, db_group.id, current_user.username)

    # Return in API format: {id, sender, text, is_bot}
    return {
        "id": new_message.id,
        "sender": current_user.username,
        "text": new_message.content,
        "is_bot": False
    }


@app.get("/groups/{group_id}/documents")
def list_documents(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all PDF documents for a group"""
    # Check if group exists in database
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Query documents from database
    documents = db.query(models.Document).filter(
        models.Document.group_id == group_id
    ).order_by(models.Document.created_at.desc()).all()
    
    # Convert to API format: [{id, filename, uploaded_at, file_path, uploaded_by, file_size}]
    import os
    result = []
    for doc in documents:
        # Get file size
        file_size = 0
        if os.path.exists(doc.stored_path):
            file_size = os.path.getsize(doc.stored_path)
        
        # Get uploader username
        uploader_name = "Unknown"
        if doc.uploaded_by:
            uploader_name = doc.uploaded_by.username
        
        # Ensure UTC timestamp is marked with 'Z' suffix
        uploaded_at_iso = doc.created_at.isoformat()
        if not uploaded_at_iso.endswith('Z'):
            uploaded_at_iso = uploaded_at_iso + 'Z'
        
        result.append({
            "id": doc.id,
            "filename": doc.filename,
            "uploaded_at": uploaded_at_iso,
            "file_path": doc.stored_path,
            "uploaded_by": uploader_name,
            "file_size": file_size,
        })
    
    return result


@app.post("/groups/{group_id}/documents")
async def upload_document(
    group_id: str,
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload a PDF document for a group"""
    # Check if group exists in database
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Validate file type
    allowed_extensions = ['.pdf', '.doc', '.docx']
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Only PDF, DOC, and DOCX files are allowed")
    
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
    
    # Store metadata in database
    document = models.Document(
        group_id=group_id,
        uploaded_by_user_id=current_user.id,
        filename=file.filename,
        stored_path=str(file_path),
        created_at=datetime.utcnow()
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    
    # Get file size
    file_size = os.path.getsize(file_path)
    
    # Return in API format: {id, filename, uploaded_at, file_path, uploaded_by, file_size}
    # Ensure UTC timestamp is marked with 'Z' suffix
    uploaded_at_iso = document.created_at.isoformat()
    if not uploaded_at_iso.endswith('Z'):
        uploaded_at_iso = uploaded_at_iso + 'Z'
    
    return {
        "id": document.id,
        "filename": document.filename,
        "uploaded_at": uploaded_at_iso,
        "file_path": document.stored_path,
        "uploaded_by": current_user.username,
        "file_size": file_size,
    }


@app.get("/groups/{group_id}/documents/{document_id}")
def download_document(
    group_id: str,
    document_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Download a PDF document"""
    # Check if group exists in database
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Find the document in database
    document = db.query(models.Document).filter(
        models.Document.id == document_id,
        models.Document.group_id == group_id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    file_path = Path(document.stored_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    
    return FileResponse(
        path=file_path,
        filename=document.filename,
        media_type="application/pdf"
    )


@app.delete("/groups/{group_id}/documents/{document_id}")
def delete_document(
    group_id: str,
    document_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a document from the database and file system"""
    # Check if group exists in database
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Find the document in database
    document = db.query(models.Document).filter(
        models.Document.id == document_id,
        models.Document.group_id == group_id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete the file from file system
    file_path = Path(document.stored_path)
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception as e:
            # Log error but continue with database deletion
            print(f"Error deleting file {file_path}: {str(e)}")
    
    # Delete the document from database
    db.delete(document)
    db.commit()
    
    return {"message": "Document deleted successfully"}


@app.get("/groups/{group_id}/summary")
def get_summary(
    group_id: str,
    range: str = Query("weekly", description="Summary range type (e.g., 'weekly', 'full')"),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get the latest summary for a group.
    Access: coordinator OR (member of group - includes supervisors and students).
    """
    # Check if group exists in database
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization (coordinator or supervisor only, no students)
    if not check_summary_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Query for the latest summary matching the group_id and range_type
    summary = db.query(models.Summary).filter(
        models.Summary.group_id == group_id,
        models.Summary.range_type == range
    ).order_by(models.Summary.created_at.desc()).first()
    
    # If no summary exists, return empty summary structure
    if not summary:
        return {
            "group_id": group_id,
            "range": range,
            "summary_text": "",
            "created_at": None,
            "start_time": None,
            "end_time": None,
            "source_last_message_ts": None,
            "source_message_count": None
        }
    
    # Return summary data
    return {
        "group_id": summary.group_id,
        "range": summary.range_type,
        "summary_text": summary.summary_text,
        "created_at": summary.created_at.isoformat() if summary.created_at else None,
        "start_time": summary.start_time.isoformat() if summary.start_time else None,
        "end_time": summary.end_time.isoformat() if summary.end_time else None,
        "source_last_message_ts": summary.source_last_message_ts.isoformat() if summary.source_last_message_ts else None,
        "source_message_count": summary.source_message_count
    }


@app.post("/groups/{group_id}/summary")
def generate_summary(
    group_id: str,
    range: str = Query("weekly", description="Summary range type (e.g., 'weekly', 'full')"),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate and save a summary for a group.
    Access: coordinator OR (member of group - includes supervisors and students).
    """
    # Check if group exists in database
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization (coordinator or group member)
    if not check_summary_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Handle different range types
    if range == "weekly":
        # Get messages from the last 7 days
        cutoff_time = datetime.utcnow() - timedelta(days=7)
        messages = db.query(models.Message).filter(
            models.Message.group_id == db_group.id,
            models.Message.timestamp >= cutoff_time
        ).order_by(models.Message.timestamp.asc()).all()
    else:
        # For other range types, fetch all messages (can be extended later)
        messages = db.query(models.Message).filter(
            models.Message.group_id == db_group.id
        ).order_by(models.Message.timestamp.asc()).all()
    
    # Check if there are any messages
    if not messages:
        # Return friendly message
        return {
            "group_id": group_id,
            "range": range,
            "summary_text": "No messages in the selected period.",
            "created_at": datetime.utcnow().isoformat(),
            "start_time": None,
            "end_time": None,
            "source_last_message_ts": None,
            "source_message_count": 0
        }
    
    # Get the latest message timestamp for optimization check
    latest_message_ts = messages[-1].timestamp
    
    # Check if we can reuse an existing summary (optimization)
    existing_summary = db.query(models.Summary).filter(
        models.Summary.group_id == group_id,
        models.Summary.range_type == range
    ).order_by(models.Summary.created_at.desc()).first()
    
    if existing_summary and existing_summary.source_last_message_ts:
        # Check if the latest message timestamp matches
        if existing_summary.source_last_message_ts == latest_message_ts:
            # No new messages, return existing summary
            return {
                "group_id": existing_summary.group_id,
                "range": existing_summary.range_type,
                "summary_text": existing_summary.summary_text,
                "created_at": existing_summary.created_at.isoformat() if existing_summary.created_at else None,
                "start_time": existing_summary.start_time.isoformat() if existing_summary.start_time else None,
                "end_time": existing_summary.end_time.isoformat() if existing_summary.end_time else None,
                "source_last_message_ts": existing_summary.source_last_message_ts.isoformat() if existing_summary.source_last_message_ts else None,
                "source_message_count": existing_summary.source_message_count
            }
    
    # Build transcript from messages
    transcript_lines = []
    for msg in messages:
        timestamp_str = msg.timestamp.strftime("%Y-%m-%d %H:%M")
        username = "AI Bot" if msg.is_AI else (msg.user.username if msg.user else "Unknown")
        transcript_lines.append(f"[{timestamp_str}] {username}: {msg.content}")
    
    transcript = "\n".join(transcript_lines)
    
    # Check if OpenAI client is available
    if not openai_client:
        # If OpenAI is not available, save an error summary
        summary_text = "Error: OPENAI_API_KEY environment variable not set. Please configure your API key."
    else:
        try:
            # Build prompt for simple summary generation
            system_prompt = (
                "You are a helpful assistant that creates concise, readable summaries of group chat conversations. "
                "Analyze the conversation transcript and provide a summary in EXACTLY this format:\n\n"
                "First, write a short plain-language paragraph (2-3 sentences) explaining what happened in the group recently. "
                "Then, on a new line, write 'Key points:' followed by 3-6 concise bullet points on separate lines. "
                "Finally, on a new line, write 'Supervisor Action Plan:' followed by 2-3 actionable recommendations for supervisors based on the conversation.\n\n"
                "CRITICAL FORMATTING RULES:\n"
                "- DO NOT use any markdown headings (no #, ##, ###, etc.)\n"
                "- DO NOT use markdown bold (**text**)\n"
                "- DO NOT create sections like 'Highlights', 'Decisions', 'Open Questions', or 'Action Items'\n"
                "- Use simple dashes (-) or asterisks (*) for bullets, NOT markdown\n"
                "- Write in plain text only\n"
                "- Keep the paragraph conversational and easy to read\n"
                "- Make bullets action-oriented and skimmable\n"
                "- Supervisor Action Plan bullets should be concrete, specific, and actionable\n"
                "- Example format:\n"
                "  The group discussed project timelines and resource allocation. Several team members shared updates on their progress.\n\n"
                "  Key points:\n"
                "  - Project deadline moved to next month\n"
                "  - Need to assign additional developer\n"
                "  - Client feedback session scheduled for Friday\n\n"
                "  Supervisor Action Plan:\n"
                "  - Schedule a meeting with the team to discuss resource allocation and clarify roles\n"
                "  - Review the project timeline and provide guidance on priority tasks\n"
                "  - Follow up with the client to confirm feedback session details"
            )
            
            user_prompt = f"Please create a summary of the following group chat conversation:\n\n{transcript}"
            
            # Call OpenAI API
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1200,
                temperature=0.7
            )
            
            summary_text = response.choices[0].message.content
        except Exception as e:
            # Handle API errors gracefully
            summary_text = f"Error: Failed to generate summary. {str(e)}"
    
    # Calculate time range
    start_time = messages[0].timestamp
    end_time = messages[-1].timestamp
    
    # Save summary to database
    new_summary = models.Summary(
        group_id=group_id,
        range_type=range,
        start_time=start_time,
        end_time=end_time,
        summary_text=summary_text,
        created_by_user_id=current_user.id,
        source_last_message_ts=latest_message_ts,
        source_message_count=len(messages),
        created_at=datetime.utcnow()
    )
    db.add(new_summary)
    db.commit()
    db.refresh(new_summary)
    
    # Return summary data
    return {
        "group_id": new_summary.group_id,
        "range": new_summary.range_type,
        "summary_text": new_summary.summary_text,
        "created_at": new_summary.created_at.isoformat() if new_summary.created_at else None,
        "start_time": new_summary.start_time.isoformat() if new_summary.start_time else None,
        "end_time": new_summary.end_time.isoformat() if new_summary.end_time else None,
        "source_last_message_ts": new_summary.source_last_message_ts.isoformat() if new_summary.source_last_message_ts else None,
        "source_message_count": new_summary.source_message_count
    }


@app.get("/groups/{group_id}/student-summary")
def get_student_summary(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get the student summary for a group.
    Access: All group members (students, supervisors, coordinators).
    """
    # Check if group exists in database
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization (all group members can access)
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Return the student summary (can be None/empty)
    return {
        "group_id": group_id,
        "summary_text": db_group.student_summary or ""
    }


@app.post("/groups/{group_id}/student-summary")
def update_student_summary(
    group_id: str,
    request: StudentSummaryRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update the student summary for a group.
    Access: All group members (students, supervisors, coordinators).
    """
    # Check if group exists in database
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check authorization (all group members can update)
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")
    
    # Update the student summary
    db_group.student_summary = request.summary_text
    db.commit()
    db.refresh(db_group)
    
    # Return the updated summary
    return {
        "group_id": group_id,
        "summary_text": db_group.student_summary or ""
    }
