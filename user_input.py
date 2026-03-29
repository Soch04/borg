import os
import shutil
from pathlib import Path
from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader, TextLoader
from langchain_experimental.text_splitter import SemanticChunker
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_core.documents import Document
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone
from dotenv import load_dotenv
from uuid import uuid4
import re
from file_cleaner import preprocess_text
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import json
import asyncio

# Load environment variables
load_dotenv()

# Initialize embeddings — MUST match the JS frontend (src/lib/rag.js).
# Both import and query paths use Gemini text-embedding-004 (768-dim) so
# vectors are comparable in cosine space.
embeddings = GoogleGenerativeAIEmbeddings(
    model="models/text-embedding-004",
    google_api_key=os.environ.get("VITE_GEMINI_API_KEY")
)

# Persistent vector database (Pinecone)
pc = Pinecone(api_key=os.environ.get("VITE_PINECONE_API_KEY"))
index_name = os.environ.get("VITE_PINECONE_INDEX_NAME")
db = PineconeVectorStore(index=pc.Index(index_name), embedding=embeddings)

# CLASSIFY DOCUMENTS  
def classify_pdf(documents):
    text = "\n".join(d.page_content for d in documents)

    signals = [
        r"\n[A-Z][A-Z ]+\n",     # headers / section titles
        r"\d+\.\s",              # numbered lists
        r"•|·|- *",              # bullet points
        r"\bTable\b \d+",
        r"\bFigure\b \d+",
        r"\n\d{1,3}\n",          # page numbers
    ]

    score = sum(bool(re.search(sig, text)) for sig in signals)
    return "structured" if score >= 2 else "unstructured"

def classify_docx(document: Document):
    # Safe mock lookup that skips raw XML to avoid crashing without python-docx active XML tree.
    if hasattr(document, 'paragraphs'):
        for paragraph in document.paragraphs:
            if hasattr(paragraph, '_p') and paragraph._p.pPr and paragraph._p.pPr.numPr:
                return "structured"
    return "unstructured"

# LOAD DOCUMENTS
def load_document(files: list, shared_org: str = "none", owner: str = "anonymous"):
    """
    Load documents from the Gradio-uploaded file list instead of scanning a folder.
    Each file gets a unique UUID and its name as metadata.
    """
    finished_documents = []

    for file in files:
        file_path = Path(file)
        
        # Check DB for this filename before doing ANY work
        try:
            res = pc.Index(index_name).query(
                vector=[0.0] * 768, 
                filter={"source": file_path.name}, 
                top_k=1
            )
            if res.matches:
                print(f"-> Skipping {file_path.name}: Already in VectorStore.")
                continue # This skips the for-loop
        except Exception as e:
            print(f"Could not check existing index for {file_path.name}: {e}")

        print(f"Processing new file: {file_path.name}...")

        if file_path.suffix.lower() == ".pdf":
            file_type = "pdf"
            loader = PyPDFLoader(str(file_path))
        elif file_path.suffix.lower() == ".docx":
            file_type = "docx"
            loader = Docx2txtLoader(str(file_path))
        elif file_path.suffix.lower() == ".txt":
            file_type = "txt"
            loader = TextLoader(str(file_path))
        else:
            print(f"Skipping unsupported file type: {file_path.name}")
            continue

        try:
            document_objects = loader.load()   
            unique_id = str(uuid4())
            
            if file_type == "docx":
                mtype=classify_docx(Document(page_content="", metadata={"source": str(file_path)}))
            elif file_type == "pdf":
                mtype=classify_pdf(document_objects)
            else:
                mtype="unstructured"

            cleaned_documents = []
            for doc in document_objects:
                doc.metadata["id"] = unique_id
                doc.metadata["source"] = f"File Import: {file_path.name}"
                doc.metadata["type"] = mtype
                doc.metadata["org_id"] = shared_org
                doc.metadata["owner"] = owner

                try: 
                    cleaned_text = preprocess_text(doc.page_content)
                    cleaned_doc = Document(
                        page_content=cleaned_text,
                        metadata=doc.metadata
                    )
                    cleaned_documents.append(cleaned_doc)
                except Exception as e:
                    print(f"Cleaning error in {file_path.name}: {e}")
                    cleaned_documents.append(doc)

            finished_documents.append(cleaned_documents)

        except Exception as e:
            print(f"Error loading {file_path.name}: {e}")

    return finished_documents

