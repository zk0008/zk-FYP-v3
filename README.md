# MS3015 Group Chat Application

> ⚠️ **Note:** This is the original version of the app using **OpenAI** and **Tavily** APIs. A newer version integrates with the NALA platform, adds a multi-model evaluator, and rate limiting. If you are building on top of this project, consider migrating to the NALA version.

---

## Overview

A group chat web application built for the **MS3015 Materials Science module at NTU**. It enables structured academic collaboration between students, supervisors, and coordinators, with AI-powered assistance built in.

### Key Features
- Role-based access control (student, supervisor, coordinator)
- Group messaging across 4 groups (Group A–D)
- AI assistant invoked via `@ai` mentions in chat
- Web search powered by Tavily
- PDF upload and retrieval via RAG (Retrieval-Augmented Generation)
- Automated conversation summarisation (weekly or full)
- Student collaborative summary per group
- JWT-based authentication

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (Python) |
| Frontend | React |
| Database | PostgreSQL (production) / SQLite (local dev fallback) |
| ORM | SQLAlchemy + Alembic |
| AI | OpenAI GPT-4o / GPT-4o-mini |
| Web Search | Tavily |
| Auth | JWT (PyJWT) + bcrypt |
| Deployment | Render (backend) + Vercel (frontend) |

---

## Project Structure

```
FYP_v2/
├── README.md
├── backend/
│   ├── main.py          # All API endpoints and core logic (AI, RAG, summarisation)
│   ├── auth.py          # JWT token creation, password hashing and verification
│   ├── database.py      # Database connection and session setup
│   ├── models.py        # Database models (User, Group, Message, Document, Summary)
│   ├── requirements.txt # Python dependencies
│   ├── alembic.ini      # Alembic configuration for database migrations
│   ├── alembic/         # Migration scripts
│   └── uploads/         # Uploaded PDFs (auto-created on startup)
└── frontend/
    └── chat-frontend/
        ├── src/         # React source code
        ├── public/      # Static assets
        └── package.json
```

---

## Local Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- PostgreSQL (optional — app falls back to SQLite if not set)

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd FYP_v2
```

### 2. Backend setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Mac/Linux
# .venv\Scripts\activate         # Windows
pip install -r requirements.txt
```

### 3. Create your `.env` file
Create a `.env` file inside the `backend/` folder:

```env
# Required
OPENAI_API_KEY=your_openai_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
JWT_SECRET_KEY=any_long_random_string_here

# Optional — leave blank to use SQLite locally
DATABASE_URL=postgresql://user:password@localhost/dbname

# Optional — defaults to http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

> 💡 If `DATABASE_URL` is not set, the app automatically uses a local SQLite file (`app.db`). This is perfectly fine for local development and testing.

### 4. Run the backend
```bash
cd backend
uvicorn main:app --reload
```
- Backend runs at: `http://localhost:8000`
- API docs at: `http://localhost:8000/docs`

### 5. Frontend setup
```bash
cd frontend/chat-frontend
npm install
npm start
```
- Frontend runs at: `http://localhost:3000`

---

## Demo Accounts

On first startup with an empty database, the app automatically seeds demo accounts via `init_demo_data()`. Use these to log in:

| Username | Password | Role |
|----------|----------|------|
| coordinator | coordinator1 | Coordinator |
| supervisor1 | supervisor1 | Supervisor |
| supervisor2 | supervisor2 | Supervisor |
| student1 | student1 | Student |
| student2 | student2 | Student |
| student3 | student3 | Student |
| student4 | student4 | Student |
| student5 | student5 | Student |
| student6 | student6 | Student |
| student7 | student7 | Student |
| student8 | student8 | Student |

**Group assignments:**
- Group 1: supervisor1, student1, student2
- Group 2: supervisor1, student3, student4
- Group 3: supervisor2, student5, student6
- Group 4: supervisor2, student7, student8
- Coordinator has access to all groups

---

## Creating Real Users

The app does not have a registration page — new users can only be created in two ways:
1. Via `init_demo_data()` on first startup (demo accounts only)
2. By directly inserting into the database

---

## Database Migrations (Alembic)

If you make changes to `models.py`, generate and apply a migration:

```bash
alembic revision --autogenerate -m "describe your change"
alembic upgrade head
```

---

## API Endpoints Summary

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/auth/login` | Login and get JWT token | Public |
| GET | `/groups` | List all groups | Authenticated |
| GET | `/groups/{group_id}/messages` | Get messages for a group | Group members |
| POST | `/groups/{group_id}/messages` | Send a message (triggers AI if `@ai`) | Group members |
| POST | `/groups/{group_id}/documents` | Upload a PDF | Group members |
| GET | `/groups/{group_id}/documents` | List uploaded documents | Group members |
| POST | `/groups/{group_id}/summary` | Generate AI summary | Supervisor/Coordinator |
| GET | `/groups/{group_id}/student-summary` | Get student summary | Group members |
| POST | `/groups/{group_id}/student-summary` | Update student summary | Group members |

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI replies and summarisation |
| `TAVILY_API_KEY` | Yes | Tavily API key for web search |
| `JWT_SECRET_KEY` | Yes | Secret key for signing JWT tokens (use a long random string) |
| `DATABASE_URL` | No | PostgreSQL connection string. Falls back to SQLite if not set |
| `FRONTEND_URL` | No | Frontend URL for CORS. Defaults to `http://localhost:3000` |
| `SKIP_DEMO_DATA` | No | Set to any value to skip demo data seeding on startup (use in production) |

---

## Known Issues / Future Improvements

- **No rate limiting** — AI endpoints are unprotected against spam
- **No user registration** — new users can only be created via database or demo seeding
- **No hallucination detection** — AI responses are not validated for accuracy
- **OpenAI dependency** — web search and AI replies are tightly coupled to OpenAI's function calling
- **Single deployment** — consider migrating to a more sustainable hosting setup for long-term use

---

## Deployment

**Backend (Render):**
- Set all environment variables in Render's dashboard
- Set `SKIP_DEMO_DATA=true` in production to avoid re-seeding on every restart

**Frontend (Vercel):**
- Set the backend API URL as an environment variable in Vercel
