# Project Plan — FYP Collaborative AI Chatbot

Continuing from a previous student's web implementation. The existing web app
is kept intact as a reference. All new development happens inside /mobile.

---

## Repository Layout

```
zk-FYP-v3/
├── backend/          Web backend — never modified (reference only)
├── frontend/         Web frontend — never modified (reference only)
└── mobile/
    ├── backend/      Mobile backend — copy of web backend, extended here
    └── frontend/     Expo (React Native) mobile app
```

---

## Tech Stack

**Web app (untouched)**
- Python 3.11.7, FastAPI, SQLAlchemy, SQLite, PyJWT, pypdf,
  OpenAI SDK, Tavily, React 19.2.0, Create React App

**Mobile backend**
- Copy of web backend, extended with new features (WebSockets,
  RAG pipeline, notifications). Runs standalone on port 8001.

**Mobile frontend**
- Expo (React Native) — iOS and Android

---

## Features in Scope (mobile only)

**Messaging**
- Real-time messaging via WebSockets
- @mention tagging — any user can tag any other user; self-tagging blocked
- In-app notifications — real-time push via WebSocket, tagged message
  highlighted in thread

**AI / RAG**
- Chunking, OpenAI text-embedding-3-small embeddings, ChromaDB vector store
- Cross-encoder reranker, confidence thresholding

**Summaries & Student Input**
- Group and individual summaries — follow existing web implementation,
  revisit later
- Student contribution input — follow existing web implementation,
  revisit later

---

## Development Phases

**Phase 1 — Setup & Baseline**
Verify the web app runs locally and all existing features work. Write a RAG
evaluation set before touching any AI code.

**Phase 2 — Mobile Backend Setup**
Copy /backend to /mobile/backend. Confirm it runs standalone on port 8001
with its own SQLite database.

**Phase 3 — RAG Improvement ✓ Complete**

Original pipeline: full PDF text dumped into the system prompt, no chunking,
no citations — 19/20 correct answers, 0/20 citations.

Built a hybrid three-case pipeline in rag.py:
- Case 1 (top reranker score >= 0.0): answer from top 10 reranked chunks, doc citations written to Message.sources
- Case 2 (score < 0.0): full text of best-matching document passed to GPT-4o, doc citation on success
- Case 3 (Case 2 returns refusal phrase): Tavily web search, results passed as context, URL citations

Key numbers: chunk size 500 words, overlap 100, top-k 40, reranked to top 10, threshold 0.0.
Citations now working post-RAG.

**→ Current phase: Phase 4**

**Phase 4 — Real-Time & Notifications**
Add WebSocket support for real-time messaging. Implement @mention tagging
and in-app notifications on mobile backend and Expo frontend.

**Phase 5 — Summary Improvements**
Follow the existing web implementation for group summaries and student
contribution input. Revisit scope after Phase 4 is complete.

**Phase 6 — Mobile Frontend**
Build the Expo app: all screens (login, group list, chat, documents,
summary). Connect to mobile backend.

**Phase 7 — Testing & Wrap-Up**
End-to-end testing, RAG eval re-run, document results.

---

## Rules

- /backend and /frontend are never modified.
- All implementation happens inside /mobile.
- No features are added beyond what is listed above without explicit approval.
