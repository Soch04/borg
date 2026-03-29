# Project Borg — Org Knowledge Query Platform

> **Yconic Hackathon — Track: Most Innovative Hack**
> Built in 24 hours · March 28–29, 2026
> **Live:** [https://polly-970c1.web.app](https://polly-970c1.web.app)

---

## What It Does

Project Borg gives every employee a sovereign AI agent that can instantly query their organization's approved knowledge base. Instead of searching Slack threads or interrupting colleagues, employees ask their agent a question — the agent retrieves the most relevant approved documents from the organization's vector store and synthesizes a cited answer in seconds.

**The problem:** Knowledge workers lose 1.8–2.5 hours per day hunting for information that already exists somewhere in the organization (McKinsey, IDC). Borg eliminates this by making every approved org document instantly queryable.

---

## Architecture

```
User sends message
      │
      ▼
useMessages.js
      │
      ├─ 1. queryKnowledgeBase(orgId, question, { is_approved: true })
      │       → Gemini text-embedding-004 embeds the query (768-dim)
      │       → Pinecone top-K=5 ANN search within org namespace
      │       → Returns [{ text, title, docId }] — approved docs only
      │
      ├─ 2. Retrieved chunks injected into Gemini 2.5 Flash Lite system prompt
      │       → Response grounded in org documents, not general LLM knowledge
      │       → Citations [{ id, title }] returned alongside response text
      │
      └─ 3. Response + citations written to Firestore messages/{id}
               → Real-time onSnapshot listener updates chat UI
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite, React Router v6 |
| **Auth** | Firebase Authentication (email/password) |
| **Database** | Firebase Firestore (real-time listeners) |
| **Vector DB** | Pinecone — 768-dim cosine, namespace-per-org |
| **Embeddings** | Gemini `text-embedding-004` (768 dimensions) |
| **LLM** | Gemini 2.5 Flash Lite (multi-turn chat history, RAG system prompt) |
| **Hosting** | Firebase Hosting — https://polly-970c1.web.app |

---

## RAG Pipeline (`src/lib/rag.js`)

### Ingestion (triggered when admin approves a document in the Admin Dashboard)

```
ingestDocument(orgId, { id, title, text, department, adminId })
  → chunkText(text, 1000, 200)          — 1000-char chunks, 200-char overlap
  → generateEmbedding(chunk)             — Gemini text-embedding-004, 768-dim
  → upsertToPinecone(orgId, chunks)     — namespace=orgId, metadata: { is_approved: true, docId, title, ... }
```

### Query (on every user message in `src/hooks/useMessages.js`)

```
queryKnowledgeBase(orgId, userMessage, { is_approved: true, department? })
  → generateEmbedding(userMessage)       — same model, same space
  → Pinecone index.query({ topK: 5, filter: { is_approved: true } })
  → returns [{ text, title, docId, score }]
```

### Privacy Architecture

`is_approved: true` is a **Pinecone server-side metadata filter** — not an application-layer check. Unapproved documents are structurally unretrievable: the filter is enforced before results are returned, regardless of application state.

---

## Document Ingestion: What's Supported

| Input method | How it works |
|---|---|
| **Text paste** | Raw text submitted via Admin Dashboard or DataUploader → stored in Firestore `orgData` → chunked and embedded on approval |
| **`.txt` file upload** | File read client-side via `FileReader` → text extracted → same Firestore → Pinecone pipeline |
| **`.pdf` / `.docx`** | Not supported in this client-only build — binary formats require server-side parsing |

Text and `.txt` uploads are fully functional end-to-end. Copy-paste from any document format works via the Text Import mode.

---

## Firestore Collections

**`users/{uid}`** — profile, org membership, theme preference
**`agents/{uid}`** — sovereign agent node: status, system instructions, knowledge scope
**`messages/{id}`** — user ↔ agent conversation with citation metadata
**`orgData/{id}`** — admin-gated knowledge docs: `status: pending | approved | rejected`
**`organizations/{id}`** — org registry, member list, invited emails

---

## Application Pages

| Route | Description |
|---|---|
| `/auth` | Firebase email/password sign up / sign in |
| `/messaging` | RAG query interface + Organization Knowledge Base panel |
| `/bot-settings` | Configure agent name, status, system instructions |
| `/profile` | User profile, department |
| `/org` | Create org, invite members, join via invite |
| `/admin` | Real-time stats, Knowledge Base approval, member management |

All routes except `/auth` are protected — unauthenticated users redirect to `/auth`.

---

## Running Locally

### Environment Variables (`.env`)

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
npm run dev   # http://localhost:5173
```

### Mock Mode (no API keys needed)

In `src/context/AppConfig.js`:
```js
export const USE_MOCK = true
```

Activates pre-seeded mock data — full UI works without credentials.

---

## Admin Workflow: Adding Knowledge to the RAG

1. Sign in as an org admin
2. Navigate to **Admin → Knowledge Base**
3. Click **Add Document** — paste text or upload a `.txt` file
4. Document appears with `status: pending`
5. Click **Approve** → `ingestDocument()` runs:
   - Text chunked (1000 chars / 200 overlap)
   - Each chunk embedded via `text-embedding-004`
   - Vectors upserted to Pinecone namespace `{orgId}` with `is_approved: true`
6. Document is live and retrievable by any agent in the organization

---

## Code Metrics

| Metric | Value |
|---|---|
| Source files | 36 React/JS/CSS files |
| Pages | 6 protected routes |
| Firestore collections | 5 (`users`, `agents`, `messages`, `orgData`, `organizations`) |
| RAG pipeline | Fully implemented in `src/lib/rag.js` |
| Vector dimensions | 768 (Gemini `text-embedding-004`) |
| Chunk size | 1,000 chars, 200-char overlap |
| Pinecone top-K | 5 per query |
| Pinecone isolation | Namespace per `orgId` |
| Lines of application code | ~8,500+ |
| Git branches | `main`, `organization`, `theme`, `touch-ups`, `query-org` |

---

## Team

**Sonya Cheteyan** — Full-Stack Lead: Firebase integration, React architecture, Admin Dashboard, multi-tenant org system, RBAC, Microsoft Fluent/Metro design system, dark mode, push layout.

**Nathan Fowler** — AI/Agent Systems Lead: RAG pipeline (`lib/rag.js`), Gemini integration, `buildPrompt.js` (system prompt, escalation parsing, internal monologue), `generateReply.js`.
