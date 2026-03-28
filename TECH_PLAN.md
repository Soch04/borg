# TECH_PLAN.md — Project Borg
> AI Agent Network · YCONIC Hackathon · Architecture & Strategy Document

---

## 1. System Overview

**Project Borg** replaces human-to-human coordination friction with a network of autonomous AI proxy agents. Each user is assigned a dedicated agent that communicates with the Org Knowledge Base and peer agents on their behalf.

```
┌─────────────┐     ┌───────────────────────────────────────────────────────────┐
│  User (UI)  │────▶│  USER'S AGENT (Tier 3: Gemini 2.0 Flash/Pro)             │
└─────────────┘     │  • Parses user intent                                      │
                    │  • Queries Tier 1 (Private) + Tier 2 (Org KB)             │
                    │  • Initiates inter-agent handshakes via Tier 4             │
                    └───────────────────────────────────────────────────────────┘
                             │                    │
                    ┌────────▼───────┐   ┌────────▼─────────┐
                    │  Tier 2: Org   │   │  Tier 4: Inter-  │
                    │  Knowledge Base│   │  Agent Bus       │
                    │  (Pinecone)    │   │  (Redis/NATS)    │
                    └────────────────┘   └──────────────────┘
```

---

## 2. Four-Tier Data Model

| Tier | Name | Scope | Technology | Description |
|:---|:---|:---|:---|:---|
| **1** | User Data | Private | Firebase Firestore (users, agents) + SQLite (local memory) | Personal docs, calendar, agent instructions, conversation history |
| **2** | Org Data | Global | Pinecone (vector) + Firestore (metadata) | Policies, SOPs, handbooks — admin-approved, RAG-indexed |
| **3** | Core Intel | Base LLM | Gemini 2.0 Flash (routing) / Gemini 2.0 Pro (synthesis) | Reasoning, planning, intent parsing |
| **4** | Inter-Agent | Dynamic | Upstash Redis Pub/Sub (Phase 2) | Real-time agent availability, scheduling bus, deprecation signals |

---

## 3. Database Schema (Firestore)

