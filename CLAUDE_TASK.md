# CLAUDE_TASK: Refine Ingestion & Real-Time Sync

### 📍 Source Context
Files: `user_input.py`, `src/pages/OrgPage.jsx`

### 🔧 Objectives
1.  **Refactor Ingestion Logic:** In `user_input.py`, ensure that `RecursiveCharacterTextSplitter` uses exactly 1000ch overlap (not 200 character overlap) to match the latest Borg Manifesto.
2.  **Verify WebSocket Integrity:** Read the `ConnectionManager` class. Add a log for when a cross-organization query protocol (A2A) is initiated vs resolved.
3.  **UI Verification:** In `OrgPage.jsx`, ensure that the `ActiveOrgDashboard` correctly renders the "Admin Queue" only for users with `isAdmin` OR `isOrgAdmin`.

### 🚨 Constraints
- Do NOT break existing Firebase `setDoc` merge logic.
- Ensure all Python imports are kept asynchronous.

### 📝 Handover Instructions
Once you have implemented these and verified the build, write a summary of the diffs to **`GEMINI_REPORT.md`**.
