/**
 * @module ragReranker
 * @description LLM-based re-ranking of Pinecone retrieval results.
 *
 * PROBLEM: Embedding-based ANN (Approximate Nearest Neighbor) retrieval optimizes for
 * cosine similarity in 768-dimensional vector space. This captures semantic similarity
 * well but has known failure modes:
 *   - Retrieves chunks that are topically similar but don't actually answer the question
 *   - Dense vectors don't encode fine-grained lexical specificity well
 *   - High cosine similarity ≠ high query-specific relevance
 *
 * SOLUTION: After Pinecone returns top-K candidates, use Gemini as a cross-encoder
 * to score each chunk's specific relevance to the user's question (0–10 scale).
 * Only chunks scoring ≥ RELEVANCE_THRESHOLD are passed to the system prompt.
 *
 * WHY THIS WORKS:
 *   - Cross-encoder LLMs can jointly reason about query + document together
 *   - They are more sensitive to exact phrasing, negation, and specificity than
 *     bi-encoder embedding similarity
 *   - This is the same approach used in production by Cohere, Anthropic, and
 *     OpenAI's file_search tool (inner rerank step)
 *
 * COST TRADEOFF:
 *   - Adds 1 additional Gemini API call per user message (scoring is batched)
 *   - Estimated latency overhead: +300-600ms
 *   - Eliminates irrelevant context from the prompt, reducing output token cost
 *   - LRU embedding cache mitigates the embedding portion of the latency
 *
 * OUTPUT:
 *   - Returns only the chunks that Gemini rates as ≥ RELEVANCE_THRESHOLD (default: 6/10)
 *   - Sorted by LLM-assigned score descending (most relevant first)
 *   - If all chunks fail the threshold, returns the single highest-scoring chunk
 *     to ensure the agent always has some context to ground from
 *
 * GRACEFUL DEGRADATION:
 *   - If the re-ranking call fails (quota, network, parse error), returns the
 *     original Pinecone results unchanged — retrieval quality degrades to
 *     embedding-only mode rather than failing entirely
 *
 * @exports rerankResults
 */

import { GEMINI_API_KEY, GEMINI_MODEL } from '../context/AppConfig'
import { safeJsonParse, buildGeminiFetchOptions } from '../utils/apiHelpers'

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`

/** Minimum relevance score (0–10) to include a chunk in the final context */
const RELEVANCE_THRESHOLD = 6

/**
 * Re-rank RAG retrieval results using Gemini as a cross-encoder judge.
 *
 * @param {string} userQuery - The user's original question
 * @param {Array<{text: string, title: string, docId: string, score: number}>} candidates
 *   - Candidate chunks from Pinecone top-K search
 * @returns {Promise<Array>} - Filtered and re-ranked subset of candidates
 */
export async function rerankResults(userQuery, candidates) {
  if (!candidates || candidates.length === 0) return candidates
  if (!GEMINI_API_KEY) return candidates  // safe fallback if key missing
  if (candidates.length === 1) return candidates  // nothing to rerank

  // Build a structured scoring prompt — Gemini scores each chunk 0-10
  const scoringPrompt = buildScoringPrompt(userQuery, candidates)

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`,
      buildGeminiFetchOptions({
        system_instruction: {
          parts: [{ text: 'You are a relevance scoring engine. Respond only with valid JSON. No explanation, no markdown, just the JSON object.' }]
        },
        contents: [{ role: 'user', parts: [{ text: scoringPrompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 256 },
      })
    )

    if (!res.ok) {
      console.warn(`[Borg Reranker] Gemini returned ${res.status} — using original ranking`)
      return candidates
    }

    const data      = await res.json()
    const rawText   = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const scores    = parseScores(rawText, candidates.length)

    if (!scores) {
      console.warn('[Borg Reranker] Could not parse scores — using original ranking')
      return candidates
    }

    // Attach LLM scores to candidates
    const scored = candidates.map((chunk, i) => ({
      ...chunk,
      llmScore:    scores[i] ?? 0,
      llmReranked: true,
    }))

    // Filter to threshold, sort by LLM score descending
    const passed = scored
      .filter(c => c.llmScore >= RELEVANCE_THRESHOLD)
      .sort((a, b) => b.llmScore - a.llmScore)

    // Ensure at least one chunk always passes (graceful degradation)
    if (passed.length === 0) {
      const best = scored.sort((a, b) => b.llmScore - a.llmScore)[0]
      console.info(`[Borg Reranker] All chunks below threshold — using best chunk (score: ${best.llmScore})`)
      return [best]
    }

    console.info(`[Borg Reranker] ${passed.length}/${candidates.length} chunks passed threshold (≥${RELEVANCE_THRESHOLD}/10)`)
    return passed

  } catch (err) {
    // Any failure → graceful degradation to original Pinecone ranking
    console.warn('[Borg Reranker] Re-ranking failed — using original ranking:', err.message)
    return candidates
  }
}

/**
 * Build the relevance scoring prompt.
 * Presents each chunk as a numbered item and asks for a JSON score array.
 *
 * @param {string} query
 * @param {Array} chunks
 * @returns {string}
 */
function buildScoringPrompt(query, chunks) {
  const items = chunks
    .map((c, i) => `[${i}] Title: "${c.title}"\nContent: ${c.text.slice(0, 400)}`)
    .join('\n\n')

  return `Score each of the following document chunks for relevance to the user's question.
Use a scale from 0 to 10:
  10 = Directly and completely answers the question
  7-9 = Highly relevant, contains important partial answer
  4-6 = Somewhat relevant, tangentially related
  1-3 = Topically similar but does not address the question
  0 = Completely irrelevant

User question: "${query}"

Documents to score:

${items}

Respond with ONLY a JSON object in this exact format (no other text):
{"scores": [<score for [0]>, <score for [1]>, ...]}`
}

/**
 * Parse the JSON score array from Gemini's response.
 * Returns null if parsing fails or scores array is wrong length.
 *
 * @param {string} rawText
 * @param {number} expectedLength
 * @returns {number[] | null}
 */
function parseScores(rawText, expectedLength) {
  const parsed = safeJsonParse(rawText)
  const scores = parsed?.scores
  if (!Array.isArray(scores) || scores.length !== expectedLength) return null
  if (!scores.every(s => typeof s === 'number' && s >= 0 && s <= 10)) return null
  return scores
}
