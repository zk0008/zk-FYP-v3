# GroupGPT (CollabGPT) — Mobile App

Collaborative AI chatbot platform for NTU academic groups. Built with Expo
React Native and a standalone FastAPI backend. This is a mobile-first
continuation of the original MS3015 web application (see `/backend` and
`/frontend` in the repo root, which remain untouched reference implementations).

For full implementation history and detailed specs, see:
`PLAN.md` (V1) → `PLAN_V2.md` → `PLAN_V2.1.md` → `PLAN_V3.md`

---

## Overview

Four roles, one app:

- **Student** — group chat, document upload, weekly summary submission, @ai assistant
- **Supervisor** — same as student, plus a read-only dashboard for assigned groups
- **Coordinator** — full dashboard access, deadline and course period configuration, global broadcasts
- **Admin** — user management, Excel bulk import, group creation/allocation, feedback review

Authentication supports both:
- **Username/password** — for admin-created accounts (coordinators, supervisors, manually created users)
- **Microsoft (NTU email)** — students sign in with their `@e.ntu.edu.sg` account; accounts are auto-created or linked to Excel-imported records

---

## Tech Stack

**Backend:** FastAPI, SQLAlchemy, SQLite, OpenAI API (chat, summaries, RAG), ChromaDB + sentence-transformers (RAG retrieval and reranking), Tavily (web search fallback), PyJWT + bcrypt (auth), cryptography (Microsoft token verification)

**Mobile App:** Expo (React Native) SDK 54, Expo Router, expo-auth-session (Microsoft OAuth), expo-secure-store (secure token storage), expo-image-picker / expo-document-picker (uploads), SheetJS/xlsx (Excel parsing), @react-native-community/datetimepicker

Full dependency lists: `mobile/backend/requirements.txt`, `mobile/app/package.json`

### Infrastructure / External Services

| Service | Purpose |
|---------|---------|
| OpenAI API | Chat completions, embeddings, vision (summaries) |
| Tavily API | Web search fallback for `@ai` |
| Microsoft Azure AD | OAuth authentication for NTU students |
| ChromaDB (local) | Vector storage, runs embedded in the backend |
| SQLite | Local database (`mobile.db`) |

---

## Required Account Setup

Before running the app, the following accounts need to be created:

| Service | Required For | Tier | Link |
|---------|--------------|------|------|
| **OpenAI** | Chat, summaries, RAG, vision | Paid (pay-as-you-go, no free tier for API) | platform.openai.com |
| **Tavily** | Web search fallback | Free tier: 1,000 searches/month | tavily.com |
| **Microsoft Azure** | Microsoft/NTU login AND backend hosting (App Service, PostgreSQL, Blob Storage) | Free to create; hosting itself is paid — see Deployment section below | portal.azure.com |
| **Expo (EAS)** | Building APK/IPA for distribution | Free tier: 30 builds/month | expo.dev |
| **Apple Developer** | iOS distribution (TestFlight/App Store) | $99 USD/year — no free tier | developer.apple.com |
| **Google Play Console** | Android Play Store distribution (optional — direct APK install is free) | $25 USD one-time | play.google.com/console |

**Note on Azure AD:** As of mid-2025, Microsoft requires a paid Entra ID license to create a *new tenant*. The workaround used in this project: register the app under an existing personal Microsoft account's tenant as a **multitenant application**, then restrict access in backend code to `@e.ntu.edu.sg` emails only. See `PLAN_V3.md` for full setup steps. No cost is incurred with this approach.

---

## Local Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- Expo Go app (for quick testing) or Android Studio / Xcode (for emulator/simulator)
- Accounts listed above (OpenAI and Tavily API keys are mandatory to run the backend at all — RAG features will fail to start without them)

### 1. Backend setup

```bash
cd mobile/backend
python -m venv .venv
source .venv/bin/activate        # Mac/Linux
# .venv\Scripts\activate         # Windows
pip install -r requirements.txt
```

Create `.env` inside `mobile/backend/`:

```
OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key
JWT_SECRET_KEY=any_long_random_string
MICROSOFT_CLIENT_ID=your_azure_app_client_id
```

Run the backend:
```bash
uvicorn main:app --reload --port 8001 --host 0.0.0.0
```
- API runs at `http://127.0.0.1:8001`
- Swagger docs at `http://127.0.0.1:8001/docs`
- Database (`mobile.db`) and ChromaDB store are created automatically on first run
- Demo accounts are seeded automatically on an empty database (see Demo Accounts below)

### 2. Mobile app setup

```bash
cd mobile/app
npm install
```

Create `.env` inside `mobile/app/`:
```
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8001
EXPO_PUBLIC_WS_URL=ws://<your-lan-ip>:8001
EXPO_PUBLIC_MICROSOFT_CLIENT_ID=your_azure_app_client_id
```
Use your machine's LAN IP (not `127.0.0.1`) so a physical device or emulator on the same network can reach the backend.

Run:
```bash
npx expo start
```
- Scan the QR code with Expo Go on a physical device, or
- Press `i` for iOS Simulator, or
- Press `a` for Android emulator (requires Android Studio set up separately)

### 3. Demo Accounts

Seeded automatically on first startup if the database is empty:

| Username | Password | Role |
|----------|----------|------|
| coordinator | coordinator1 | Coordinator |
| supervisor1 | supervisor1 | Supervisor |
| supervisor2 | supervisor2 | Supervisor |
| student1–student8 | matches username | Student |

Set `SKIP_DEMO_DATA=true` in `.env` to disable this seeding — recommended for production.

---

## Running Locally vs Production

### Local Development

