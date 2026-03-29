import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Environment variables for API keys — read lazily to avoid crashing on startup
const getPineconeKey = () => import.meta.env.VITE_PINECONE_API_KEY;
const getPineconeIndex = () => import.meta.env.VITE_PINECONE_INDEX;
const getGeminiKey = () => import.meta.env.VITE_GEMINI_API_KEY;

// Lazy singletons — only created when first needed, not at module load time
let _pc = null;
let _embeddingModel = null;

function getPinecone() {
  if (!_pc) _pc = new Pinecone({ apiKey: getPineconeKey() });
  return _pc;
}

function getEmbeddingModel() {
  if (!_embeddingModel) {
    const genAI = new GoogleGenerativeAI(getGeminiKey());
    _embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  }
  return _embeddingModel;
}

/**
 * Generate an embedding vector for a string of text.
 * @param {string} text 
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
  const result = await getEmbeddingModel().embedContent(text);
  return result.embedding.values;
}

/**
 * Upsert a document chunk into Pinecone with multi-tenant metadata.
 * @param {string} orgId - Namespace for isolation
 * @param {Object} chunk - { id, text, metadata }
 */
export async function upsertToPinecone(orgId, chunks) {
  const index = getPinecone().index(getPineconeIndex()).namespace(orgId);
  
  const vectors = await Promise.all(chunks.map(async (c) => {
    const values = await generateEmbedding(c.text);
    return {
      id: c.id,
      values,
      metadata: {
        ...c.metadata,
        text: c.text,
        orgId,
      }
    };
  }));

  await index.upsert(vectors);
}

/**
 * Universal Ingestion Workflow:
 * Extract Text -> Chunk -> Embed -> Metadata Injection -> Pinecone Upsert
 * 
 * @param {string} orgId - Namespace
 * @param {Object} doc - { id, title, text, department, adminId }
 */
export async function ingestDocument(orgId, doc) {
  const { id: docId, title, text, department, adminId } = doc;
  
  // 1. Chunk text (Recursive character splitting)
  const textChunks = chunkText(text, 1000, 200);
  
  // 2. Map into Pinecone Vector Chunks
  const chunks = textChunks.map((t, i) => ({
    id: `${docId}_chunk_${i}`,
    text: t,
    metadata: {
      docId,
      title,
      department,
      adminId,
      is_approved: true, // As requested: mandatory metadata
      ingestedAt: new Date().toISOString()
    }
  }));

  // 3. Batched Upsert
  await upsertToPinecone(orgId, chunks);
}

/**
 * Query Pinecone for relevant context using multi-tenant filtering.
 * @param {string} orgId - Namespace
 * @param {string} queryText - User question
 * @param {Object} filters - e.g. { department: 'Engineering', is_approved: true }
 * @returns {Promise<Array>}
 */
export async function queryKnowledgeBase(orgId, queryText, filters = {}) {
  const index = getPinecone().index(getPineconeIndex()).namespace(orgId);
  const queryVector = await generateEmbedding(queryText);

  const results = await index.query({
    vector: queryVector,
    topK: 5,
    includeMetadata: true,
    filter: filters, // Metadata-level filter for is_approved and department
  });

  return results.matches.map(m => ({
    text:     m.metadata.text,
    score:    m.score,
    docId:    m.metadata.docId,
    adminId:  m.metadata.adminId, // For auditability as requested
    title:    m.metadata.title
  }));
}

/**
 * Professional Chunking Utility: Recursive character splitting with overlap.
 * @param {string} text 
 * @param {number} size 
 * @param {number} overlap 
 */
export function chunkText(text, size = 1000, overlap = 200) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
  }

  return chunks;
}
