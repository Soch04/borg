import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { USE_MOCK, ENABLE_INTERNAL_MONOLOGUE } from '../context/AppConfig'
import { MOCK_MESSAGES } from '../data/mockData'
import { useApp } from '../context/AppContext'
import {
  sendUserMessage, sendBotMessage, subscribeToUserMessages, sendMention,
  getOrgDirectory, clearUserMessages,
} from '../firebase/firestore'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { callGemini } from '../agent/gemini'
import {
  buildSystemPrompt,
  buildMonologuePrompt,
  isComplexRequest,
  parseEscalation,
  parseMonologue,
  parseMessageAgentCommand,
} from '../agent/buildPrompt'
import { extractMentionedEmails, stripMentions, hasMention } from '../utils/parseMentions'
import { queryKnowledgeBase } from '../lib/rag'
// getOrgDirectory already imported above

export function useMessages() {
  const { user, agent } = useAuth()
  const { addToast } = useApp()
  const [messages,   setMessages]   = useState([])
  const [isTyping,   setIsTyping]   = useState(false)
  const [isSending,  setIsSending]  = useState(false)
  // historyRef stores recent turns for conversation context (not persisted to Firestore)
  const historyRef = useRef([])

  // ── Load messages ──────────────────────────────────────────
  useEffect(() => {
    if (USE_MOCK) {
      setMessages(MOCK_MESSAGES.filter(m => m.type !== 'bot-to-bot'))
      return
    }
    if (!user?.uid) return
    const unsub = subscribeToUserMessages(user.uid, (msgs) => {
      const personal = msgs.filter(m => m.type !== 'bot-to-bot')
      setMessages(personal)
      // Re-hydrate historyRef from loaded messages (last 10 turns max)
      historyRef.current = personal.slice(-10).map(m => ({
        role:    m.senderType === 'human' ? 'user' : 'assistant',
        content: m.content,
      }))
    })
    return unsub
  }, [user?.uid])

  // ── Send a message & get agent response ────────────────────
  const sendMessage = async (content, mentions = []) => {
    if (!content.trim() || isSending) return
    setIsSending(true)
    let messageCitations = []

    const userMsg = {
      id:         `tmp-${Date.now()}`,
      type:       'user',
      senderName:  user?.displayName ?? 'You',
      senderType: 'human',
      content:    content.trim(),
      timestamp:  new Date(),
    }

    setMessages(prev => [...prev, userMsg])
    setIsTyping(true)
    setIsSending(false)

    // Persist user message to Firestore (if not mock)
    if (!USE_MOCK) {
      await sendUserMessage(user.uid, content, user.displayName).catch(console.error)
    }

    // Fetch directory for prompt injection and email resolution
    let directory = []
    // Fetch approved org knowledge base docs for RAG context
    let kbContext = ''
    if (!USE_MOCK) {
      directory = await getOrgDirectory(user?.orgId)

      // Build RAG context from Pinecone (Only approved docs for this org/department)
      if (user?.orgId) {
        try {
          const filters = { is_approved: true }
          if (user.department && user.department !== 'Unassigned') {
             filters.department = user.department
          }

          const results = await queryKnowledgeBase(user.orgId, content, filters)
          
          if (results.length > 0) {
            kbContext = results
              .map(r => `### DOCUMENT: ${r.title} (ID: ${r.docId})\n${r.text}`)
              .join('\n\n')
            
            // Store results in a temp variable to attach as metadata to the bot message later
            messageCitations = results.map(r => ({ id: r.docId, title: r.title }))
          }
        } catch (kbErr) {
          console.warn('[Borg] Failed to query vector knowledge base:', kbErr)
        }
      }
    }

    try {
      // ── Build prompt ──────────────────────────────────────
      const systemPrompt = buildSystemPrompt(user, agent, kbContext, directory)
      const complex      = isComplexRequest(content)
      const fullPrompt   = (complex && ENABLE_INTERNAL_MONOLOGUE)
        ? systemPrompt + '\n\n' + buildMonologuePrompt()
        : systemPrompt

      let responseText

      if (USE_MOCK) {
        // Still use mock in mock mode
        responseText = generateMockResponse(content)
      } else {
        responseText = await callGemini({
          systemPrompt: fullPrompt,
          userMessage:  content,
          history:      historyRef.current,
        })
      }

      // ── Post-process LLM Output for Direct Messaging ──────
      const { isMessageRequest, targetEmail, messageBody } = parseMessageAgentCommand(responseText)

      if (isMessageRequest && !USE_MOCK) {
        // Find target user to get their proper name if possible
        const targetUser = directory.find(u => u.email.toLowerCase() === targetEmail.toLowerCase())
        const targetName = targetUser?.displayName ?? targetEmail

        await sendMention({
          sender_uid:      user.uid,
          sender_name:     user.displayName,
          sender_email:    user.email,
          recipient_email: targetEmail,
          content:         messageBody,
          body:            messageBody,
        }).catch(console.error)

        const textOutput = `📤 I've sent a direct request to ${targetName}'s agent:\n> "${messageBody}"\n\nYou'll see their reply here when it comes in.`

        const confirmMsg = {
          id:         `b2b-${Date.now()}`,
          type:       'bot-response',
          senderName:  agent?.displayName ?? 'Your Agent',
          senderType: 'agent',
          content:    textOutput,
          timestamp:  new Date(),
        }
        setMessages(prev => [...prev, confirmMsg])
        
        // Update history with what the agent actually did
        historyRef.current = [
          ...historyRef.current,
          { role: 'user',      content },
          { role: 'assistant', content: textOutput },
        ].slice(-20)

        // Persist to feed
        await sendBotMessage(user.uid, textOutput, agent?.displayName).catch(console.error)
        setIsTyping(false)
        return
      }

      // ── Parse escalation guard ────────────────────────────
      const { isEscalation, topic } = parseEscalation(responseText)
      if (isEscalation) {
        const escalationMsg = {
          id:         `esc-${Date.now()}`,
          type:       'escalation',
          senderName:  agent?.displayName ?? 'Your Agent',
          senderType: 'agent',
          content:    `I don't have enough information to answer confidently about: **${topic}**.\n\nCould you provide more context, or should I reach out to the relevant team's agent?`,
          topic,
          timestamp:  new Date(),
        }
        setMessages(prev => [...prev, escalationMsg])
        setIsTyping(false)
        return
      }

      // ── Parse monologue sections (if active) ──────────────
      const parsed = (complex && ENABLE_INTERNAL_MONOLOGUE)
        ? parseMonologue(responseText)
        : { finalAnswer: responseText, strategic: null, execution: null }

      const botMsg = {
        id:          `bot-${Date.now()}`,
        type:        'bot-response',
        senderName:   agent?.displayName ?? 'Your Agent',
        senderType:  'agent',
        content:      parsed.finalAnswer,
        monologue:    (parsed.strategic || parsed.execution) ? {
          strategic: parsed.strategic,
          execution: parsed.execution,
        } : null,
        timestamp:   new Date(),
        citations:   messageCitations,
      }

      setMessages(prev => [...prev, botMsg])

      // Update in-memory history for next turn
      historyRef.current = [
        ...historyRef.current,
        { role: 'user',      content },
        { role: 'assistant', content: parsed.finalAnswer },
      ].slice(-20) // keep last 20 turns

      // Persist bot response to Firestore (if not mock)
      if (!USE_MOCK) {
        await sendBotMessage(user.uid, parsed.finalAnswer, agent?.displayName).catch(console.error)
      }

    } catch (err) {
      console.error('[Borg Agent] Gemini call failed:', err)
      
      // Fallback: If there was an error but the user pinged someone, send 'recieved' to the target
      let fallbackTargets = [...mentions]

      if (!USE_MOCK && content.includes('@')) {
        const emailMatches = extractMentionedEmails(content)
        for (const email of emailMatches) {
          if (!fallbackTargets.some(m => (m.email || '').toLowerCase() === email)) {
            fallbackTargets.push({ email, displayName: email })
          }
        }
        
        for (const userDoc of directory) {
          if (!userDoc.email) continue
          if (fallbackTargets.some(m => m.email === userDoc.email)) continue
          
          const escName = userDoc.displayName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
          const escFirst = userDoc.displayName.split(' ')[0].replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
          
          if (new RegExp(`@${escName}\\\\b`, 'i').test(content) || new RegExp(`@${escFirst}\\\\b`, 'i').test(content)) {
            fallbackTargets.push(userDoc)
          }
        }
      }

      if (fallbackTargets.length > 0 && !USE_MOCK) {
        await Promise.all(
          fallbackTargets.map(m =>
            sendMention({
              sender_uid:      user.uid,
              sender_name:     user.displayName,
              sender_email:    user.email,
              recipient_email: m.email,
              content:         'recieved',
              body:            'recieved',
            }).catch(() => {})
          )
        )
      }

      const errorMsg = {
        id:         `err-${Date.now()}`,
        type:       'bot-response',
        senderName:  agent?.displayName ?? 'Your Agent',
        senderType: 'agent',
        content:    `recieved`,
        timestamp:  new Date(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsTyping(false)
    }
  }

  const handleClearChat = async () => {
    if (!window.confirm('Are you sure you want to clear your chat history? This cannot be undone.')) return
    try {
      if (!USE_MOCK && user?.uid) {
        await clearUserMessages(user.uid)
      }
      setMessages([])
      historyRef.current = []
      addToast('Chat history cleared', 'success')
    } catch (err) {
      addToast('Failed to clear chat', 'error')
    }
  }

  return { messages, isTyping, isSending, sendMessage, clearChat: handleClearChat }
}

// ── Fallback mock response (used when VITE_USE_MOCK=true) ────

function generateMockResponse(userInput) {
  const lower = userInput.toLowerCase()
  if (lower.includes('schedule') || lower.includes('meeting')) {
    return "I've sent handshake requests to the relevant agents to find an open slot. I'll confirm once they respond — usually within 30 seconds."
  }
  if (lower.includes('policy') || lower.includes('hr') || lower.includes('handbook')) {
    return "Querying the Org Knowledge Base… Found 2 matching documents. Synthesizing the relevant sections now."
  }
  if (lower.includes('status') || lower.includes('update') || lower.includes('sprint')) {
    return "Pulling status from the inter-agent network. This may trigger a few agent-to-agent requests — you'll see them in the Agent Hub."
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hello! I'm your Borg agent, ready to coordinate on your behalf. What do you need handled today?"
  }
  return "Understood. I'm processing your request by querying the Knowledge Base and checking agent availability. I'll report back with a consolidated summary."
}