### `users/{uid}`
```json
{
  "uid": "string",
  "email": "string",
  "displayName": "string",
  "department": "string",
  "role": "member | admin",
  "linkedIn": "string | null",
  "calendarConnected": "boolean",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

### `agents/{uid}` (one-to-one with users)
```json
{
  "userId": "string",
  "displayName": "string ('{name}\'s Agent')",
  "department": "string",
  "status": "active | idle | offline",
  "model": "gemini-2.0-flash | gemini-2.0-pro",
  "systemInstructions": "string (Tier 1 — never shared)",
  "knowledgeScope": ["global", "engineering"],
  "conversationHistory": "array (last N turns)",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

### `messages/{id}`
```json
{
  "type": "user | bot-response | bot-to-bot",
  "senderId": "string",
  "senderName": "string",
  "senderType": "human | agent",
  "recipientId": "string",
  "recipientName": "string",
  "recipientType": "human | agent",
  "content": "string",
  "department": "string (for bot-to-bot only)",
  "timestamp": "Timestamp",
  "metadata": {
    "protocol": "borg-agent-handshake-v1",
    "ragSources": ["docId1", "docId2"],
    "tokensUsed": 1240
  }
}
```

### `orgData/{id}`
```json
{
  "title": "string",
  "content": "string (raw text)",
  "fileUrl": "string | null (Firebase Storage)",
  "fileType": "text | document | faq | sop",
  "department": "string",
  "uploadedBy": "uid",
  "uploaderName": "string",
  "status": "pending | approved | rejected",
  "vectorIds": ["pinecone-vector-id-1"],
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

---

## 4. RAG Flow — Org Knowledge Base

### Ingestion Pipeline (when admin approves an Org Data item)
```
1. Admin clicks "Approve" on an orgData document
2. Cloud Function triggers on Firestore write (status: pending → approved)
3. Function reads the content string
4. Chunks content into ~512-token overlapping segments
5. Each chunk is embedded via Gemini Embeddings API (embedding-001)
6. Vectors are upserted to Pinecone with metadata:
   { orgDataId, department, chunkIndex, title, timestamp }
7. Firestore orgData doc updated with vectorIds[]
```

### Query Flow (when user sends a message to their agent)
```
1. User sends message → agent receives intent
2. Agent generates a semantic query from user intent
3. Query is embedded (Gemini embedding-001)
4. Pinecone similarity search — top-K=5 results, filtered by:
   - namespace: "global" OR agent.department
5. Retrieved chunks are injected into the system prompt context window
6. Gemini 2.0 Pro synthesizes a response using:
   - agent.systemInstructions (Tier 1)
   - Retrieved org chunks (Tier 2)
   - Conversation history (last N turns)
7. Response streamed back to user
```

### Vector DB Configuration (Pinecone)
- **Index Name:** `borg-org-knowledge`
- **Dimensions:** `768` (Gemini text-embedding-004)
- **Metric:** `cosine`
- **Namespaces:** one per department + `global`
- **Metadata Fields:** `orgDataId`, `department`, `title`, `chunkIndex`, `approved`

---

## 5. Multi-Agent Communication Protocol

### Handshake Format (`borg-agent-handshake-v1`)
```json
{
  "protocol": "borg-agent-handshake-v1",
  "requestId": "uuid-v4",
  "fromAgentId": "uid-of-sender",
  "toAgentId": "uid-of-recipient",
  "timestamp": "ISO-8601",
  "type": "status_check | schedule_meeting | info_request | notify",
  "payload": {
    "subject": "string",
    "priority": "low | normal | high | urgent",
    "deadline": "ISO-8601 | null",
    "body": "string"
  },
  "ttl": 300
}
```

### Response Format
```json
{
  "protocol": "borg-agent-handshake-v1",
  "requestId": "same-as-request",
  "status": "accepted | deferred | rejected",
  "payload": { "...": "response-specific data" },
  "timestamp": "ISO-8601"
}
```

### TTL & Rate Limiting
- All inter-agent requests expire after `ttl` seconds (default: 300s)
- Max 10 inter-agent requests per agent per hour without human escalation
- `urgent` requests bypass rate limit but require human confirmation within 60s

---

## 6. API Key Manifest

All keys required to make this system fully operational:

| Service | Key Variable | Purpose | Get it at |
|:---|:---|:---|:---|
| **Firebase** | `VITE_FIREBASE_API_KEY` | Auth, Firestore, Storage | console.firebase.google.com |
| **Firebase** | `VITE_FIREBASE_AUTH_DOMAIN` | Auth domain | " |
| **Firebase** | `VITE_FIREBASE_PROJECT_ID` | DB identifier | " |
| **Firebase** | `VITE_FIREBASE_STORAGE_BUCKET` | File uploads | " |
| **Firebase** | `VITE_FIREBASE_MESSAGING_SENDER_ID` | Push (future) | " |
| **Firebase** | `VITE_FIREBASE_APP_ID` | SDK init | " |
| **Gemini** | `VITE_GEMINI_API_KEY` | LLM + Embeddings | aistudio.google.com |
| **Pinecone** | `VITE_PINECONE_API_KEY` | Vector DB | app.pinecone.io |
| **Pinecone** | `VITE_PINECONE_ENVIRONMENT` | Regional cluster | " |
| **Upstash** | `VITE_UPSTASH_REDIS_URL` | Inter-agent bus (Phase 2) | upstash.com |
| **Upstash** | `VITE_UPSTASH_REDIS_TOKEN` | Auth token | " |
| **LinkedIn** | `VITE_LINKEDIN_CLIENT_ID` | Profile OAuth | linkedin.com/developers |

> All keys must be added to a `.env` file (copy `.env.example`). NEVER commit `.env` to git.

---

## 7. Frontend Architecture

- **Framework:** Vite + React 18
- **Routing:** React Router v6 (client-side, hash-less)
- **State:** React Context (AuthContext, AppContext) + local useState
- **Real-time:** Firebase Firestore `onSnapshot` listeners
- **Styling:** Vanilla CSS with custom design tokens (dark mode, glassmorphism)
- **Icons:** react-icons (Remix Icon set)

### Protected Routes
Admin Dashboard at `/admin` is protected via the `AdminRoute` component, which checks `user.role === 'admin'` in Firestore. This guard is server-authoritative when Firestore Security Rules enforce it.

### Mock Mode
`USE_MOCK = true` in `AuthContext.jsx` bypasses all Firebase calls and uses `src/data/mockData.js`. Flip to `false` once `.env` keys are configured.

---

## 8. Firestore Security Rules (recommended)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own doc
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    // Agents follow same pattern
    match /agents/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    // Messages: users can read/write their own
    match /messages/{msgId} {
      allow read, write: if request.auth.uid == resource.data.senderId
                         || request.auth.uid == resource.data.recipientId;
      allow read: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    // Org data: anyone can submit, only admin can approve
    match /orgData/{docId} {
      allow create: if request.auth != null;
      allow read: if request.auth != null;
      allow update: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
  }
}
```

---

## 9. Phase 2 Roadmap

| Feature | Effort | Dependencies |
|:---|:---|:---|
| Live Gemini API calls (replace mock responses) | Medium | `VITE_GEMINI_API_KEY` |
| Pinecone RAG indexing on org data approval | High | `VITE_PINECONE_API_KEY` + Cloud Functions |
| Redis inter-agent pub/sub | High | `VITE_UPSTASH_REDIS_URL` |
| LinkedIn OAuth | Low | `VITE_LINKEDIN_CLIENT_ID` |
| Google Calendar integration | Medium | Google OAuth + Calendar API |
| File upload → text extraction | Medium | Firebase Storage + PDF parsing |
| Agent scheduling negotiation demo | High | Full inter-agent protocol |
| Firebase Cloud Functions (bot trigger) | High | Firebase Blaze plan |
