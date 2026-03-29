import { useState } from 'react'
import { RiRobot2Line, RiUser3Line, RiArrowLeftRightLine, RiSendPlaneFill } from 'react-icons/ri'
import { useAuth } from '../../context/AuthContext'
import { generateAgentReply } from '../../agent/generateReply'
import { postMentionReply, updateMessageMetadata, sendBotMessage } from '../../firebase/firestore'
import './MessageBubble.css'

/**
 * Renders a single message bubble.
 * type: 'user' | 'bot-response' | 'bot-to-bot'
 */
export default function MessageBubble({ message, onHighlightDoc }) {
  const { type, senderName, recipientName, content, timestamp, metadata, citations } = message
  const { user, agent } = useAuth()
  
  const [isReplyingManually, setIsReplyingManually] = useState(false)
  const [manualText, setManualText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  const timeStr = timestamp
    ? new Date(timestamp?.toDate?.() ?? timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

  const handleAction = async (actionType) => {
    if (!metadata?.interactionId) return
    if (actionType === 'manual' && !manualText.trim()) return

    setIsProcessing(true)
    try {
      let finalReply = ''
      if (actionType === 'agent') {
        finalReply = await generateAgentReply({ interaction: metadata, user, agent })
      } else {
        finalReply = manualText.trim()
      }

      // Record the reply in the shared agent interactions doc
      await postMentionReply(metadata.interactionId, finalReply)
      
      // Update original message so the buttons disappear
      await updateMessageMetadata(message.id, { ...metadata, actioned: true })

      // Drop a new message bubble asserting what we did
      if (actionType === 'agent') {
        await sendBotMessage(user.uid, `**Your agent replied:**\n> "${finalReply}"`, agent?.displayName ?? 'Your Agent')
      } else {
        await sendBotMessage(user.uid, `**You replied dynamically:**\n> "${finalReply}"`, user.displayName)
      }
    } catch (err) {
      console.error('Failed to handle interaction', err)
    } finally {
      setIsProcessing(false)
      setIsReplyingManually(false)
    }
  }

  if (type === 'bot-to-bot') {
    return (
      <div className="msg-bot-to-bot">
        <div className="msg-bot-to-bot-header">
          <RiArrowLeftRightLine className="msg-b2b-icon" />
          <span className="msg-b2b-route">
            <strong>{senderName}</strong>
            <span className="msg-b2b-arrow"> → </span>
            <strong>{recipientName}</strong>
          </span>
          <span className="msg-timestamp">{timeStr}</span>
        </div>
        <div className="msg-bot-to-bot-body">
          <pre className="msg-b2b-content">{content}</pre>
        </div>
      </div>
    )
  }

  const isUser = type === 'user'
  const isBot  = type === 'bot-response'

  return (
    <div className={`msg-bubble-row ${isUser ? 'msg-row-user' : 'msg-row-bot'}`}>
      {/* Avatar */}
      {isBot && (
        <div className="msg-avatar msg-avatar-bot" aria-hidden="true">
          <RiRobot2Line />
        </div>
      )}

      <div className={`msg-bubble ${isUser ? 'msg-bubble-user' : 'msg-bubble-bot'}`}>
        {/* Sender label */}
        <div className="msg-meta">
          <span className="msg-sender-name">{senderName}</span>
          <span className="msg-timestamp">{timeStr}</span>
        </div>

        {/* Content — support markdown-like bold */}
        <div className="msg-content">
          {formatContent(content)}
        </div>

        {/* Interactive Notification Actions */}
        {metadata?.type === 'interaction-request' && !metadata.actioned && (
          <div className="interaction-actions">
            {!isReplyingManually ? (
              <div className="interaction-buttons">
                <button 
                  className="btn btn-secondary btn-sm" 
                  disabled={isProcessing}
                  onClick={() => setIsReplyingManually(true)}
                >
                  Reply Manually
                </button>
                <button 
                  className="btn btn-primary btn-sm" 
                  disabled={isProcessing}
                  onClick={() => handleAction('agent')}
                >
                  {isProcessing ? 'Processing...' : 'Send Agent'}
                </button>
              </div>
            ) : (
              <div className="manual-reply-box">
                <textarea 
                  autoFocus
                  className="input"
                  placeholder="Type your manual reply..."
                  value={manualText}
                  onChange={e => setManualText(e.target.value)}
                  disabled={isProcessing}
                  rows={2}
                />
                <div className="manual-reply-actions">
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => setIsReplyingManually(false)}
                    disabled={isProcessing}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn btn-primary btn-sm btn-icon"
                    onClick={() => handleAction('manual')}
                    disabled={isProcessing || !manualText.trim()}
                  >
                    <RiSendPlaneFill /> Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Citations / Sources */}
        {isBot && citations && citations.length > 0 && (
          <div className="msg-citations" style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
            <div className="citations-label" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.375rem' }}>Sources:</div>
            <div className="citations-list" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {citations.map((cite, idx) => (
                <button 
                  key={cite.id || idx} 
                  className="citation-badge"
                  onClick={() => onHighlightDoc?.(cite.id)}
                  style={{ 
                    fontSize: '0.75rem', 
                    padding: '0.25rem 0.5rem', 
                    borderRadius: '0.25rem',
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    color: 'var(--color-accent)'
                  }}
                  title={`View ${cite.title}`}
                >
                  [{idx + 1}] {cite.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {isUser && (
        <div className="msg-avatar msg-avatar-user" aria-hidden="true">
          <RiUser3Line />
        </div>
      )}
    </div>
  )
}

/** Simple renderer: bold **text**, blockquotes >, newlines → <br> */
function formatContent(text) {
  if (!text) return null
  return text.split('\n').map((line, i) => {
    // Handle blockquotes
    const isQuote = line.startsWith('> ')
    const displayLine = isQuote ? line.slice(2) : line

    const parts = displayLine.split(/\*\*([^*]+)\*\*/g)
    const formattedLine = (
      <span key={i} className={isQuote ? 'msg-blockquote' : ''}>
        {parts.map((part, j) =>
          j % 2 === 1 ? <strong key={j}>{part}</strong> : part
        )}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    )
    return formattedLine
  })
}
