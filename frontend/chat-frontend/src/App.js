import { useEffect, useState, useRef } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

function App() {
    const [groups, setGroups] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [error, setError] = useState("");
    const [activeTab, setActiveTab] = useState("Chats");
    const [documents, setDocuments] = useState([]);
    const [loadingDocuments, setLoadingDocuments] = useState(false);
    const [uploading, setUploading] = useState(false);
    const pollingIntervalRef = useRef(null);
    const pollingTimeoutRef = useRef(null);

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

    // Cleanup polling intervals on unmount or when group changes
    useEffect(() => {
        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
            if (pollingTimeoutRef.current) {
                clearTimeout(pollingTimeoutRef.current);
                pollingTimeoutRef.current = null;
            }
        };
    }, [selectedGroup]);

    // Fetch documents when Documents tab is active and group is selected
    useEffect(() => {
        if (activeTab === "Documents" && selectedGroup) {
            setLoadingDocuments(true);
            fetch(`${API_BASE}/groups/${selectedGroup.id}/documents`)
                .then((res) => res.json())
                .then((data) => {
                    setDocuments(data);
                    setLoadingDocuments(false);
                })
                .catch(() => {
                    setError("Failed to load documents");
                    setLoadingDocuments(false);
                });
        } else {
            setDocuments([]);
        }
    }, [activeTab, selectedGroup]);

    const handleSelectGroup = (group) => {
        setSelectedGroup(group);
        setActiveTab("Chats"); // Reset to Chats tab when selecting a group
        setError("");
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (!selectedGroup || !newMessage.trim()) {
            return;
        }

        const messageText = newMessage.trim();
        const isAiMessage = messageText.startsWith("@ai");

        // Optimistic UI: Add message immediately to local state
        const tempId = Date.now(); // Temporary ID for optimistic message
        const optimisticMessage = {
            id: tempId,
            sender: "Supervisor",
            text: messageText,
            is_bot: false,
        };
        setMessages((prev) => [...prev, optimisticMessage]);
        setNewMessage("");

        // Send POST request
        fetch(`${API_BASE}/groups/${selectedGroup.id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender: "Supervisor", text: messageText }),
        })
            .then((res) => res.json())
            .then((createdMessage) => {
                // Replace optimistic message with real one from server
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === tempId ? createdMessage : msg
                    )
                );

                // If it's an AI message, start polling for the AI response
                if (isAiMessage) {
                    startPollingForAiResponse(createdMessage.id);
                }
            })
            .catch(() => {
                // On error, remove optimistic message and show error
                setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
                setError("Failed to send message");
            });
    };

    const startPollingForAiResponse = (lastMessageId) => {
        // Clear any existing polling
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }
        if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
        }

        let pollCount = 0;
        const maxPolls = 10; // Poll for 10 seconds (10 polls * 1 second)

        // Poll every 1 second
        pollingIntervalRef.current = setInterval(() => {
            pollCount++;

            fetch(`${API_BASE}/groups/${selectedGroup.id}/messages`)
                .then((res) => res.json())
                .then((allMessages) => {
                    // Check if there's a new AI bot message after our last message
                    const lastMessageIndex = allMessages.findIndex(
                        (msg) => msg.id === lastMessageId
                    );

                    if (
                        lastMessageIndex !== -1 &&
                        lastMessageIndex < allMessages.length - 1
                    ) {
                        // There's a message after ours - check if it's from AI Bot
                        const nextMessage = allMessages[lastMessageIndex + 1];
                        if (
                            nextMessage.sender === "AI Bot" &&
                            nextMessage.is_bot
                        ) {
                            // AI response arrived! Update messages and stop polling
                            setMessages(allMessages);
                            stopPolling();
                            return;
                        }
                    }

                    // Update messages anyway (in case of other changes)
                    setMessages(allMessages);

                    // Stop polling after max attempts
                    if (pollCount >= maxPolls) {
                        stopPolling();
                    }
                })
                .catch(() => {
                    // On error, just stop polling
                    stopPolling();
                });
        }, 1000); // Poll every 1 second

        // Safety timeout: stop polling after 10 seconds regardless
        pollingTimeoutRef.current = setTimeout(() => {
            stopPolling();
        }, 10000);
    };

    const stopPolling = () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
        if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
        }
    };

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (!file || !selectedGroup) {
            return;
        }

        if (!file.name.endsWith(".pdf")) {
            setError("Only PDF files are allowed");
            return;
        }

        setUploading(true);
        setError("");

        const formData = new FormData();
        formData.append("file", file);

        fetch(`${API_BASE}/groups/${selectedGroup.id}/documents`, {
            method: "POST",
            body: formData,
        })
            .then((res) => res.json())
            .then((newDocument) => {
                setDocuments((prev) => [...prev, newDocument]);
                setUploading(false);
                // Reset file input
                event.target.value = "";
            })
            .catch(() => {
                setError("Failed to upload document");
                setUploading(false);
            });
    };

    const handleDownloadDocument = (documentId, filename) => {
        window.open(
            `${API_BASE}/groups/${selectedGroup.id}/documents/${documentId}`,
            "_blank"
        );
    };

    return (
        <div className="app-shell">
            <header className="top-bar">
                <div className="brand">Supervisor Dashboard</div>
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
                    {selectedGroup && (
                        <nav className="panel-tabs">
                            <span
                                className={
                                    activeTab === "Chats" ? "active" : ""
                                }
                                onClick={() => setActiveTab("Chats")}
                            >
                                Chats
                            </span>
                            <span
                                className={
                                    activeTab === "Documents" ? "active" : ""
                                }
                                onClick={() => setActiveTab("Documents")}
                            >
                                Documents
                            </span>
                        </nav>
                    )}
                    {activeTab === "Chats" ? (
                        <>
                            <div className="messages">
                                {error && <p className="error-text">{error}</p>}
                                {!selectedGroup && !error && (
                                    <p className="placeholder">
                                        Select a chatroom to view messages.
                                    </p>
                                )}
                                {selectedGroup && loadingMessages && (
                                    <p className="placeholder">
                                        Loading messages…
                                    </p>
                                )}
                                {selectedGroup && !loadingMessages && (
                                    <div className="message-stack">
                                        {messages.map((msg) => (
                                            <div
                                                key={msg.id}
                                                className="message-row"
                                            >
                                                <span className="message-sender">
                                                    {msg.sender}:
                                                </span>
                                                <span>{msg.text}</span>
                                            </div>
                                        ))}
                                        {!messages.length && (
                                            <p className="placeholder">
                                                No messages yet. Be the first to
                                                say hi!
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                            <form
                                className="message-form"
                                onSubmit={handleSubmit}
                            >
                                <input
                                    type="text"
                                    placeholder="Enter a message"
                                    value={newMessage}
                                    onChange={(e) =>
                                        setNewMessage(e.target.value)
                                    }
                                    disabled={!selectedGroup}
                                />
                                <button type="submit" disabled={!selectedGroup}>
                                    Send
                                </button>
                            </form>
                        </>
                    ) : (
                        <div className="documents-panel">
                            {error && <p className="error-text">{error}</p>}
                            {!selectedGroup && !error && (
                                <p className="placeholder">
                                    Select a chatroom to view documents.
                                </p>
                            )}
                            {selectedGroup && (
                                <>
                                    <div className="documents-upload">
                                        <h3>Upload PDF</h3>
                                        <input
                                            type="file"
                                            accept=".pdf"
                                            onChange={handleFileUpload}
                                            disabled={uploading}
                                            style={{ marginTop: "12px" }}
                                        />
                                        {uploading && (
                                            <p className="placeholder">
                                                Uploading...
                                            </p>
                                        )}
                                    </div>
                                    <div className="documents-list">
                                        <h3>Documents</h3>
                                        {loadingDocuments ? (
                                            <p className="placeholder">
                                                Loading documents…
                                            </p>
                                        ) : documents.length === 0 ? (
                                            <p className="placeholder">
                                                No documents uploaded yet.
                                            </p>
                                        ) : (
                                            <ul className="document-list">
                                                {documents.map((doc) => (
                                                    <li
                                                        key={doc.id}
                                                        className="document-item"
                                                    >
                                                        <span>
                                                            {doc.filename}
                                                        </span>
                                                        <span className="document-date">
                                                            {new Date(
                                                                doc.uploaded_at
                                                            ).toLocaleDateString()}
                                                        </span>
                                                        <button
                                                            onClick={() =>
                                                                handleDownloadDocument(
                                                                    doc.id,
                                                                    doc.filename
                                                                )
                                                            }
                                                            className="download-btn"
                                                        >
                                                            Download
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

export default App;
