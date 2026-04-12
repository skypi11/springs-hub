import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';

// GET /api/auth/me — retourne le profil utilisateur + statut admin
// Note : on ne passe pas par verifyAuth() car celui-ci bloque les bannis,
// or ici on veut pouvoir détecter le ban côté client pour afficher un message clair.
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Token manquant' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const db = getAdminDb();
    const [userSnap, adminSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('admins').doc(uid).get(),
    ]);

    // Si l'utilisateur est banni, on coupe immédiatement
    if (userSnap.exists && userSnap.data()?.isBanned === true) {
      return NextResponse.json({ error: 'banned' }, { status: 403 });
    }

    return NextResponse.json({
      user: userSnap.exists ? userSnap.data() : null,
      isAdmin: adminSnap.exists,
    });
  } catch (err) {
    captureApiError('API Auth/me error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
