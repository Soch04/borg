/**
 * @module apiHelpers
 * @description Shared utilities for API error classification, retry logic, and
 * response validation. Centralizes patterns that were previously duplicated across
 * gemini.js, ragReranker.js, conversationMemory.js, and hyde.js.
 *
 * @exports isRetryableError    - Classify HTTP status as retryable vs non-retryable
 * @exports isQuotaError        - Detect Gemini API quota exhaustion
 * @exports withTimeout         - Wrap a promise with a configurable timeout
 * @exports safeJsonParse       - Parse JSON without throwing, returning null on failure
 * @exports buildFetchOptions   - Build standard fetch options for Gemini REST calls
 * @exports classifyApiError    - Return a structured error classification object
 */

/** HTTP status codes that indicate transient infrastructure issues — safe to retry */
export const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

/** HTTP status codes that indicate permanent client/auth errors — do not retry */
export const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422])

/**
 * Classify an HTTP status code as retryable or not.
 *
 * @param {number} status - HTTP response status code
 * @returns {boolean}
 */
export function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(status)
}

/**
 * Detect Gemini API quota exhaustion from an error message.
 * Handles both 429 errors and the "quota" keyword in error messages.
 *
 * @param {string|Error} errOrMessage
 * @returns {boolean}
 */
export function isQuotaError(errOrMessage) {
  const msg = typeof errOrMessage === 'string'
    ? errOrMessage
    : errOrMessage?.message ?? ''
  return msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')
}

/**
 * Classify an API error into a structured result for error handling branches.
 *
 * @param {Error} err
 * @returns {{ isQuota: boolean, isNetwork: boolean, isAuth: boolean, isUnknown: boolean, message: string }}
 */
export function classifyApiError(err) {
  const message = err?.message ?? 'Unknown error'
  return {
    isQuota:   isQuotaError(message),
    isNetwork: message.includes('Failed to fetch') || message.includes('NetworkError'),
    isAuth:    message.includes('401') || message.includes('403') || message.toLowerCase().includes('unauthorized'),
    isUnknown: !isQuotaError(message) && !message.includes('fetch') && !message.includes('401'),
    message,
  }
}

/**
 * Wrap a promise with a configurable timeout.
 * Rejects with a TimeoutError if the promise doesn't resolve within timeoutMs.
 *
 * @param {Promise<any>} promise
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [label]   - Optional label for error message
 * @returns {Promise<any>}
 */
export function withTimeout(promise, timeoutMs, label = 'operation') {
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`[Borg] ${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  )
  return Promise.race([promise, timeout])
}

/**
 * Safely parse JSON without throwing.
 *
 * @param {string} text
 * @returns {any | null} Parsed value, or null if parsing fails
 */
export function safeJsonParse(text) {
  try {
    // Extract first JSON object or array from text (handles markdown-wrapped JSON)
    const match = text?.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    return match ? JSON.parse(match[0]) : null
  } catch {
    return null
  }
}

/**
 * Build standard fetch options for Gemini REST API calls.
 *
 * @param {Object} body - Request body object (will be JSON-stringified)
 * @returns {RequestInit}
 */
export function buildGeminiFetchOptions(body) {
  return {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }
}

/**
 * Format a Firestore error for user-facing display.
 * Strips internal Firebase error codes and returns a clean message.
 *
 * @param {Error} err - Firebase error
 * @returns {string} User-facing error message
 */
export function formatFirestoreError(err) {
  const code = err?.code ?? ''
  const msgs = {
    'permission-denied':    'You do not have permission to perform this action.',
    'not-found':            'The requested document was not found.',
    'already-exists':       'This item already exists.',
    'resource-exhausted':   'Too many requests. Please try again in a moment.',
    'unauthenticated':      'You must be signed in to perform this action.',
    'unavailable':          'Service temporarily unavailable. Please try again.',
  }
  return msgs[code] ?? err?.message ?? 'An unexpected error occurred.'
}
