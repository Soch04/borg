import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider } from './context/AppContext'
import Layout from './components/layout/Layout'

// Pages
import AuthPage        from './pages/AuthPage'
import MessagingPage   from './pages/MessagingPage'
import ProfilePage     from './pages/ProfilePage'
import BotSettingsPage from './pages/BotSettingsPage'
import OrgPage         from './pages/OrgPage'
import AdminDashboard  from './pages/AdminDashboard'

/**
 * Guard that requires authentication.
 * In mock mode (VITE_USE_MOCK=true) → always passes through.
 * In live mode → redirects to /auth if no user.
 */
function AuthRoute({ children }) {
  const { user, loading, USE_MOCK } = useAuth()
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--color-bg)' }}>
      <div className="spinner" />
    </div>
  )
  if (!USE_MOCK && !user) return <Navigate to="/auth" replace />
  return children
}

/**
 * Guard that requires the user to be an org admin.
 * Redirects non-org-admins to /messaging.
 */
function AdminRoute({ children }) {
  const { isOrgAdmin, loading } = useAuth()
  if (loading) return null
  return isOrgAdmin ? children : <Navigate to="/messaging" replace />
}

/**
 * Main app router — nested inside AuthProvider and AppProvider.
 */
function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth — no sidebar */}
        <Route path="/auth" element={<AuthPage />} />

        {/* Root redirect */}
        <Route path="/" element={<Navigate to="/messaging" replace />} />

        {/* Authenticated routes */}
        <Route
          path="/messaging"
          element={<AuthRoute><Layout><MessagingPage /></Layout></AuthRoute>}
        />
        <Route
          path="/profile"
          element={<AuthRoute><Layout><ProfilePage /></Layout></AuthRoute>}
        />
        <Route
          path="/bot-settings"
          element={<AuthRoute><Layout><BotSettingsPage /></Layout></AuthRoute>}
        />

        <Route
          path="/org"
          element={<AuthRoute><Layout><OrgPage /></Layout></AuthRoute>}
        />

        {/* Protected admin route */}
        <Route
          path="/admin"
          element={
            <AuthRoute>
              <AdminRoute>
                <Layout><AdminDashboard /></Layout>
              </AdminRoute>
            </AuthRoute>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/messaging" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </AppProvider>
  )
}
