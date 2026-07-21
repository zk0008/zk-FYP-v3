# Project Plan V3 — FYP Collaborative AI Chatbot

Continuing from V2.1. V3 covers user enrolment, distribution, and research
components for the final submission.

---

## Phase 1 — User Enrolment

**Admin role and user management** — ✓ Complete
- Admin role added with full user management (create, edit, deactivate users)
- Admin dashboard with user list, role management, and group allocation UI

**Excel import for student account creation** — ✓ Complete (updated)
- Admin uploads an .xlsx file with columns: full_name, username, student_id, group_id
- Username matches the NTU email prefix (e.g. username J0008TAN maps to J0008TAN@e.ntu.edu.sg)
- Students are Microsoft-login-only — no working local password is set
- Automatically assigned to groups based on group_id (e.g. group_id 1 maps to "Group 1")
- Duplicate usernames are skipped; inactive accounts are reactivated on re-import
- Supervisor assignment is handled separately, not part of this import
- Students who log in via Microsoft after import are automatically linked to their pre-assigned group

**Change password** — ✓ Complete
- All users can change their password from the group list screen
- Requires current password verification and minimum 8 character new password

**Hard delete user** — ✓ Complete
- Admin can permanently delete a user from the Edit User modal
- Requires confirmation before deletion
- Cannot delete own account

**Microsoft authentication** — ✓ Complete
- Implemented using a personal Azure AD tenant registered as multitenant
- OAuth Authorization Code + PKCE flow via expo-auth-session
- Backend verifies Microsoft-issued tokens against Microsoft's public keys
- Only @e.ntu.edu.sg email addresses are accepted — all other domains rejected
- New NTU accounts are created automatically on first login
- Existing username/password login remains fully functional alongside Microsoft login

**Dummy supervisor accounts** — ✓ Complete
- Supervisor accounts can be created manually by admin through the Admin Dashboard

**Group allocation** — ✓ Complete
- Admin can assign users to groups through the Admin Dashboard
- Excel import automatically assigns students to groups based on the file

**Admin group management** — ✓ Complete
- Admin can create new groups
- Admin can permanently delete groups and all associated data

**External users** — Deferred
- Deferred — admin account creation covers all current user types
- Can be revisited if external non-NTU users need access in future

---

## Phase 2 — Global Broadcast

**Coordinator broadcast** — ✓ Complete
- Coordinator and admin can send announcements to all users
- Real-time delivery via WebSocket to all connected users
- Offline users receive recent broadcasts on next login
- Announcement banner shown above group list when broadcasts exist
- All users can view broadcast history in the Announcements modal
- Coordinator and admin can delete broadcasts

---

## Phase 3 — Feedback and Issue Reporting

**Feedback and issue reporting** — ✓ Complete
- All users can submit general feedback or bug reports from the groups screen
- Feedback stored in database with type, content, submitter, and timestamp
- Admin can view all feedback in the admin dashboard
- Admin can toggle resolved/unresolved status on each feedback item
- Latest 5 shown by default with View More option

---

## Phase 4 — Distribution

**Cross-Platform Testing — Android Emulator** — ✓ Complete

**Mobile**
- iOS and Android builds via Expo
- APK (Android) and IPA (iOS) for distribution

**Distribution method (confirmed)**
- iOS via Expo Go (bypasses Apple Developer cost, push notifications and date pickers confirmed working on real device), Android via standalone APK build

**Web version**
- Web version of the application

**Deployment Platform — Azure (Decided)**

Chosen platform: Microsoft Azure, to consolidate hosting with the existing Azure AD (Microsoft authentication) account under one bill.

Required Azure services:
- Azure App Service (Linux, Python, B1 tier) — hosts the FastAPI backend, replaces local uvicorn
- Azure Database for PostgreSQL — Flexible Server (Burstable B1ms) — replaces SQLite
- pgvector extension on the same PostgreSQL instance — replaces ChromaDB for RAG embeddings
- Azure Blob Storage — replaces local uploads/ folder for PDFs and images
- Azure AD (Entra ID) — already configured for Microsoft authentication

