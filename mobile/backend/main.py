import os
import re
import json
import base64
import asyncio
import requests as http_requests
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Depends, Header, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from openai import OpenAI
from pypdf import PdfReader
from docx import Document as DocxDocument
from sqlalchemy import text
from sqlalchemy.orm import Session
from tavily import TavilyClient

# Import database Base for Alembic to discover models
from database import Base, SessionLocal, get_db, engine
import models  # Import models so Alembic can see them
from auth import hash_password, decode_token, verify_password, create_access_token
from rag import index_document, get_relevant_context, get_top_document
from websocket_manager import manager

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


EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def send_push_notifications(tokens: list[str], title: str, body: str, data: dict):
    """Fire-and-forget push to the Expo push service. Failures are non-critical."""
    messages = [
        {"to": t, "title": title, "body": body, "data": data, "sound": "default"}
        for t in tokens
        if t.startswith("ExponentPushToken[")
    ]
    if not messages:
        return
    try:
        http_requests.post(EXPO_PUSH_URL, json=messages, timeout=5)
    except Exception:
        pass  # push failures should never break the WS flow


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


def migrate_student_summaries():
    # runs once on startup — copies any existing Group.student_summary text into
    # the new student_summaries table so we don't lose data when switching to the new model
    db = SessionLocal()
    try:
        # already migrated on a previous startup — nothing to do
        if db.query(models.StudentSummary).first():
            return

        groups_with_text = db.query(models.Group).filter(
            models.Group.student_summary != None,
            models.Group.student_summary != ""
        ).all()

        for group in groups_with_text:
            db.add(models.StudentSummary(
                group_id=group.string_id,
                summary_text=group.student_summary,
                created_at=datetime.utcnow(),
                created_by_user_id=None,
            ))

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Error during student summary migration: {str(e)}")
    finally:
        db.close()


@app.on_event("startup")
async def startup_event():
    """Run initialization tasks when the app starts."""
    # Create all database tables
    Base.metadata.create_all(bind=engine)
    # Add any columns that were added after the DB was first created.
    # SQLite doesn't support IF NOT EXISTS on ALTER TABLE, so wrap in try/except.
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE group_members ADD COLUMN last_read_message_id INTEGER"))
            conn.commit()
        except Exception:
            pass  # column already exists — safe to ignore
        try:
            conn.execute(text("ALTER TABLE messages ADD COLUMN message_type VARCHAR DEFAULT 'text' NOT NULL"))
            conn.commit()
        except Exception:
            pass  # column already exists — safe to ignore
    # Copy any existing Group.student_summary text into the new student_summaries table
    migrate_student_summaries()
    # Ensure uploads directories exist
    PDF_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
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

