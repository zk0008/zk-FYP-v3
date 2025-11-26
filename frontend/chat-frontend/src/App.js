import { useEffect, useState } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

function App() {
    const [groups, setGroups] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        fetch(`${API_BASE}/groups`)
            .then((res) => res.json())
            .then(setGroups)
            .catch(() => setError("Failed to load groups"));
    }, []);

    useEffect(() => {
        if (!selectedGroup) {
            setMessages([]);
            return;
        }
        setLoadingMessages(true);
        fetch(`${API_BASE}/groups/${selectedGroup.id}/messages`)
            .then((res) => res.json())
            .then((data) => {
                setMessages(data);
                setLoadingMessages(false);
            })
            .catch(() => {
                setError("Failed to load messages");
                setLoadingMessages(false);
            });
    }, [selectedGroup]);

    const handleSelectGroup = (group) => {
        setSelectedGroup(group);
        setError("");
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (!selectedGroup || !newMessage.trim()) {
            return;
        }
        fetch(`${API_BASE}/groups/${selectedGroup.id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender: "Supervisor", text: newMessage }),
        })
            .then((res) => res.json())
            .then((created) => {
                setMessages((prev) => [...prev, created]);
                setNewMessage("");
            })
            .catch(() => setError("Failed to send message"));
    };

    return (
        <div className="app-shell">
            <header className="top-bar">
                <div className="brand">Supervisor Dashboard</div>
                <nav className="nav-tabs">
                    <span className="active">Chats</span>
                    <span>Documents</span>
                </nav>
                <div className="welcome">Welcome, Name!</div>
            </header>

            <div className="content">
                <aside className="sidebar">
                    <div className="sidebar-title">Chatrooms</div>
                    <div className="room-list">
                        {groups.map((group) => (
                            <button
                                key={group.id}
                                className={`room-item ${
                                    selectedGroup?.id === group.id
                                        ? "selected"
                                        : ""
                                }`}
                                onClick={() => handleSelectGroup(group)}
                            >
                                <span className="badge">
                                    {group.name.split(" ").pop()}
                                </span>
                                <span>{group.name}</span>
                            </button>
                        ))}
                    </div>
                    <div className="sidebar-footer">Name</div>
                </aside>

                <section className="chat-panel">
                    <div className="messages">
                        {error && <p className="error-text">{error}</p>}
                        {!selectedGroup && !error && (
                            <p className="placeholder">
                                Select a chatroom to view messages.
                            </p>
                        )}
                        {selectedGroup && loadingMessages && (
                            <p className="placeholder">Loading messages…</p>
                        )}
                        {selectedGroup && !loadingMessages && (
                            <div className="message-stack">
                                {messages.map((msg) => (
                                    <div key={msg.id} className="message-row">
                                        <span className="message-sender">
                                            {msg.sender}:
                                        </span>
                                        <span>{msg.text}</span>
                                    </div>
                                ))}
                                {!messages.length && (
                                    <p className="placeholder">
                                        No messages yet. Be the first to say hi!
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                    <form className="message-form" onSubmit={handleSubmit}>
                        <input
                            type="text"
                            placeholder="Enter a message"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            disabled={!selectedGroup}
                        />
                        <button type="submit" disabled={!selectedGroup}>
                            Send
                        </button>
                    </form>
                </section>
            </div>
        </div>
    );
}

export default App;
