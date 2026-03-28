import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider } from './context/AppContext'
import Layout from './components/layout/Layout'

// Pages
import AuthPage        from './pages/AuthPage'
import MessagingPage   from './pages/MessagingPage'
import ProfilePage     from './pages/ProfilePage'
import BotSettingsPage from './pages/BotSettingsPage'
import UserInputPage   from './pages/UserInputPage'
import OrgPage         from './pages/OrgPage'
import AdminDashboard  from './pages/AdminDashboard'

/**
 * Guard that requires the user to be an admin.
 * Redirects non-admins to /messaging.
 */
function AdminRoute({ children }) {
  const { isAdmin, loading } = useAuth()
  if (loading) return null
  return isAdmin ? children : <Navigate to="/messaging" replace />
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

        {/* Authenticated layout */}
        <Route
          path="/"
          element={<Layout><></></Layout>}
        />
        <Route
          path="/messaging"
          element={<Layout><MessagingPage /></Layout>}
        />
        <Route
          path="/profile"
          element={<Layout><ProfilePage /></Layout>}
        />
        <Route
          path="/bot-settings"
          element={<Layout><BotSettingsPage /></Layout>}
        />
        <Route
          path="/user-input"
          element={<Layout><UserInputPage /></Layout>}
        />
        <Route
          path="/org"
          element={<Layout><OrgPage /></Layout>}
        />

        {/* Protected admin route */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <Layout><AdminDashboard /></Layout>
            </AdminRoute>
          }
        />

        {/* Catch-all → messaging */}
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
