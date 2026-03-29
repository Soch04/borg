# Project Borg — Org Knowledge Query Platform

> **Yconic Hackathon — Track: Most Innovative Hack**  
> Built in 24 hours · March 28–29, 2026  
> **Live:** https://polly-970c1.web.app

---

## 🚀 Project Overview

**Project Borg** is a centralized, role-gated knowledge management platform that uses Retrieval-Augmented Generation (RAG) to eliminate the **'Coordination Tax'** in modern organizations. It enables both individuals and corporate teams to query a curated, organization-scoped vector database using natural language, replacing fragmented SaaS searches and manual document retrieval with a single conversational interface. 

Each organization owns an isolated Pinecone vector store, partitioned by `orgId`, and all data ingestion passes through an Admin approval workflow before reaching the shared index, ensuring the knowledge base remains clean and verified. The system is built on a React/Vite frontend with Firebase handling authentication and role-based access control, Google Gemini 2.5 Flash as the core LLM for query generation, and Pinecone as the vector store backend. 

The permission handshake between standard users and administrators is positioned as the core innovation — treating the vector database as a curated ledger of truth rather than an uncontrolled data dump. Multi-format ingestion supports PDF, DOCX, and raw text files, with modularity designed to allow future integrations with Google Drive or Notion. Project Borg targets a well-understood enterprise problem — knowledge fragmentation — and differentiates itself by sitting between generic enterprise search tools like SharePoint and unconstrained AI chat interfaces. The 24-hour execution plan is divided into clear 6-hour blocks with role-specific responsibilities assigned across a three-person team covering frontend, backend/IAM, and data/AI concerns.

---

## Architecture

```
User (Browser)
    │
    ▼
Query Interface (React 18 + Vite)
    │  User sends question
    ▼
useMessages.js  ──────────────────────────────────────────────────────┐
    │                                                                  │
    │  1. queryKnowledgeBase(orgId, question, { is_approved: true })  │
    │     → Pinecone top-K=5 similarity search                        │
    │     → Returns chunks with { title, text, docId }                │
    │                                                                  │
    │  2. Chunks injected into Gemini system prompt                   │
    │     → Gemini 2.5 Flash Lite synthesizes grounded response       │
    │     → Source citations returned alongside response text         │
    │                                                                  │
    │  3. Bot response + citations written to Firestore messages      │
    └──────────────────────────────────────────────────────────────────┘
    │
    ▼
Firebase Firestore (messages/{id})   Pinecone (borg-org-knowledge)
    Real-time onSnapshot listener     Namespace per orgId
    User session scoped               is_approved filter on every query
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite, React Router v6 |
| **Auth** | Firebase Authentication (email/password) |
| **Database** | Firebase Firestore (6 collections, real-time listeners) |
| **Vector DB** | Pinecone — 768-dim cosine, namespace-per-org |
| **Embeddings** | `all-mpnet-base-v2` (768 dimensions) |
| **LLM** | Gemini 2.5 Flash (multi-turn history, system prompt) |
| **Hosting** | Firebase Hosting (CDN) |
| **Styling** | Vanilla CSS — Microsoft Fluent/Metro design system |

---

## Firestore Collections

**`users/{uid}`** — user profile and org membership:
```json
{
  "displayName": "string",
  "email": "string",
  "orgId": "string | null",
  "department": "string",
  "role": "admin | user",
  "orgRole": "admin | member",
  "theme": "light | dark"
}
```

**`agents/{uid}`** — the sovereign agent node (never shared cross-user):
```json
{
  "userId": "string",
  "displayName": "string",
  "department": "string",
  "status": "active | idle | offline",
  "model": "gemini-2.5-flash-lite",
  "systemInstructions": "string",
  "knowledgeScope": ["global", "engineering"],
  "createdAt": "Timestamp"
}
```

**`messages/{id}`** — user ↔ agent conversation:
```json
{
  "type": "user | bot-response",
  "senderId": "string",
  "senderName": "string",
  "recipientId": "string",
  "content": "string",
  "timestamp": "Timestamp",
  "metadata": { "citations": [{ "id": "docId", "title": "string" }] }
}
```

**`orgData/{id}`** — admin-gated knowledge documents:
```json
{
  "orgId": "string",
  "title": "string",
  "content": "string",
  "department": "string",
  "uploadedBy": "uid",
  "status": "pending | approved | rejected",
  "createdAt": "Timestamp"
}
```

**`organizations/{id}`** — org registry with invite system:
```json
{
  "name": "string",
  "adminUid": "string",
  "members": ["uid"],
  "departments": ["Engineering", "Design"],
  "invitedEmails": ["string"],
  "createdAt": "Timestamp"
}
```

---

## RAG Pipeline

### Ingestion (`src/lib/rag.js`)

1. Admin uploads a document via the Admin Dashboard → saved to `orgData` with `status: "pending"`
2. Admin approves → `ingestDocument()` is called
3. Content split via recursive character chunking — **1,000 tokens per chunk, 200-token overlap**
4. Each chunk embedded via `all-mpnet-base-v2` (768 dimensions)
5. Chunks upserted to Pinecone namespace `orgId` (or filtered by metadata) with mandatory metadata:
   ```json
   { "is_approved": true, "adminId": "uid", "department": "string", "docId": "string", "title": "string" }
   ```

### Query (`src/hooks/useMessages.js`)

1. User sends a message → `queryKnowledgeBase(orgId, content, { is_approved: true })`
2. Pinecone returns top-5 matching chunks from the org's namespace
3. Chunks formatted as `### DOCUMENT: {title}\n{text}` and injected into the Gemini system prompt
4. Gemini synthesizes a response grounded in retrieved content
5. Source citations `[{ id, title }]` returned alongside the response text
6. Citation badges render in `MessageBubble.jsx` — clicking a badge highlights and scrolls to the document in the Knowledge Base panel

