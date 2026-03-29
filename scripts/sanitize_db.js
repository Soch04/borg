/**
 * Database Sanitization Script for Project Borg
 * 
 * Objectives:
 * 1. Delete all user accounts from the 'users' collection except:
 *    - ssquare@rock.org
 *    - pstar@rock.org
 *    - scheeks@rock.org
 * 2. Purge all related data for deleted users (agents, messages, orgDoc invites).
 * 3. Purge ALL message history to provide a clean slate.
 */

import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, getDocs, query, where, 
  deleteDoc, writeBatch, doc 
} from 'firebase/firestore';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const AUTHORIZED_EMAILS = [
  'ssquare@rock.org',
  'pstar@rock.org',
  'scheeks@rock.org'
];

async function sanitize() {
  console.log('🚀 Starting Database Sanitization...');

  // 1. Fetch all users
  const usersSnap = await getDocs(collection(db, 'users'));
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  const usersToDelete = allUsers.filter(u => !AUTHORIZED_EMAILS.includes(u.email));
  const authorizedUserIds = allUsers.filter(u => AUTHORIZED_EMAILS.includes(u.email)).map(u => u.id);

  console.log(`📊 Found ${allUsers.length} total users.`);
  console.log(`🗑️  Marked ${usersToDelete.length} users for deletion.`);

  const batch = writeBatch(db);

  // 2. Delete Users and their Agents
  for (const user of usersToDelete) {
    batch.delete(doc(db, 'users', user.id));
    batch.delete(doc(db, 'agents', user.id));
  }

  // 3. Purge ALL messages (as requested for clean slate)
  const messagesSnap = await getDocs(collection(db, 'messages'));
  console.log(`💬 Purging ${messagesSnap.size} messages...`);
  messagesSnap.docs.forEach(d => batch.delete(d.ref));

  // 4. Purge ALL agent interactions
  const interactionsSnap = await getDocs(collection(db, 'agent_interactions'));
  console.log(`🤝 Purging ${interactionsSnap.size} agent interactions...`);
  interactionsSnap.docs.forEach(d => batch.delete(d.ref));

  // 5. Cleanup Org Invitations (Remove invalid ones)
  const orgsSnap = await getDocs(collection(db, 'organizations'));
  for (const orgDoc of orgsSnap.docs) {
    const data = orgDoc.data();
    if (data.invites) {
      const newInvites = data.invites.filter(email => AUTHORIZED_EMAILS.includes(email));
      if (newInvites.length !== data.invites.length) {
        batch.update(orgDoc.ref, { invites: newInvites });
      }
    }
  }

  await batch.commit();
  console.log('✅ Sanitization complete. Database is clean.');
  process.exit(0);
}

sanitize().catch(err => {
  console.error('❌ Sanitization failed:', err);
  process.exit(1);
});
