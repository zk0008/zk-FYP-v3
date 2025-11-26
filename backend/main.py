from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Group Chat Prototype")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory data store for hard-coded groups and messages
groups = {
    "group-a": {
        "id": "group-a",
        "name": "Group A",
        "messages": [
            {"id": 1, "sender": "Alice", "text": "Hey everyone!"},
            {"id": 2, "sender": "Bob", "text": "Hi Alice!"},
        ],
    },
    "group-b": {
        "id": "group-b",
        "name": "Group B",
        "messages": [
            {"id": 1, "sender": "Charlie", "text": "Who's ready for lunch?"},
        ],
    },
}


class NewMessage(BaseModel):
    sender: str
    text: str


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
def add_message(group_id: str, message: NewMessage):
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    next_id = (group["messages"][-1]["id"] + 1) if group["messages"] else 1
    new_entry = {"id": next_id, "sender": message.sender, "text": message.text}
    group["messages"].append(new_entry)
    return new_entry
