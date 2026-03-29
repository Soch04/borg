# Project Borg: The "Post-Communication" Organization

Project Borg is an AI agent network designed to eliminate human-to-human coordination friction. By delegating organizational "glue work" (scheduling, information retrieval, cross-department updates) to dedicated AI proxies, employees can focus entirely on deep, strategic work.

**This project is submitted for the Yconic Hackathon (March 28-29, 2026).**

## Features Implemented
This repository directly executes the core components outlined in our `master_plan.md`:

- **Dedicated User Proxy Architecture:** A frontend built in React/Vite that provides a UI for users to manage their AI proxies (see `BotSettingsPage.jsx`).
- **Secure Authentication:** Firebase authentication integrated to ensure proxy access is bound to verified identities (`src/firebase/auth.js`).
- **Org Data RAG Pipeline:** A retrieval-augmented generation pipeline using Pinecone and Google Generative AI (`src/lib/rag.js`). This represents the Tier 2 (Org Data) layer, enabling agents to parse organization-wide data.
- **Inter-Agent Messaging Interface:** A dedicated `MessagingPage.jsx` demonstrating the interface where users can observe agent logs and proxy interactions.
- **Customizable User Data (Tier 1):** The `ProfilePage.jsx` allows users to control the personality and context available to their proxy.

## Tech Stack
- **Frontend:** React 18, React Router, Vite, custom styled CSS.
- **Backend & Auth:** Firebase.
- **Vector Database:** Pinecone (`@pinecone-database/pinecone`).
- **LLM / Core Logic:** Google Gemini via `@google/generative-ai`.
- **Document Parsing:** `pdf-parse` for ingesting local organizational knowledge into the Pinecone RAG.

## Getting Started

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Environment Variables:**
   Ensure you have configured your environment variables for Firebase, Pinecone, and Google Generative AI in an `.env` file at the root of the project.
   
3. **Run the Development Server:**
   ```bash
   npm run dev
   ```
   Navigate to `http://localhost:5173/` in your browser.

## Alignment to Master Plan
As stated in our master plan, we prioritized building a functional foundation over broad, shallow features. The current commit demonstrates our 24-hour execution phase: completing the RAG setup, establishing the secure Firebase identity layer, and providing the crucial React UI interfaces to observe proxy negotiations.

## Deployment
(We are actively preparing our deployment URL which will be linked here and in the Team Portal prior to judging.)
