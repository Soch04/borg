# Master Plan: Project Borg

## 1. Vision Clarity
**North Star:** Project Borg is a centralized AI knowledge-query platform that eliminates time wasted on manual organizational data retrieval. By providing every employee a sovereign AI agent grounded in their organization's curated vector knowledge base, Borg transforms fragmented silos into a single, real-time queryable source of truth per organization.

**Core Value:** The "Coordination Tax" — 1.8–2.5 hours per knowledge worker per day lost hunting for information that already exists somewhere in the organization (McKinsey, IDC). Borg eliminates this by making every approved document instantly queryable through natural language.

---

## 2. Technical Architecture (Implemented)

### Frontend
- React 18 + Vite SPA with React Router v6 (6 protected routes)
- Firebase Authentication (email/password, persistent sessions)
- Dark/Light theme toggle with Firestore persistence (`users/{uid}.theme`)
- Microsoft Fluent/Metro industrial design system (0px border radius, elevation through color, 20+ CSS custom properties)
- Collapsible icon dock (52px → 220px push layout), fixed 48px header, responsive sidebars

### RAG Pipeline (`src/lib/`)
- **`rag.js`**: Full ingestion + query pipeline
  - `ingestDocument()`: text → recursive character chunking (1000 chars / 200 overlap) → Gemini `text-embedding-004` (768-dim) → Pinecone namespace upsert
  - `queryKnowledgeBase()`: embed query → Pinecone top-K ANN search (topK=4/5/8 by intent) → metadata filter `is_approved:true` (server-side)
- **`pdfParser.js`**: Client-side PDF text extraction via `pdfjs-dist`
  - Full page iteration, text normalization, page-boundary markers
  - PDF metadata extraction (title, author, page count)
- **`embeddingCache.js`**: LRU cache for Gemini embedding vectors
  - SHA-256 hash keys (Web Crypto API), Map-based LRU eviction (200 entries)
  - Eliminates re-embedding for repeated/identical queries
- **`tokenBudget.js`**: Gemini context window budget manager
  - 4-chars-per-token heuristic, 25,500 token KB budget
  - Sentence-boundary trimming prevents mid-sentence cuts on long documents

### Agent Intelligence (`src/agent/`)
- **`buildPrompt.js`**: System prompt assembly
  - `buildCitationBlock()`: deduplicates Pinecone chunks by docId, ranks by cosine similarity, formats numbered citation index [N] for Gemini referencing
  - `buildSystemPrompt()`: agent identity + org directory + RAG context injection
  - `buildMonologuePrompt()`: strategic/execution/final-answer reasoning structure for complex queries
  - Token budget trimming applied to all knowledge blocks before injection
- **`gemini.js`**: Gemini REST API gateway
  - Exponential backoff retry (3 attempts: 1s → 2s → 4s with ±10% jitter)
  - Retryable status detection (429, 500, 503) vs non-retryable (400, 401)
  - SAFETY finishReason detection, configurable temperature + maxTokens
- **`generateReply.js`**: Autonomous agent reply generation
  - `[CONFIDENT]` / `[ESCALATE]` self-evaluation tokens
  - RAG context injection from `queryKnowledgeBase()` before reply assembly
- **`queryClassifier.js`**: Pre-RAG query intent classification
  - 4 intents: CONVERSATIONAL (skip RAG) / FACTUAL / ANALYTICAL (topK=8) / PROCEDURAL (temperature=0.15)
  - Zero-latency local pattern matching — no API call required

### Multi-Agent Protocol
- **`useAgentInbox.js`**: Autonomous agent inbox with real-time Firestore subscription
  - Subscribes to `agent_interactions` where `recipient_email == user.email`
  - Runs autonomous confidence evaluation: CONFIDENT → auto-reply; ESCALATE → user notification
- **`[MESSAGE_AGENT: email]` routing**: Agent-to-agent dispatch via `sendMention()`
  - Gemini can output this token → `useMessages.js` parses and dispatches
  - Full inter-agent loop: user → own agent → target agent → target user inbox

