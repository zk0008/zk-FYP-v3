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

**Microsoft authentication** — Deferred
- Blocked by Microsoft's May 2025 policy change requiring a paid Entra ID license for new tenant creation
- Architecture supports Microsoft auth — implementation can be completed when NTU IT provides an Azure AD tenant
- Current login uses username and password authentication

**Dummy supervisor accounts** — ✓ Complete
- Supervisor accounts can be created manually by admin through the Admin Dashboard

**Group allocation** — ✓ Complete
- Admin can assign users to groups through the Admin Dashboard
- Excel import automatically assigns students to groups based on the file

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
