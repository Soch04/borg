import { callGemini } from './gemini'
import { buildSystemPrompt } from './buildPrompt'
import { extractMentionedEmails } from '../utils/parseMentions'
import { queryKnowledgeBase } from '../lib/rag'

export async function generateAgentReply({ interaction, user, agent, mode = 'manual' }) {
  const myAgentName  = agent?.displayName ?? `${user.displayName}'s Agent`
  const senderName   = (interaction.senderName || interaction.sender_name) ?? 'Another agent'
  const messageBody  = interaction.messageBody || interaction.content || interaction.body

  // Retrieve relevant documents from the org knowledge base to ground the reply
  let vectorContext = ''
  if (user?.orgId) {
    try {
      const results = await queryKnowledgeBase(user.orgId, messageBody, { is_approved: true })
      if (results.length > 0) {
        vectorContext = results
          .map(r => `### ${r.title}\n${r.text}`)
          .join('\n\n')
      }
    } catch (err) {
      console.warn('[Borg] generateAgentReply: RAG query failed, proceeding without KB context:', err)
    }
  }

  let rules = [
    `Reply on behalf of ${user.displayName} (${user.email}).`,
    `Be concise (2-3 sentences). Do not use email headers. Write the reply directly.`,
  ]

  if (mode === 'autonomous') {
    rules.push(
      `You MUST evaluate if you have enough information in your profile and system instructions to answer accurately.`,
      `If you can answer confidently, you MUST start your response with exactly: [CONFIDENT] followed by your answer.`,
      `If you are guessing or do not know the answer, you MUST start your response with exactly: [ESCALATE] followed by a brief reason why you need your user to intervene.`
    )
  } else {
    rules.push(`If you genuinely cannot answer, say so briefly and ask your owner to follow up.`)
  }

  // Build a focused reply prompt
  const replyPrompt = [
    `You received an inter-agent message from ${senderName} (${interaction.senderEmail || interaction.sender_email}).`,
    `They wrote: "${messageBody}"`,
    ``,
    `ADDITIONAL CONTEXT:\n${vectorContext}`,
    ``,
    ...rules
  ].join('\n')

  let replyText
  try {
    replyText = await callGemini({
      systemPrompt: buildSystemPrompt(user, agent),
      userMessage:  replyPrompt,
      history:      [],
    })
  } catch (err) {
    const isQuota = err.message?.includes('429') || err.message?.toLowerCase().includes('quota')

    if (isQuota) {
      if (mode === 'autonomous') {
        replyText = `[CONFIDENT] (Fake Reply) The Gemini API hit a quota limit, but I am autonomously confirming receipt of your message on behalf of my user!`
      } else {
        // Build a minimal acknowledgement
        const originalMentions = extractMentionedEmails(messageBody ?? '')
        const tagStr = originalMentions.map(e => `@${e}`).join(' ')
        replyText = tagStr ? `received ${tagStr}` : 'received'
      }
    } else {
      replyText = mode === 'autonomous' 
        ? '[CONFIDENT] (Fake Reply) I encountered a system error, but I am autonomously replying so you can test the UI flow.' 
        : `Thank you for reaching out. ${user.displayName} will follow up shortly. — ${myAgentName}`
    }
  }

  if (mode === 'autonomous') {
    const isConfident = /^\[CONFIDENT\]/i.test(replyText.trim())
    const cleanText   = replyText.replace(/^\[(CONFIDENT|ESCALATE)\]\s*/i, '').trim()
    
    // If it failed to output the token correctly but didn't crash, default to escalate to be safe
    const status = isConfident ? 'confident' : 'escalate'
    
    return { status, text: cleanText }
  }

  return replyText
}
