import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { signOut } from '../../firebase/auth'
import { RiHexagonFill, RiLogoutBoxRLine } from 'react-icons/ri'
import './Header.css'

const STATUS_COLOR = {
  active:  'var(--color-bot)',
  idle:    'var(--color-warning)',
  offline: 'var(--text-muted)',
}

const STATUS_LABEL = {
  active:  'Active',
  idle:    'Idle',
  offline: 'Offline',
}

export default function Header() {
  const { user, agent } = useAuth()
  const navigate = useNavigate()

  const initials = user?.displayName
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? '??'

  const status  = agent?.status ?? 'offline'
  const tagLine = user?.department ? `${user.department}` : 'Agent Network Member'

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate('/auth')
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <header className="app-header" role="banner">
      {/* ── Brand ─────────────────────────────────────── */}
      <div className="header-brand">
        <div className="header-brand-icon" aria-hidden="true">
          <RiHexagonFill />
        </div>
        <div className="header-brand-text">
          <span className="header-brand-name">BORG</span>
          <span className="header-brand-sub">Agent Network</span>
        </div>
      </div>

      {/* ── Right suite ───────────────────────────────── */}
      <div className="header-suite">
        {/* Status glyph */}
        <div className="header-status-wrap" title={STATUS_LABEL[status]}>
          <span
            className="header-status-dot"
            style={{ background: STATUS_COLOR[status] }}
            aria-label={`Agent status: ${STATUS_LABEL[status]}`}
          />
          <span className="header-status-tooltip">{STATUS_LABEL[status]}</span>
        </div>

        {/* User info */}
        <div className="header-user-info">
          <span className="header-user-name">{user?.displayName ?? 'User'}</span>
          <span className="header-user-tag">{tagLine}</span>
        </div>

        {/* Avatar */}
        <div className="header-avatar" aria-hidden="true">{initials}</div>

        {/* Logout */}
        <button
          className="header-logout-btn"
          onClick={handleSignOut}
          title="Sign Out"
          id="btn-header-sign-out"
        >
          <RiLogoutBoxRLine />
        </button>
      </div>
    </header>
  )
}