### Privacy Architecture

`is_approved: true` is enforced as a **Pinecone server-side metadata filter** on every query — not an application-layer check. An unapproved document cannot be retrieved by the agent even if the application layer is compromised, because the filter is applied at the vector database before any results are returned.

---

## Application Pages

| Route | Page | Description |
|---|---|---|
| `/auth` | `AuthPage.jsx` | Sign up / sign in — Firebase email/password |
| `/messaging` | `MessagingPage.jsx` | RAG query interface + Organization Knowledge Base panel |
| `/bot-settings` | `BotSettingsPage.jsx` | Configure agent name, status, system instructions |
| `/profile` | `ProfilePage.jsx` | Edit profile, department, view connected services |
| `/org` | `OrgPage.jsx` | Create org, invite members, join via invite |
| `/admin` | `AdminDashboard.jsx` | Global stats, department management, KB approval, agent network |

All routes except `/auth` are protected — unauthenticated users are redirected to `/auth`.

---

## Key Source Files

```
src/
├── agent/
│   ├── buildPrompt.js      # System prompt assembly: identity, KB context, instructions
│   ├── gemini.js           # Gemini API gateway — multi-turn chat history
│   └── generateReply.js    # Autonomous confidence scoring ([CONFIDENT]/[ESCALATE])
├── components/
│   ├── icons/icons.jsx     # Custom SVG icon set (9 icons, currentColor)
│   ├── layout/
│   │   ├── Dock.jsx        # Collapsible icon dock (52px→220px push layout)
│   │   ├── Header.jsx      # Fixed 48px header — branding, user suite, status glyph
│   │   └── Layout.jsx      # Flex push layout — dock + main as siblings
│   └── messaging/
│       ├── MessageBubble.jsx  # Renders citations, markdown, typing state
│       └── MessageInput.jsx   # Textarea + send button only
├── context/
│   ├── AppConfig.js        # USE_MOCK flag — single toggle for demo/live mode
│   ├── AppContext.jsx       # Toast notification system
│   └── AuthContext.jsx      # Firebase auth state, theme persistence, org/admin detection
├── firebase/
│   ├── auth.js             # Firebase Auth wrapper
│   ├── config.js           # Firebase SDK init
│   └── firestore.js        # All Firestore reads/writes — typed, documented functions
├── hooks/
│   ├── useMessages.js      # Core: send message → RAG query → Gemini → response
│   └── useAgent.js         # Agent document real-time listener
├── lib/
│   └── rag.js              # Pinecone ingestion + query pipeline
├── pages/
│   ├── AdminDashboard.jsx  # Tabs: Overview, Dept Monitor, Knowledge Base, Agent Network
│   ├── MessagingPage.jsx   # Split pane: query chat (left) + KB doc viewer (right)
│   └── OrgPage.jsx         # Create/join/invite org flow
└── utils/
    └── parseMentions.js    # Email extraction utilities
```

