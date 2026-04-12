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

// GET /api/profile?uid=discord_XXX — lire un profil
export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get('uid');
  if (!uid) {
    return NextResponse.json({ error: 'uid requis' }, { status: 400 });
  }

  try {
    initAdmin();
    const db = getFirestore();
    const snap = await db.collection('users').doc(uid).get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(snap.data());
  } catch (err) {
    console.error('[API Profile] GET error:', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

// POST /api/profile — sauvegarder son profil
export async function POST(req: NextRequest) {
  try {
    initAdmin();

    // Vérifier le token Firebase de l'utilisateur
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Token manquant' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const body = await req.json();

    // Validation serveur
    if (!body.displayName?.trim()) {
      return NextResponse.json({ error: 'Le pseudo est obligatoire.' }, { status: 400 });
    }
    if (!body.country) {
      return NextResponse.json({ error: 'Le pays est obligatoire.' }, { status: 400 });
    }
    if (!body.dateOfBirth) {
      return NextResponse.json({ error: 'La date de naissance est obligatoire.' }, { status: 400 });
    }
    if (!body.games || body.games.length === 0) {
      return NextResponse.json({ error: 'Sélectionne au moins un jeu.' }, { status: 400 });
    }
    if (body.games.includes('rocket_league') && !body.epicAccountId?.trim()) {
      return NextResponse.json({ error: 'Le pseudo Epic Games est obligatoire pour RL.' }, { status: 400 });
    }
    if (body.games.includes('trackmania') && !body.pseudoTM?.trim()) {
      return NextResponse.json({ error: 'Le pseudo Ubisoft est obligatoire pour TM.' }, { status: 400 });
    }

    // Vérifier âge minimum
    const birth = new Date(body.dateOfBirth);
    const age = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 13) {
      return NextResponse.json({ error: 'Tu dois avoir au moins 13 ans.' }, { status: 400 });
    }

    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const existing = await userRef.get();

    const profileData: Record<string, unknown> = {
      uid,
      displayName: body.displayName.trim(),
      avatarUrl: body.avatarUrl?.trim() || '',
      bio: body.bio?.trim() || '',
      country: body.country,
      dateOfBirth: body.dateOfBirth,
      games: body.games,
      epicAccountId: body.games.includes('rocket_league') ? body.epicAccountId?.trim() || '' : '',
      rlTrackerUrl: body.games.includes('rocket_league') ? body.rlTrackerUrl?.trim() || '' : '',
      pseudoTM: body.games.includes('trackmania') ? body.pseudoTM?.trim() || '' : '',
      loginTM: body.games.includes('trackmania') ? body.loginTM?.trim() || '' : '',
      tmIoUrl: body.games.includes('trackmania') ? body.tmIoUrl?.trim() || '' : '',
      isAvailableForRecruitment: body.isAvailableForRecruitment || false,
      recruitmentRole: body.isAvailableForRecruitment ? body.recruitmentRole || '' : '',
      recruitmentMessage: body.isAvailableForRecruitment ? body.recruitmentMessage?.trim() || '' : '',
      updatedAt: new Date(),
    };

    if (!existing.exists) {
      profileData.createdAt = new Date();
    }

    await userRef.set(profileData, { merge: true });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API Profile] POST error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
