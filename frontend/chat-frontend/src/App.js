import React, { useEffect, useState, useRef } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

function App() {
    // Authentication state
    const [token, setToken] = useState(localStorage.getItem("token") || null);
    const [user, setUser] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loginError, setLoginError] = useState("");
    const [loginLoading, setLoginLoading] = useState(false);

    // App state
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
    const [summary, setSummary] = useState(null);
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [refreshingSummary, setRefreshingSummary] = useState(false);
    const [studentSummary, setStudentSummary] = useState("");
    const [loadingStudentSummary, setLoadingStudentSummary] = useState(false);
    const [savingStudentSummary, setSavingStudentSummary] = useState(false);
    const [studentSummaryText, setStudentSummaryText] = useState("");
    const pollingIntervalRef = useRef(null);
    const pollingTimeoutRef = useRef(null);

    // Helper function for authenticated API calls
    const authFetch = (url, options = {}) => {
        const headers = {
            ...options.headers,
            Authorization: `Bearer ${token}`,
        };
        return fetch(url, { ...options, headers });
    };

    // Login function
    const handleLogin = async (username, password) => {
        setLoginLoading(true);
        setLoginError("");

        try {
            const response = await fetch(`${API_BASE}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
                throw new Error("Invalid username or password");
            }

            const data = await response.json();
            const accessToken = data.access_token;

            // Store token in localStorage FIRST
            localStorage.setItem("token", accessToken);
            setToken(accessToken);

            // Only after saving token, fetch user info and groups
            // Read token from localStorage to ensure it's available
            const savedToken = localStorage.getItem("token");
            await loadUserData(savedToken);
        } catch (err) {
            setLoginError(err.message || "Login failed");
            setLoginLoading(false);
            // Clear token on error
            localStorage.removeItem("token");
            setToken(null);
        }
    };

    // Load user data and groups after login
    const loadUserData = async (authToken) => {
        try {
            // Fetch user info - use token from parameter, not from state
            const userResponse = await fetch(`${API_BASE}/auth/me`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!userResponse.ok) throw new Error("Failed to load user info");
            const userData = await userResponse.json();
            setUser(userData);

            // Fetch groups - use token from parameter, not from state
            const groupsResponse = await fetch(`${API_BASE}/my-groups`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!groupsResponse.ok) throw new Error("Failed to load groups");
            const groupsData = await groupsResponse.json();
            // Sort groups by number (Group 1, Group 2, etc.)
            const extractGroupNumber = (groupName) => {
                const match = groupName.match(/\d+/);
                return match ? parseInt(match[0], 10) : 999;
            };
            const sortedGroups = groupsData.sort((a, b) => {
                return extractGroupNumber(a.name) - extractGroupNumber(b.name);
            });
            setGroups(sortedGroups);

            setIsAuthenticated(true);
            setLoginLoading(false);
        } catch (err) {
            setLoginError(err.message || "Failed to load data");
            setLoginLoading(false);
            // Clear token on error
            localStorage.removeItem("token");
            setToken(null);
        }
    };

    // Logout function
    const handleLogout = () => {
        localStorage.removeItem("token");
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
        setGroups([]);
        setSelectedGroup(null);
        setMessages([]);
        setError("");
    };

    // Check for token on mount and auto-login
    useEffect(() => {
        if (token && !isAuthenticated) {
            loadUserData(token);
        }
    }, [token]);

    // Helper function to extract group number for sorting
    const extractGroupNumber = (groupName) => {
        const match = groupName.match(/\d+/);
        return match ? parseInt(match[0], 10) : 999;
    };

    // Load groups when authenticated
    useEffect(() => {
        if (isAuthenticated && token) {
            authFetch(`${API_BASE}/my-groups`)
                .then((res) => res.json())
                .then((groups) => {
                    // Sort groups by number (Group 1, Group 2, etc.)
                    const sortedGroups = groups.sort((a, b) => {
                        return extractGroupNumber(a.name) - extractGroupNumber(b.name);
                    });
                    setGroups(sortedGroups);
                })
                .catch(() => setError("Failed to load groups"));
        }
    }, [isAuthenticated, token]);

    useEffect(() => {
        if (!selectedGroup || !token) {
            setMessages([]);
            return;
        }
        setLoadingMessages(true);
        authFetch(`${API_BASE}/groups/${selectedGroup.id}/messages`)
            .then((res) => res.json())
            .then((data) => {
                setMessages(data);
                setLoadingMessages(false);
            })
            .catch(() => {
                setError("Failed to load messages");
                setLoadingMessages(false);
            });
    }, [selectedGroup, token]);

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
        if (activeTab === "Documents" && selectedGroup && token) {
            setLoadingDocuments(true);
            authFetch(`${API_BASE}/groups/${selectedGroup.id}/documents`)
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
    }, [activeTab, selectedGroup, token]);

    // Fetch summary when AI Overview tab is active and group is selected
    useEffect(() => {
        if (activeTab === "AI Overview" && selectedGroup && token) {
            setLoadingSummary(true);
            authFetch(
                `${API_BASE}/groups/${selectedGroup.id}/summary?range=weekly`
            )
                .then((res) => res.json())
                .then((data) => {
                    setSummary(data);
                    setLoadingSummary(false);
                })
                .catch(() => {
                    setError("Failed to load summary");
                    setLoadingSummary(false);
                });
        } else {
            setSummary(null);
        }
    }, [activeTab, selectedGroup, token]);

    // Fetch student summary when Student Overview tab is active and group is selected
    useEffect(() => {
        if (activeTab === "Student Overview" && selectedGroup && token) {
            setLoadingStudentSummary(true);
            authFetch(
                `${API_BASE}/groups/${selectedGroup.id}/student-summary`
            )
                .then((res) => res.json())
                .then((data) => {
                    setStudentSummary(data.summary_text || "");
                    setStudentSummaryText(data.summary_text || "");
                    setLoadingStudentSummary(false);
                })
                .catch(() => {
                    setError("Failed to load student summary");
                    setLoadingStudentSummary(false);
                });
        } else {
            setStudentSummary("");
            setStudentSummaryText("");
        }
    }, [activeTab, selectedGroup, token]);

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
        authFetch(`${API_BASE}/groups/${selectedGroup.id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sender: user?.username || "User",
                text: messageText,
            }),
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
            authFetch(`${API_BASE}/groups/${selectedGroup.id}/messages`)
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

        authFetch(`${API_BASE}/groups/${selectedGroup.id}/documents`, {
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

    const handleDownloadDocument = async (documentId, filename) => {
        try {
            const response = await authFetch(
                `${API_BASE}/groups/${selectedGroup.id}/documents/${documentId}`
            );
            if (!response.ok) {
                throw new Error("Failed to download document");
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            setError("Failed to download document");
        }
    };

    const handleRefreshSummary = async () => {
        if (!selectedGroup || !token) {
            return;
        }

        setRefreshingSummary(true);
        setError("");

        try {
            const response = await authFetch(
                `${API_BASE}/groups/${selectedGroup.id}/summary?range=weekly`,
                {
                    method: "POST",
                }
            );
            if (!response.ok) {
                throw new Error("Failed to refresh summary");
            }
            const data = await response.json();
            setSummary(data);
        } catch (err) {
            setError("Failed to refresh summary");
        } finally {
            setRefreshingSummary(false);
        }
    };

    // Helper function to format summary text with bold "Key points:" and "Supervisor Action Plan:" and bullet points
    const formatSummaryText = (text) => {
        if (!text) return "";
        
        // Replace dashes with bullet points
        let formatted = text.replace(/^(\s*)-\s+/gm, "$1• ");
        
        // Split by lines to handle bold headings
        const lines = formatted.split("\n");
        return lines.map((line, index) => {
            // Make "Key points:" bold
            if (line.includes("Key points:")) {
                const parts = line.split("Key points:");
                return (
                    <React.Fragment key={index}>
                        {parts[0]}
                        <strong>Key points:</strong>
                        {parts[1] || ""}
                        {index < lines.length - 1 && "\n"}
                    </React.Fragment>
                );
            }
            // Make "Supervisor Action Plan:" bold
            if (line.includes("Supervisor Action Plan:")) {
                const parts = line.split("Supervisor Action Plan:");
                return (
                    <React.Fragment key={index}>
                        {parts[0]}
                        <strong>Supervisor Action Plan:</strong>
                        {parts[1] || ""}
                        {index < lines.length - 1 && "\n"}
                    </React.Fragment>
                );
            }
            // Regular line
            return (
                <React.Fragment key={index}>
                    {line}
                    {index < lines.length - 1 && "\n"}
                </React.Fragment>
            );
        });
    };

    // Helper function to format timestamp in Singapore timezone
    const formatSingaporeTime = (utcTimestamp) => {
        if (!utcTimestamp) {
            return "—";
        }

        try {
            // Ensure the timestamp is treated as UTC
            // Backend sends ISO format like "2026-01-06T11:43:51" or "2026-01-06T11:43:51.123456"
            // We need to explicitly mark it as UTC by appending 'Z' if no timezone is present
            let timestampStr = String(utcTimestamp).trim();

            // Check if it already has timezone info (Z, +, or - after the time part)
            const hasTimezone =
                timestampStr.endsWith("Z") ||
                timestampStr.match(/[+-]\d{2}:\d{2}$/) ||
                timestampStr.match(/[+-]\d{4}$/);

            if (!hasTimezone) {
                // Remove microseconds if present, then append 'Z' to indicate UTC
                timestampStr = timestampStr.split(".")[0] + "Z";
            }

            const date = new Date(timestampStr);

            // Verify the date is valid
            if (isNaN(date.getTime())) {
                console.error("Invalid date:", utcTimestamp);
                return "—";
            }

            const formatter = new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Singapore",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            });

            // Format as DD/MM/YYYY, HH:MM:SS
            const parts = formatter.formatToParts(date);
            const day = parts.find((p) => p.type === "day").value;
            const month = parts.find((p) => p.type === "month").value;
            const year = parts.find((p) => p.type === "year").value;
            const hour = parts.find((p) => p.type === "hour").value;
            const minute = parts.find((p) => p.type === "minute").value;
            const second = parts.find((p) => p.type === "second").value;

            return `${day}/${month}/${year}, ${hour}:${minute}:${second}`;
        } catch (err) {
            console.error("Error formatting time:", err, utcTimestamp);
            return "—";
        }
    };

    // Login component
    const LoginPage = () => {
        const [username, setUsername] = useState("");
        const [password, setPassword] = useState("");

        const handleSubmit = (e) => {
            e.preventDefault();
            handleLogin(username, password);
        };

        return (
            <div className="login-container">
                <div className="login-box">
                    <h2>Login</h2>
                    <form onSubmit={handleSubmit}>
                        <div className="login-field">
                            <label>Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                disabled={loginLoading}
                            />
                        </div>
                        <div className="login-field">
                            <label>Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                disabled={loginLoading}
                            />
                        </div>
                        {loginError && (
                            <p className="error-text">{loginError}</p>
                        )}
                        <button
                            type="submit"
                            disabled={loginLoading}
                            className="login-button"
                        >
                            {loginLoading ? "Logging in..." : "Login"}
                        </button>
                    </form>
                </div>
            </div>
        );
    };

    // Show login page if not authenticated
    if (!isAuthenticated) {
        return <LoginPage />;
    }

    // Get dashboard title based on user role
    const getDashboardTitle = () => {
        if (user?.role === "coordinator") {
            return "Coordinator Dashboard";
        } else if (user?.role === "supervisor") {
            return "Supervisor Dashboard";
        } else if (user?.role === "student") {
            return "Student Dashboard";
        }
        return "Dashboard";
    };

    return (
        <div className="app-shell">
            <header className="top-bar">
                <div className="brand">{getDashboardTitle()}</div>
                <div className="welcome">
                    Welcome, {user?.username || "User"}! ({user?.role || ""})
                </div>
                <button onClick={handleLogout} className="logout-button">
                    Logout
                </button>
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
                    <div className="sidebar-footer">
                        {user?.username || "User"}
                    </div>
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
                            <span
                                className={
                                    activeTab === "AI Overview" ? "active" : ""
                                }
                                onClick={() => setActiveTab("AI Overview")}
                            >
                                AI Overview
                            </span>
                            <span
                                className={
                                    activeTab === "Student Overview" ? "active" : ""
                                }
                                onClick={() => setActiveTab("Student Overview")}
                            >
                                Student Overview
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
                                                className={`message-card ${
                                                    msg.is_bot
                                                        ? "ai-message"
                                                        : ""
                                                }`}
                                            >
                                                <span
                                                    className={`message-sender ${
                                                        msg.sender === "AI Bot"
                                                            ? "ai-sender"
                                                            : ""
                                                    }`}
                                                >
                                                    {msg.sender}:
                                                </span>
                                                <div className="message-text">
                                                    {msg.text}
                                                </div>
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
                    ) : activeTab === "Documents" ? (
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
                    ) : activeTab === "AI Overview" ? (
                        <div className="overview-panel">
                            {error && <p className="error-text">{error}</p>}
                            {!selectedGroup && !error && (
                                <p className="placeholder">
                                    Select a chatroom to view overview.
                                </p>
                            )}
                            {selectedGroup && (
                                <>
                                    <div className="overview-header">
                                        <h3>Weekly Summary</h3>
                                        <button
                                            onClick={handleRefreshSummary}
                                            disabled={refreshingSummary}
                                            className="download-btn"
                                            style={{
                                                padding: "8px 16px",
                                                fontSize: "14px",
                                            }}
                                        >
                                            {refreshingSummary
                                                ? "Refreshing..."
                                                : "Refresh Summary"}
                                        </button>
                                    </div>
                                    {loadingSummary ? (
                                        <p className="placeholder">
                                            Loading summary…
                                        </p>
                                    ) : summary ? (
                                        <div className="overview-content">
                                            <div className="summary-card">
                                                <p className="summary-meta">
                                                    Last updated:{" "}
                                                    {formatSingaporeTime(
                                                        summary.created_at
                                                    )}
                                                </p>
                                                <div className="summary-text">
                                                    {summary.summary_text
                                                        ? formatSummaryText(
                                                              summary.summary_text
                                                          )
                                                        : "No summary available."}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="placeholder">
                                            No summary available.
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    ) : activeTab === "Student Overview" ? (
                        <div className="overview-panel">
                            {error && <p className="error-text">{error}</p>}
                            {!selectedGroup && !error && (
                                <p className="placeholder">
                                    Select a chatroom to view student overview.
                                </p>
                            )}
                            {selectedGroup && (
                                <>
                                    <div className="overview-header">
                                        <h3>Student Overview</h3>
                                        <button
                                            onClick={async () => {
                                                if (
                                                    !selectedGroup ||
                                                    !token
                                                ) {
                                                    return;
                                                }

                                                setSavingStudentSummary(true);
                                                setError("");

                                                try {
                                                    const response =
                                                        await authFetch(
                                                            `${API_BASE}/groups/${selectedGroup.id}/student-summary`,
                                                            {
                                                                method: "POST",
                                                                headers: {
                                                                    "Content-Type":
                                                                        "application/json",
                                                                },
                                                                body: JSON.stringify(
                                                                    {
                                                                        summary_text:
                                                                            studentSummaryText,
                                                                    }
                                                                ),
                                                            }
                                                        );
                                                    if (!response.ok) {
                                                        throw new Error(
                                                            "Failed to save student summary"
                                                        );
                                                    }
                                                    const data =
                                                        await response.json();
                                                    setStudentSummary(
                                                        data.summary_text || ""
                                                    );
                                                } catch (err) {
                                                    setError(
                                                        "Failed to save student summary"
                                                    );
                                                } finally {
                                                    setSavingStudentSummary(
                                                        false
                                                    );
                                                }
                                            }}
                                            disabled={
                                                savingStudentSummary ||
                                                studentSummaryText ===
                                                    studentSummary
                                            }
                                            className="download-btn"
                                            style={{
                                                padding: "8px 16px",
                                                fontSize: "14px",
                                            }}
                                        >
                                            {savingStudentSummary
                                                ? "Saving..."
                                                : "Save Summary"}
                                        </button>
                                    </div>
                                    {loadingStudentSummary ? (
                                        <p className="placeholder">
                                            Loading student summary…
                                        </p>
                                    ) : (
                                        <div className="overview-content">
                                            <div className="summary-card">
                                                <textarea
                                                    value={studentSummaryText}
                                                    onChange={(e) =>
                                                        setStudentSummaryText(
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="Write a collaborative summary for your group..."
                                                    className="student-summary-textarea"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    ) : null}
                </section>
            </div>
        </div>
    );
}

export default App;