def semantic_chunking(documents: list[Document]):
    avg_length = sum(len(d.page_content.split()) for d in documents) / len(documents)
    if avg_length < 150:
        threshold = 0.38   
    elif avg_length > 800:
        threshold = 0.46   
    else:
        threshold = 0.42   

    text_splitter = SemanticChunker(
        embeddings=embeddings,
        buffer_size=2,
        breakpoint_threshold_type="percentile",
        breakpoint_threshold_amount=threshold,
        min_chunk_size=3
    )
    return text_splitter.split_documents(documents)

def paragraph_chunking(documents: list[Document]):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000, 
        chunk_overlap=100,
        separators=["\n\n", "\n", " ", ""]
    )
    return text_splitter.split_documents(documents)

def add_to_vectorstore(files, org_id: str = "global", owner: str = "anonymous"):
    docs_list = load_document(files, shared_org=org_id, owner=owner) 
    if not docs_list:
        print("No new documents to add.")
        return

    total_chunks = 0
    for doc_group in docs_list:
        if not doc_group: continue
        if doc_group[0].metadata['type'] == 'structured':
            chunks = paragraph_chunking(doc_group)
        else:
            chunks = semantic_chunking(doc_group)

        if chunks:
            db.add_documents(chunks)
            total_chunks += len(chunks)
            print(f"Uploaded {len(chunks)} chunks for {doc_group[0].metadata['source']}")

    print(f"Job Complete. Added total {total_chunks} chunks to vectorstore.")

def delete_from_db(source: str):
    print(f"Deleting from DB via filter: {source}")
    try:
        pc.Index(index_name).delete(filter={"source": source})
        print(f"Deleted vector(s) for {source} from Pinecone.")
    except Exception as e:
        print(f"Error during delete for {source}: {e}")

def add_text_to_vectorstore(text: str, org_id: str = "global", owner: str = "anonymous"):
    if not text.strip():
        return
        
    source_name = "Text Import"
    unique_id = str(uuid4())
    
    try: cleaned_text = preprocess_text(text)
    except: cleaned_text = text

    doc = Document(
        page_content=cleaned_text,
        metadata={"source": source_name, "id": unique_id, "type": "unstructured", "org_id": org_id, "owner": owner}
    )
    
    if len(cleaned_text) <= 1000:
        db.add_documents([doc])
        print(f"Uploaded 1 chunk for typed text: {source_name}")
    else:
        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=50)
        chunks = splitter.split_documents([doc])
        db.add_documents(chunks)
        print(f"Uploaded {len(chunks)} chunks for typed text: {source_name}")

# --- FASTAPI SERVER INTEGRATION ---
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

TEMP_DIR = Path("temp_uploads")
TEMP_DIR.mkdir(exist_ok=True)

UPLOAD_QUEUE = {}

@app.post("/api/text")
async def upload_text_endpoint(background_tasks: BackgroundTasks, text: str = Form(...), org_id: str = Form("global"), owner: str = Form("anonymous"), is_admin: str = Form("false")):
    if is_admin.lower() == "true":
        background_tasks.add_task(add_text_to_vectorstore, text, org_id, owner)
        return {"message": "Text queued for embedding", "queued": False}
    else:
        req_id = str(uuid4())
        UPLOAD_QUEUE[req_id] = {
            "req_id": req_id, "type": "text", "content": text, 
            "org_id": org_id, "owner": owner, "title": "Text Import",
            "preview": text[:500] + ("..." if len(text) > 500 else "")
        }
        return {
            "message": "Text queued for admin approval", 
            "queued": True, 
            "req_id": req_id, 
            "title": "Text Import", 
            "preview": UPLOAD_QUEUE[req_id]["preview"],
            "type": "text"
        }

