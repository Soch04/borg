/**
 * utils/parseMentions.js
 *
 * Utilities for detecting and extracting @email mentions from message text.
 *
 * Supported format:  @user@domain.tld
 * Multiple mentions in one message are all extracted.
 */

// Matches @word@domain.tld — the leading @ is the trigger,
// the rest is a standard email address.
const MENTION_REGEX = /@([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g

/**
 * Extract all @email mentions from a message string.
 * Returns an array of lowercased email strings (unique).
 *
 * @param {string} text
 * @returns {string[]}  e.g. ['ssquare@rocks.org']
 */
export function extractMentionedEmails(text) {
  const matches = [...text.matchAll(MENTION_REGEX)]
  const emails  = matches.map(m => m[1].toLowerCase())
  return [...new Set(emails)]
}

/**
 * Strip all @email mentions from the message body so the
 * clean text can be sent as the interaction content.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripMentions(text) {
  return text.replace(MENTION_REGEX, '').replace(/\s{2,}/g, ' ').trim()
}

/**
 * Check if a message contains at least one @email mention.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasMention(text) {
  MENTION_REGEX.lastIndex = 0   // reset stateful regex
  return MENTION_REGEX.test(text)
}
