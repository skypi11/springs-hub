import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function initAdmin() {
  if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
    initializeApp({ credential: cert(serviceAccount) });
  }
}

// GET /api/auth/me — retourne le profil utilisateur + statut admin
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Token manquant' }, { status: 401 });
    }

    initAdmin();

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const db = getFirestore();
    const [userSnap, adminSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('admins').doc(uid).get(),
    ]);

    return NextResponse.json({
      user: userSnap.exists ? userSnap.data() : null,
      isAdmin: adminSnap.exists,
    });
  } catch (err) {
    console.error('[API Auth/me] error:', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
