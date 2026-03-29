import { useState, useEffect, useRef, useCallback } from 'react'
import { RiSendPlaneFill, RiMicLine } from 'react-icons/ri'
import { useDirectory } from '../../hooks/useDirectory'
import './MessageInput.css'

export default function MessageInput({ onSend, disabled }) {
  const [value,       setValue]       = useState('')
  const [mentions,    setMentions]    = useState([])   // confirmed @mentions
  const [query,       setQuery]       = useState(null) // active @query string | null
  const [highlighted, setHighlighted] = useState(0)   // keyboard nav index

  const textareaRef  = useRef(null)
  const dropdownRef  = useRef(null)
  const { search, loading } = useDirectory()

  const suggestions = query !== null ? search(query) : []

  // ── Close dropdown on outside click ─────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target) &&
          !textareaRef.current?.contains(e.target)) {
        setQuery(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Parse @mention from current cursor position ─────────────
  const detectMention = useCallback((text, cursorPos) => {
    const textBefore = text.slice(0, cursorPos)
    // Match the last @ followed by non-space chars (the active query)
    const match = textBefore.match(/@([^\s@]*)$/)
    if (match) {
      setQuery(match[1])       // what the user typed after @
      setHighlighted(0)
    } else {
      setQuery(null)
    }
  }, [])

  // ── Handle text input ───────────────────────────────────────
  const handleInput = (e) => {
    const text = e.target.value
    setValue(text)
    detectMention(text, e.target.selectionStart)

    // Auto-resize
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
    }
  }

  // ── Select a member from the dropdown ───────────────────────
  const selectMember = (member) => {
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? value.length
    const textBefore = value.slice(0, cursor)

    // Replace the active @query with the selected name
    const replaced = textBefore.replace(/@([^\s@]*)$/, `@${member.displayName} `)
    const newValue = replaced + value.slice(cursor)

    setValue(newValue)
    setMentions(prev => {
      // Avoid duplicate mentions of the same user
      if (prev.some(m => m.uid === member.uid)) return prev
      return [...prev, member]
    })
    setQuery(null)
    setHighlighted(0)

    // Restore focus + move cursor to end of inserted mention
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus()
        ta.selectionStart = ta.selectionEnd = replaced.length
      }
    })
  }

  // ── Remove a confirmed @mention chip ────────────────────────
  const removeMention = (uid) => {
    const member = mentions.find(m => m.uid === uid)
    if (!member) return
    // Also remove the @Name text from the input
    const cleaned = value.replace(new RegExp(`@${member.displayName}\\s?`, 'g'), '')
    setValue(cleaned)
    setMentions(prev => prev.filter(m => m.uid !== uid))
  }

  // ── Keyboard navigation ──────────────────────────────────────
  const handleKeyDown = (e) => {
    if (query !== null && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted(i => Math.min(i + 1, suggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMember(suggestions[highlighted])
        return
      }
      if (e.key === 'Escape') {
        setQuery(null)
        return
      }
    }

    // Normal send on Enter (no active dropdown)
    if (e.key === 'Enter' && !e.shiftKey && query === null) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // ── Submit ───────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e?.preventDefault()
    if (!value.trim() || disabled) return
    onSend(value, mentions)
    setValue('')
    setMentions([])
    setQuery(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  return (
    <form className="msg-input-form" onSubmit={handleSubmit} aria-label="Send message">

      {/* Confirmed mention chips */}
      {mentions.length > 0 && (
        <div className="mention-chips" aria-label="Mentioned members">
          {mentions.map(m => (
            <span key={m.uid} className="mention-chip">
              <span className="mention-chip-avatar">{m.avatar}</span>
              <span className="mention-chip-name">@{m.displayName}</span>
              <span className="mention-chip-dept"> · {m.department}</span>
              <button
                type="button"
                className="mention-chip-remove"
                onClick={() => removeMention(m.uid)}
                aria-label={`Remove mention of ${m.displayName}`}
              >×</button>
            </span>
          ))}
        </div>
      )}

      <div className="msg-input-wrapper" style={{ position: 'relative' }}>

        {/* @mention dropdown */}
        {query !== null && (
          <div className="mention-dropdown" ref={dropdownRef} role="listbox" aria-label="Mention suggestions">
            {loading ? (
              <div className="mention-empty">Loading directory…</div>
            ) : suggestions.length === 0 ? (
              <div className="mention-empty">No members found for "@{query}"</div>
            ) : (
              suggestions.slice(0, 6).map((m, i) => (
                <button
                  key={m.uid}
                  type="button"
                  role="option"
                  aria-selected={i === highlighted}
                  className={`mention-option ${i === highlighted ? 'highlighted' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); selectMember(m) }}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  <span className="mention-option-avatar">{m.avatar}</span>
                  <span className="mention-option-info">
                    <span className="mention-option-name">{m.displayName}</span>
                    <span className="mention-option-meta">{m.department} · {m.email}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          id="message-input"
          className="msg-input-field"
          placeholder={`Message your agent… type @ to mention someone`}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
          aria-label="Message input"
          aria-autocomplete="list"
          aria-expanded={query !== null}
        />

        <div className="msg-input-actions">
          <button
            type="button"
            className="btn btn-icon btn-ghost msg-action-btn"
            title="Voice input (coming soon)"
            disabled
            aria-label="Voice input"
          >
            <RiMicLine />
          </button>
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

      {mentions.length > 0 && (
        <p className="msg-input-hint">
          {`Your agent will initiate Bot-to-Bot contact with ${mentions.map(m => m.displayName).join(', ')}.`}
        </p>
      )}
    </form>
  )
}
