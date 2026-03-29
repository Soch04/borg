/**
 * hooks/useAgentInbox.js
 *
 * Subscribes to agent_interactions where recipient_email == currentUser.email.
 *
 * For each new 'pending' interaction:
 *   1. Calls Gemini with a contextual prompt (who asked, what they asked)
 *   2. Posts the reply back to the same Firestore document (postMentionReply)
 *   3. Also writes a bot-response message to the user's personal chat
 *      so they see a notification inline.
 */

import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeToIncomingMentions, markInteractionNotified, sendBotMessage, postMentionReply } from '../firebase/firestore'
import { generateAgentReply } from '../agent/generateReply'

export function useAgentInbox() {
  const { user, agent } = useAuth()
  const processedRef    = useRef(new Set())

  useEffect(() => {
    // Only run when we have a real authenticated user with an email
    if (!user?.email || !user?.uid) return

    const unsubscribe = subscribeToIncomingMentions(user.email, async (interactions) => {
      for (const interaction of interactions) {
        // Skip already-processed or non-pending interactions
        if (processedRef.current.has(interaction.id)) continue
        if (interaction.status !== 'pending')         continue
        if (interaction.feed_notified)                continue

        processedRef.current.add(interaction.id)

        // Fire-and-forget
        handleIncoming(interaction, user, agent).catch(() => {})
      }
    })

    return () => unsubscribe()
  }, [user?.email, user?.uid, agent])
}

// ── Per-interaction handler ───────────────────────────────────────────────────

async function handleIncoming(interaction, user, agent) {
  const myAgentName  = agent?.displayName ?? `${user.displayName}'s Agent`
  const senderName   = interaction.sender_name ?? 'Another agent'
  const messageBody  = interaction.body || interaction.content

  // 1. Secretly try the autonomous confidence loop
  let evaluation = { status: 'escalate', text: '' }
  try {
    evaluation = await generateAgentReply({ interaction, user, agent, mode: 'autonomous' })
  } catch (err) {
    console.warn('[Autonomous Check Failed]', err)
  }

  // 2. Route based on status
  if (evaluation.status === 'confident') {
    // Agent believes it can answer automatically
    await postMentionReply(interaction.id, evaluation.text, myAgentName).catch(console.error)

    // Notify the user it was handled
    const notification = `✅ I autonomously handled a question from **${senderName}** regarding:\n> "${messageBody}"\n\n**My Reply:**\n> "${evaluation.text}"`
    
    await sendBotMessage(user.uid, notification, myAgentName, {
      type: 'interaction-request',
      interactionId: interaction.id,
      senderName: senderName,
      senderEmail: interaction.sender_email,
      messageBody: messageBody,
      actioned: true // No buttons
    }).catch(console.error)

  } else {
    // Agent doesn't know / escalated
    const escalateReason = evaluation.text || 'I need your input to answer this.'
    const notification = `📨 **${senderName}** sent you a message:\n> "${messageBody}"\n\n**Agent Note:** _${escalateReason}_\n\nHow would you like to respond?`
    
    await sendBotMessage(user.uid, notification, myAgentName, {
      type: 'interaction-request',
      interactionId: interaction.id,
      senderName: senderName,
      senderEmail: interaction.sender_email,
      messageBody: messageBody,
      actioned: false // Leaves buttons active
    }).catch(console.error)
  }

  // 3. Mark as notified so we don't duplicate on page reload
  await markInteractionNotified(interaction.id).catch(console.error)
}
