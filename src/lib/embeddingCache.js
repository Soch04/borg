/**
 * @module embeddingCache
 * @description LRU (Least Recently Used) in-memory cache for Gemini text embeddings.
 *
 * PROBLEM: queryKnowledgeBase() re-embeds every user message before querying Pinecone.
 * If a user asks the same question twice (or similar questions in rapid succession),
 * we make redundant Gemini API calls and add 200-400ms of latency each time.
 *
 * SOLUTION: Cache the 768-dimensional embedding vector keyed by a hash of the input
 * text. On cache hit, skip the Gemini embedContent() call entirely.
 *
 * EVICTION POLICY: LRU — when the cache reaches MAX_ENTRIES, the least recently
 * used entry is evicted. This prevents unbounded memory growth.
 *
 * IMPLEMENTATION: Uses a Map (insertion-order preserving in JS) — on every access
 * (get + set), the key is deleted and re-inserted to move it to the end of the Map,
 * simulating LRU ordering. Eviction removes the first (oldest) entry.
 *
 * CACHE KEY: SHA-256 hash of the text (via Web Crypto API) — collision-resistant,
 * constant size regardless of input length. Not cryptographically sensitive.
 *
 * WHY NOT SEMANTIC SIMILARITY FOR CACHE LOOKUP:
 * We can't check semantically-similar queries against the cache without an embedding —
 * which is what we're trying to skip. Exact-match hashing is the correct approach here.
 * Near-duplicate queries will still benefit from the classifier's intent routing.
 */

/** Maximum number of embeddings to cache before LRU eviction */
const MAX_ENTRIES = 200

/** @type {Map<string, number[]>} LRU map: hash → 768-dim embedding vector */
const cache = new Map()

/**
 * Compute a SHA-256 hash of a string using the Web Crypto API.
 * Returns a hex string — used as the cache key.
 *
 * @param {string} text
 * @returns {Promise<string>} hex digest
 */
async function hashText(text) {
  const encoder = new TextEncoder()
  const data    = encoder.encode(text.toLowerCase().trim())  // normalize before hashing
  const buffer  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Retrieve a cached embedding vector, updating its LRU position.
 *
 * @param {string} text
 * @returns {Promise<number[] | null>} cached vector, or null on cache miss
 */
export async function getCachedEmbedding(text) {
  const key = await hashText(text)
  if (!cache.has(key)) return null

  // Move to end of Map to mark as Most Recently Used
  const value = cache.get(key)
  cache.delete(key)
  cache.set(key, value)

  return value
}

/**
 * Store an embedding vector in the LRU cache.
 * Evicts the least recently used entry if the cache is at capacity.
 *
 * @param {string}   text      - The input text that was embedded
 * @param {number[]} embedding - The 768-dim vector returned by Gemini gemini-embedding-001
 */
export async function setCachedEmbedding(text, embedding) {
  const key = await hashText(text)

  if (cache.size >= MAX_ENTRIES) {
    // Evict the first (least recently used) entry
    const firstKey = cache.keys().next().value
    cache.delete(firstKey)
  }

  cache.set(key, embedding)
}

/**
 * Returns current cache statistics for debugging/monitoring.
 * @returns {{ size: number, maxEntries: number, hitRate: string }}
 */
export function getCacheStats() {
  return { size: cache.size, maxEntries: MAX_ENTRIES }
}
