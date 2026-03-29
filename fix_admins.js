import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDf9-KmpBLiU5-zT4hNnqh8rI7nm2nbF_k",
  authDomain: "polly-970c1.firebaseapp.com",
  projectId: "polly-970c1",
  storageBucket: "polly-970c1.firebasestorage.app",
  messagingSenderId: "496144166424",
  appId: "1:496144166424:web:dad3d0830b293d59bedd6d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixAdmins() {
  console.log("Starting script...");
  const orgsSnap = await getDocs(collection(db, "organizations"));
  
  for (const orgDoc of orgsSnap.docs) {
    const data = orgDoc.data();
    if (data.ownerId && data.members && data.members[data.ownerId]) {
      console.log(`Fixing owner ${data.ownerId} for org ${orgDoc.id}...`);
      await updateDoc(doc(db, "organizations", orgDoc.id), {
        [`members.${data.ownerId}.role`]: "admin",
        [`members.${data.ownerId}.autoApprove`]: true
      });
      console.log(`Done fixing org ${orgDoc.id}`);
    } else if (data.ownerId && data.members) {
      console.log(`Owner ${data.ownerId} not in members for org ${orgDoc.id}, injecting...`);
      await updateDoc(doc(db, "organizations", orgDoc.id), {
        [`members.${data.ownerId}`]: {
           role: "admin",
           autoApprove: true,
           displayName: "Owner",
           email: "owner@rock.org"
        }
      });
    }
  }
  console.log("All org owners elevated to admin successfully!");
  process.exit(0);
}

fixAdmins().catch(console.error);
