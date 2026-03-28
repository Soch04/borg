# Project Borg — React Scaffold Implementation Plan

## Overview

Build a complete React.js scaffold for **Project Borg**, an AI agent network for organizations. This is a functional MVP scaffold with a premium UI, real-time messaging simulation, auth flow, protected admin routes, and a documented backend/RAG strategy. We will use **Vite + React** for the frontend and **Firebase** for the backend (Auth + Firestore + Storage).

---

## User Review Required

> [!IMPORTANT]
> **Database Choice: Firebase (Recommended)**
> We'll use Firebase (Firestore + Auth + Storage) as it's the fastest path to a working scaffold with real-time listeners, auth, and file storage — all with generous free tiers. This avoids hosting a separate backend server during the hackathon.

> [!IMPORTANT]
> **This scaffold will use mock/simulated data for agent logic.** The LLM calls (Gemini API) and vector search (Pinecone) will be stubbed out with realistic fake data. In Phase 2, these stubs will be replaced with real API calls.

> [!NOTE]
> **Auth**: We'll use Firebase Authentication (Email/Password) for the scaffold. LinkedIn OAuth can be added later as a non-functional "Connect" button on the profile page.

---

## Proposed Changes

### Project Structure

```
polly/
├── src/
│   ├── components/
│   │   ├── layout/         # Sidebar, Layout wrapper
│   │   ├── messaging/      # MessageBoard, MessageBubble, MessageInput
│   │   ├── profile/        # ProfileCard, ConnectButtons
│   │   ├── bot-settings/   # BotConfig, InstructionsEditor
│   │   ├── org/            # OrgDataUpload, KnowledgeBase
│   │   └── admin/          # DeptMonitor, LogsFilter
│   ├── pages/
│   │   ├── MessagingPage.jsx
│   │   ├── BotSettingsPage.jsx
│   │   ├── ProfilePage.jsx
│   │   ├── OrgPage.jsx
│   │   └── AdminDashboard.jsx
│   ├── context/
│   │   ├── AuthContext.jsx
│   │   └── AppContext.jsx
│   ├── firebase/
│   │   ├── config.js
│   │   ├── auth.js
│   │   └── firestore.js
│   ├── hooks/
│   │   ├── useMessages.js
│   │   └── useAgent.js
│   ├── data/
│   │   └── mockData.js     # Mock agents, messages, org data
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── TECH_PLAN.md
├── .env.example
└── package.json
```

### Key Pages & Features

#### [NEW] `MessagingPage.jsx`
- Real-time message feed with two visual lanes:
  - **User → Bot**: Personal conversation thread
  - **Bot → Bot**: Automated inter-agent logs (shown in a distinct "system log" style)
- Live typing indicator simulation
- Message input with send button

#### [NEW] `ProfilePage.jsx`
- Profile card: avatar, name, role, department
- Non-functional "Connect LinkedIn" and "Add Calendar" buttons (styled with provider colors)
- Agent status indicator

#### [NEW] `BotSettingsPage.jsx`
- View/edit "Custom Instructions" for user's assigned agent
- Agent status toggle (Active / Idle / Offline)
- Model config view (read-only in scaffold)

#### [NEW] `OrgPage.jsx`
- Form to submit organizational data (text + document upload)
- "Pending Approval" status indicator
- List of submitted org data items with status badges

#### [NEW] `AdminDashboard.jsx` (Protected Route)
- **Departmental Monitor**: Filter bot-to-bot logs by department
- **Knowledge Base Manager**: Upload/approve org data documents
- Admin badge on nav for authorized users

#### [NEW] `AuthPage.jsx`
- Login + Create Account tabs
- On account creation: initializes Agent Record in Firestore with default system instructions

### Firebase / Backend

#### [NEW] `firebase/config.js`
- Firebase project initialization

#### [NEW] `firebase/auth.js`
- `signUp()` — creates user + triggers agent record creation
- `signIn()`, `signOut()`

#### [NEW] `firebase/firestore.js`
- Collections: `users`, `agents`, `messages`, `orgData`, `departments`
- Real-time listeners for messages

### Documentation

#### [NEW] `TECH_PLAN.md`
- Full architecture overview
- Data schema (all Firestore collections)
- RAG flow diagram (text-based)
- Multi-agent communication protocol
- API Key Manifest

---

## Open Questions

> [!IMPORTANT]
> **Do you have a Firebase project already set up?**
> If yes, share the config keys and we can wire them in. If no, we'll use `.env.example` with placeholder keys and you can create a project at console.firebase.google.com.

> [!NOTE]
> **Admin Role**: For the protected Admin route, do you want a hardcoded admin email check (fastest for hackathon) or a Firestore `role: "admin"` field on the user document?

---

## Verification Plan

### Automated
- `npm run dev` — confirm Vite dev server starts clean
- Navigate all routes manually via the browser subagent

### Manual Verification
- All 5 pages render without errors
- Auth flow: sign up → agent record created in Firestore (mocked)
- Messaging board shows both message types
- Admin dashboard is only reachable by admin user
- TECH_PLAN.md is complete and readable
