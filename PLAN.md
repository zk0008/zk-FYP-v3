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

**Phase 4 — Real-Time & Notifications ✓ Complete**

Messages now go through WebSockets instead of HTTP polling. When a user
sends a message the server broadcasts it to everyone connected to that
group in real time. The old polling loop and optimistic-UI code in the
web frontend were removed.

@mention tagging works end-to-end: the server finds any @username in a
message, creates a Notification row, and pushes it to that user
immediately via WebSocket. If they're offline the notification is queued
and delivered on their next connection. Tagged messages are highlighted
in yellow in the chat.

The sidebar shows two separate badges per group — a blue one for unread
messages and an orange @N one for unread tag notifications. Both hide
when you're already in that group. Unread position is tracked using
GroupMember.last_read_message_id and cleared when you open a group.
The mobile backend gained four new REST endpoints: GET /notifications,
POST /notifications/{id}/read, GET /groups/{id}/unread, and
POST /groups/{id}/read.

Known gap: the cross-group badge only updates in real time if the user
is connected to a different group's WebSocket. If they're not connected
at all, the badge won't tick up until the next page load. Fixing this
properly would need a separate notification channel or polling, deferred
for now.

Note: /frontend was intentionally modified for Phase 4 WebSocket
integration. All existing web features remain intact.

**Phase 5 — Mobile Frontend (Expo) — In Progress**

Build the Expo React Native app for iOS and Android. Every screen from
the web frontend must be reproduced in the mobile app.

Theme: simple, natural colours with rounded corners, broadly consistent
with the existing web frontend. Target both iOS and Android via Expo.

Steps 1–4 complete. Step 5 is next.

**Step 1 — Project scaffold ✓**
Expo Router project created under /mobile/app. File-system routing with
a root Stack navigator. AuthProvider wraps the tree via React Context.
AsyncStorage persists JWT token and user across sessions. Auto-redirect
to login if unauthenticated.

Screens: index (redirect), login, groups (root of app after auth).
Hooks: useAuth (token, user, login, logout), useGroups (fetch + badge counts).

**Step 2 — Groups screen ✓**
Group list with blue (unread messages) and orange (@mention) badge counts
per group. useFocusEffect refreshes on return from chat; 15 s polling
keeps badges current while the screen is active. 401 auto-logout and
retry on error. Stable FlatList separator, SafeAreaView from
react-native-safe-area-context.

**Step 3 — Chat shell & navigation ✓**
[groupId] folder creates a nested Tabs navigator (Chats, Documents,
AI Overview, Student) inside the root Stack. Stack header shows group
name with an explicit ‹ Groups back button (router.navigate avoids
history-pop issues in the nested Stack). tabBarHideOnKeyboard: true on
the Chats tab so the keyboard never covers the input bar.

**Step 4 — Chats tab ✓**
Real-time chat screen backed by WebSocket with full reconnect logic.

ScrollView (not FlatList) renders all messages at once so scrollToEnd
and scrollTo always land at the exact position — matches how the web
frontend works. On load, messages + unread count are fetched in parallel;
unread count is captured before POST /read resets it. Each message View
captures its Y position via onLayout. After a 50 ms settle, the screen
jumps to the first unread message (by ID, same formula as the web) or
to the latest message if no unread. Hidden behind a spinner overlay until
positioned — no flash-to-top.

MessageBubble: own messages right-aligned blue, bot messages left purple,
others left white, @mentioned messages yellow. Wrapped in React.memo.

Keyboard: KeyboardAvoidingView with behavior="padding" on iOS and
behavior="height" on Android, keyboardVerticalOffset=useHeaderHeight()
so the input bar always appears flush above the keyboard. Keyboard open
event scrolls to the latest message. keyboardShouldPersistTaps="handled"
on the ScrollView.

WebSocket hook: exponential backoff reconnect (2 s → 4 s → 8 s → 30 s
cap, no hard attempt limit), AppState listener reconnects when app
returns to foreground, guard against stacking duplicate connections.

Backend fixes shipped alongside Step 4:
- NullPool on SQLite engine (no more pool exhaustion from long-lived WS sessions)
- ConnectionManager stores list[WebSocket] per user per group so the same
  account on two devices (simulator + physical) both receive broadcasts
- Offline cross-group nudge uses active_user_ids_in_group() helper

**Push notifications ✓ (shipped with Step 4)**
System push notifications via Expo Push Notification Service → APNs.

Backend: PushToken model and POST /push-token endpoint. When a message
is sent, members with no live WebSocket receive an Expo push notification
(title = group name, body = sender: first 100 chars). HTTP call runs in
a thread executor so it never blocks the async event loop.

Frontend: usePushNotifications hook requests permission, obtains the
Expo push token via getExpoPushTokenAsync (projectId from EAS config),
registers it with the backend on login. Notification handler configured
for foreground banners + sound. Response listener navigates to the
correct group on notification tap, including cold-start via
getLastNotificationResponseAsync.

EAS project configured (projectId in app.json). iOS Simulator cannot
receive push notifications — Apple platform restriction, no workaround.

**Step 5 — Documents tab ✓**

Documents screen built. Shows all uploaded PDFs for a group in a scrollable
list with filename, uploader, file size, and upload date. Tapping the upload
button opens the device file picker filtered to PDFs; the file uploads straight
away as multipart POST and the list refreshes on success. The download button
fetches the file from the backend with the JWT header, saves it to the device
cache, then opens the system share sheet so the user can view or save it.
Tapping delete shows a confirmation alert before calling DELETE on the backend
and removes the row from the list on success.

**Step 6 — AI Overview tab ✓**

AI Overview screen built. Fetches the latest weekly summary from the backend
on tab open and displays it in a scrollable card. Text formatting is ported
from the web frontend — leading dashes become bullet points, and "Key points:"
and "Supervisor Action Plan:" are bolded. The last updated timestamp is shown
in Singapore time with the same UTC-to-SGT fix the web uses. A Refresh button
calls the POST endpoint to regenerate the summary and updates the card on
success. If no summary exists yet an empty state message is shown with the
refresh button still available.

Also fixed in this step: AI bot messages in the Chats tab were rendering raw
markdown syntax as literal characters. MessageBubble.tsx now formats bot
messages the same way the web frontend does — ### headings go bold, **word**
goes bold, and leading dashes become bullet points.

**→ Current: Step 7**

**Step 7 — Student Overview tab**
- View and edit collaborative student summary text
- Save button (POST to persist)

**Phase 6 — Summary Improvements**
Follow the existing web implementation for group summaries and student
contribution input. Revisit scope after Phase 5 is complete.

**Phase 7 — Testing & Wrap-Up**
End-to-end testing, RAG eval re-run, document results.

---

## Rules

- /backend and /frontend are never modified.
- All implementation happens inside /mobile.
- No features are added beyond what is listed above without explicit approval.
