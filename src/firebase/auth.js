import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth'
import { auth, db } from './config'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'

/**
 * Create a new user account.
 * Triggers: creates User doc + Agent Record in Firestore.
 */
export async function signUp({ email, password, displayName, department = 'Unassigned', role = 'member' }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  const user = credential.user

  // Set display name on Firebase Auth profile
  await updateProfile(user, { displayName })

  // ── Create User document ──────────────────────────────
  await setDoc(doc(db, 'users', user.uid), {
    uid:         user.uid,
    email,
    displayName,
    department,
    role,        // 'member' | 'admin'
    linkedIn:    null,
    calendarConnected: false,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  })

  // ── Initialize Agent Record (the "bot" tied to this user) ──
  // This is the hook that spawns the user's AI proxy
  await setDoc(doc(db, 'agents', user.uid), {
    userId:     user.uid,
    displayName: `${displayName}'s Agent`,
    department,
    status:     'active',   // 'active' | 'idle' | 'offline'
    // Default system instructions — customizable later
    systemInstructions: buildDefaultInstructions(displayName, department),
    model:      'gemini-2.5-flash-lite',
    // RAG context scopes this agent is allowed to query
    knowledgeScope: ['global', department.toLowerCase()],
    // Memory — populated over time
    conversationHistory: [],
    createdAt:  serverTimestamp(),
    updatedAt:  serverTimestamp(),
  })

  return user
}

/**
 * Sign in an existing user.
 */
export async function signIn({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  return credential.user
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  return firebaseSignOut(auth)
}

/**
 * Subscribe to auth state changes.
 * @param {function} callback - called with user | null
 * @returns {function} unsubscribe
 */
export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, callback)
}

// ── Helpers ────────────────────────────────────────────────

function buildDefaultInstructions(name, department) {
  return ""
}
