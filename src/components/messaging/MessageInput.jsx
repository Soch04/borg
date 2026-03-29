import { useState, useRef } from 'react'
import { RiSendPlaneFill } from 'react-icons/ri'
import './MessageInput.css'

export default function MessageInput({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const textareaRef = useRef(null)

  // ── Handle text input with auto-resize ──────────────────────
  const handleInput = (e) => {
    setValue(e.target.value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
    }
  }

  // ── Submit ───────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e?.preventDefault()
    if (!value.trim() || disabled) return
    onSend(value, [])
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  // ── Send on Enter (no Shift) ─────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <form className="msg-input-form" onSubmit={handleSubmit} aria-label="Send message">
      <div className="msg-input-wrapper">
        <textarea
          ref={textareaRef}
          id="message-input"
          className="msg-input-field"
          placeholder="Message your agent…"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
          aria-label="Message input"
        />
        <div className="msg-input-actions">
          <button
            type="submit"
            id="btn-send-message"
            className="btn btn-primary btn-icon msg-send-btn"
            disabled={!value.trim() || disabled}
            aria-label="Send message"
          >
            <RiSendPlaneFill />
          </button>
        </div>
      </div>
    </form>
  )
}
