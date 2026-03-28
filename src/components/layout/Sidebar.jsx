import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { signOut } from '../../firebase/auth'
import {
  RiMessage3Line, RiRobot2Line, RiUser3Line,
  RiBuildingLine, RiShieldLine, RiLogoutBoxRLine,
  RiHexagonFill, RiInputMethodLine,
} from 'react-icons/ri'
import './Sidebar.css'

const navItems = [
  { to: '/messaging',    icon: RiMessage3Line, label: 'Messaging' },
  { to: '/bot-settings', icon: RiRobot2Line,   label: 'My Agent' },
  { to: '/user-input',   icon: RiInputMethodLine, label: 'User Input' },
  { to: '/profile',      icon: RiUser3Line,    label: 'Profile' },
  { to: '/org',          icon: RiBuildingLine, label: 'Organization' },
]

export default function Sidebar() {
  const { user, agent, isAdmin } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate('/auth')
    } catch (e) {
      console.error(e)
    }
  }

  const initials = user?.displayName
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase() ?? '??'

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="brand-icon">
          <RiHexagonFill />
        </div>
        <div className="brand-text">
          <span className="brand-name">BORG</span>
          <span className="brand-tagline">Agent Network</span>
        </div>
      </div>

      {/* User mini card */}
      <div className="sidebar-user-card">
        <div className="avatar-placeholder avatar-sm sidebar-avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="sidebar-user-info">
          <span className="sidebar-user-name">{user?.displayName ?? 'User'}</span>
          <span className="sidebar-user-dept">{user?.department ?? ''}</span>
        </div>
        {isAdmin && (
          <span className="sidebar-admin-badge" title="Admin">A</span>
        )}
      </div>

      {/* Agent Status indicator */}
      <div className="sidebar-agent-status">
        <RiRobot2Line className="agent-status-icon" />
        <span className="agent-status-label">{agent?.displayName ?? 'Agent'}</span>
        <span className={`badge badge-${agent?.status ?? 'offline'}`}>
          <span className="badge-dot" />
          {agent?.status ?? 'offline'}
        </span>
      </div>

      <div className="sidebar-divider" />

      {/* Navigation */}
      <nav className="sidebar-nav" aria-label="Main navigation">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `sidebar-nav-item ${isActive ? 'active' : ''}`
            }
            id={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <Icon className="nav-icon" />
            <span>{label}</span>
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <div className="sidebar-section-label">Admin</div>
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `sidebar-nav-item admin-item ${isActive ? 'active' : ''}`
              }
              id="nav-admin-dashboard"
            >
              <RiShieldLine className="nav-icon" />
              <span>Admin Dashboard</span>
            </NavLink>
          </>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="sidebar-footer">
        <button
          className="sidebar-nav-item sign-out-btn"
          onClick={handleSignOut}
          id="btn-sign-out"
        >
          <RiLogoutBoxRLine className="nav-icon" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}
