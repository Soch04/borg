import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove
} from 'firebase/firestore'
import { db } from './config'

// ══════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════

export const getUserDoc = (uid) =>
  getDoc(doc(db, 'users', uid))

export const updateUserDoc = (uid, data) =>
  updateDoc(doc(db, 'users', uid), { ...data, updatedAt: serverTimestamp() })

export const updateUserDepartment = (uid, department) =>
  updateDoc(doc(db, 'users', uid), { department, updatedAt: serverTimestamp() })

/**
 * Fetch the org directory (users matching specific orgId).
 * Used by the @mention autocomplete in MessageInput.
 */
export const getOrgDirectory = (orgId) => {
  if (!orgId) return Promise.resolve([])
  const q = query(collection(db, 'users'), where('orgId', '==', orgId))
  return getDocs(q).then(snap => snap.docs.map(d => d.data()))
}

// ══════════════════════════════════════════════════════════
// ORGANIZATIONS & INVITES
// ══════════════════════════════════════════════════════════

export const createOrganization = async (userId, name, userEmail) => {
  const orgDoc = await addDoc(collection(db, 'organizations'), {
    name,
    ownerId: userId,
    invites: [],
    createdAt: serverTimestamp(),
  })
  await updateUserDoc(userId, { orgId: orgDoc.id, orgRole: 'admin' })
  return orgDoc.id
}

export const updateOrgDepartments = (orgId, departments) =>
  updateDoc(doc(db, 'organizations', orgId), { departments, updatedAt: serverTimestamp() })

export const inviteUserToOrg = (orgId, email) =>
  updateDoc(doc(db, 'organizations', orgId), {
    invites: arrayUnion(email.toLowerCase().trim())
  })

export const joinOrganization = async (orgId, userId, email) => {
  await updateUserDoc(userId, { orgId, orgRole: 'member' })
  await updateDoc(doc(db, 'organizations', orgId), {
    invites: arrayRemove(email.toLowerCase().trim())
  })
}

export const subscribeToOrgInvites = (email, callback) => {
  if (!email) return () => callback([])
  const q = query(
    collection(db, 'organizations'),
    where('invites', 'array-contains', email.toLowerCase().trim())
  )
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }, () => callback([]))
}

export const getOrgMembers = (orgId) => {
  if (!orgId) return Promise.resolve([])
  const q = query(collection(db, 'users'), where('orgId', '==', orgId))
  return getDocs(q).then(snap => snap.docs.map(d => d.data()))
}

export const subscribeToOrganization = (orgId, callback) => {
  if (!orgId) return () => callback(null)
  return onSnapshot(doc(db, 'organizations', orgId), (d) => {
    callback(d.exists() ? { id: d.id, ...d.data() } : null)
  })
}

// ══════════════════════════════════════════════════════════
// AGENTS
// ══════════════════════════════════════════════════════════

export const getAgentDoc = (uid) =>
  getDoc(doc(db, 'agents', uid))

export const updateAgentInstructions = (uid, instructions) =>
  updateDoc(doc(db, 'agents', uid), {
    systemInstructions: instructions,
    updatedAt: serverTimestamp(),
  })

export const updateAgentStatus = (uid, status) =>
  updateDoc(doc(db, 'agents', uid), { status, updatedAt: serverTimestamp() })

export const createAgentDoc = (uid, { displayName, department, systemInstructions }) =>
  setDoc(doc(db, 'agents', uid), {
    userId:             uid,
    displayName:        `${displayName}'s Agent`,
    department,
    status:             'active',
    systemInstructions,
    model:              'gemini-2.5-flash-lite',
    knowledgeScope:     ['global', department.toLowerCase()],
    conversationHistory: [],
    createdAt:          serverTimestamp(),
    updatedAt:          serverTimestamp(),
  })

// ══════════════════════════════════════════════════════════
// MESSAGES
// Schema: { id, type: 'user'|'bot-response'|'bot-to-bot',
//           senderId, senderName, recipientId, recipientName,
//           content, department, timestamp, metadata }
// ══════════════════════════════════════════════════════════

