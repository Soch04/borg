/**
 * useAgentInbox.js
 *
 * Subscribes to incoming Bot-to-Bot messages addressed to the current user's agent.
 *
 * Decision tree per message:
 *   1. Call Gemini with a CONFIDENCE CHECK prompt
 *   2. HIGH confidence → generate and log an autonomous reply (sanitized)
 *   3. LOW confidence  → trigger Escalation Protocol:
 *        - setEscalation({ convId, incomingMsg, senderAgentName, topic })
 *        - MessagingPage switches to personal tab and injects escalation banner
 *        - When user replies, useMessages relays the answer back to the B2B thread
 */

import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useEscalation } from '../context/EscalationContext'
import { USE_MOCK } from '../context/AppConfig'
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  logBotToBotMessage,
  setConversationActive,
  updateAgentStatus,
  sendBotMessage,
} from '../firebase/firestore'
import { callGemini } from '../agent/gemini'
import { buildSystemPrompt, parseEscalation } from '../agent/buildPrompt'
import { sanitizeAgentOutput } from '../agent/sanitize'

// ── Automatic Reply prompt template ─────────────────────────────────────────
function buildReplyPrompt(myAgentName, senderName, question, agentInstructions) {
  return [
    `You are ${myAgentName}. You received this inter-agent message from ${senderName}:`,
    `"${question}"`,
    ``,
    `Your owner's role and instructions: "${agentInstructions ?? 'No specific instructions provided.'}"`,
    ``,
    `CRITICAL RULES — failure to follow = invalid output:`,
    `• Do NOT write any email headers (no "To:", "From:", "Subject:", "CC:", "Date:")`,
    `• Do NOT use email format at all — write natural conversational language only`,
    `• Do NOT describe what you will do — write the actual content`,
    `• Answer the question directly and completely on behalf of your owner.`,
    `• If you have the answer, you are fully autonomous. Do NOT pause to ask your human owner.`,
    `• If you absolutely do NOT have the required information to answer, output exactly: [ESCALATE: <brief topic>]`,
    `• Keep it under 3 sentences.`,
  ].join('\n')
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useAgentInbox() {
  const { user, agent }   = useAuth()
  const { setEscalation } = useEscalation()
  const processedRef      = useRef(new Set())
  const initialLoadRef    = useRef(true)

  useEffect(() => {
    if (USE_MOCK || !user?.uid || !agent?.displayName) return
    console.log('[AgentInbox] Listening for B2B messages → uid:', user.uid)

    const q = query(
      collection(db, 'messages'),
      where('recipientId', '==', user.uid),
      where('type',        '==', 'bot-to-bot'),
      limit(30),
    )

    const unsubscribe = onSnapshot(
      q,
      async (snap) => {
        if (initialLoadRef.current) {
          snap.docs.forEach(d => processedRef.current.add(d.id))
          initialLoadRef.current = false
          console.log('[AgentInbox] Seeded', snap.docs.length, 'existing messages')
          return
        }

        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue
          const msg = { id: change.doc.id, ...change.doc.data() }

          if (processedRef.current.has(msg.id)) continue
          if (msg.senderId === user.uid)         continue
          if (!msg.convId)                       continue

          processedRef.current.add(msg.id)
          console.log('[AgentInbox] Incoming B2B from', msg.senderName)

          handleIncoming({ user, agent, incomingMsg: msg, setEscalation }).catch(err =>
            console.error('[AgentInbox] handleIncoming failed:', err.message)
          )
        }
      },
      err => console.error('[AgentInbox] Listener error:', err.code, err.message)
    )

    return () => unsubscribe()
  }, [user?.uid, agent?.displayName, setEscalation])
}

// ── Decision tree ─────────────────────────────────────────────────────────────

