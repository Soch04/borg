import os
import shutil
from pathlib import Path
from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader, TextLoader
from langchain_experimental.text_splitter import SemanticChunker
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
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

# Load environment variables
load_dotenv()

# Initialize embeddings
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-mpnet-base-v2")

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
def load_document(files: list, shared_org: str = "none"):
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
                doc.metadata["source"] = file_path.name
                doc.metadata["type"] = mtype
                doc.metadata["shared_orgs"] = [shared_org]
                doc.metadata["owner"] = "Current_User"

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
        chunk_size= 1000, 
        chunk_overlap=50,
        separators=["\n\n", "\n", " ", ""]
    )
    return text_splitter.split_documents(documents)

def add_to_vectorstore(files, shared_org: str = "none"):
    docs_list = load_document(files, shared_org) 
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

def add_text_to_vectorstore(text: str, shared_org: str = "none"):
    if not text.strip():
        return
        
    source_name = text[:30] + '...' if len(text) > 30 else text
    unique_id = str(uuid4())
    
    try:
        res = pc.Index(index_name).query(
            vector=[0.0] * 768, filter={"source": source_name}, top_k=1
        )
        if res.matches:
            print(f"-> Skipping typed text: Already in VectorStore.")
            return
    except Exception as e: pass

    try: cleaned_text = preprocess_text(text)
    except: cleaned_text = text

    doc = Document(
        page_content=cleaned_text,
        metadata={"source": source_name, "id": unique_id, "type": "unstructured", "shared_orgs": [shared_org], "owner": "Current_User"}
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

@app.post("/api/text")
async def upload_text_endpoint(background_tasks: BackgroundTasks, text: str = Form(...), shared_org: str = Form("none")):
    background_tasks.add_task(add_text_to_vectorstore, text, shared_org)
    return {"message": "Text queued for embedding"}

@app.post("/api/upload")
async def upload_files_endpoint(background_tasks: BackgroundTasks, files: List[UploadFile] = File(...), shared_org: str = Form("none")):
    saved_files = []
    for file in files:
        file_path = TEMP_DIR / file.filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_files.append(str(file_path))
    
    background_tasks.add_task(add_to_vectorstore, saved_files, shared_org)
    return {"message": f"Successfully queued files for embedding."}

@app.delete("/api/delete")
async def delete_file_endpoint(source: str):
    delete_from_db(source)
    return {"message": f"Deleted {source} vectors"}

from pydantic import BaseModel

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, ws: WebSocket, user_id: str):
        await ws.accept()
        self.active_connections[user_id] = ws

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

    async def send_personal_message(self, message: str, user_id: str):
        ws = self.active_connections.get(user_id)
        if ws:
            await ws.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/alerts/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(user_id)

class ChatSimulation(BaseModel):
    target_user: str
    sender: str

@app.post("/api/chat_simulate")
async def simulate_chat(data: ChatSimulation):
    # This simulates someone talking to your agent
    await manager.send_personal_message(f"{data.sender} is interacting with your Agent right now!", data.target_user)
    return {"status": "Alert sent"}

if __name__ == "__main__":
    import uvicorn
    print("Starting Data Ingestion Server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