Backend (SQLite + local disk storage):
```bash
cd mobile/backend
source .venv/bin/activate
unset ALL_PROXY HTTPS_PROXY HTTP_PROXY
uvicorn main:app --reload --port 8001 --host 0.0.0.0
```

Confirm `mobile/backend/.env` does NOT contain `DATABASE_URL` pointing to PostgreSQL, and does NOT contain `AZURE_STORAGE_CONNECTION_STRING` — their absence is what activates local SQLite and local disk storage.

Mobile app:
```bash
cd mobile/app
npx expo start --clear
```

Update `mobile/app/.env` with your current LAN IP:
```
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8001
EXPO_PUBLIC_WS_URL=ws://<your-lan-ip>:8001
```

### Production (Azure)

Production runs automatically — no manual commands needed. Deployment happens via GitHub Actions whenever `prod` branch is updated:

```bash
git checkout prod
git merge main
git push origin prod
```

This triggers Azure App Service to pull the latest code, install dependencies, and restart automatically. Environment variables (`DATABASE_URL`, `AZURE_STORAGE_CONNECTION_STRING`, `JWT_SECRET_KEY`, etc.) are already configured in Azure App Service → Environment variables → App settings, and do not need to be set locally.

To view production logs: Azure Portal → App Service (`collab-gpt-backend`) → Log stream.

### Testing Against Production Database Locally (rare, use with caution)

Only needed for debugging production-specific issues. Requires temporarily adding your local IP to the Azure PostgreSQL firewall allowlist first (Azure Portal → PostgreSQL server → Networking → Firewall rules).

```bash
export DATABASE_URL='your_azure_postgresql_connection_string'
export AZURE_STORAGE_CONNECTION_STRING='your_azure_blob_connection_string'
unset ALL_PROXY HTTPS_PROXY HTTP_PROXY
uvicorn main:app --reload --port 8001 --host 0.0.0.0
```

**Important — always clean up afterward:**
```bash
unset DATABASE_URL AZURE_STORAGE_CONNECTION_STRING
```
And remove your IP from the Azure PostgreSQL firewall allowlist once done testing.

---

## Feature Summary by Version

**V1** — Hybrid three-case RAG pipeline, WebSocket real-time chat, full Expo app (login, groups, chat, documents, AI overview, student overview), summary system with history.

**V2** — Message timestamps and date separators, @mention tagging, image upload in chat, photos included in AI summaries, student weekly summary with submit and deadline, coordinator and supervisor dashboards with contribution charts and AI post-analysis, full security audit.

**V2.1** — Repeating deadlines (weekly/biweekly), late submission and hard deadline options, course period configuration, week-based group overview, improved AI analysis with source transparency, smaller RAG chunks and filename detection for better document retrieval.

**V3** — Admin role with full user management, Excel bulk import for student accounts, Microsoft (NTU) authentication, admin group creation/deletion, global broadcast announcements, feedback and issue reporting, Android emulator cross-platform testing and fixes.

See the individual `PLAN_*.md` files for full detail on each phase.

---

## Excel Import (Student Accounts)

Admin uploads an `.xlsx` file with columns:

| Column | Description |
|--------|-------------|
| `full_name` | Student's full name |
| `username` | NTU email prefix (e.g. `J0008TAN` for `J0008TAN@e.ntu.edu.sg`) |
| `student_id` | Matric number, stored for reference |
| `group_id` | Group number (e.g. `1` maps to "Group 1") |

Imported accounts are Microsoft-login-only — no working local password is set. Supervisor assignment is handled separately through the Admin Dashboard's Group Allocation section.

---

## Known Limitations

- SQLite is used for local development; production deployment should consider PostgreSQL for concurrent write reliability
- iOS distribution requires an Apple Developer account (TestFlight or App Store)
- Android distribution via direct APK requires enabling "install from unknown sources"
- Microsoft auth uses a personal Azure AD tenant (multitenant registration) with domain-restricted access, since NTU IT app registration was not available at time of development

---

## Deployment

**Chosen platform: Microsoft Azure** — consolidates hosting with the existing Azure AD (Microsoft auth) account under one bill.

### Required Azure Services

| Component | Azure Service | Replaces |
|-----------|---------------|----------|
| Backend (FastAPI + WebSockets) | Azure App Service (Linux, Python, B1 tier) | Local `uvicorn` |
| Database | Azure Database for PostgreSQL — Flexible Server (Burstable B1ms) | SQLite |
| Vector store (RAG embeddings) | `pgvector` extension on the same PostgreSQL instance | ChromaDB |
| File uploads (PDFs, images) | Azure Blob Storage | Local `uploads/` folder |
| Authentication | Azure AD (Entra ID) — already configured | — |

### Why PostgreSQL + pgvector instead of SQLite/ChromaDB

Azure's persistent storage isn't SQLite-compatible under concurrent access. Full reasoning in `PLAN_V3.md`.

### Migration Requirements

Full checklist before going live in `PLAN_V3.md` Phase 4.

### Estimated Cost

| Item | Cost |
|------|------|
| Azure App Service B1 | ~$13 USD/month |
| Azure Database for PostgreSQL (Burstable B1ms) | ~$12–15 USD/month |
| Azure Blob Storage | <$1 USD/month |
| Apple Developer Account (iOS distribution) | $99 USD/year |
| Google Play Console (optional, Android Play Store) | $25 USD one-time |
| **Total (excluding OpenAI usage)** | **~$26–29 USD/month + $99/year** |

### Distribution

- **Android** — direct APK build via EAS Build (free), shared as a download link; students enable "install from unknown sources"
- **iOS** — TestFlight via Apple Developer account; builds expire every 90 days and need periodic rebuilding
- **Web version** — deferred until mobile distribution is stable

See `PLAN_V3.md` Phase 4 for further detail and the original cost comparison against Render/Railway.