@app.post("/api/upload")
async def upload_files_endpoint(background_tasks: BackgroundTasks, files: List[UploadFile] = File(...), org_id: str = Form("global"), owner: str = Form("anonymous"), is_admin: str = Form("false")):
    saved_files = []
    for file in files:
        file_path = TEMP_DIR / file.filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_files.append(str(file_path))
    
    if is_admin.lower() == "true":
        background_tasks.add_task(add_to_vectorstore, saved_files, org_id, owner)
        return {"message": "Successfully queued files for embedding.", "queued": False}
    else:
        req_id = str(uuid4())
        # Brief preview extraction logic
        preview_text = "Content Preview Loading..."
        try:
           preview_docs = load_document([saved_files[0]], org_id, owner)
           if preview_docs and preview_docs[0]:
              preview_text = preview_docs[0][0].page_content[:500] + ("..." if len(preview_docs[0][0].page_content) > 500 else "")
        except: pass

        UPLOAD_QUEUE[req_id] = {
            "req_id": req_id, "type": "file", "files": saved_files, 
            "org_id": org_id, "owner": owner, 
            "title": f"File Import: {files[0].filename}" + (" and others" if len(files)>1 else ""),
            "preview": preview_text
        }
        return {
            "message": "Files queued for admin approval", 
            "queued": True,
            "req_id": req_id,
            "title": UPLOAD_QUEUE[req_id]["title"],
            "preview": preview_text,
            "type": "file"
        }

@app.get("/api/queue")
async def get_queue(org_id: str):
    return {"queue": [q for q in UPLOAD_QUEUE.values() if q["org_id"] == org_id]}

@app.post("/api/queue/approve")
async def approve_queue(background_tasks: BackgroundTasks, req_id: str = Form(...)):
    if req_id not in UPLOAD_QUEUE:
        return {"error": "Not found"}
    req = UPLOAD_QUEUE.pop(req_id)
    if req["type"] == "text":
        background_tasks.add_task(add_text_to_vectorstore, req["content"], req["org_id"], req["owner"])
    else:
        background_tasks.add_task(add_to_vectorstore, req["files"], req["org_id"], req["owner"])
    return {"message": "Approved"}

@app.post("/api/queue/deny")
async def deny_queue(req_id: str = Form(...)):
    if req_id in UPLOAD_QUEUE:
        req = UPLOAD_QUEUE.pop(req_id)
        if req["type"] == "file":
             for f in req["files"]:
                 try: os.remove(f)
                 except: pass
    return {"message": "Denied"}

@app.delete("/api/delete")
async def delete_file_endpoint(source: str):
    delete_from_db(source)
    return {"message": f"Deleted {source} vectors"}

from pydantic import BaseModel

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.user_orgs: dict[str, str] = {}
        self.user_admins: dict[str, bool] = {}
        self.pending_cross_org: dict[str, dict] = {} # req_id -> {from_email, target_org, query_text}

    async def connect(self, ws: WebSocket, email: str, org_id: str, is_admin: bool):
        await ws.accept()
        self.active_connections[email] = ws
        self.user_orgs[email] = org_id
        self.user_admins[email] = is_admin
        
        # Dispatch parked cross-border queries on Admin Auth
        if is_admin:
            for req_id, pd in self.pending_cross_org.items():
                if pd["target_org"] == org_id:
                    await ws.send_text(json.dumps({
                        "type": "cross_org_request", "req_id": req_id, 
                        "from_email": pd["from_email"], "query": pd["query_text"]
                    }))

    def disconnect(self, email: str):
        if email in self.active_connections: del self.active_connections[email]

    async def broadcast_to_org(self, org_id: str, message: str):
        for email, ws in self.active_connections.items():
            if self.user_orgs.get(email) == org_id:
                try: await ws.send_text(message)
                except: pass

    async def send_personal(self, email: str, message: str):
        if email in self.active_connections:
            try: await self.active_connections[email].send_text(message)
            except: pass

manager = ConnectionManager()

