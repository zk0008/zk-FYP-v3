# Project Plan V2 — FYP Collaborative AI Chatbot

Continuing from V1. All mobile backend, RAG pipeline, real-time messaging,
Expo mobile app, and summary features are complete. V2 adds chat improvements,
AI context from images, student summary submission, and a coordinator dashboard.

---

## Repository Layout

```
zk-FYP-v3/
├── backend/          Web backend — never modified (reference only)
├── frontend/         Web frontend — never modified (reference only)
└── mobile/
    ├── backend/      Mobile backend — all new endpoints added here
    └── app/          Expo React Native app — all new screens added here
```

---

## Phase 1 — Chat Interface Improvements

**Message timestamps ✓ Complete**
- Show timestamp on each message bubble, formatted in SGT (UTC+8)

**@mention member list ✓ Complete**
- Typing @ in the chat input shows a list of group members to tag
- Selecting a name inserts @username into the input
- Self-tagging stays blocked

**Image upload and camera capture ✓ Complete**
- Attachment button on the chat input bar — pick from photo library or take a photo
- Image sent as a chat message, renders as a thumbnail in the thread
- File type and size validated on both frontend and backend

**Notification filtering for coordinator and supervisor**
- Coordinators and supervisors only receive notifications when explicitly @mentioned by their exact username
- Deferred — not yet implemented
- No changes to the member list endpoint needed until this is implemented

---

## Phase 2 — Document & AI Context

**Photos as AI context ✓ Complete**
- Images uploaded or taken in chat are included as context when generating
  the AI Overview summary
- Only images belonging to the group are accessible — no cross-group leakage

---

## Phase 3 — Student Weekly Summary

**Editable summary ✓ Complete**
- Two input fields in the Student Overview tab:
  - One for editing a copy of the AI-generated weekly summary
  - One for the student-written summary
- A single Save button saves both fields to history, following the existing
  StudentSummary implementation

**Save with attribution ✓ Complete**
- Each save records the username and timestamp of who saved it
- Full save history is kept for both fields

**Submit feature ✓ Complete**
- Students can submit the latest saved copy before a deadline
- Only the most recent submission counts
- Only students in the group can submit

---

## Phase 4 — Coordinator Dashboard

**Weekly summary view**
- Coordinators can view the weekly AI summary and latest student summary
  submission for each group

**AI post-analysis**
- AI-generated comparison between the group chat transcript and the
  student-written summary
- Shows what was observed in chat vs what students reported
- Coordinator can select the number of weeks to include in the analysis

**Week range selector**
- Select a range of weeks to view summary, student contributions,
  and percentage involvement in chat

**Contribution metrics and visualisations**
- Per-student message count and percentage involvement for the selected range
- Charts or graphs showing individual and group-level activity

**Group comparison dashboard**
- Compare activity and metrics across all groups
- Graphical visualisation of group-level engagement and summary submission status

---

## Phase 5 — Security Audit

Verification pass before any distribution or deployment.

- JWT expiry and secret strength
- Role-based access on every endpoint
- File upload validation — type and size
- No sensitive data leaked in API responses
- WebSocket token validation
- Cross-group data isolation

---

## Rules

- /backend and /frontend are never modified
- All new development in /mobile
