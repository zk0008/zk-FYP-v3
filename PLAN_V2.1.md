# Project Plan V2.1 — FYP Collaborative AI Chatbot

Continuing from V2. All V2 features are complete. V2.1 covers improvements
discussed during the meeting with the supervisor and coordinator.

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

## Phase 1 — Deadline for Submission ✓ Complete

**Simpler date picker ✓ Complete**
- Replace the current date and time picker with a simpler implementation

**Submission frequency ✓ Complete**
- Coordinator sets the submission frequency — weekly, biweekly, or a specific date
- Weekly: deadline repeats every selected day of the week (e.g. every Friday)
- Biweekly: deadline repeats every two weeks on the selected day
- Specific date: one-off deadline, does not repeat
- When a deadline passes, a new submission window opens automatically
- All submission history remains visible to all users — existing history flow unchanged

**Late submission ✓ Complete**
- Students can still submit after the deadline has passed
- Late submissions are flagged and visible to all users including students

**Hard deadline ✓ Complete**
- Coordinator can enable a hard deadline option
- When enabled, no submissions are accepted after the deadline date

---

## Phase 2 — Course Period ✓ Complete

**Start and end date**
- Coordinator can configure a course start date and end date
- Used as the anchor for all week numbering across the application

---

## Phase 3 — Group Overview

**Week-based display**
- Count from Week 1 starting from the course start date to the end date
- Display group overview by weekly, biweekly, or number of weeks

---

## Phase 4 — AI Analysis

**Improved post-analysis**
- More explicit prompt with better structured explanations
- Clearer breakdown of what was discussed in chat versus what students reported

---

## Phase 5 — Document Fetching Fix (RAG)

**Retrieval accuracy**
- Investigate and fix the issue where @ai cannot retrieve information from a
  specific page in a large PDF document
- The RAG pipeline finds the correct document but fails to surface content
  from the relevant page when the document has many pages
- Review chunking strategy, retrieval parameters, and reranker threshold

---

## Phase 6 — Supervisor Dashboard

**Group overview**
- Supervisors can view an overview of their assigned groups only
- Identical layout and features to the coordinator dashboard

**Group comparison**
- Supervisors can compare activity and metrics across their assigned groups
- Includes AI post-analysis and contribution metrics

---

## Rules

- /backend and /frontend are never modified
- All new development in /mobile
- Security handled at implementation time, not deferred