/**
 * Send a user message (user → their bot)
 */
export const sendUserMessage = (userId, content, userName) =>
  addDoc(collection(db, 'messages'), {
    type:          'user',
    senderId:      userId,
    senderName:    userName,
    senderType:    'human',
    recipientId:   userId,   // bot tied to this user
    recipientType: 'agent',
    content,
    timestamp:     serverTimestamp(),
    metadata:      {},
  })

/**
 * Send a bot response message (bot → user)
 */
export const sendBotMessage = (userId, content, agentName, metadata = {}) =>
  addDoc(collection(db, 'messages'), {
    type:          'bot-response',
    senderId:      userId,
    senderName:    agentName,
    senderType:    'agent',
    recipientId:   userId,
    recipientType: 'human',
    content,
    timestamp:     serverTimestamp(),
    metadata,
  })

/**
 * Update the metadata of an existing message (e.g. to mark an interaction actioned)
 */
export const updateMessageMetadata = (msgId, data) =>
  updateDoc(doc(db, 'messages', msgId), { metadata: data })

/**
 * Log a bot-to-bot message (inter-agent communication)
 */
export const logBotToBotMessage = (fromId, toId, fromName, toName, content, dept) =>
  addDoc(collection(db, 'messages'), {
    type:          'bot-to-bot',
    senderId:      fromId,
    senderName:    fromName,
    senderType:    'agent',
    recipientId:   toId,
    recipientName: toName,
    recipientType: 'agent',
    content,
    department:    dept,
    timestamp:     serverTimestamp(),
    metadata:      { protocol: 'borg-agent-handshake-v1' },
  })

/**
 * Subscribe to messages for a user (real-time listener)
 * Returns unsubscribe function.
 */
export const subscribeToUserMessages = (userId, callback) => {
  const q = query(
    collection(db, 'messages'),
    where('recipientId',   '==', userId),
    orderBy('timestamp', 'asc'),
    limit(100),
  )
  return onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    callback(msgs)
  })
}

/**
 * Delete all personal messages for a user.
 */
export const clearUserMessages = (userId) => {
  const q = query(collection(db, 'messages'), where('recipientId', '==', userId))
  return getDocs(q).then(async snap => {
    const { writeBatch } = await import('firebase/firestore')
    const batch = writeBatch(db)
    snap.docs.forEach(doc => batch.delete(doc.ref))
    return batch.commit()
  })
}

/**
 * Subscribe to bot-to-bot logs (optionally filtered by department)
 */
export const subscribeToBotLogs = (department, callback) => {
  let q = query(
    collection(db, 'messages'),
    where('type', '==', 'bot-to-bot'),
    orderBy('timestamp', 'desc'),
    limit(50),
  )
  if (department && department !== 'all') {
    q = query(
      collection(db, 'messages'),
      where('type',       '==', 'bot-to-bot'),
      where('department', '==', department),
      orderBy('timestamp', 'desc'),
      limit(50),
    )
  }
  return onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    callback(msgs)
  })
}

// ══════════════════════════════════════════════════════════
// ORG DATA (Knowledge Base / RAG data)
// Schema: { id, orgId, title, content, fileUrl, fileType,
//           uploadedBy, department, status, createdAt }
// ══════════════════════════════════════════════════════════

export const submitOrgData = (userId, userName, orgId, data) =>
  addDoc(collection(db, 'orgData'), {
    ...data,
    orgId,
    uploadedBy:   userId,
    uploaderName: userName,
    status:       'pending',   // 'pending' | 'approved' | 'rejected'
    createdAt:    serverTimestamp(),
    updatedAt:    serverTimestamp(),
  })

export const updateOrgDataStatus = (docId, status) =>
  updateDoc(doc(db, 'orgData', docId), { status, updatedAt: serverTimestamp() })

