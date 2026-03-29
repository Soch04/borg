import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { HIDE_ORG_DATA_UI } from '../../context/AppConfig'
import {
  RiMessage3Line, RiRobot2Line, RiUser3Line,
  RiBuildingLine, RiShieldLine,
  RiSunLine, RiMoonLine,
} from 'react-icons/ri'
import './Dock.css'

const baseNavItems = [
  { to: '/messaging',    icon: RiMessage3Line, label: 'Query'        },
  { to: '/bot-settings', icon: RiRobot2Line,   label: 'My Agent'    },
  { to: '/profile',      icon: RiUser3Line,    label: 'Profile'     },
  { to: '/org',          icon: RiBuildingLine, label: 'Organization', hidden: HIDE_ORG_DATA_UI },
]

const navItems = baseNavItems.filter(item => !item.hidden)

export default function Dock() {
  const { isOrgAdmin, theme, toggleTheme } = useAuth()

  return (
    <aside className="dock" aria-label="Navigation dock">
      {/* Main nav items */}
      <nav className="dock-nav">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `dock-item ${isActive ? 'active' : ''}`}
            id={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
            title={label}
          >
            <Icon className="dock-icon" aria-hidden="true" />
            <span className="dock-label">{label}</span>
          </NavLink>
        ))}

        {isOrgAdmin && (
          <>
            <div className="dock-section-divider" aria-hidden="true" />
            <NavLink
              to="/admin"
              className={({ isActive }) => `dock-item dock-admin ${isActive ? 'active' : ''}`}
              id="nav-admin-dashboard"
              title="Admin Dashboard"
            >
              <RiShieldLine className="dock-icon" aria-hidden="true" />
              <span className="dock-label">Admin</span>
            </NavLink>
          </>
        )}
      </nav>

      {/* Footer: theme toggle */}
      <div className="dock-footer">
        <button
          className="dock-item dock-theme-btn"
          onClick={toggleTheme}
          id="btn-theme-toggle"
          title={theme === 'light' ? 'Dark Mode' : 'Light Mode'}
        >
          {theme === 'light'
            ? <RiMoonLine className="dock-icon" aria-hidden="true" />
            : <RiSunLine  className="dock-icon" aria-hidden="true" />}
          <span className="dock-label">
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </span>
        </button>
      </div>
    </aside>
  )
}
