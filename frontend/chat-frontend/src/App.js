import React, { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const API_BASE = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000";

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
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);
    const [summary, setSummary] = useState(null);
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [refreshingSummary, setRefreshingSummary] = useState(false);
    const [studentSummary, setStudentSummary] = useState("");
    const [loadingStudentSummary, setLoadingStudentSummary] = useState(false);
    const [savingStudentSummary, setSavingStudentSummary] = useState(false);
    const [studentSummaryText, setStudentSummaryText] = useState("");
    const pollingIntervalRef = useRef(null);
    const pollingTimeoutRef = useRef(null);
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const messagePollingIntervalRef = useRef(null);
    const shouldForceScrollToBottomRef = useRef(false);

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
                        return (
                            extractGroupNumber(a.name) -
                            extractGroupNumber(b.name)
                        );
                    });
                    setGroups(sortedGroups);
                })
                .catch(() => setError("Failed to load groups"));
        }
    }, [isAuthenticated, token]);

    useEffect(() => {
        if (!selectedGroup || !token) {
            setMessages([]);
            // Clear any existing polling interval
            if (messagePollingIntervalRef.current) {
                clearInterval(messagePollingIntervalRef.current);
                messagePollingIntervalRef.current = null;
            }
            shouldForceScrollToBottomRef.current = false;
            return;
        }

        // Function to load messages (defined inside useEffect to avoid stale closures)
        const loadMessages = () => {
            if (!selectedGroup || !token) {
                return;
            }
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
        };

        // Load messages immediately
        setLoadingMessages(true);
        // For a freshly selected group, always scroll to bottom on the first load
        shouldForceScrollToBottomRef.current = true;
        loadMessages();

        // Set up polling to load messages every 1 second
        messagePollingIntervalRef.current = setInterval(() => {
            loadMessages();
        }, 1000);

        // Cleanup function to clear interval when component unmounts or dependencies change
        return () => {
            if (messagePollingIntervalRef.current) {
                clearInterval(messagePollingIntervalRef.current);
                messagePollingIntervalRef.current = null;
            }
        };
    }, [selectedGroup, token]);

    // Scroll to bottom when messages change (only if user is near bottom)
    useEffect(() => {
        if (messages.length === 0) return;

        setTimeout(() => {
            const container = messagesContainerRef.current;
            const endElement = messagesEndRef.current;

            if (!container || !endElement) return;

            const distanceFromBottom =
                container.scrollHeight -
                container.scrollTop -
                container.clientHeight;

            if (
                shouldForceScrollToBottomRef.current ||
                distanceFromBottom < 20
            ) {
                endElement.scrollIntoView({
                    behavior: shouldForceScrollToBottomRef.current
                        ? "auto"
                        : "smooth",
                });
                shouldForceScrollToBottomRef.current = false;
            }
        }, 50);
    }, [messages]);

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
            authFetch(`${API_BASE}/groups/${selectedGroup.id}/student-summary`)
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

    const handleFileSelect = (file) => {
        if (!file || !selectedGroup) {
            return;
        }

        const allowedExtensions = [".pdf", ".doc", ".docx"];
        const fileExt = file.name
            .toLowerCase()
            .substring(file.name.lastIndexOf("."));
        if (!allowedExtensions.includes(fileExt)) {
            setError("Only PDF, DOC, and DOCX files are allowed");
            setSelectedFile(null);
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            setError("File size must be less than 10MB");
            setSelectedFile(null);
            return;
        }

        setSelectedFile(file);
        setError("");
    };

    const handleFileInputChange = (event) => {
        const file = event.target.files[0];
        handleFileSelect(file);
    };

    const handleDragOver = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const handleDragLeave = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const handleDrop = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = event.dataTransfer.files[0];
        handleFileSelect(file);
    };

    const handleUpload = () => {
        if (!selectedFile || !selectedGroup) {
            return;
        }

        setUploading(true);
        setError("");

        const formData = new FormData();
        formData.append("file", selectedFile);

        authFetch(`${API_BASE}/groups/${selectedGroup.id}/documents`, {
            method: "POST",
            body: formData,
        })
            .then((res) => res.json())
            .then((newDocument) => {
                setDocuments((prev) => [...prev, newDocument]);
                setUploading(false);
                setSelectedFile(null);
                if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                }
            })
            .catch(() => {
                setError("Failed to upload document");
                setUploading(false);
            });
    };

    // Helper function to format file size
    const formatFileSize = (bytes) => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (
            Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
        );
    };

    // Helper function to format relative time
    const formatRelativeTime = (dateString) => {
        if (!dateString) return "Unknown";

        // Ensure the timestamp is treated as UTC
        let timestampStr = String(dateString).trim();

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
        const now = new Date();

        // Verify the date is valid
        if (isNaN(date.getTime())) {
            console.error("Invalid date:", dateString);
            return "Unknown";
        }

        const diffInSeconds = Math.floor((now - date) / 1000);

        if (diffInSeconds < 0) return "just now"; // Handle future dates
        if (diffInSeconds < 60) return "just now";
        if (diffInSeconds < 3600)
            return `${Math.floor(diffInSeconds / 60)} minutes ago`;
        if (diffInSeconds < 86400)
            return `${Math.floor(diffInSeconds / 3600)} hours ago`;
        if (diffInSeconds < 604800)
            return `${Math.floor(diffInSeconds / 86400)} days ago`;
        if (diffInSeconds < 2592000)
            return `${Math.floor(diffInSeconds / 604800)} weeks ago`;
        return `${Math.floor(diffInSeconds / 2592000)} months ago`;
    };

    const handleViewDocument = async (documentId) => {
        try {
            const response = await authFetch(
                `${API_BASE}/groups/${selectedGroup.id}/documents/${documentId}`
            );
            if (!response.ok) {
                throw new Error("Failed to view document");
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            window.open(url, "_blank");
            // Clean up the URL after a delay
            setTimeout(() => window.URL.revokeObjectURL(url), 100);
        } catch (err) {
            setError("Failed to view document");
        }
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

    const handleDeleteDocument = async (documentId) => {
        // Show confirmation dialog
        const confirmed = window.confirm(
            "Are you sure you want to delete this document?"
        );

        if (!confirmed) {
            return;
        }

        try {
            const response = await authFetch(
                `${API_BASE}/groups/${selectedGroup.id}/documents/${documentId}`,
                {
                    method: "DELETE",
                }
            );

            if (!response.ok) {
                throw new Error("Failed to delete document");
            }

            // Remove document from local state
            setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
        } catch (err) {
            setError("Failed to delete document");
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
                                    activeTab === "Student Overview"
                                        ? "active"
                                        : ""
                                }
                                onClick={() => setActiveTab("Student Overview")}
                            >
                                Student Overview
                            </span>
                        </nav>
                    )}
                    {activeTab === "Chats" ? (
                        <>
                            <div
                                className="messages"
                                ref={messagesContainerRef}
                            >
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
                                                    {msg.sender === "AI Bot" ? (
                                                        <div className="ai-message-content">
                                                            <ReactMarkdown>
                                                                {msg.text}
                                                            </ReactMarkdown>
                                                        </div>
                                                    ) : (
                                                        msg.text
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {!messages.length && (
                                            <p className="placeholder">
                                                No messages yet. Be the first to
                                                say hi!
                                            </p>
                                        )}
                                        <div ref={messagesEndRef} />
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
                                    <div className="documents-upload-section">
                                        <div className="documents-upload-header">
                                            <h3>Upload Document</h3>
                                        </div>
                                        <div
                                            className="upload-drop-zone"
                                            onDragOver={handleDragOver}
                                            onDragLeave={handleDragLeave}
                                            onDrop={handleDrop}
                                            onClick={() =>
                                                fileInputRef.current?.click()
                                            }
                                        >
                                            <div className="upload-icon">
                                                📎
                                            </div>
                                            <p className="upload-text">
                                                Drag & drop your file here or
                                                click to browse
                                            </p>
                                            <p className="upload-limits">
                                                PDF, DOC, DOCX
                                            </p>
                                            {selectedFile && (
                                                <p className="selected-file">
                                                    Selected:{" "}
                                                    {selectedFile.name}
                                                </p>
                                            )}
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept=".pdf,.doc,.docx"
                                                onChange={handleFileInputChange}
                                                style={{ display: "none" }}
                                            />
                                        </div>
                                        <div className="upload-actions">
                                            <button
                                                className="choose-file-btn"
                                                onClick={() =>
                                                    fileInputRef.current?.click()
                                                }
                                                disabled={uploading}
                                            >
                                                Choose File
                                            </button>
                                            <button
                                                className="upload-btn"
                                                onClick={handleUpload}
                                                disabled={
                                                    !selectedFile || uploading
                                                }
                                            >
                                                {uploading
                                                    ? "Uploading..."
                                                    : "Upload"}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="documents-list-section">
                                        <div className="documents-list-header">
                                            <h3>Your Documents</h3>
                                            <span className="document-count">
                                                {documents.length} document
                                                {documents.length !== 1
                                                    ? "s"
                                                    : ""}
                                            </span>
                                        </div>
                                        {loadingDocuments ? (
                                            <p className="placeholder">
                                                Loading documents…
                                            </p>
                                        ) : documents.length === 0 ? (
                                            <div className="documents-empty-state">
                                                <div className="empty-state-icon">
                                                    📭
                                                </div>
                                                <h4 className="empty-state-heading">
                                                    No documents yet
                                                </h4>
                                                <p className="empty-state-text">
                                                    Upload your first document
                                                    to get started
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="document-list">
                                                {documents.map((doc) => (
                                                    <div
                                                        key={doc.id}
                                                        className="document-card"
                                                    >
                                                        <div className="document-icon">
                                                            📄
                                                        </div>
                                                        <div className="document-info">
                                                            <div className="document-name">
                                                                {doc.filename}
                                                            </div>
                                                            <div className="document-metadata">
                                                                <span className="metadata-item">
                                                                    <span className="metadata-icon">
                                                                        👤
                                                                    </span>
                                                                    {doc.uploaded_by ||
                                                                        "Unknown"}
                                                                </span>
                                                                <span className="metadata-item">
                                                                    <span className="metadata-icon">
                                                                        📦
                                                                    </span>
                                                                    {formatFileSize(
                                                                        doc.file_size ||
                                                                            0
                                                                    )}
                                                                </span>
                                                                <span className="metadata-item">
                                                                    <span className="metadata-icon">
                                                                        📅
                                                                    </span>
                                                                    {formatRelativeTime(
                                                                        doc.uploaded_at
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="document-actions">
                                                            <button
                                                                className="view-btn"
                                                                onClick={() =>
                                                                    handleViewDocument(
                                                                        doc.id
                                                                    )
                                                                }
                                                            >
                                                                View
                                                            </button>
                                                            <button
                                                                className="download-btn-primary"
                                                                onClick={() =>
                                                                    handleDownloadDocument(
                                                                        doc.id,
                                                                        doc.filename
                                                                    )
                                                                }
                                                            >
                                                                Download
                                                            </button>
                                                            <button
                                                                className="delete-btn"
                                                                onClick={() =>
                                                                    handleDeleteDocument(
                                                                        doc.id
                                                                    )
                                                                }
                                                            >
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
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
                                                if (!selectedGroup || !token) {
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
