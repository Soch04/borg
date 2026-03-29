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

  const wsRef = useRef(null)

  // ── Load messages & Connect Python WebSocket ────────────────
  useEffect(() => {
    if (!user?.uid || !user?.email) return

    // 1. Load historical messages (Firestore)
    const unsub = subscribeToUserMessages(user.uid, (msgs) => {
      const personal = msgs.filter(m => m.type !== 'bot-to-bot')
      setMessages(personal)
    })

    // 2. Establish Python Engine WebSocket connection
    const wsUrl = `ws://localhost:8000/ws/chat/${user.email}?org_id=${user.department ?? 'global'}&is_admin=${user.orgRole === 'admin'}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.type === 'bot_broadcast') {
          const botMsg = {
            id:         `bot-ws-${Date.now()}`,
            type:       'bot-response',
            senderName:  'Pinecone Vector Engine',
            senderType: 'agent',
            content:    data.text,
            timestamp:  new Date(),
          }
          setMessages(prev => [...prev, botMsg])
          setIsTyping(false)
        } 
        else if (data.type === 'cross_org_request') {
          const hitlMsg = {
            id:         `hitl-${data.req_id}`,
            type:       'bot-response',
            senderName:  'System Security (HITL)',
            senderType: 'system',
            content:    `🚨 Cross-Org Request from ${data.from_email}:\n> "${data.query}"\n\nTo approve this release, type exactly:\n/approve ${data.req_id}`,
            timestamp:  new Date(),
          }
          setMessages(prev => [...prev, hitlMsg])
        }
      } catch (e) {
        console.error('WS Parse Error:', e)
      }
    }

    return () => {
      unsub()
      ws.close()
    }
  }, [user?.uid, user?.email, user?.department, user?.orgRole])

  // ── Send a message to Python DB Vector Engine ────────────────
  const sendMessage = async (content, mentions = []) => {
    if (!content.trim() || isSending) return
    setIsSending(true)

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

    // Capture HITL Approvals manually
    if (content.startsWith('/approve ')) {
      const req_id = content.split(' ')[1]
      wsRef.current?.send(JSON.stringify({ type: 'cross_org_approve', req_id }))
      setIsTyping(false)
      addToast('HITL Approval Sent to Python Engine', 'success')
      return;
    }

    // Pass direct query to python
    try {
      wsRef.current?.send(JSON.stringify({ type: 'query', text: content }))
    } catch (err) {
      console.error('Python WS execution failed:', err)
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
