/**
 * @module hyde
 * @description Hypothetical Document Embeddings (HyDE) for improved RAG retrieval.
 *
 * REFERENCE: Gao et al. (2022) — "Precise Zero-Shot Dense Retrieval without Relevance Labels"
 * https://arxiv.org/abs/2212.10496
 *
 * THE PROBLEM WITH QUERY EMBEDDING:
 * When a user asks a question, their query is short (10-30 tokens) and uses question
 * syntax ("What is", "How do I", "When should"). Documents in the knowledge base use
 * declarative statement syntax ("The policy requires", "Employees must", "Step 1 is").
 *
 * The semantic gap between question-space and document-space vectors causes the cosine
 * similarity between a query embedding and its ideal matching document embedding to be
 * LOWER than the similarity between two random documents in the same topic area.
 *
 * THE HYDE SOLUTION:
 * Instead of embedding the raw user question, use the LLM to first generate a
 * hypothetical document that WOULD CONTAIN the answer, then embed THAT document.
 * The hypothetical document uses the same syntax as real knowledge base documents,
 * so its embedding lands much closer to the actual matching documents in vector space.
 *
 * EXAMPLE:
 *   Query:               "How many vacation days do employees get?"
 *   HyDE document:       "Employees are entitled to 15 vacation days per year. New hires
 *                          receive 10 days in their first year. Senior staff (5+ years)
 *                          receive 20 days. Unused days may be carried over..."
 *   Effect:              The HyDE embedding is much closer to "Section 4.2: Leave Policy"
 *                        in Pinecone than the raw question embedding
 *
 * WHEN TO USE:
 *   - FACTUAL queries: questions with a specific factual answer (big benefit)
 *   - PROCEDURAL queries: how-to questions (moderate benefit)
 *   - ANALYTICAL: less benefit (query already information-dense)
 *   - CONVERSATIONAL: skip entirely (no RAG being run anyway)
 *
 * GRACEFUL DEGRADATION:
 *   If Gemini fails to generate the hypothetical doc (quota, network), returns the
 *   original query text — retrieval falls back to standard embedding mode.
 *
 * LATENCY:
 *   Adds 1 Gemini API call (+300-600ms) before the Pinecone query.
 *   Embedding cache in embeddingCache.js will serve repeated identical queries.
 *
 * @exports generateHypotheticalDoc
 * @exports isHyDEBeneficial
 */

import { GEMINI_API_KEY, GEMINI_MODEL } from '../context/AppConfig'

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`

/**
 * Determine if HyDE would benefit this query type.
 * Skip for CONVERSATIONAL (no RAG) and skip when query is already document-like.
 *
 * @param {'CONVERSATIONAL'|'FACTUAL'|'ANALYTICAL'|'PROCEDURAL'} intentType
 * @returns {boolean}
 */
export function isHyDEBeneficial(intentType) {
  return intentType === 'FACTUAL' || intentType === 'PROCEDURAL'
}

/**
 * Generate a hypothetical document that would contain the answer to the user's query.
 * This document is then embedded instead of the raw query for better vector space alignment.
 *
 * @param {string} userQuery        - The user's original question
 * @param {string} orgContext       - Brief org context to make hypothetical doc realistic
 * @param {string} userDepartment   - User's department for domain-specific generation
 * @returns {Promise<string>}        - Hypothetical document text, or original query on failure
 */
export async function generateHypotheticalDoc(userQuery, orgContext = '', userDepartment = '') {
  if (!GEMINI_API_KEY) return userQuery  // safe fallback

  const deptContext = userDepartment && userDepartment !== 'Unassigned'
    ? `The user works in the ${userDepartment} department.`
    : ''

  const systemPrompt = `You are generating a hypothetical knowledge base document excerpt.
Write a realistic passage (3-5 sentences) that DIRECTLY ANSWERS the question below.
Write in declarative document style (not question-answer format).
Write as if this is an excerpt from an official policy document, procedure guide, or reference document.
Do NOT say "I" or reference the user. Do NOT add disclaimers. Just write the document content.
${deptContext}`

  const userPrompt = `Question: "${userQuery}"

Generate a hypothetical document excerpt that directly contains the answer to this question.`

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature:     0.5,   // Some variance for diversity, not fully deterministic
          maxOutputTokens: 200,   // Short hypothetical doc — embedding quality, not length
        },
      }),
    })

    if (!res.ok) {
      console.warn(`[Borg HyDE] Gemini returned ${res.status} — falling back to raw query`)
      return userQuery
    }

    const data = await res.json()
    const doc  = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!doc || doc.length < 20) {
      return userQuery  // Degenerate response → fall back
    }

    console.info(`[Borg HyDE] Generated hypothetical doc (${doc.length} chars) for embedding`)
    return doc

  } catch (err) {
    console.warn('[Borg HyDE] Generation failed — falling back to raw query:', err.message)
    return userQuery  // Always fall back gracefully
  }
}