@app.websocket("/ws/chat/{email}")
async def websocket_chat(websocket: WebSocket, email: str, org_id: str = "global", is_admin: str = "false"):
    is_admin_bool = (is_admin.lower() == "true")
    await manager.connect(websocket, email, org_id, is_admin_bool)
    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
                
                if data.get("type") == "query":
                    query_text = data.get("text", "")
                    
                    # 1. CROSS-ORG REQUEST ROUTING
                    org_m = re.search(r'@org:([^\s]+)', query_text)
                    if org_m:
                        target_org = org_m.group(1).replace("_", " ")
                        q_clean = query_text.replace(f"@org:{target_org}", "").strip()
                        
                        if target_org != org_id:
                            req_id = str(uuid4())
                            manager.pending_cross_org[req_id] = {
                                "from_email": email, "target_org": target_org, "query_text": q_clean
                            }
                            # Route to target admins
                            admin_notified = False
                            for e, org in manager.user_orgs.items():
                                if org == target_org and manager.user_admins.get(e):
                                    await manager.send_personal(e, json.dumps({
                                        "type": "cross_org_request", "req_id": req_id,
                                        "from_email": email, "query": q_clean
                                    }))
                                    admin_notified = True
                            
                            status_msg = "Sent HITL request to Admins." if admin_notified else "Parked request. Awaiting Admin connect."
                            await manager.send_personal(email, json.dumps({
                                "type": "bot_broadcast", "sender": "System", "target": "Personal",
                                "text": f"🚨 Action Blocked: You are querying siloed `{target_org}` data. Requires Human-in-the-Loop authentication.\n> {status_msg}"
                            }))
                            continue
                        else:
                            query_text = q_clean

                    # 2. INTERNAL & TARGETED (ATTRIBUTION) QUERY
                    target_owner = None
                    um = re.search(r'@([^\s]+)', query_text)
                    if um:
                        target_owner = um.group(1)
                        query_text = query_text.replace(f"@{target_owner}", "").strip()
                        
                    asyncio.create_task(process_org_query(email, query_text, org_id, target_owner))
                
                elif data.get("type") == "cross_org_approve":
                    req_id = data.get("req_id")
                    if req_id in manager.pending_cross_org:
                        pd = manager.pending_cross_org[req_id]
                        if manager.user_orgs.get(email) == pd["target_org"] and is_admin_bool:
                            # 3. SECURE RELEASE TRIGGERED
                            asyncio.create_task(process_org_query(
                                sender_email=pd["from_email"],
                                query_text=pd["query_text"],
                                org_id=pd["target_org"],
                                target_owner=None,
                                is_cross_org=True,
                                approved_by=email
                            ))
                            del manager.pending_cross_org[req_id]

            except Exception as e:
                print(f"WS error: {e}")
    except WebSocketDisconnect:
        manager.disconnect(email)

async def process_org_query(sender_email: str, query_text: str, org_id: str, target_owner: str = None, is_cross_org: bool = False, approved_by: str = None):
    try:
        from google import genai
        client = genai.Client(api_key=os.environ.get("VITE_GEMINI_API_KEY"))
        
        filter_dict = {"org_id": org_id}
        if target_owner: filter_dict["owner"] = target_owner
            
        print(f"[RECOVERY] Initiating RAG retrieval for {sender_email} (Target Org: {org_id})...")
        results = await asyncio.to_thread(db.similarity_search, query_text, k=5, filter=filter_dict)
        context_blocks = "\n\n".join([doc.page_content for doc in results])
        print(f"[RECOVERY] Retrieval complete. {len(results)} chunks identified. Generating synthesis...")
        
        prompt = f"""
        Answer the following question based ONLY on the provided context retrieved from the database. 
        If the answer is not in the context, confidently say "I do not know based on the provided data."
        
        Context:
        {context_blocks}
        
        Question:
        {query_text}
        """
        
        response = await asyncio.to_thread(
            client.models.generate_content,
            model='gemini-2.5-flash',
            contents=prompt
        )
        
        if is_cross_org:
            payload = {
                "type": "bot_broadcast", "sender": "System", "target": "Personal",
                "text": f"✅ [HITL ALGORITHM AUTHENTICATED BY `{approved_by}`] Organization `{org_id}` temporarily released the following external response payload:\n\n{response.text}",
                "original_query": query_text
            }
            await manager.send_personal(sender_email, json.dumps(payload))
        else:
            payload = {
                "type": "bot_broadcast", "sender": sender_email, "target": target_owner if target_owner else "Global",
                "text": response.text, "original_query": query_text
            }
            await manager.broadcast_to_org(org_id, json.dumps(payload))

    except Exception as e:
        print(f"WS Error: {e}")
        error_payload = {"type": "bot_broadcast", "text": f"Error resolving query: {e}", "sender": "System", "target": "Personal", "original_query": query_text}
        await manager.send_personal(sender_email, json.dumps(error_payload))

class ChatSimulation(BaseModel):
    target_user: str
    sender: str

@app.post("/api/chat_simulate")
async def simulate_chat(data: ChatSimulation):
    await manager.broadcast(f"{data.sender} is interacting with your Agent right now!")
    return {"status": "Alert sent"}

if __name__ == "__main__":
    import uvicorn
    print("Starting Data Ingestion Server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