### Data Layer (`src/firebase/`)
- **`firestore.js`**: Complete Firestore interface (20+ typed functions with JSDoc)
- **Security Rules** (`firestore.rules`): Row-level security — users can only access their own messages and org-scoped data
- **Composite Indexes** (`firestore.indexes.json`): 4 indexes for production query patterns

---

## 3. Firestore Collections

| Collection | Purpose |
|---|---|
| `users/{uid}` | Profile, orgId, department, role, orgRole, theme |
| `agents/{uid}` | Sovereign agent: name, status, system instructions, knowledge scope |
| `messages/{id}` | User ↔ agent conversation with citation metadata |
| `orgData/{id}` | Admin-gated knowledge documents: `status: pending\|approved\|rejected` |
| `organizations/{id}` | Org registry, members map (role: admin\|member), invited emails |
| `agent_interactions/{id}` | Inter-agent message requests with `status: pending\|handled` |

---

## 4. Document Ingestion: Supported Formats

| Format | Method | Status |
|---|---|---|
| Raw text (paste) | Direct Firestore write → Pinecone on approval | ✅ Fully implemented |
| `.txt` file | FileReader client-side → same pipeline | ✅ Fully implemented |
| `.pdf` file | pdfjs-dist client-side extraction → same pipeline | ✅ Fully implemented |
| `.docx` file | Requires server-side XML parsing | ⬜ Phase 2 (Cloud Functions) |

---

## 5. Innovation: Curated RAG Architecture

Unlike unstructured knowledge tools, Borg implements a **verified knowledge pipeline**:

1. **Admin-gated ingestion**: All documents enter `status: pending` — no vector pollution from unapproved content
2. **Server-side metadata filtering**: `is_approved: true` enforced at Pinecone query time — not application logic
3. **Org namespace isolation**: Each org gets its own Pinecone namespace — cross-org retrieval is architecturally impossible
4. **Intent-driven retrieval**: Query classifier optimizes topK and temperature before any API call
5. **Source attribution**: Every response carries numbered citations pointing to specific approved documents

---

## 6. Scalability Design

- **Multi-tenant index**: `orgId` namespace partitioning allows one Pinecone index to serve thousands of organizations (horizontal SaaS scale)
- **Embedding cache**: LRU cache prevents re-embedding — reduces latency and Gemini API costs for repeated queries
- **Context window management**: Token budget manager ensures prompts never exceed Gemini's 32k context window
- **Exponential backoff**: Retry logic with jitter prevents thundering herd on API rate limits
- **Production hardening path**: Replace VITE_ API calls with Firebase Cloud Functions to move keys server-side

---

## 7. Execution Timeline (Actual)

| Phase | Hours | Deliverable |
|---|---|---|
| Scaffolding | 0–6 | React/Vite, Firebase Auth, org system, Firestore schema |
| RAG Core | 6–12 | Pinecone ingestion pipeline, Gemini embedding, admin approval |
| Agent Intelligence | 12–18 | Prompt assembly, monologue reasoning, A2A protocol, inbox |
| Polish + Deploy | 18–24 | Industrial UI, query classifier, embedding cache, token budget, PDF parsing |

---

## 8. Risk Mitigation (Implemented)

| Risk | Mitigation |
|---|---|
| Knowledge base pollution | Admin approval gate — `status: pending` blocks all unapproved vectors |
| Cross-org data leakage | Pinecone namespace isolation + Firestore Security Rules |
| Context window overflow | `tokenBudget.js` trims knowledge block to 25,500 token budget |
| API rate limits | Exponential backoff with jitter in `gemini.js` |
| LLM hallucination | `is_approved: true` server-side filter + ESCALATE token when confidence is low |
| Repeated query cost | LRU embedding cache — cache hits skip Gemini API entirely |
| API key exposure | Read-only key scope + documented Cloud Functions production path |
