import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { HIDE_ORG_DATA_UI } from '../../context/AppConfig'
import { RiSunLine, RiMoonLine } from 'react-icons/ri'
import {
  IconQuery, IconMyAgent, IconProfile,
  IconOrganization, IconAdmin,
} from '../icons/icons'
import './Dock.css'

const baseNavItems = [
  { to: '/messaging',    icon: IconQuery,        label: 'Query'        },
  { to: '/bot-settings', icon: IconMyAgent,      label: 'My Agent'    },
  { to: '/profile',      icon: IconProfile,      label: 'Profile'     },
  { to: '/org',          icon: IconOrganization, label: 'Organization', hidden: HIDE_ORG_DATA_UI },
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
              <IconAdmin className="dock-icon" aria-hidden="true" />
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
