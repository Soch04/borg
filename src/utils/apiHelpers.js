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

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
//
// PROBLEM:
//   When the Gemini API is degraded, every in-flight request piles up and waits
//   for a timeout. Under sustained failure, this creates a cascade: the client
//   fires dozens of retries, exhausts its quota faster, and makes recovery slower.
//
// SOLUTION — three-state circuit breaker:
//   CLOSED  → normal operation, failures are counted
//   OPEN    → fast-fail all calls immediately, no network round-trip
//   HALF_OPEN → test probe: one call allowed through; if it succeeds, reset to
//               CLOSED; if it fails, reset OPEN timer and stay OPEN
//
// USAGE:
//   const circuit = getCircuit('gemini')
//   const result  = await circuit.call(() => callGemini(prompt, history))
//
//   if (circuit.isOpen()) {
//     // Show degraded-mode UI before attempting the call
//   }
//
// DESIGN:
//   Circuits are keyed by name and stored as module-level singletons so that
//   every import site shares the same state — a burst of failures in gemini.js
//   will trip the circuit for ragReranker.js immediately without additional
//   coordination. The registry is intentionally not exported to prevent external
//   mutation; use getCircuit(name) as the only factory.
//
/**
 * @typedef {'CLOSED' | 'OPEN' | 'HALF_OPEN'} CircuitState
 */

/**
 * @typedef {Object} CircuitBreakerOptions
 * @property {number} [failureThreshold=3]  - Consecutive failures before tripping open
 * @property {number} [successThreshold=1]  - Consecutive successes in HALF_OPEN before closing
 * @property {number} [timeoutMs=30000]     - Time OPEN before allowing a probe (ms)
 * @property {string} [name='default']      - Circuit name for logging
 */

export class CircuitBreaker {
  /**
   * @param {CircuitBreakerOptions} [opts]
   */
  constructor(opts = {}) {
    this.name             = opts.name             ?? 'default'
    this.failureThreshold = opts.failureThreshold ?? 3
    this.successThreshold = opts.successThreshold ?? 1
    this.timeoutMs        = opts.timeoutMs        ?? 30_000

    /** @type {CircuitState} */
    this._state           = 'CLOSED'
    this._failures        = 0
    this._successes       = 0
    this._lastFailureTime = null
  }

  /** @returns {CircuitState} */
  get state() {
    // Automatically transition OPEN → HALF_OPEN if the timeout has elapsed
    if (
      this._state === 'OPEN' &&
      this._lastFailureTime !== null &&
      Date.now() - this._lastFailureTime >= this.timeoutMs
    ) {
      this._state    = 'HALF_OPEN'
      this._failures = 0
      console.log(`[Borg Circuit:${this.name}] OPEN → HALF_OPEN — probe allowed`)
    }
    return this._state
  }

  /** @returns {boolean} True if the circuit is OPEN (fast-fail mode) */
  isOpen() {
    return this.state === 'OPEN'
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws immediately if the circuit is OPEN.
   * Records the outcome and adjusts circuit state accordingly.
   *
   * @template T
   * @param {() => Promise<T>} fn - The async call to protect
   * @returns {Promise<T>}
   * @throws {Error} FastFailError if circuit is OPEN, or the original error if the call fails
   */
  async call(fn) {
    const currentState = this.state

    if (currentState === 'OPEN') {
      const ms = Math.max(0, this.timeoutMs - (Date.now() - this._lastFailureTime))
      throw new Error(
        `[Borg Circuit:${this.name}] OPEN — fast-failing. Retry in ${Math.ceil(ms / 1000)}s`
      )
    }

    try {
      const result = await fn()
      this._onSuccess()
      return result
    } catch (err) {
      this._onFailure(err)
      throw err
    }
  }

  /** Record a successful call */
  _onSuccess() {
    this._failures = 0
    if (this._state === 'HALF_OPEN') {
      this._successes++
      if (this._successes >= this.successThreshold) {
        this._state    = 'CLOSED'
        this._successes = 0
        console.log(`[Borg Circuit:${this.name}] HALF_OPEN → CLOSED — recovered`)
      }
    }
  }

  /** Record a failed call and potentially trip the circuit */
  _onFailure(err) {
    this._failures++
    this._lastFailureTime = Date.now()
    this._successes       = 0

    if (this._state === 'HALF_OPEN' || this._failures >= this.failureThreshold) {
      this._state = 'OPEN'
      console.warn(
        `[Borg Circuit:${this.name}] TRIPPED OPEN after ${this._failures} failures. ` +
        `Last error: ${err?.message ?? err}`
      )
    }
  }

  /**
   * Manually reset the circuit to CLOSED state.
   * Use after a confirmed infrastructure recovery.
   */
  reset() {
    this._state           = 'CLOSED'
    this._failures        = 0
    this._successes       = 0
    this._lastFailureTime = null
    console.log(`[Borg Circuit:${this.name}] Manual reset → CLOSED`)
  }

  /** @returns {{ state: CircuitState, failures: number, lastFailureTime: number|null }} */
  getStatus() {
    return {
      state:           this.state,
      failures:        this._failures,
      lastFailureTime: this._lastFailureTime,
    }
  }
}

/** Module-level circuit registry — shared across all import sites */
const _circuits = new Map()

/**
 * Get or create a named circuit breaker.
 * Circuits are singletons: the same name always returns the same instance.
 *
 * @param {string} name
 * @param {CircuitBreakerOptions} [opts] - Only applied on first creation
 * @returns {CircuitBreaker}
 */
export function getCircuit(name, opts = {}) {
  if (!_circuits.has(name)) {
    _circuits.set(name, new CircuitBreaker({ name, ...opts }))
  }
  return _circuits.get(name)
}

/**
 * Pre-configured circuits for the two external services Borg depends on.
 * Import these instead of calling getCircuit() for guaranteed consistent config.
 *
 * geminiCircuit  — trips after 3 consecutive Gemini API failures, resets after 30s
 * pineconeCircuit — trips after 3 consecutive Pinecone failures, resets after 45s
 */
export const geminiCircuit  = getCircuit('gemini',  { failureThreshold: 3, timeoutMs: 30_000 })
export const pineconeCircuit = getCircuit('pinecone', { failureThreshold: 3, timeoutMs: 45_000 })