---

## Multi-Tenant Architecture

Every organization is strictly isolated:

- **Pinecone:** One namespace per `orgId` — vectors from Org A are invisible to Org B at the index level
- **Firestore:** Security Rules enforce `orgId` matching on all reads/writes — server-authoritative, not client-enforced
- **RAG:** Every query scopes the namespace to `user.orgId` — cross-org retrieval is structurally impossible
- **RBAC:** Two role axes — `role: "admin"` (global) and `orgRole: "admin"` (org-scoped) — enforced in both Firestore Rules and `AuthContext.jsx`

---

## UI Design System

Microsoft Fluent / Metro industrial aesthetic, implemented in Vanilla CSS:

- **0px** border radius on all interactive elements — no rounded corners
- **Elevation through color:** `#0B0B0B` base → `#1F1F1F` surface → `#2A2A2A` raised surface
- **1px solid borders** (`#333333`) replace drop shadows for depth
- **CSS custom properties:** 20+ design tokens in `src/index.css` (`--color-bg`, `--color-surface`, `--color-accent`, `--color-border`, etc.)
- **Dark / Light mode:** Toggle in the dock footer — preference persisted to both `localStorage` and `Firestore users/{uid}.theme`
- **Push layout:** Dock is a flex sibling of the main pane — expanding from 52px to 220px pushes content right, no overlay

---

## Running Locally

### Prerequisites

- Node.js 18+
- Firebase project with Firestore and Authentication enabled
- Pinecone account with an index named `borg-org-knowledge` (768 dimensions, cosine)
- Google Cloud project with Gemini API enabled

### Environment Variables

Create `.env` at the project root:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GEMINI_API_KEY=
VITE_PINECONE_API_KEY=
VITE_PINECONE_INDEX=borg-org-knowledge
```

### Install and Run

```bash
npm install
npm run dev       # http://localhost:5173
```

### Mock Mode (No API Keys Required)

In `src/context/AppConfig.js`, set:

```js
export const USE_MOCK = true
```

This activates pre-seeded mock data and bypasses all Firebase/Gemini/Pinecone calls — the full UI and agent flow are demonstrable without any credentials.

### Deploy to Firebase

```bash
npm run build
npx firebase-tools deploy
```

---

## Admin Workflow: Adding Knowledge

1. **Sign in** as an org admin account
2. **Navigate to Admin → Knowledge Base tab**
3. Click **Add Document** — paste or type content, assign a department
4. The document appears with `status: pending`
5. Click **Approve** → `ingestDocument()` runs:
   - Content is chunked (1,000 tokens / 200-token overlap)
   - Each chunk embedded via Gemini `text-embedding-004`
   - Vectors upserted to Pinecone namespace `{orgId}` with `is_approved: true`
6. The document is now **live and retrievable** by any agent in the organization

---

## Code Metrics

| Metric | Value |
|---|---|
| **Source files** | 36 React/JS/CSS files |
| **Pages** | 6 protected routes |
| **Firestore collections** | 5 active (`users`, `agents`, `messages`, `orgData`, `organizations`) |
| **Agent logic files** | 3 (`buildPrompt.js`, `gemini.js`, `generateReply.js`) |
| **Lines of application code** | ~8,500+ (excl. `node_modules`) |
| **Git branches shipped** | `main`, `organization`, `theme`, `touch-ups`, `query-org` |
| **CSS design tokens** | 20+ custom properties, light + dark mode |
| **Vector dimensions** | 768 (`all-mpnet-base-v2`) |
| **RAG chunk size** | 1,000 tokens / Semantic Chunking |
| **Pinecone top-K** | 5 chunks per query |

---

## Team

**Sonya Cheteyan** — Full-Stack Lead  
Firebase integration (Auth, Firestore schema, Security Rules), React architecture (6 pages, AuthContext, AppContext), Admin Dashboard, multi-tenant Organization system, RBAC, Microsoft Fluent/Metro design system, dark mode persistence, push layout, custom icon system.

**Nathan Fowler** — AI/Agent Systems Lead  
RAG pipeline (Pinecone ingestion, Gemini embedding, top-K retrieval), `buildPrompt.js` (system prompt assembly, escalation parsing), `gemini.js` (multi-turn LLM gateway), `generateReply.js` (confidence scoring), `parseMentions.js`.
