# Mobile Backend

Standalone FastAPI backend for the mobile app. Runs on port 8001.

---

## First-time setup

```bash
conda activate fyp-backend
cd mobile/backend
pip install -r requirements.txt
```

---

## Running the server

```bash
conda activate fyp-backend
cd mobile/backend
uvicorn main:app --reload --port 8001
```

API runs at: http://127.0.0.1:8001  
Swagger docs at: http://127.0.0.1:8001/docs

---

## Notes

- Database: `mobile.db` (SQLite, created automatically on first run)
- Demo users and groups are seeded on first run
- Environment variables are in `.env` (git-ignored)
