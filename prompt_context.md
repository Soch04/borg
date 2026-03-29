# Project Polly (Project Borg) - System Architecture & Context Snapshot

*Note: Paste this entire document into any fresh AI instance (like Gemini, ChatGPT, or Claude) to instantly bring them up to speed on your exact codebase, tech stack, and current hackathon progress.*

---

## 🚀 Project Overview
I am building a **Real-Time, Multi-Tenant Collaborative RAG (Retrieval-Augmented Generation) Platform** named "Polly" (Project Borg). The platform facilitates isolated knowledge silos (Organizations) where users can securely upload documents (PDF/DOCX) or input text, which is chunked, vectorized, and parsed by a Python backend using Google Gemini.

## 🛠️ Technology Stack
*   **Frontend:** React (Vite), JavaScript, Vanilla CSS.
*   **Identity & Auth:** Firebase Auth (Email/Password), Firebase Firestore.
*   **Real-Time Comms:** Full-Duplex WebSockets (FastAPI + React).
*   **Backend & Processing:** Python `FastAPI`, Asynchronous Event Loops.
*   **Database (Vector):** Pinecone (`langchain-pinecone`), utilizing `all-mpnet-base-v2` HuggingFace Embeddings.
*   **AI / LLM:** Google `gemini-2.5-flash` natively integrated into the Python worker.
*   **Chunking / ETL:** `SemanticChunker` (for unstructured text) and `RecursiveCharacterTextSplitter` (for structured).

## 🔐 Core Architecture & Features Implemented 
### 1. Multi-Tenant Data Governance
*   **Data Provenance:** All data uploaded to Pinecone is strictly tagged with `metadata={"org_id": <DEPARTMENT>, "owner": <EMAIL>}`.
*   **Organizational Lifecycle:** Firestore contains an `organizations` collection and an `orgRequests` collection. Users can visually discover active organizations and dispatch requests to join them. Admins natively receive requests in their UI dashboard and use 1-click approvals to modify the user's root `department` profile setting.
*   **Role-Based Access Control (RBAC):** `AuthContext` globally provides an `isAdmin` boolean based on `user.role === 'admin'`.

### 2. The WebSocket "Cross-Border" Query Protocol
*   **In-Memory Routing:** The Python layer maps connections via `ws://localhost:8000/ws/chat/{email}?org_id={org}&is_admin={isAdmin}`.
*   **Silo Integrity:** Standard AI queries securely inject `filter={"org_id": user_org_id}` directly into Pinecone's similarity search.
*   **Cross-Org Targeting:** Users can query other organizations using the `@org:TargetOrg` syntax. The Python Regex engine parses this, intercepts the execution thread, parks the query in a dictionary, and silently dispatches a `"cross_org_request"` JSON packet directly to the Target Organization's active Administrators.
*   **Human-in-the-Loop (HITL):** Admins see a visual notification pop-up. Clicking "Allow" routes a specific approval byte packet back up the socket. The Python engine resumes execution with the external `TargetOrg` filter, and securely routes a one-time websocket message **only** to the original external requesting client.

### 3. Targeted Attribution (Mentions)
*   Standard internal users can query specific user "silos" within their own organization by using the `@username` syntax. The regex parses the target and safely runs the Pinecone filter `{"org_id": my_org, "owner": target_username}`.

## ⚠️ Known Blockers & Current Objectives
1.  **Deployment Scaling:** The WebSocket `ConnectionManager` is currently an in-memory Python dictionary bound to `localhost:8000`. We need to migrate this to an Upstash Redis/PubSub model for horizontal scaling.
2.  **Firestore Security Rules:** Currently managing complex custom `firestore.rules` for `{organizations}` and `{orgRequests}` to securely bypass deny-by-default behavior while establishing hierarchical boundaries.
3.  **Local Execution Politics:** Encountered `UnauthorizedAccess` policies on Windows PowerShell blocking local `npx` Firebase CLI executions.

## 🎯 How You Can Help Me Today
*(Add your specific question or goal here based on what you want the AI to do next!)*
