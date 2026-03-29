# Project Borg — Org Knowledge Query Platform

[![Build Check](https://github.com/Soch04/borg/actions/workflows/build-check.yml/badge.svg)](https://github.com/Soch04/borg/actions/workflows/build-check.yml)
[![Firebase Deploy](https://github.com/Soch04/borg/actions/workflows/firebase-deploy.yml/badge.svg)](https://github.com/Soch04/borg/actions/workflows/firebase-deploy.yml)

> **Yconic Hackathon — Track: Most Innovative Hack**  
> Built in 24 hours · March 28–29, 2026  
> **Live:** https://polly-970c1.web.app

---

## 🚀 Project Overview

**Project Borg** is a dual-stack organizational knowledge platform that uses Retrieval-Augmented Generation (RAG) to eliminate the **‘Coordination Tax’** in modern organizations. Teams query a curated, org-scoped vector database using natural language — replacing fragmented document searches with a single conversational interface grounded in verified organizational knowledge.

The platform is split into two services:
- **Query layer** — React/Vite SPA. Handles authentication, the conversational interface, and the 5-stage RAG query pipeline (intent classification → HyDE → Pinecone ANN → LLM re-ranking → citation assembly) running entirely in the browser.
- **Ingestion layer** — Python FastAPI server (`user_input.py`). Handles multi-format document ingestion (PDF, DOCX, text) using LangChain’s `SemanticChunker` + `RecursiveCharacterTextSplitter`, HuggingFace `all-mpnet-base-v2` embeddings (768-dim), and direct Pinecone upsert with org namespace isolation.

Each organization owns an isolated Pinecone namespace partitioned by `orgId`. The `is_approved: true` metadata flag is enforced as a server-side Pinecone filter on every query, ensuring only curated documents surface in responses.

---

## Architecture

```
┌─────────────────────────────── INGESTION PATH ───────────────────────────┐
│ React DataUploader → POST /api/upload or /api/text                     │
│                                                                          │
│ user_input.py (FastAPI)                                                  │
│   ├─ Load: PyPDFLoader / Docx2txtLoader / TextLoader                     │
│   ├─ Classify: structured vs unstructured (via signal scoring)           │
│   ├─ Chunk: SemanticChunker | RecursiveCharacterTextSplitter (1000/100)  │
│   ├─ Embed: HuggingFace all-mpnet-base-v2 (768-dim)                      │
│   └─ Upsert: Pinecone namespace=orgId, is_approved=true metadata          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────── QUERY PATH ─────────────────────────────┐
│ User question → useMessages.js (5-stage pipeline)                       │
│                                                                          │
│   1. classifyQuery()         — FACTUAL / PROCEDURAL / ANALYTICAL / CONV │
│   2. generateHypotheticalDoc — HyDE: embed answer-space doc, not query  │
│   3. queryKnowledgeBase()    — Pinecone ANN, topK=4-8, is_approved:true │
│   4. rerankResults()         — Gemini cross-encoder score 0-10 (≥6 pass) │
│   5. buildCitationBlock()    — dedup, confidence score, token budget trim│
│   6. streamGemini()          — SSE streaming, tokens rendered in real-time│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite, React Router v6 |
| **Auth** | Firebase Authentication (email/password) |
| **Database** | Firebase Firestore (6 collections, real-time listeners) |
| **Vector DB** | Pinecone — 768-dim cosine, namespace-per-org |
| **Query Embeddings** | Gemini `text-embedding-004` (browser, via RAG pipeline) |
| **Ingestion Embeddings** | HuggingFace `all-mpnet-base-v2` 768-dim (Python backend) |
| **Ingestion Backend** | Python FastAPI (`user_input.py`) — LangChain chunking, Pinecone upsert |
| **LLM** | Gemini 2.5 Flash (multi-turn, streaming SSE) |
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

### Ingestion (`user_input.py` — Python FastAPI)

1. User uploads a document via the DataUploader → React POSTs to `/api/upload` or `/api/text`
2. `user_input.py` receives the file and passes it to the appropriate LangChain loader:
   - `.pdf` → `PyPDFLoader`
   - `.docx` → `Docx2txtLoader`
   - `.txt` / text → `TextLoader` / direct string
3. Document classified as **structured** (has headers/tables) or **unstructured** via signal scoring
4. Chunked via `SemanticChunker` (structured) or `RecursiveCharacterTextSplitter` (unstructured):
   - Chunk size: **1,000 characters** — overlap: **100 characters** (10%)
5. Each chunk embedded via HuggingFace `all-mpnet-base-v2` (**768 dimensions**)
6. Chunks upserted to Pinecone namespace `orgId` with metadata:
   ```json
   { "is_approved": true, "owner": "email", "org_id": "string", "source": "filename" }
   ```

### Query (`src/hooks/useMessages.js` — 5-stage browser pipeline)

1. `classifyQuery(message)` → intent: `FACTUAL` / `PROCEDURAL` / `ANALYTICAL` / `CONVERSATIONAL`
2. `generateHypotheticalDoc()` → HyDE generates an answer-space document to embed instead of the raw query (Gao et al. 2022)
3. `queryKnowledgeBase(orgId, hydeDoc, { is_approved: true })` → Pinecone top-K (4–8 by intent)
4. `rerankResults(query, chunks)` → Gemini cross-encoder scores each chunk 0–10, filters ≥6
5. `buildCitationBlock(reranked)` → deduplication by docId, confidence labels, 25,500-token budget trim
6. `streamGemini({ onChunk })` → SSE token stream, rendered progressively via `streaming-cursor` animation

### Privacy Architecture

`is_approved: true` is enforced as a **Pinecone server-side metadata filter** on every query — not an application-layer check. An unapproved document cannot be retrieved by the agent even if the application layer is compromised, because the filter is applied at the vector database before any results are returned.

---

## Document Ingestion

Document ingestion runs **entirely in the browser** — no Python server required.

`DataUploader.jsx` extracts text client-side and calls `ingestDocument()` from `lib/rag.js` directly:

| Format | Extraction | Embedding | Storage |
|---|---|---|---|
| `.pdf` | `pdfParser.js` (pdfjs-dist) | Gemini `text-embedding-004` | Pinecone namespace `{orgId}` |
| `.docx` | `docxParser.js` (mammoth) | Gemini `text-embedding-004` | Pinecone namespace `{orgId}` |
| `.txt` / text | `File.text()` | Gemini `text-embedding-004` | Pinecone namespace `{orgId}` |

All chunks are upserted with `{ is_approved: true, orgId, uploadedBy }` metadata — immediately queryable by any agent in the organization.

> **Optional advanced path:** A Python FastAPI server (`user_input.py`) exists for server-side ingestion with LangChain `SemanticChunker` and HuggingFace `all-mpnet-base-v2` embeddings. Run with `uvicorn user_input:app --reload` if preferred. The browser path is the production default.


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

## Knowledge Base: Adding Documents

1. **Sign in** to your organization account
2. **Navigate to the Org / Knowledge Base tab**
3. Click **File Upload** (PDF, DOCX, or TXT) or **Text Import** (paste content)
4. Submit — the DataUploader sends the content to the Python ingestion server (`POST /api/upload`)
5. The server chunks, embeds, and upserts directly to Pinecone with `is_approved: true`
6. The document is now **live and retrievable** by any agent query in the organization

> **Note**: Requires the Python ingestion server to be running locally (`uvicorn user_input:app --reload`).

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
