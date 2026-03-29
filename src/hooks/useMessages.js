import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { USE_MOCK, ENABLE_INTERNAL_MONOLOGUE } from '../context/AppConfig'
import { MOCK_MESSAGES } from '../data/mockData'
import { useApp } from '../context/AppContext'
import {
  sendUserMessage, sendBotMessage, subscribeToUserMessages,
  getOrgDirectory, clearUserMessages,
} from '../firebase/firestore'
import { callGemini } from '../agent/gemini'
import {
  buildSystemPrompt,
  buildMonologuePrompt,
  isComplexRequest,
  parseEscalation,
  parseMonologue,
} from '../agent/buildPrompt'
import { queryKnowledgeBase } from '../lib/rag'

export function useMessages() {
  const { user, agent } = useAuth()
  const { addToast } = useApp()
  const [messages,   setMessages]   = useState([])
  const [isTyping,   setIsTyping]   = useState(false)
  const [isSending,  setIsSending]  = useState(false)
  // historyRef stores recent turns for conversation context (not persisted to Firestore)
  const historyRef = useRef([])

  // ── Subscribe to messages from Firestore ─────────────────────
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

  // ── Send a message and get agent response via Gemini + RAG ───
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

    // Persist user message to Firestore
    if (!USE_MOCK) {
      await sendUserMessage(user.uid, content, user.displayName).catch(console.error)
    }

    // Fetch org member directory for agent context
    let directory = []
    // Build RAG context from approved org knowledge base documents
    let kbContext = ''

    if (!USE_MOCK) {
      directory = await getOrgDirectory(user?.orgId).catch(() => [])

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

            messageCitations = results.map(r => ({ id: r.docId, title: r.title }))
          }
        } catch (kbErr) {
          console.warn('[Borg] Failed to query knowledge base:', kbErr)
        }
      }
    }

    try {
      // ── Build system prompt with RAG context ──────────────────
      const systemPrompt = buildSystemPrompt(user, agent, kbContext, directory)
      const complex      = isComplexRequest(content)
      const fullPrompt   = (complex && ENABLE_INTERNAL_MONOLOGUE)
        ? systemPrompt + '\n\n' + buildMonologuePrompt()
        : systemPrompt

      let responseText

      if (USE_MOCK) {
        responseText = generateMockResponse(content)
      } else {
        responseText = await callGemini({
          systemPrompt: fullPrompt,
          userMessage:  content,
          history:      historyRef.current,
        })
      }

      // ── Parse escalation guard ────────────────────────────────
      const { isEscalation, topic } = parseEscalation(responseText)
      if (isEscalation) {
        const escalationMsg = {
          id:         `esc-${Date.now()}`,
          type:       'escalation',
          senderName:  agent?.displayName ?? 'Your Agent',
          senderType: 'agent',
          content:    `I don't have enough information to answer confidently about: **${topic}**.\n\nCould you provide more context, or should I reach out to the relevant team?`,
          topic,
          timestamp:  new Date(),
        }
        setMessages(prev => [...prev, escalationMsg])
        setIsTyping(false)
        return
      }

      // ── Parse monologue sections if Internal Monologue is on ──
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

      // Update in-memory conversation history for next turn
      historyRef.current = [
        ...historyRef.current,
        { role: 'user',      content },
        { role: 'assistant', content: parsed.finalAnswer },
      ].slice(-20)

      // Persist bot response to Firestore
      if (!USE_MOCK) {
        await sendBotMessage(user.uid, parsed.finalAnswer, agent?.displayName).catch(console.error)
      }

    } catch (err) {
      console.error('[Borg Agent] Response generation failed:', err)
      const errorMsg = {
        id:         `err-${Date.now()}`,
        type:       'bot-response',
        senderName:  agent?.displayName ?? 'Your Agent',
        senderType: 'agent',
        content:    'I encountered an error processing your request. Please try again.',
        timestamp:  new Date(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsTyping(false)
    }
  }

  // ── Clear all messages for this user ─────────────────────────
  const handleClearChat = async () => {
    try {
      if (!USE_MOCK && user?.uid) {
        await clearUserMessages(user.uid)
      }
      setMessages([])
      historyRef.current = []
      addToast('Chat cleared', 'success')
    } catch (err) {
      console.error('[Borg] clearUserMessages failed:', err)
      addToast('Failed to clear chat', 'error')
    }
  }

  return { messages, isTyping, isSending, sendMessage, clearChat: handleClearChat }
}

// ── Fallback mock responses ───────────────────────────────────

function generateMockResponse(userInput) {
  const lower = userInput.toLowerCase()
  if (lower.includes('policy') || lower.includes('hr') || lower.includes('handbook')) {
    return 'Querying the Org Knowledge Base… Found 2 matching documents. Synthesizing the relevant sections now.'
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hello! I'm your Borg agent. Ask me anything about your organization's knowledge base."
  }
  return "I'm processing your request by querying the Organization Knowledge Base. Here's what I found based on your approved documents."
}