Why not keep SQLite/ChromaDB on Azure:
Azure App Service's persistent storage (/home) is mounted as a CIFS network filesystem, documented by Microsoft as unsuitable for SQLite due to file-locking incompatibility — this causes "database is locked" errors under concurrent access. This affects both the main SQLite database and ChromaDB (which is SQLite-backed internally). Render and Railway do not have this limitation since their persistent disks are local block storage, but Azure was chosen anyway to consolidate billing with the existing Microsoft auth setup. PostgreSQL + pgvector avoids the issue entirely since it does not rely on file-based locking.

Migration requirements before going live:
- Rewrite database connection to use PostgreSQL instead of SQLite (psycopg already in requirements.txt)
- Rewrite rag.py to use pgvector instead of ChromaDB for embedding storage and retrieval
- Rewrite document/image upload endpoints to use Azure Blob Storage instead of local disk
- Review all ALTER TABLE startup migrations for PostgreSQL syntax compatibility (some use SQLite-specific syntax like AUTOINCREMENT)
- Enable "Always On" in Azure App Service configuration (required for WebSocket stability, not available on Free tier)
- Enable WebSocket support explicitly in App Service configuration
- Set all environment variables in Azure App Service Configuration → Application Settings
- Update CORS allowlist to include the production Azure App Service URL
- Start fresh in production — no migration of existing local test data, re-seed via Excel import and re-upload documents after go-live

Estimated cost:
- Azure App Service B1: ~$13 USD/month
- Azure Database for PostgreSQL (Burstable B1ms): ~$12-15 USD/month
- Azure Blob Storage: <$1 USD/month
- Apple Developer Account (iOS distribution): $99 USD/year
- Google Play Console (optional): $25 USD one-time
- Total excluding OpenAI usage: ~$26-29 USD/month + $99/year

This decision was made after comparing against Render (Paid, $7/month) and Railway (Hobby, $5/month), which do not require the PostgreSQL/pgvector migration since their persistent disks support SQLite natively. Azure was chosen specifically to consolidate all spending under one account alongside the existing Microsoft authentication setup.

**PostgreSQL and pgvector migration** — ✓ Complete
- Database migration made dialect-aware (SQLite for local dev, PostgreSQL for Azure production)
- ChromaDB replaced with pgvector on PostgreSQL, function-for-function parity maintained
- Verified end-to-end: document upload, chunking, embedding, retrieval, and @ai responses tested against real Azure PostgreSQL database
- Local SQLite/ChromaDB path confirmed unaffected

**Azure Blob Storage migration** — ✓ Complete
- Document and image uploads made storage-aware (local disk for dev, Blob Storage for Azure production)
- RAG text extraction and vision summary reads now use in-memory content instead of re-reading from disk
- Fixed silent failure on image upload errors — frontend now surfaces backend validation messages to the user
- Verified end-to-end on both local disk and Azure Blob Storage: upload, download, delete, image display, AI summary with images
- Note: HEIC images (default iPhone camera format) are not yet supported — deferred, frontend conversion or backend decoding needed in future

**Environment indicator** — ✓ Complete
- Small dot indicator visible on all screens showing which backend the app is connected to
- Green dot for production (Azure), yellow dot for local development
- Implemented once at the root layout level, no changes needed to individual screens

**Full-screen image viewer** — ✓ Complete
- Tap any chat image to view it full-screen
- Tap anywhere to close, or use the close button
- Note: pinch-to-zoom was attempted via react-native-gesture-handler but caused a crash in Expo Go ("Exception in HostFunction" at import time) — reverted to a simpler tap-to-view modal using only React Native core components, no gesture library

**Azure production fixes and AI thinking indicator** — ✓ Complete
- Fixed Azure App Service cold-start failure caused by chromadb's unconditional sqlite3 version check (lazy-loaded)
- Fixed Azure cold-start timeout caused by blocking cross-encoder model download at startup (lazy-loaded, pre-warmed in background on startup)
- Added AI thinking indicator (animated dots) shown while waiting for @ai response, with 60-second fallback timeout
- Fixed message ordering so the thinking indicator appears below the user's own @ai message, not above it
- Confirmed live on Azure App Service: instant login and /docs, first RAG query pre-warmed in background

---

## Phase 5 — Pre and Post Survey

- In-app pre and post survey for research data collection
- Questions to be defined — details to be confirmed when implementation begins

---

## Rules

- /backend and /frontend are never modified
- All new development in /mobile
- Security handled at implementation time, not deferred
