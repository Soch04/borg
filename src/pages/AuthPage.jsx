import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signUp, signIn } from '../firebase/auth'
import { DEPARTMENTS } from '../data/mockData'
import { RiHexagonFill, RiEyeLine, RiEyeOffLine, RiCheckboxCircleLine, RiErrorWarningLine } from 'react-icons/ri'
import './AuthPage.css'

// Map Firebase error codes to human-friendly messages
function friendlyError(err) {
  const code = err?.code ?? ''
  if (code === 'auth/email-already-in-use')   return 'An account with that email already exists. Try signing in instead.'
  if (code === 'auth/user-not-found')          return 'No account found with that email.'
  if (code === 'auth/wrong-password')          return 'Incorrect password. Please try again.'
  if (code === 'auth/invalid-credential')      return 'Incorrect email or password. Please try again.'
  if (code === 'auth/invalid-email')           return 'Please enter a valid email address.'
  if (code === 'auth/weak-password')           return 'Password must be at least 6 characters.'
  if (code === 'auth/operation-not-allowed')   return 'Email/Password sign-in is not enabled yet. Please contact the admin.'
  if (code === 'auth/too-many-requests')       return 'Too many attempts. Please wait a moment and try again.'
  if (code === 'auth/network-request-failed')  return 'Network error. Check your connection and try again.'
  return err?.message ?? 'Something went wrong. Please try again.'
}

export default function AuthPage() {
  const [tab,      setTab]      = useState('login')    // 'login' | 'signup'
  const [loading,  setLoading]  = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [alert,    setAlert]    = useState(null)   // { type: 'error'|'success', message }
  const navigate = useNavigate()

  const showAlert = (message, type = 'error') => {
    setAlert({ message, type })
    if (type === 'success') setTimeout(() => setAlert(null), 4000)
  }

  // Clear alert when switching tabs
  const switchTab = (t) => { setTab(t); setAlert(null) }

  // Login form
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })

  // Sign up form
  const [signupForm, setSignupForm] = useState({
    displayName: '',
    email: '',
    password: '',
  })

  const handleLogin = async (e) => {
    e.preventDefault()
    setAlert(null)
    setLoading(true)
    try {
      await signIn(loginForm)
      navigate('/messaging')
    } catch (err) {
      showAlert(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await signUp(signupForm)
      // Navigate immediately — AuthContext will resolve user from Firebase Auth
      navigate('/messaging')
    } catch (err) {
      showAlert(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  // In mock mode, skip auth entirely
  const handleMockEnter = () => navigate('/messaging')

  return (
    <div className="auth-page">
      <div className="auth-bg-glow" aria-hidden="true" />

      <div className="auth-card glass">
        {/* Brand */}
        <div className="auth-brand">
          <div className="auth-brand-icon">
            <RiHexagonFill />
          </div>
          <div>
            <div className="auth-brand-name">BORG</div>
            <div className="auth-brand-tagline">AI Agent Network</div>
          </div>
        </div>

        <h2 className="auth-title">
          {tab === 'login' ? 'Welcome back' : 'Create your account'}
        </h2>
        <p className="auth-subtitle">
          {tab === 'login'
            ? 'Sign in to access your AI agent and org network'
            : 'Set up your profile to initialize your personal AI proxy'}
        </p>

        {/* Tab switch */}
        <div className="tab-bar auth-tabs">
          <button
            id="auth-tab-login"
            className={`tab-item ${tab === 'login' ? 'active' : ''}`}
            onClick={() => switchTab('login')}
          >Sign In</button>
          <button
            id="auth-tab-signup"
            className={`tab-item ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => switchTab('signup')}
          >Create Account</button>
        </div>

        {/* Inline alert */}
        {alert && (
          <div className={`auth-alert auth-alert-${alert.type}`} role="alert">
            {alert.type === 'success' ? <RiCheckboxCircleLine /> : <RiErrorWarningLine />}
            {alert.message}
          </div>
        )}

        {/* ── Login Form ── */}
        {tab === 'login' && (
          <form className="auth-form" onSubmit={handleLogin} id="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                className="form-input"
                placeholder="you@company.com"
                value={loginForm.email}
                onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                required
                autoComplete="email"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Password</label>
              <div className="password-wrap">
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  className="form-input"
                  placeholder="••••••••"
                  value={loginForm.password}
                  onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPass(v => !v)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <RiEyeOffLine /> : <RiEyeLine />}
                </button>
              </div>
            </div>
            <button
              id="btn-login"
              type="submit"
              className="btn btn-primary btn-full btn-lg"
              disabled={loading}
            >
              {loading ? <><span className="spinner" style={{ width: 18, height: 18 }} />Signing in...</> : 'Sign In'}
            </button>
          </form>
        )}

        {/* ── Signup Form ── */}
        {tab === 'signup' && (
          <form className="auth-form" onSubmit={handleSignUp} id="signup-form">
            <div className="form-group">
              <label className="form-label" htmlFor="signup-name">Full Name</label>
              <input
                id="signup-name"
                type="text"
                className="form-input"
                placeholder="Alex Rivera"
                value={signupForm.displayName}
                onChange={e => setSignupForm(f => ({ ...f, displayName: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="signup-email">Work Email</label>
              <input
                id="signup-email"
                type="email"
                className="form-input"
                placeholder="alex@company.com"
                value={signupForm.email}
                onChange={e => setSignupForm(f => ({ ...f, email: e.target.value }))}
                required
                autoComplete="email"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="signup-password">Password</label>
              <div className="password-wrap">
                <input
                  id="signup-password"
                  type={showPass ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Min 6 characters"
                  value={signupForm.password}
                  onChange={e => setSignupForm(f => ({ ...f, password: e.target.value }))}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPass(v => !v)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <RiEyeOffLine /> : <RiEyeLine />}
                </button>
              </div>
            </div>

            <div className="signup-agent-notice">
              🤖 Creating your account will initialize a dedicated AI proxy agent with default system instructions.
            </div>

            <button
              id="btn-signup"
              type="submit"
              className="btn btn-primary btn-full btn-lg"
              disabled={loading}
            >
              {loading ? <><span className="spinner" style={{ width: 18, height: 18 }} />Creating account...</> : 'Create Account & Initialize Agent'}
            </button>
          </form>
        )}

        <div className="auth-divider">
          <span>or</span>
        </div>

        <button
          id="btn-demo-mode"
          className="btn btn-ghost btn-full"
          onClick={handleMockEnter}
        >
          Enter Demo Mode (no account needed)
        </button>

        <p className="auth-footnote">
          Project Borg · YCONIC Hackathon · All data is org-scoped and private.
        </p>
      </div>
    </div>
  )
}
