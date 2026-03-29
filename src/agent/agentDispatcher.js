/**
 * agentDispatcher.js
 * Handles inter-agent (Bot-to-Bot) message dispatch.
 *
 * Flow:
 *  1. Sender's agent generates an outgoing message via Gemini
 *  2. Upsert a conversation thread in Firestore
 *  3. Log the message to `messages` with type:'bot-to-bot'
 *  4. Update the sender agent's status to 'in-conversation'
 */

import { callGemini } from './gemini'
import { buildSystemPrompt } from './buildPrompt'
import {
  upsertConversation,
  logBotToBotMessage,
  updateAgentStatus,
  setConversationActive,
} from '../firebase/firestore'

/**
 * Dispatch agent-to-agent messages for each @mention.
 *
 * @param {object} params
 * @param {object} params.user        — sender's Firestore user doc
 * @param {object} params.agent       — sender's Firestore agent doc
 * @param {string} params.userMessage — the original user message text
 * @param {Array}  params.mentions    — [{ uid, displayName, email, department }]
 */
export async function dispatchAgentMessages({ user, agent, userMessage, mentions }) {
  if (!mentions?.length) return
  console.log('[Dispatcher] Starting B2B dispatch for', mentions.length, 'mention(s)')

  const systemPrompt = buildSystemPrompt(user, agent, '', mentions)

  // Use Promise.all so any failure bubbles up to the caller
  await Promise.all(
    mentions.map(target => dispatchSingle({ user, agent, systemPrompt, userMessage, target }))
  )

  // Set sender agent status to 'in-conversation'
  try {
    await updateAgentStatus(user.uid, 'in-conversation')
    console.log('[Dispatcher] Agent status set to in-conversation')
    setTimeout(() => updateAgentStatus(user.uid, 'active').catch(() => {}), 30000)
  } catch (e) {
    console.warn('[Dispatcher] Could not update agent status:', e.message)
  }
}

async function dispatchSingle({ user, agent, systemPrompt, userMessage, target }) {
  const senderAgentName = agent?.displayName ?? `${user.displayName}'s Agent`
  const targetAgentName = `${target.displayName}'s Agent`
  console.log(`[Dispatcher] Dispatching: ${senderAgentName} → ${targetAgentName} (uid:${target.uid})`)

  // 1. Generate the actual outgoing B2B message
  let outgoingContent
  try {
    outgoingContent = await callGemini({
      systemPrompt,
      userMessage: [
        `You are ${senderAgentName}. Write the ACTUAL agent-to-agent message you are sending RIGHT NOW to ${targetAgentName}.`,
        `Topic: "${userMessage}"`,
        `Write the message directly — addressed to ${targetAgentName}, signed as ${senderAgentName}.`,
        `CRITICAL RULES — Failure to follow will cause system errors:`,
        `• Do NOT use any email formatting or email headers (no "To:", "From:", "Subject:").`,
        `• Do NOT ask your human owner for input. You are fully autonomous.`,
        `• Do NOT describe what you will do. Just write the message itself.`,
        `• Keep it conversational and under 3 sentences.`,
      ].join('\n'),
      history: [],
    })
    console.log('[Dispatcher] B2B message generated, length:', outgoingContent.length)
  } catch (err) {
    console.error('[Dispatcher] Gemini call failed, using fallback:', err.message)
    outgoingContent = `Hello ${targetAgentName}, I am contacting you on behalf of ${user.displayName} regarding: "${userMessage}". Please share any relevant information your agent has on this topic. — ${senderAgentName}`
  }

  // 2. Upsert the conversation thread
  // Use new Date() (not serverTimestamp()) so the timestamp resolves immediately in local cache
  console.log('[Dispatcher] Upserting conversation:', [user.uid, target.uid].sort().join('__'))
  const convId = await upsertConversation({
    participantIds:   [user.uid, target.uid],
    participantNames: [senderAgentName, targetAgentName],
    initiatorId:      user.uid,
    contextType:      deriveContext(userMessage),
    department:       target.department || agent?.department || 'General',
    lastMessage:      outgoingContent.slice(0, 120) + (outgoingContent.length > 120 ? '…' : ''),
    lastActivity:     new Date(),
    isActive:         true,
  })
  console.log('[Dispatcher] Conversation upserted, convId:', convId)

  // 3. Log the B2B message
  await logBotToBotMessage(
    user.uid, target.uid,
    senderAgentName, targetAgentName,
    outgoingContent,
    target.department || 'General',
    convId,
  )
  console.log('[Dispatcher] B2B message logged ✅')

  // 4. Reset isActive after 4s (stops the "processing..." indicator)
  setTimeout(() => setConversationActive(convId, false).catch(() => {}), 4000)

  return { convId, content: outgoingContent }
}

/** Infer context type from message keywords */
function deriveContext(text) {
  const t = text.toLowerCase()
  if (t.includes('schedule') || t.includes('meeting') || t.includes('calendar')) return 'Scheduling'
  if (t.includes('policy') || t.includes('compliance') || t.includes('legal'))   return 'Compliance'
  if (t.includes('report') || t.includes('data') || t.includes('analysis'))      return 'Data Request'
  if (t.includes('review') || t.includes('feedback') || t.includes('approve'))   return 'Review'
  if (t.includes('budget') || t.includes('cost') || t.includes('spend'))         return 'Finance'
  return 'General Coordination'
}
