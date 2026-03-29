/**
 * buildPrompt.js
 * Assembles the system prompt for the Gemini API call.
 *
 * The system prompt IS the agent's identity — it grounds every
 * response in the user's real profile, instructions, and context.
 */

/**
 * Build the system prompt from the user + agent profile.
 * This is prepended to every Gemini call.
 *
 * @param {object} user  — Firestore users/{uid} document
 * @param {object} agent — Firestore agents/{uid} document
 * @param {string} kbContext — knowledge base results (optional)
 */
export function buildSystemPrompt(user, agent, kbContext = '', directory = []) {
  const name  = user?.displayName ?? 'the user'
  const dept  = user?.department  ?? 'their department'
  const title = user?.title       ?? ''
  const instructions = agent?.systemInstructions ?? ''

  const knowledgeBlock = kbContext
    ? `\nKNOWLEDGE BASE CONTEXT (use only this, do not invent facts):\n${kbContext}`
    : ''

  const directoryBlock = directory.length > 0
    ? `\nORGANIZATION DIRECTORY:\n${directory.map(d => `- ${d.displayName} (${d.department}): ${d.email}`).join('\n')}`
    : ''

  return `You are the dedicated AI proxy for ${name}${title ? `, ${title}` : ''}, a member of the ${dept} department.

You do not act as a generic AI assistant. You act specifically as ${name}'s personal agent.

PERSONA & INSTRUCTIONS:
${instructions}

CORE RULES:
1. Respond as ${name}'s agent — use first person as the agent ("I'll handle that for you", "I've queried...").
2. Ground every response in the user's context and the knowledge provided below. Do not invent facts.
3. If you cannot find a confident answer in the provided context, output exactly: [ESCALATE: <brief topic>]
   Do not guess. Do not fill gaps with plausible-sounding information.
4. Never share ${name}'s personal information with other agents unless explicitly instructed.
5. If the user asks you to contact a colleague or send a message, output exactly this syntax: [MESSAGE_AGENT: recipient_email@domain.com] <your message to the agent>
   Keep the internal message concise. Do not output anything else if you send a message.
6. Be concise and direct. Match the communication style set in the instructions above.
${directoryBlock}
${knowledgeBlock}`.trim()
}

/**
 * Build the internal monologue prompt — appended when a task is complex.
 * The model reasons through multiple lenses before giving a final answer.
 */
export function buildMonologuePrompt() {
  return `
Before giving your final answer, reason through this request step by step:

[STRATEGIC VIEW]
What is the user's underlying goal? What risks, constraints, or missing information exist?

[EXECUTION VIEW]
What are the concrete next steps? What resources, people, or agents need to be involved?

[FINAL ANSWER]
Based on the above reasoning, provide your concise, actionable response to the user.

Always include all three sections with the exact labels above.`
}

/**
 * Determine whether a request is complex enough to warrant monologue.
 * Simple queries (greetings, single-fact lookups) skip it for speed.
 */
export function isComplexRequest(userInput) {
  const lower = userInput.toLowerCase()
  const words = userInput.trim().split(/\s+/).length

  const complexKeywords = [
    'plan', 'strategy', 'coordinate', 'compare', 'evaluate',
    'all departments', 'propose', 'analyze', 'should i', 'help me decide',
    'what do you think', 'pros and cons', 'trade-off', 'recommend'
  ]

  const hasComplexKeyword = complexKeywords.some(k => lower.includes(k))
  return words > 25 || hasComplexKeyword
}

/**
 * Parse the [ESCALATE: topic] token from a Gemini response.
 * Returns { isEscalation: bool, topic: string|null, cleanText: string }
 */
export function parseEscalation(text) {
  const match = text.match(/\[ESCALATE:\s*([^\]]+)\]/i)
  if (match) {
    return { isEscalation: true, topic: match[1].trim(), cleanText: '' }
  }
  return { isEscalation: false, topic: null, cleanText: text }
}

/**
 * Parse the monologue sections from a Gemini response that used monologue prompt.
 * Returns { strategic, execution, finalAnswer, rawText }
 */
export function parseMonologue(text) {
  const strategicMatch = text.match(/\[STRATEGIC VIEW\]([\s\S]*?)(?=\[EXECUTION VIEW\]|\[FINAL ANSWER\]|$)/i)
  const executionMatch  = text.match(/\[EXECUTION VIEW\]([\s\S]*?)(?=\[FINAL ANSWER\]|$)/i)
  const finalMatch      = text.match(/\[FINAL ANSWER\]([\s\S]*?)$/i)

  return {
    strategic:   strategicMatch?.[1]?.trim() ?? null,
    execution:   executionMatch?.[1]?.trim()  ?? null,
    finalAnswer: finalMatch?.[1]?.trim()      ?? text,
    rawText:     text,
  }
}

/**
 * Parse the [MESSAGE_AGENT: email] token from a Gemini response.
 * Returns { isMessageRequest: bool, targetEmail: string|null, messageBody: string }
 */
export function parseMessageAgentCommand(text) {
  const match = text.match(/\[MESSAGE_AGENT:\s*([^\]\s]+)\]([\s\S]*)/i)
  if (match) {
    return {
      isMessageRequest: true,
      targetEmail: match[1].trim(),
      messageBody: match[2].trim()
    }
  }
  return { isMessageRequest: false, targetEmail: null, messageBody: null }
}
