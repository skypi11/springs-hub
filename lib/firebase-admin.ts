import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';

export function initAdmin() {
  if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
    initializeApp({ credential: cert(serviceAccount) });
  }
}

export function getAdminDb() {
  initAdmin();
  return getFirestore();
}

export function getAdminAuth() {
  initAdmin();
  return getAuth();
}

// Vérifier le token Firebase et retourner l'uid — null si invalide
// Bloque les utilisateurs bannis
export async function verifyAuth(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    initAdmin();
    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(idToken);
    // Bloquer les bannis
    const userSnap = await getFirestore().collection('users').doc(decoded.uid).get();
    if (userSnap.exists && userSnap.data()?.isBanned === true) return null;
    return decoded.uid;
  } catch {
    return null;
  }
}

// Vérifier que l'uid est admin Springs (collection `admins`)
export async function isAdmin(uid: string): Promise<boolean> {
  const snap = await getAdminDb().collection('admins').doc(uid).get();
  return snap.exists;
}
