/**
 * scripts/seedUser.mjs
 *
 * Seeds a Firestore user + agent document for an existing Firebase Auth account.
 * Run with: node scripts/seedUser.mjs <uid> <email> <displayName> <department>
 *
 * Example:
 *   node scripts/seedUser.mjs 8td2dOmTOTMv4ygJAqNqFKBX4N73 ssquare@rocks.org "Sidney Square" Operations
 */

import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc } from 'firebase/firestore'
import { config } from 'dotenv'

config() // loads .env automatically

const {
  VITE_FIREBASE_API_KEY:            apiKey,
  VITE_FIREBASE_AUTH_DOMAIN:        authDomain,
  VITE_FIREBASE_PROJECT_ID:         projectId,
  VITE_FIREBASE_STORAGE_BUCKET:     storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: messagingSenderId,
  VITE_FIREBASE_APP_ID:             appId,
} = process.env

if (!apiKey || !projectId) {
  console.error('❌ Firebase config missing. Make sure .env is present.')
  process.exit(1)
}

const [,, uid, email, displayName, department = 'Operations'] = process.argv

if (!uid || !email || !displayName) {
  console.error('Usage: node scripts/seedUser.mjs <uid> <email> <displayName> [department]')
  process.exit(1)
}

const app = initializeApp({ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId })
const db  = getFirestore(app)

await setDoc(doc(db, 'users', uid), {
  uid,
  email,
  displayName,
  department,
  role: 'member',
  linkedIn: null,
  calendarConnected: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
console.log(`✅ users/${uid} written`)

await setDoc(doc(db, 'agents', uid), {
  userId:      uid,
  displayName: `${displayName}'s Agent`,
  department,
  status:      'active',
  systemInstructions: `You are the AI agent proxy for ${displayName}, a member of the ${department} department.\n\nRepresent them professionally and accurately. Escalate to ${displayName} only when human judgment is required.`,
  model: 'gemini-2.0-flash',
  knowledgeScope: ['global', department.toLowerCase()],
  conversationHistory: [],
  createdAt: new Date(),
  updatedAt: new Date(),
})
console.log(`✅ agents/${uid} written`)
console.log(`\n✅ Done! ${email} is ready to sign in.`)