# Setup image storage directory for chat images
IMAGE_STORAGE_DIR = Path("uploads/images")
IMAGE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

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
    db = SessionLocal()
    try:
        db_group = db.query(models.Group).filter(models.Group.id == db_group_id).first()
        if not db_group:
            return

        if not openai_client:
            error_message = "Error: OPENAI_API_KEY environment variable not set. Please configure your API key."
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
            return

        try:
            # Ask the RAG pipeline for the most relevant chunks and its confidence
            chunks, top_score = get_relevant_context(group_id, question)

            # Fetch last 10 messages for conversation context
            recent_messages = db.query(models.Message).filter(
                models.Message.group_id == db_group_id
            ).order_by(models.Message.timestamp.desc()).limit(10).all()

            # Reverse to get chronological order (oldest first)
            recent_messages.reverse()

            # Build conversation history
            conversation_history = []
            for msg in recent_messages:
                if msg.is_AI:
                    conversation_history.append({
                        "role": "assistant",
                        "content": msg.content
                    })
                else:
                    msg_sender = msg.user.username if msg.user else "Unknown"
                    conversation_history.append({
                        "role": "user",
                        "content": f"{msg_sender}: {msg.content}"
                    })

            # The exact phrase Case 2 tells GPT-4o to say when the answer isn't
            # in the document — pipeline looks for this string to trigger Case 3
            REFUSAL_PHRASE = "I don't have that information in the uploaded documents"

            sources = []
            ai_text = ""

            if top_score >= 0.0:
                # --- Case 1: RAG path ---
                # Top chunks scored well — answer directly from them
                print(f"[RAG] Case 1 triggered — answering from document chunks")
                context_parts = [
                    f"[{chunk['filename']}]\n{chunk['text']}"
                    for chunk in chunks
                ]
                context_str = "\n\n".join(context_parts)

                system_message = (
                    "Answer the question using ONLY the context passages provided below. "
                    "Each passage is labelled with its source file in square brackets. "
                    "Cite the source inline as [filename.pdf] when you use information from it. "
                    "Do not use general knowledge. Do not make up information.\n\n"
                    "Context:\n\n" + context_str
                )

                messages = [{"role": "system", "content": system_message}]
                messages.extend(conversation_history)
                messages.append({"role": "user", "content": question})

                response = openai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=messages,
                    max_tokens=500,
                    temperature=0.7
                )
                ai_text = response.choices[0].message.content

                sources = [
                    {"type": "doc", "filename": c["filename"], "chunk_index": c["chunk_index"]}
                    for c in chunks
                ]

            else:
                # --- Case 2: Full document fallback ---
                # Chunks scored too low — find the best-matching document and
                # pass its full text so GPT-4o has a fair chance to answer
                fallback_filename = get_top_document(chunks) if chunks else None
                print(f"[RAG] Case 2 triggered — full document fallback: {fallback_filename}")
                fallback_text = ""

                if fallback_filename:
                    doc_record = db.query(models.Document).filter(
                        models.Document.group_id == group_id,
                        models.Document.filename == fallback_filename
                    ).first()
                    if doc_record and Path(doc_record.stored_path).exists():
                        try:
                            reader = PdfReader(Path(doc_record.stored_path))
                            fallback_text = "\n".join(
                                page.extract_text() or "" for page in reader.pages
                            )
                        except Exception:
                            fallback_text = ""

                if fallback_text.strip():
                    system_message = (
                        f"Answer the question using ONLY the document provided below. "
                        f"Cite the source inline as [{fallback_filename}] when you use information from it. "
                        f"If the answer is genuinely not in the document, reply with exactly: "
                        f"\"{REFUSAL_PHRASE}\"\n\n"
                        f"Document:\n\n{fallback_text}"
                    )

                    messages = [{"role": "system", "content": system_message}]
                    messages.extend(conversation_history)
                    messages.append({"role": "user", "content": question})

                    response = openai_client.chat.completions.create(
                        model="gpt-4o",
                        messages=messages,
                        max_tokens=500,
                        temperature=0.7
                    )
                    ai_text = response.choices[0].message.content

                    if REFUSAL_PHRASE not in ai_text:
                        # GPT-4o found the answer in the full document
                        sources = [{"type": "doc", "filename": fallback_filename}]
                    else:
                        # GPT-4o struck out — clear ai_text so we fall into Case 3
                        ai_text = ""
                        sources = []

                if not ai_text:
                    # --- Case 3: Tavily web search ---
                    # Pipeline calls Tavily explicitly — results passed as plain
                    # text context, not as a tool to GPT-4o
                    print(f"[RAG] Case 3 triggered — Tavily web search fallback")
                    tavily_api_key = os.getenv("TAVILY_API_KEY")
                    web_results = []

                    if tavily_api_key:
                        try:
                            tavily_client_obj = TavilyClient(api_key=tavily_api_key)
                            tavily_response = tavily_client_obj.search(
                                query=question, max_results=5
                            )
                            web_results = tavily_response.get("results", [])
                        except Exception:
                            web_results = []

                    if not web_results:
                        print(f"[RAG] All cases failed — returning final refusal")
                        ai_text = "I don't have enough information to answer that question."
                        sources = []
                    else:
                        context_parts = []
                        for result in web_results:
                            title = result.get("title", "")
                            content = result.get("content", "")
                            url = result.get("url", "")
                            context_parts.append(f"Title: {title}\n{content}\nSource: {url}")
                        context_str = "\n\n---\n\n".join(context_parts)

                        system_message = (
                            "The uploaded documents do not contain the answer to this question. "
                            "Answer using the web search results provided below. "
                            "Clearly state in your response that this information comes from "
                            "a web search, not the uploaded documents. "
                            "Include the source URLs in your response.\n\n"
                            "Web search results:\n\n" + context_str
                        )

                        messages = [{"role": "system", "content": system_message}]
                        messages.extend(conversation_history)
                        messages.append({"role": "user", "content": question})

                        response = openai_client.chat.completions.create(
                            model="gpt-4o",
                            messages=messages,
                            max_tokens=500,
                            temperature=0.7
                        )
                        ai_text = response.choices[0].message.content

                        sources = [
                            {"type": "web", "url": r.get("url", "")}
                            for r in web_results
                            if r.get("url")
                        ]

            if username:
                ai_text = f"@{username}: {ai_text}"

            ai_message = models.Message(
                group_id=db_group_id,
                user_id=None,
                content=ai_text,
                is_AI=True,
                sources=sources if sources else None
            )
            db.add(ai_message)
            db.commit()

        except Exception as e:
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


