import json
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # {group_id: {user_id: [websocket, ...]}}
        # List per user so the same account logged in on two devices both receive broadcasts
        self.active_connections: dict[str, dict[int, list[WebSocket]]] = {}

    def connect(self, websocket: WebSocket, group_id: str, user_id: int):
        if group_id not in self.active_connections:
            self.active_connections[group_id] = {}
        self.active_connections[group_id].setdefault(user_id, []).append(websocket)

    def disconnect(self, group_id: str, user_id: int, websocket: WebSocket):
        if group_id not in self.active_connections:
            return
        sockets = self.active_connections[group_id].get(user_id, [])
        if websocket in sockets:
            sockets.remove(websocket)
        if not sockets:
            self.active_connections[group_id].pop(user_id, None)
        if not self.active_connections[group_id]:
            del self.active_connections[group_id]

    def active_user_ids_in_group(self, group_id: str) -> set[int]:
        """User ids that have at least one live connection to this group."""
        return set(self.active_connections.get(group_id, {}).keys())

    async def broadcast_to_group(self, group_id: str, data: dict):
        if group_id not in self.active_connections:
            return
        payload = json.dumps(data)
        dead: list[tuple[int, WebSocket]] = []
        for user_id, sockets in list(self.active_connections.get(group_id, {}).items()):
            for ws in sockets:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append((user_id, ws))
        for user_id, ws in dead:
            self.disconnect(group_id, user_id, ws)

    async def send_to_user(self, user_id: int, data: dict):
        """Send to every active connection for this user across all groups."""
        payload = json.dumps(data)
        for group_id, group_connections in list(self.active_connections.items()):
            dead: list[WebSocket] = []
            for ws in list(group_connections.get(user_id, [])):
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.disconnect(group_id, user_id, ws)


# one shared instance — imported by main.py
manager = ConnectionManager()
