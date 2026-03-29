/**
 * sanitize.js
 * Strips email-style headers from agent-generated B2B content.
 *
 * Handles multi-line AND single-line email preambles:
 *   "To: pstar@rock.org From: X Agent Subject: Y Body..."
 *   "To: Pstar@rock.org\nFrom: Agent\nSubject: ..."
 */

// Patterns that appear at the START of a message — matched and removed
const BLOCK_HEADER_RE = /^(?:\s*(?:To|From|Subject|CC|Date|Re):[^\n]*\n)+/im

// Inline single-line patterns: "To: x@y From: z Subject: q"
const INLINE_HEADER_RE = /(?:To:\s*\S+\s*)?(?:From:\s*[\w\s'@.]+?)?(?:Subject:\s*[^.!?\n]*)(?=\s)/gi

// Standalone prefix words that survive the block strip
const LEFTOVER_RE = /^(?:To|From|Subject|Re|CC|Date):\s*.+?\n/gim

/**
 * Strip email-style headers from a string and trim whitespace.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeAgentOutput(text) {
  if (!text) return text
  let out = text

  // 1. Remove a leading block of header lines (multi-line format)
  out = out.replace(/^(?:\s*(?:To|From|Subject|CC|Date|Re):[^\n]*\n)+/im, '')

  // 2. Remove any surviving standalone header lines
  out = out.replace(/^(?:To|From|Subject|Re|CC|Date):\s*.+?\n/gim, '')

  // 3. Remove single-line concatenated headers that sometimes occur
  out = out.replace(/^To:\s*\S+\s*/i, '')
  out = out.replace(/^From:\s*.*?(?=(Subject:|Body:|\n|$))\s*/i, '')
  out = out.replace(/^Subject:\s*.*?(?=(Body:|\n|$))\s*/i, '')
  
  // 4. Fallback: aggressive sweep for inline headers at the very start
  // This handles the format: "To: email@domain.com From: Name Subject: Topic Text..."
  let changed = true;
  while (changed) {
    changed = false;
    const oldOut = out;
    out = out.replace(/^To:\s*\S+\s*/i, '');
    out = out.replace(/^From:\s*[A-Za-z0-9\s'._-]+? Agent\s*/i, '');
    out = out.replace(/^From:\s*[A-Za-z0-9\s'._-]+\s*/i, ''); // Generic From
    out = out.replace(/^Subject:\s*[^\n.!?:]+\s*/i, '');
    if (out !== oldOut) changed = true;
  }

  // 5. Remove mid-sentence email-header fragments the model sometimes appends
  out = out.replace(/\bTo:\s*\S+@\S+\b/gi, '')
  out = out.replace(/\bFrom:\s*[\w\s']+(?:Agent|Bot)\b/gi, '')

  return out.trim()
}
