import { useEffect, useRef, useState } from 'react'
import { useMessages } from '../hooks/useMessages'
import { useAuth } from '../context/AuthContext'
import { Navigate } from 'react-router-dom'
import { subscribeToOrgData } from '../firebase/firestore'
import MessageBubble from '../components/messaging/MessageBubble'
import MessageInput from '../components/messaging/MessageInput'
import { RiRobot2Line, RiFileTextLine, RiSearchEyeLine, RiDeleteBinLine } from 'react-icons/ri'
import './MessagingPage.css'

export default function MessagingPage() {
  const { user, agent, loading, USE_MOCK } = useAuth()
  const { messages, isTyping, isSending, sendMessage, clearChat } = useMessages()
  
  const feedRef = useRef(null)
  
  // Auto-scroll in personal chat (instantly snap to bottom)
  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
  }, [messages, isTyping])

  // ── Conditional returns AFTER all hooks ─────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div className="spinner" />
    </div>
  )
  if (!USE_MOCK && user && !agent) return <Navigate to="/bot-settings" replace />

  return (
    <div className="msg-page rag-query-page">
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="msg-page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            <h1>
              <RiSearchEyeLine style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
              Query
            </h1>
            <p>Ask your agent questions about your Organization's Knowledge Base</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button 
              className="btn btn-sm btn-danger" 
              onClick={clearChat}
              disabled={messages.length === 0}
              title="Clear current chat history"
            >
              Clear Chat
            </button>
          </div>
        </div>
      </div>

      <div className="rag-layout">
        {/* Full-width Query Chat */}
        <div className="rag-chat-pane">
          <div className="msg-feed-wrapper" style={{ height: '100%' }}>
            <div className="msg-feed-header">
              <div className="feed-agent-info">
                <div className="feed-agent-avatar">
                  <RiRobot2Line />
                </div>
                <div>
                  <div className="feed-agent-name">{agent?.displayName ?? 'Your Agent'}</div>
                  <div className="feed-agent-model">{agent?.model ?? 'gemini-2.0-flash'} · RAG enabled</div>
                </div>
              </div>
              <span className={`badge badge-${agent?.status ?? 'offline'}`}>
                <span className="badge-dot" />
                {agent?.status ?? 'offline'}
              </span>
            </div>

            <div className="msg-feed" ref={feedRef} role="log" aria-live="polite">
              {messages.length === 0 && (
                <div className="empty-state">
                  {!user?.orgId ? (
                    <>
                      <h3>Query your Organization</h3>
                      <p>Join or create an organization to message your agent.</p>
                    </>
                  ) : (
                    <h3>Query your Organization</h3>
                  )}
                </div>
              )}
              {messages.map((msg, i) => (
                <MessageBubble key={msg.id ?? i} message={msg} />
              ))}
              {isTyping && (
                <div className="typing-indicator">
                  <div className="msg-avatar msg-avatar-bot"><RiRobot2Line /></div>
                  <div className="msg-bubble msg-bubble-bot" style={{ padding: '0.625rem 1rem' }}>
                    <div className="msg-meta">
                      <span className="msg-sender-name" style={{ color: 'var(--color-bot)' }}>
                        {agent?.displayName ?? 'Your Agent'}
                      </span>
                    </div>
                    <div className="typing-dots">
                      <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <MessageInput onSend={sendMessage} disabled={isTyping || isSending || !user?.orgId} />
          </div>
        </div>
      </div>
    </div>
  )
}
