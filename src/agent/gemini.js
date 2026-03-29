/**
 * gemini.js
 * Wrapper around the Google Gemini REST API (v1beta generateContent endpoint).
 *
 * Why REST vs SDK: The @google/generative-ai npm SDK does not support browser
 * environments cleanly with Vite — the REST endpoint works without Node.js shims.
 *
 * Exports:
 *  - callGemini()       — standard request/response (used by autonomous inbox, reranker)
 *  - streamGemini()     — Server-Sent Events streaming (used by interactive chat)
 *
 * Both share the same request body builder and exponential backoff logic.
 * An apiHelpers.geminiCircuit (CLOSED/OPEN/HALF_OPEN) wraps all fetch calls:
 * after 3 consecutive failures the circuit trips OPEN, causing fast-fail for
 * 30s before a probe is allowed through — preventing quota cascade under degradation.
 *
 * STREAMING IMPLEMENTATION:
 * Gemini's streamGenerateContent endpoint returns an SSE stream where each event
 * is a newline-delimited JSON object containing a partial response candidate.
 * The stream is consumed via the Web Streams API (ReadableStream + ReadableStreamDefaultReader),
 * which is native in modern browsers and does not require any polyfills.
 *
 * SSE PROTOCOL:
 *   Each chunk from the server starts with "data: " followed by a JSON object.
 *   A chunk may contain multiple lines. The final message ends with "data: [DONE]"
 *   (not always present — end of stream is detected by ReadableStream done=true).
 *
 * onChunk CALLBACK:
 *   Called on every parsed text token with (accumulatedText, newToken).
 *   This drives the progressive UI update in useMessages.js.
 */

import { GEMINI_API_KEY, GEMINI_MODEL } from '../context/AppConfig'
import { isRetryableStatus, geminiCircuit } from '../utils/apiHelpers'