@app.websocket("/ws/groups/{group_id}")
async def websocket_endpoint(websocket: WebSocket, group_id: str):
    # Token comes in as a query param since WS connections can't use headers
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4008)
        return

    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4008)
        return

    username = payload.get("sub") or payload.get("username")
    if not username:
        await websocket.close(code=4008)
        return

    db = SessionLocal()
    try:
        current_user = db.query(models.User).filter(models.User.username == username).first()
        if not current_user:
            await websocket.close(code=4008)
            return

        await websocket.accept()
        manager.connect(websocket, group_id, current_user.id)

        # Push any unread notifications that arrived while the user was offline
        pending = db.query(models.Notification, models.Group).join(
            models.Group, models.Group.id == models.Notification.group_id
        ).filter(
            models.Notification.recipient_id == current_user.id,
            models.Notification.is_read == False
        ).all()
        for notif, grp in pending:
            await manager.send_to_user(current_user.id, {
                "type": "notification",
                "id": notif.id,
                "sender_id": notif.sender_id,
                "message_id": notif.message_id,
                "group_id": notif.group_id,
                "group_string_id": grp.string_id,
                "created_at": notif.created_at.isoformat()
            })

        # Look up the integer group PK once — needed for DB writes
        db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()

        try:
            while True:
                data = await websocket.receive_json()
                content = data.get("content", "").strip()
                if not content:
                    continue

                # Save the message
                new_message = models.Message(
                    group_id=db_group.id,
                    user_id=current_user.id,
                    content=content,
                    is_AI=False
                )
                db.add(new_message)
                db.commit()
                db.refresh(new_message)

                # Broadcast the message to everyone in the group
                await manager.broadcast_to_group(group_id, {
                    "type": "message",
                    "id": new_message.id,
                    "sender": current_user.username,
                    "text": content,
                    "is_bot": False,
                    "group_string_id": group_id,
                    "timestamp": new_message.timestamp.isoformat()
                })

                # Nudge members who are connected to a *different* group's WS
                # so their badge counter updates without a full page refresh
                group_members = db.query(models.GroupMember).filter(
                    models.GroupMember.group_id == db_group.id
                ).all()
                watching = manager.active_user_ids_in_group(group_id)
                for member in group_members:
                    # sender already got the broadcast above
                    if member.user_id == current_user.id:
                        continue
                    # already got the broadcast because they're watching this group
                    if member.user_id in watching:
                        continue
                    await manager.send_to_user(member.user_id, {
                        "type": "message",
                        "id": new_message.id,
                        "sender": current_user.username,
                        "text": content,
                        "is_bot": False,
                        "group_string_id": group_id
                    })
                    # this user has no live WebSocket — send a push notification
                    # so they see a banner even if the app is backgrounded/closed
                    offline_tokens = [
                        pt.token for pt in db.query(models.PushToken).filter(
                            models.PushToken.user_id == member.user_id
                        ).all()
                    ]
                    if offline_tokens:
                        # run in a thread — requests.post is blocking and would
                        # stall the event loop (and all other WS connections) if awaited directly
                        asyncio.get_running_loop().run_in_executor(
                            None,
                            send_push_notifications,
                            offline_tokens,
                            f"{db_group.name}",
                            f"{current_user.username}: {content[:100]}",
                            {"groupId": group_id, "groupName": db_group.name},
                        )

                # Go through @mentions and notify the tagged users
                mentions = re.findall(r"@(\w+)", content)
                for mentioned_username in mentions:
                    # skip @ai — that's handled separately below
                    if mentioned_username.lower() == "ai":
                        continue
                    # skip self-mentions
                    if mentioned_username == current_user.username:
                        continue
                    # only notify if they're actually in this group
                    mentioned_user = db.query(models.User).join(
                        models.GroupMember,
                        models.GroupMember.user_id == models.User.id
                    ).filter(
                        models.User.username == mentioned_username,
                        models.GroupMember.group_id == db_group.id
                    ).first()
                    if not mentioned_user:
                        continue

                    notif = models.Notification(
                        recipient_id=mentioned_user.id,
                        sender_id=current_user.id,
                        message_id=new_message.id,
                        group_id=db_group.id
                    )
                    db.add(notif)
                    db.commit()
                    db.refresh(notif)

                    await manager.send_to_user(mentioned_user.id, {
                        "type": "notification",
                        "id": notif.id,
                        "sender_id": current_user.id,
                        "message_id": new_message.id,
                        "group_id": db_group.id,
                        "group_string_id": db_group.string_id,
                        "created_at": notif.created_at.isoformat()
                    })

                # If @ai is in the message, run the RAG pipeline and broadcast the reply
                if "@ai" in content.lower():
                    question = re.sub(r"@ai\s*", "", content, flags=re.IGNORECASE).strip()
                    if question:
                        # generate_ai_reply is blocking (OpenAI call) — run it in a
                        # thread so the event loop stays free for other connections
                        loop = asyncio.get_running_loop()
                        await loop.run_in_executor(
                            None,
                            generate_ai_reply,
                            group_id,
                            question,
                            db_group.id,
                            current_user.username
                        )
                        # Fetch the AI message that was just written and broadcast it
                        ai_message = db.query(models.Message).filter(
                            models.Message.group_id == db_group.id,
                            models.Message.is_AI == True
                        ).order_by(models.Message.timestamp.desc()).first()
                        if ai_message:
                            await manager.broadcast_to_group(group_id, {
                                "type": "message",
                                "id": ai_message.id,
                                "sender": "AI Bot",
                                "text": ai_message.content,
                                "is_bot": True,
                                "group_string_id": group_id,
                                "timestamp": ai_message.timestamp.isoformat()
                            })

        except WebSocketDisconnect:
            manager.disconnect(group_id, current_user.id, websocket)

    finally:
        db.close()


