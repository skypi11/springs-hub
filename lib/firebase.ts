import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps',
  authDomain: 'monthly-cup.firebaseapp.com',
  projectId: 'monthly-cup',
  storageBucket: 'monthly-cup.firebasestorage.app',
  messagingSenderId: '82527508810',
  appId: '1:82527508810:web:ca14ebfdeffb24d09889b3',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = initializeFirestore(app, { experimentalForceLongPolling: true });

const authInstance = getAuth(app);
if (typeof window !== 'undefined') {
  setPersistence(authInstance, browserLocalPersistence).catch(() => {});
}
export const auth = authInstance;
export { app };
