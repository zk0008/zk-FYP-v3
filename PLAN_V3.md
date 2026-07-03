# Project Plan V3 — FYP Collaborative AI Chatbot

Continuing from V2.1. V3 covers user enrolment, distribution, and research
components for the final submission.

---

## Phase 1 — User Enrolment

**Admin role and user management** — ✓ Complete
- Admin role added with full user management (create, edit, deactivate users)
- Admin dashboard with user list, role management, and group allocation UI

**Excel import for student account creation** — ✓ Complete
- Admin uploads an .xlsx file with columns: username, matric_number, full_name, email, group_name, supervisor_email (optional)
- Students are created with temporary password (last 4 characters of matric number)
- Automatically assigned to groups and supervisors based on the file
- Duplicate usernames are skipped; inactive accounts are reactivated on re-import

**Change password** — ✓ Complete
- All users can change their password from the group list screen
- Requires current password verification and minimum 8 character new password

**Hard delete user** — ✓ Complete
- Admin can permanently delete a user from the Edit User modal
- Requires confirmation before deletion
- Cannot delete own account

**Microsoft authentication**
- NTU users (students, supervisors, coordinators) log in via Microsoft authentication
- User accounts are created by fetching from an Excel file

**Dummy supervisor accounts**
- Create dummy accounts for supervisors for testing and demonstration

**Group allocation**
- Fixed list for group allocation when creating group chats
- Basic modifications to group assignments supported

**External users**
- External users register via a separate create new account flow
- Not linked to Microsoft authentication

---

## Phase 2 — Global Broadcast

**Coordinator broadcast**
- Coordinator can send a global announcement to all users
- Appears as a separate notification or announcement, not inside a group chat

---

## Phase 3 — Feedback and Issue Reporting

- Users can submit feedback or report issues from within the app

---

## Phase 4 — Distribution

**Mobile**
- iOS and Android builds via Expo
- APK (Android) and IPA (iOS) for distribution

**Web version**
- Web version of the application

---

## Phase 5 — Pre and Post Survey

- In-app pre and post survey for research data collection
- Questions to be defined — details to be confirmed when implementation begins

---

## Rules

- /backend and /frontend are never modified
- All new development in /mobile
- Security handled at implementation time, not deferred