@app.websocket("/ws/home")
async def home_websocket_endpoint(websocket: WebSocket):
    # same auth pattern as /ws/groups/{group_id} — token comes in as a query param
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4008)
        return

    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4008)
        return

    username = payload.get("sub") or payload.get("username")
    if not username:
        await websocket.close(code=4008)
        return

    db = SessionLocal()
    try:
        current_user = db.query(models.User).filter(models.User.username == username).first()
        if not current_user:
            await websocket.close(code=4008)
            return

        await websocket.accept()
        # register under "__home__" so send_to_user can deliver cross-group nudges here
        manager.connect(websocket, "__home__", current_user.id)

        try:
            while True:
                # client never sends on this socket — discard anything that arrives
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect("__home__", current_user.id, websocket)

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


class PushTokenRequest(BaseModel):
    token: str


@app.post("/push-token")
def register_push_token(
    body: PushTokenRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Register or refresh an Expo push token for the current user."""
    existing = db.query(models.PushToken).filter(
        models.PushToken.token == body.token
    ).first()
    if not existing:
        db.add(models.PushToken(user_id=current_user.id, token=body.token))
        db.commit()
    elif existing.user_id != current_user.id:
        # token transferred to a new user (device re-login) — reassign it
        existing.user_id = current_user.id
        db.commit()
    return {"ok": True}


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


@app.get("/groups/{group_id}/members")
def list_group_members(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    # everyone in the group except the caller — they can't @mention themselves
    members = db.query(models.User).join(
        models.GroupMember,
        models.GroupMember.user_id == models.User.id
    ).filter(
        models.GroupMember.group_id == db_group.id,
        models.User.id != current_user.id
    ).all()

    result = [{"username": m.username} for m in members]
    # "ai" is a special mention target that triggers the RAG pipeline
    result.append({"username": "ai"})

    return result


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
    
    # Convert to API format: [{id, sender, text, is_bot, message_type, image_url, timestamp}]
    result = []
    for msg in messages:
        sender = "AI Bot" if msg.is_AI else (msg.user.username if msg.user else "Unknown")
        msg_type = msg.message_type if msg.message_type else "text"
        image_url = (
            f"/groups/{group_id}/messages/{msg.id}/image"
            if msg_type == "image" else None
        )
        result.append({
            "id": msg.id,
            "sender": sender,
            "text": msg.content,
            "is_bot": msg.is_AI,
            "message_type": msg_type,
            "image_url": image_url,
            "timestamp": msg.timestamp.isoformat()
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


@app.post("/groups/{group_id}/messages/image")
async def upload_image_message(
    group_id: str,
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    # only JPEG and PNG accepted
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in (".jpg", ".jpeg", ".png"):
        raise HTTPException(status_code=400, detail="Only JPEG and PNG images are allowed")

    content = await file.read()

    # 5 MB hard limit
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be 5 MB or smaller")

    # save to uploads/images/{group_id}/{timestamp}_{filename}
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"{ts}_{file.filename}"
    file_path = IMAGE_STORAGE_DIR / group_id / safe_filename
    file_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with open(file_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save image: {str(e)}")

    new_message = models.Message(
        group_id=db_group.id,
        user_id=current_user.id,
        content=str(file_path),
        is_AI=False,
        message_type="image"
    )
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    image_url = f"/groups/{group_id}/messages/{new_message.id}/image"

    await manager.broadcast_to_group(group_id, {
        "type": "message",
        "id": new_message.id,
        "sender": current_user.username,
        "text": "",
        "is_bot": False,
        "message_type": "image",
        "image_url": image_url,
        "group_string_id": group_id,
        "timestamp": new_message.timestamp.isoformat()
    })

    return {
        "id": new_message.id,
        "sender": current_user.username,
        "message_type": "image",
        "image_url": image_url,
        "timestamp": new_message.timestamp.isoformat()
    }


@app.get("/groups/{group_id}/messages/{message_id}/image")
def get_image_message(
    group_id: str,
    message_id: int,
    token: str = Query(None),        # Image component can't set headers — accept token here too
    authorization: str = Header(None),
    db: Session = Depends(get_db)
):
    # prefer query-param token (used by the React Native Image component), fall back to header
    raw_token = token
    if not raw_token and authorization:
        try:
            _, raw_token = authorization.split()
        except ValueError:
            raw_token = None

    if not raw_token:
        raise HTTPException(status_code=401, detail="Authorization required")

    payload = decode_token(raw_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    username = payload.get("sub") or payload.get("username")
    current_user = db.query(models.User).filter(models.User.username == username).first()
    if not current_user:
        raise HTTPException(status_code=401, detail="User not found")

    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    msg = db.query(models.Message).filter(
        models.Message.id == message_id,
        models.Message.group_id == db_group.id,
        models.Message.message_type == "image"
    ).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Image message not found")

    file_path = Path(msg.content)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Image file not found on disk")

    # pick the right MIME type from the extension
    ext = file_path.suffix.lower()
    mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"

    return FileResponse(path=file_path, media_type=mime)


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

    # Index file text into ChromaDB so the RAG pipeline can search it.
    # .doc is the old binary Word format — python-docx can't read it, so those are stored but not indexed.
    if file_ext == '.pdf':
        try:
            reader = PdfReader(file_path)
            pdf_text = "\n".join(page.extract_text() or "" for page in reader.pages)
            if pdf_text.strip():
                index_document(group_id, file.filename, pdf_text)
        except Exception as e:
            # Don't block the upload if indexing fails — just log it
            print(f"Warning: failed to index {file.filename} for RAG: {str(e)}")
    elif file_ext == '.docx':
        try:
            reader = DocxDocument(file_path)
            doc_text = "\n".join(p.text for p in reader.paragraphs if p.text.strip())
            if doc_text.strip():
                index_document(group_id, file.filename, doc_text)
        except Exception as e:
            print(f"Warning: failed to index {file.filename} for RAG: {str(e)}")
    # .doc files land here — stored on disk, skipped for indexing since python-docx can't parse the old binary format

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
        if existing_summary.source_last_message_ts == latest_message_ts:
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

    # Build transcript from messages.
    # Image messages get a placeholder in the text transcript and are base64-encoded
    # separately so they can be passed to the vision model in step 2.
    transcript_lines = []
    image_blocks = []  # {mime, data} dicts in conversation order
    for msg in messages:
        timestamp_str = msg.timestamp.strftime("%Y-%m-%d %H:%M")
        username = "AI Bot" if msg.is_AI else (msg.user.username if msg.user else "Unknown")
        msg_type = msg.message_type if msg.message_type else "text"

        if msg_type == "image":
            # mark where the image appeared in the conversation
            transcript_lines.append(f"[{timestamp_str}] {username}: [sent an image]")

            # only read files that live inside this group's image folder
            file_path = Path(msg.content)
            expected_prefix = f"uploads/images/{group_id}/"
            if not str(file_path).startswith(expected_prefix):
                print(f"[Summary] Skipping image outside group directory: {msg.content}")
                continue

            if not file_path.exists():
                print(f"[Summary] Skipping missing image file: {msg.content}")
                continue

            try:
                ext = file_path.suffix.lower()
                mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
                with open(file_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("utf-8")
                image_blocks.append({"mime": mime, "data": b64})
            except Exception as e:
                print(f"[Summary] Warning: could not read image {msg.content}: {e}")
        else:
            transcript_lines.append(f"[{timestamp_str}] {username}: {msg.content}")

    transcript = "\n".join(transcript_lines)

    # use the last AI summary as context so the new one can note what's changed
    previous_ai_text = existing_summary.summary_text if existing_summary else None

    # pull the most recent student-written summary for comparison context
    latest_student = db.query(models.StudentSummary).filter(
        models.StudentSummary.group_id == group_id
    ).order_by(models.StudentSummary.created_at.desc()).first()
    student_summary_text = latest_student.summary_text if latest_student else None

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
                "  - Follow up with the client to confirm feedback session details\n\n"
                "For any images shared in the conversation, include a brief description of what the image shows as part of the summary. "
                "Do not say the image lacks context — describe what you can see."
            )

            # if a previous AI summary exists, ask the model to note what has changed
            if previous_ai_text:
                system_prompt += (
                    "\n\nFor reference, here is the previous AI summary generated for this group:\n\n"
                    + previous_ai_text
                    + "\n\nIn your new summary, briefly note what has changed or progressed since then."
                )

            # if the students wrote their own summary, ask the model to compare it
            if student_summary_text:
                system_prompt += (
                    "\n\nThe students have also written their own account of their progress:\n\n"
                    + student_summary_text
                    + "\n\nCompare what the students say with what the chat transcript shows. "
                    "Note any differences or areas of growth, and incorporate this into the Supervisor Action Plan."
                )

            # text first, then images in the order they appeared in the chat
            user_content = [
                {
                    "type": "text",
                    "text": f"Please create a summary of the following group chat conversation:\n\n{transcript}"
                }
            ]
            for img in image_blocks:
                user_content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{img['mime']};base64,{img['data']}"
                    }
                })

            response = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
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


@app.get("/groups/{group_id}/summary/history")
def get_summary_history(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Return all AI summaries for a group, newest first.
    Access: coordinator OR group member (same as the summary endpoints).
    """
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not check_summary_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    rows = db.query(models.Summary).filter(
        models.Summary.group_id == group_id
    ).order_by(models.Summary.created_at.desc()).all()

    return [
        {
            "id": r.id,
            "summary_text": r.summary_text,
            "created_at": r.created_at.isoformat(),
            "source_message_count": r.source_message_count,
        }
        for r in rows
    ]


@app.get("/groups/{group_id}/student-summary")
def get_student_summary(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get the most recent student summary for a group.
    Access: All group members (students, supervisors, coordinators).
    """
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    # most recent entry, or empty string if none exists yet
    row = db.query(models.StudentSummary).filter(
        models.StudentSummary.group_id == group_id
    ).order_by(models.StudentSummary.created_at.desc()).first()

    return {
        "group_id": group_id,
        "summary_text": row.summary_text if row else ""
    }


@app.post("/groups/{group_id}/student-summary")
def update_student_summary(
    group_id: str,
    request: StudentSummaryRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Save a new student summary for a group (inserts a row, keeps history).
    Access: All group members (students, supervisors, coordinators).
    """
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    # insert a new row so the full edit history is preserved
    new_entry = models.StudentSummary(
        group_id=group_id,
        summary_text=request.summary_text,
        created_by_user_id=current_user.id,
    )
    db.add(new_entry)
    db.commit()
    db.refresh(new_entry)

    return {
        "group_id": group_id,
        "summary_text": new_entry.summary_text
    }


@app.get("/groups/{group_id}/student-summary/history")
def get_student_summary_history(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Return all saved student summaries for a group, newest first.
    Access: All group members (students, supervisors, coordinators).
    """
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    rows = db.query(models.StudentSummary).filter(
        models.StudentSummary.group_id == group_id
    ).order_by(models.StudentSummary.created_at.desc()).all()

    return [
        {
            "id": r.id,
            "summary_text": r.summary_text,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@app.get("/notifications")
def get_notifications(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    results = db.query(models.Notification, models.Group).join(
        models.Group, models.Group.id == models.Notification.group_id
    ).filter(
        models.Notification.recipient_id == current_user.id,
        models.Notification.is_read == False
    ).all()
    return [
        {
            "id": n.id,
            "sender_id": n.sender_id,
            "message_id": n.message_id,
            "group_id": n.group_id,
            "group_string_id": g.string_id,
            "created_at": n.created_at.isoformat()
        }
        for n, g in results
    ]


@app.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    notif = db.query(models.Notification).filter(
        models.Notification.id == notification_id
    ).first()
    # 404 if missing or belongs to a different user
    if not notif or notif.recipient_id != current_user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    db.commit()
    return {"status": "ok"}


@app.get("/groups/{group_id}/unread")
def get_group_unread(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    membership = db.query(models.GroupMember).filter(
        models.GroupMember.user_id == current_user.id,
        models.GroupMember.group_id == db_group.id
    ).first()

    # coordinators have no membership row — treat everything as read for them
    if not membership:
        return {"unread_messages": 0, "unread_tags": 0}

    last_read_id = membership.last_read_message_id

    if last_read_id is None:
        # never read anything — every message in this group is unread
        unread_messages = db.query(models.Message).filter(
            models.Message.group_id == db_group.id
        ).count()
    else:
        unread_messages = db.query(models.Message).filter(
            models.Message.group_id == db_group.id,
            models.Message.id > last_read_id
        ).count()

    unread_tags = db.query(models.Notification).filter(
        models.Notification.recipient_id == current_user.id,
        models.Notification.group_id == db_group.id,
        models.Notification.is_read == False
    ).count()

    return {"unread_messages": unread_messages, "unread_tags": unread_tags}


@app.post("/groups/{group_id}/read")
def mark_group_read(
    group_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_group = db.query(models.Group).filter(models.Group.string_id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    if not check_group_access(group_id, current_user, db):
        raise HTTPException(status_code=403, detail="Access denied to this group")

    # find the latest message so we know what "read up to" means
    latest = db.query(models.Message).filter(
        models.Message.group_id == db_group.id
    ).order_by(models.Message.id.desc()).first()

    if not latest:
        return {"status": "ok"}

    membership = db.query(models.GroupMember).filter(
        models.GroupMember.user_id == current_user.id,
        models.GroupMember.group_id == db_group.id
    ).first()

    if membership:
        membership.last_read_message_id = latest.id
        db.commit()

    # also clear any tag notifications for this user in this group
    db.query(models.Notification).filter(
        models.Notification.recipient_id == current_user.id,
        models.Notification.group_id == db_group.id,
        models.Notification.is_read == False
    ).update({"is_read": True})
    db.commit()

    return {"status": "ok"}
