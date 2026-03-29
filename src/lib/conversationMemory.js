/**
 * @module conversationMemory
 * @description Intelligent conversation history summarization for long-running sessions.
 *
 * PROBLEM: Gemini 2.5 Flash Lite has a 32k token context window. A long conversation
 * (20+ turns) with RAG context can fill this window, causing the oldest turns to be
 * silently dropped. Information discussed 30 messages ago — a specific document the
 * user referenced, a decision they made, a name they mentioned — is permanently lost.
 *
 * NAIVE SOLUTION: Drop oldest turns (FIFO). Fast, but lossy — important context is
 * discarded equally with small-talk.
 *
 * THIS SOLUTION: When history reaches SUMMARIZE_THRESHOLD turns, use Gemini to
 * generate a structured 3-5 sentence "conversation summary" covering the oldest
 * TURNS_TO_SUMMARIZE turns. The summary is stored as a synthetic 'summary' role
 * message in history and replaces the raw turns it summarizes. Recent turns (the
 * last RECENT_WINDOW turns) are kept verbatim for conversational coherence.
 *
 * STRUCTURE OF COMPRESSED HISTORY:
 *   [system-summary-block] → injected once as a 'user' turn at position 0
 *   [raw turn N-5]
 *   [raw turn N-4]
 *   [raw turn N-3]
 *   [raw turn N-2]
 *   [raw turn N-1]  ← most recent, always verbatim
 *
 * SUMMARY PROMPT DESIGN:
 * Instructs Gemini to produce a structured summary with three sections:
 *   [KEY DECISIONS] — choices the user made or asked the agent to make
 *   [REFERENCED DOCUMENTS] — specific documents or data that were discussed
 *   [CONTEXT] — important background facts established in the conversation
 *
 * TRIGGERING:
 * shouldSummarize() returns true when history length exceeds SUMMARIZE_THRESHOLD.
 * Called in useMessages.js before each Gemini call.
 *
 * GRACEFUL DEGRADATION:
 * If summarization fails, the original history is returned unchanged.
 * The conversation continues — just without the memory compression step.
 *
 * @exports shouldSummarize
 * @exports summarizeHistory
 * @exports injectSummaryIntoHistory
 */

import { GEMINI_API_KEY, GEMINI_MODEL } from '../context/AppConfig'

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

/** Number of turns in history before compression triggers */
const SUMMARIZE_THRESHOLD = 16

/** Number of oldest turns to compress into a summary */
const TURNS_TO_SUMMARIZE  = 10

/** Number of most-recent turns to always preserve verbatim */
const RECENT_WINDOW       = 6

/**
 * Returns true when conversation history is long enough to benefit from compression.
 *
 * @param {Array<{role: string, content: string}>} history
 * @returns {boolean}
 */
export function shouldSummarize(history) {
  return Array.isArray(history) && history.length >= SUMMARIZE_THRESHOLD
}

/**
 * Compress older turns into a structured Gemini-generated summary.
 * Preserves the most recent RECENT_WINDOW turns verbatim for coherence.
 *
 * @param {Array<{role: string, content: string}>} history
 *   Full conversation history array (oldest first)
 * @returns {Promise<Array<{role: string, content: string}>>}
 *   Compressed history: [summary-block, ...recentTurns]
 */
export async function summarizeHistory(history) {
  if (!shouldSummarize(history)) return history
  if (!GEMINI_API_KEY) return history.slice(-RECENT_WINDOW)

  const toSummarize = history.slice(0, TURNS_TO_SUMMARIZE)
  const toKeep      = history.slice(-RECENT_WINDOW)

  // Build the conversation transcript for the summarizer
  const transcript = toSummarize
    .map(turn => `${turn.role === 'user' ? 'User' : 'Agent'}: ${turn.content}`)
    .join('\n\n')

  const summaryPrompt = `You are summarizing an agent-user conversation for memory compression.
Create a structured summary covering the key information an AI agent needs to remember for future turns.

Conversation transcript:
${transcript}

Write a structured summary with these exact sections (keep it concise — max 5 sentences total):

[KEY DECISIONS]
Any decisions made, tasks requested, or actions the agent agreed to take.

[REFERENCED DOCUMENTS]
Any specific documents, policies, data, or knowledge base content that was discussed.

[CONTEXT]
Important background facts, user preferences, or constraints established in this conversation.

Be factual. Do not invent information not in the transcript.`

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
        generationConfig: {
          temperature:     0.1,  // Near-deterministic for factual summary
          maxOutputTokens: 300,  // Summary is short by design
        },
      }),
    })

    if (!res.ok) {
      console.warn(`[Borg Memory] Summarization returned ${res.status} — keeping full history`)
      return history.slice(-RECENT_WINDOW)
    }

    const data    = await res.json()
    const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!summary || summary.length < 30) {
      return history.slice(-RECENT_WINDOW)
    }

    console.info(`[Borg Memory] Summarized ${toSummarize.length} turns (${summary.length} chars)`)

    // Inject summary as a system-style user message at position 0
    return [
      {
        role: 'user',
        content: `[CONVERSATION MEMORY — summarized from earlier in this session]\n${summary}`,
      },
      {
        role: 'assistant',
        content: 'Understood. I have the context from our earlier conversation and will use it.',
      },
      ...toKeep,
    ]

  } catch (err) {
    console.warn('[Borg Memory] Summarization failed — keeping recent window:', err.message)
    return history.slice(-RECENT_WINDOW)
  }
}