export const subscribeToOrgData = (orgId, callback) => {
  if (!orgId) return () => callback([])
  const q = query(
    collection(db, 'orgData'), 
    where('orgId', '==', orgId),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export const subscribeToUserOrgData = (userId, orgId, callback) => {
  if (!orgId) return () => callback([])
  const q = query(
    collection(db, 'orgData'),
    where('uploadedBy', '==', userId),
    where('orgId', '==', orgId),
    orderBy('createdAt', 'desc'),
  )
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// ════════════════════════════════════════════════════════
// AGENT INTERACTIONS (@mention routing)
// Schema per doc:
//   sender_uid      : string   — Firebase UID of sender
//   sender_name     : string   — display name
//   sender_email    : string   — sender's email
//   recipient_email : string   — target user's email (queried by recipient)
//   content         : string   — full message including @mention
//   body            : string   — message text with @mention stripped
//   status          : 'pending' | 'replied' | 'escalated'
//   reply           : string   — agent's response (written back to same doc)
//   replied_at      : timestamp
//   timestamp       : timestamp
// ════════════════════════════════════════════════════════

/**
 * Write a new @mention interaction to Firestore.
 * @param {{ sender_uid, sender_name, sender_email, recipient_email, content, body }} params
 * @returns {Promise<DocumentReference>}
 */
export const sendMention = ({ sender_uid, sender_name, sender_email, recipient_email, content, body }) =>
  addDoc(collection(db, 'agent_interactions'), {
    sender_uid,
    sender_name,
    sender_email,
    recipient_email: recipient_email.toLowerCase().trim(),
    content,
    body,
    status:    'pending',
    reply:     null,
    replied_at: null,
    timestamp: serverTimestamp(),
  })

/**
 * Real-time listener for interactions addressed to this user's email.
 * Ordered newest-first, capped at 50.
 * @param {string}   recipientEmail
 * @param {function} callback  — called with array of interaction docs
 * @returns {function} unsubscribe
 */
export const subscribeToIncomingMentions = (recipientEmail, callback) => {
  const q = query(
    collection(db, 'agent_interactions'),
    where('recipient_email', '==', recipientEmail.toLowerCase().trim()),
    orderBy('timestamp', 'desc'),
    limit(50),
  )
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }, () => callback([]))
}

/**
 * Write the agent's reply back to the same interaction document.
 * @param {string} interactionId
 * @param {string} replyText
 */
export const postMentionReply = (interactionId, replyText) =>
  updateDoc(doc(db, 'agent_interactions', interactionId), {
    reply:      replyText,
    status:     'replied',
    replied_at: serverTimestamp(),
  })

/**
 * Mark that this interaction has been shown in the user's personal chat feed
 * to prevent duplicate notifications upon Reload.
 */
export const markInteractionNotified = (interactionId) =>
  updateDoc(doc(db, 'agent_interactions', interactionId), {
    feed_notified: true
  })

/**
 * Global interactions listener for Admin Feed (Activity monitor)
 */
export const subscribeToAllOrgInteractions = (callback) => {
  const q = query(
    collection(db, 'agent_interactions'),
    orderBy('timestamp', 'desc'),
    limit(30)
  )
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }, () => callback([]))
}

/**
 * System Sanitization (Admin Only)
 * Prunes unauthorized accounts and purges all message history.
 */
export const runSystemSanitization = async () => {
  const AUTHORIZED_EMAILS = ['ssquare@rock.org', 'pstar@rock.org', 'scheeks@rock.org'];
  
  // 1. Fetch Users
  const usersSnap = await getDocs(collection(db, 'users'));
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const usersToDelete = allUsers.filter(u => !AUTHORIZED_EMAILS.includes(u.email));

  const { writeBatch } = await import('firebase/firestore');
  const batch = writeBatch(db);

  // 2. Delete Users and Agents
  usersToDelete.forEach(user => {
    batch.delete(doc(db, 'users', user.id));
    batch.delete(doc(db, 'agents', user.id));
  });

  // 3. Purge Messages
  const messagesSnap = await getDocs(collection(db, 'messages'));
  messagesSnap.docs.forEach(d => batch.delete(d.ref));

  // 4. Purge Interactions
  const interactionsSnap = await getDocs(collection(db, 'agent_interactions'));
  interactionsSnap.docs.forEach(d => batch.delete(d.ref));

  return batch.commit();
}
