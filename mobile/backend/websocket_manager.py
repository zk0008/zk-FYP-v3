import json
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # {group_id: {user_id: websocket}} — two-level dict so we can
        # broadcast to a whole group or target one user specifically
        self.active_connections: dict[str, dict[int, WebSocket]] = {}

    def connect(self, websocket: WebSocket, group_id: str, user_id: int):
        if group_id not in self.active_connections:
            self.active_connections[group_id] = {}
        self.active_connections[group_id][user_id] = websocket

    def disconnect(self, group_id: str, user_id: int):
        # pop() with a default avoids a KeyError if the key is already gone
        if group_id in self.active_connections:
            self.active_connections[group_id].pop(user_id, None)
            # clean up the group entry if no one is left
            if not self.active_connections[group_id]:
                del self.active_connections[group_id]

    async def broadcast_to_group(self, group_id: str, data: dict):
        if group_id not in self.active_connections:
            return
        for websocket in self.active_connections[group_id].values():
            await websocket.send_text(json.dumps(data))

    async def send_to_user(self, user_id: int, data: dict):
        # scan all groups — a user can only be in one active connection at a time
        for group_connections in self.active_connections.values():
            if user_id in group_connections:
                await group_connections[user_id].send_text(json.dumps(data))
                return


# one shared instance — imported by main.py
manager = ConnectionManager()