async function handleIncoming({ user, agent, incomingMsg, setEscalation }) {
  const myAgentName = agent.displayName
  const senderName  = sanitizeAgentOutput(incomingMsg.senderName ?? 'Unknown Agent')
  const msgContent  = sanitizeAgentOutput(incomingMsg.content ?? '')

  await updateAgentStatus(user.uid, 'in-conversation').catch(() => {})
  await setConversationActive(incomingMsg.convId, true).catch(() => {})

  // ── Step 1: Generate Automatic Reply ──────────────────────────────────────
  let replyResponse
  try {
    replyResponse = await callGemini({
      systemPrompt: buildSystemPrompt(user, agent),
      userMessage:  buildReplyPrompt(
        myAgentName,
        senderName,
        msgContent,
        agent.systemInstructions,
      ),
      history: [],
    })
  } catch (err) {
    console.error('[AgentInbox] Reply generation failed:', err.message)
    replyResponse = `I received your message but encountered a system error while processing it. — ${myAgentName}`
  }

  const rawReply = replyResponse.trim()
  const { isEscalation, topic } = parseEscalation(rawReply)

  if (isEscalation) {
    console.log(`[AgentInbox] Escalation triggered for topic: ${topic} ✅`)
    
    // 1. Send wait message to Sender Agent
    const waitMessage = `I don't have this information right now. I've asked my owner, ${user.displayName}, and will get back to you shortly. — ${myAgentName}`
    await logBotToBotMessage(
      user.uid,
      incomingMsg.senderId,
      myAgentName,
      senderName,
      waitMessage,
      agent.department ?? 'General',
      incomingMsg.convId,
    )

    // 2. Trigger UI banner
    setEscalation({
      convId: incomingMsg.convId,
      incomingMsg,
      senderAgentName: senderName,
      topic: topic || deriveTopic(msgContent),
    })

    // 3. Notify owner in personal chat
    const escalationNotice = `📨 **${senderName}** asked me about "${msgContent}". I didn't have the answer, so I paused to ask you. Please type your reply here and I will forward it to them!`
    await sendBotMessage(
      user.uid,
      escalationNotice,
      myAgentName,
    ).catch(err => console.warn('[AgentInbox] Escalation notification failed:', err.message))

    await updateAgentStatus(user.uid, 'active').catch(() => {})
    setTimeout(() => setConversationActive(incomingMsg.convId, false).catch(() => {}), 4000)
    return
  }

  const replyContent = sanitizeAgentOutput(rawReply) ||
    `Thank you for reaching out. I'll follow up shortly. — ${myAgentName}`

  console.log('[AgentInbox] Autonomous reply generated ✅')

  // ── Step 2: Send Autonomous reply ─────────────────────────────────────────
  await logBotToBotMessage(
    user.uid,
    incomingMsg.senderId,
    myAgentName,
    senderName,
    replyContent,
    agent.department ?? 'General',
    incomingMsg.convId,
  )

  // ── Notify the user in their personal chat ────────────────────────────
  // Always inform the user what their agent received and what it did.
  const userNotification = await callGemini({
    systemPrompt: buildSystemPrompt(user, agent),
    userMessage:  [
      `You just received and automatically replied to an inter-agent message.`,
      `The message from ${senderName} was:`,
      `"${msgContent}"`,
      ``,
      `Your reply was:`,
      `"${replyContent}"`,
      ``,
      `Write a SHORT (2-3 sentence) natural language notification for ${user.displayName} summarising:`,
      `1. What ${senderName} told you`,
      `2. Any important information or action the user needs to know about`,
      `3. What you replied`,
      ``,
      `Write directly to ${user.displayName}. Be specific about the actual content.`,
      `CRITICAL: If the message mentions anything being misplaced, missing, or someone needs information — make sure to include that clearly.`,
      `Do NOT use email headers. Write in plain, friendly language.`,
    ].join('\n'),
    history: [],
  }).catch(() =>
    `📨 I received a message from ${senderName} in the Agent Hub: "${msgContent.slice(0, 120)}${msgContent.length > 120 ? '…' : ''}". I replied on your behalf.`
  )

  await sendBotMessage(
    user.uid,
    sanitizeAgentOutput(userNotification),
    myAgentName,
  ).catch(err => console.warn('[AgentInbox] Personal notification failed:', err.message))

  console.log('[AgentInbox] Autonomous reply + user notification sent ✅')

  await updateAgentStatus(user.uid, 'active').catch(() => {})
  setTimeout(() => setConversationActive(incomingMsg.convId, false).catch(() => {}), 4000)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveTopic(text) {
  if (!text) return 'the request'
  const t = text.toLowerCase()
  if (t.includes('ai use') || t.includes('ai policy'))   return 'AI Use Policy'
  if (t.includes('misplac') || t.includes('missing'))    return 'Misplaced Document'
  if (t.includes('schedule') || t.includes('meeting'))   return 'Scheduling'
  if (t.includes('budget') || t.includes('cost'))        return 'Budget'
  if (t.includes('policy') || t.includes('compliance'))  return 'Compliance Policy'
  if (t.includes('report') || t.includes('data'))        return 'Data Request'
  const words = text.split(/\s+/).slice(0, 6).join(' ')
  return words.length > 3 ? `"${words}…"` : 'the request'
}