const GEMINI_ENDPOINT        = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const GEMINI_STREAM_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`

/**
 * Exponential backoff delay: 1s → 2s → 4s (with ±10% jitter to avoid thundering herd).
 * @param {number} attempt - 0-indexed attempt number
 * @returns {Promise<void>}
 */
function backoffDelay(attempt) {
  const baseMs  = 1000 * Math.pow(2, attempt)
  const jitter  = baseMs * 0.1 * (Math.random() * 2 - 1)
  return new Promise(resolve => setTimeout(resolve, baseMs + jitter))
}

/**
 * Build the standard Gemini request body — shared by both callGemini and streamGemini.
 *
 * @param {string}   systemPrompt
 * @param {string}   userMessage
 * @param {Array}    history
 * @param {number}   temperature
 * @param {number}   maxTokens
 * @returns {Object} Request body
 */
function buildRequestBody(systemPrompt, userMessage, history, temperature, maxTokens) {
  const contents = [
    ...history.map(turn => ({
      role:  turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.content }],
    })),
    {
      role:  'user',
      parts: [{ text: userMessage }],
    },
  ]

  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }
}

/**
 * Call Gemini (non-streaming) with exponential backoff retry.
 * Used by the autonomous agent inbox and pipeline utility calls.
 *
 * @param {string}   systemPrompt  — built by buildSystemPrompt()
 * @param {string}   userMessage   — the user's current message
 * @param {Array}    history       — prior turns: [{ role: 'user'|'assistant', content: string }]
 * @param {number}   [temperature] — sampling temperature (default 0.3)
 * @param {number}   [maxTokens]   — max output tokens (default 1024)
 * @returns {Promise<string>}
 */
export async function callGemini({
  systemPrompt,
  userMessage,
  history      = [],
  temperature  = 0.3,
  maxTokens    = 1024,
}) {
  if (!GEMINI_API_KEY) throw new Error('VITE_GEMINI_API_KEY is not set in .env')

  // Fast-fail immediately if the circuit is OPEN — avoids piling up requests
  // during a Gemini degradation event and exhausting quota on doomed retries.
  if (geminiCircuit.isOpen()) {
    const { failures, lastFailureTime } = geminiCircuit.getStatus()
    const waitSec = Math.ceil((30_000 - (Date.now() - lastFailureTime)) / 1000)
    throw new Error(`[Borg] Gemini circuit OPEN (${failures} failures). Auto-retry in ~${Math.max(0, waitSec)}s`)
  }

  const body        = buildRequestBody(systemPrompt, userMessage, history, temperature, maxTokens)
  const MAX_ATTEMPTS = 3
  let lastError

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await backoffDelay(attempt - 1)

    try {
      const res = await geminiCircuit.call(() =>
        fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        })
      )

      if (res.ok) {
        const data = await res.json()
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text

        if (!text) {
          const finishReason = data?.candidates?.[0]?.finishReason
          if (finishReason === 'SAFETY') throw new Error('Gemini blocked the response due to safety filters.')
          throw new Error('Gemini returned an empty response — no text candidate produced.')
        }

        return text
      }

      const errBody = await res.json().catch(() => ({}))
      const errMsg  = errBody?.error?.message ?? res.statusText
      lastError = new Error(`Gemini API error ${res.status}: ${errMsg}`)

      if (!isRetryableStatus(res.status)) throw lastError

      console.warn(`[Borg] Gemini ${res.status} on attempt ${attempt + 1}/${MAX_ATTEMPTS} — retrying...`)
    } catch (err) {
      // If the circuit just tripped OPEN (fast-fail error), re-throw immediately
      if (err.message?.includes('OPEN')) throw err
      lastError = err
      if (attempt + 1 >= MAX_ATTEMPTS) throw lastError
    }
  }

  throw lastError
}

/**
 * Call Gemini with Server-Sent Events streaming.
 * Used by the interactive chat path (useMessages.js) for real-time token display.
 *
 * Tokens are delivered progressively via the onChunk callback, allowing the UI to
 * render each new word/phrase as it arrives without waiting for the full response.
 *
 * GRACEFUL FALLBACK: If the browser doesn't support ReadableStream or the SSE
 * stream fails, falls back to callGemini() automatically to ensure the message
 * always delivers.
 *
 * @param {Object}   opts
 * @param {string}   opts.systemPrompt
 * @param {string}   opts.userMessage
 * @param {Array}    opts.history
 * @param {number}   [opts.temperature]
 * @param {number}   [opts.maxTokens]
 * @param {Function} opts.onChunk  — called with (accumulatedText, newToken) on each token
 * @returns {Promise<string>}       — final complete response text
 */
export async function streamGemini({
  systemPrompt,
  userMessage,
  history     = [],
  temperature = 0.3,
  maxTokens   = 1024,
  onChunk,
}) {
  if (!GEMINI_API_KEY) throw new Error('VITE_GEMINI_API_KEY is not set in .env')

  // Graceful fallback if ReadableStream is not supported
  if (typeof ReadableStream === 'undefined') {
    console.warn('[Borg] ReadableStream not available — falling back to non-streaming')
    const text = await callGemini({ systemPrompt, userMessage, history, temperature, maxTokens })
    onChunk?.(text, text)
    return text
  }

  const body = buildRequestBody(systemPrompt, userMessage, history, temperature, maxTokens)

  let res
  try {
    res = await fetch(`${GEMINI_STREAM_ENDPOINT}?key=${GEMINI_API_KEY}&alt=sse`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
  } catch (fetchErr) {
    console.warn('[Borg] Stream fetch failed — falling back to non-streaming:', fetchErr.message)
    const text = await callGemini({ systemPrompt, userMessage, history, temperature, maxTokens })
    onChunk?.(text, text)
    return text
  }

  if (!res.ok) {
    // On stream error, fall back to non-streaming with retry
    console.warn(`[Borg] Stream returned ${res.status} — falling back to non-streaming`)
    const text = await callGemini({ systemPrompt, userMessage, history, temperature, maxTokens })
    onChunk?.(text, text)
    return text
  }

  // Read the SSE stream
  const reader  = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let accumulated = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })

      // Each SSE chunk may contain multiple "data: {...}" lines
      const lines = chunk
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('data:') && l !== 'data: [DONE]')

      for (const line of lines) {
        const jsonStr = line.slice(5).trim()  // Remove "data:" prefix
        if (!jsonStr) continue

        try {
          const parsed  = JSON.parse(jsonStr)
          const token   = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

          if (token) {
            accumulated += token
            onChunk?.(accumulated, token)
          }

          // Detect SAFETY finish reason mid-stream
          const finishReason = parsed?.candidates?.[0]?.finishReason
          if (finishReason === 'SAFETY') {
            throw new Error('Gemini blocked the response due to safety filters.')
          }
        } catch (parseErr) {
          // Skip malformed SSE chunks — partial JSON can occur at chunk boundaries
          if (parseErr.message.includes('safety')) throw parseErr
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!accumulated) {
    throw new Error('Gemini stream completed with no text output.')
  }

  return accumulated
}
