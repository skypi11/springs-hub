import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveEpicAccount } from '@/lib/tracker-gg';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';

// Champs privés — jamais renvoyés aux autres utilisateurs.
// `dateOfBirth` sert uniquement à calculer l'âge côté serveur.
const PRIVATE_FIELDS = ['dateOfBirth', 'discordId', 'isBanned', 'banReason', 'bannedAt', 'bannedBy'];

function computeAge(dateStr: unknown): number | null {
  if (typeof dateStr !== 'string' || !dateStr) return null;
  const birth = new Date(dateStr);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

// GET /api/profile?uid=discord_XXX — lire un profil
// Si le requester est le propriétaire (token Firebase), renvoie le document complet.
// Sinon, masque les champs privés et expose uniquement `age` calculé serveur.
export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get('uid');
  if (!uid) {
    return NextResponse.json({ error: 'uid requis' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection('users').doc(uid).get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const data = snap.data() ?? {};
    const requesterUid = await verifyAuth(req);
    const isOwner = requesterUid === uid;

    if (isOwner) {
      return NextResponse.json(data);
    }

    // Vue publique : on calcule l'âge et on retire les champs privés
    const publicData: Record<string, unknown> = { ...data, age: computeAge(data.dateOfBirth) };
    for (const field of PRIVATE_FIELDS) delete publicData[field];
    return NextResponse.json(publicData);
  } catch (err) {
    console.error('[API Profile] GET error:', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

// POST /api/profile — sauvegarder son profil
export async function POST(req: NextRequest) {
  try {
    // Vérifier le token Firebase de l'utilisateur
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Token manquant' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await getAdminAuth().verifyIdToken(idToken);
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

    // Vérifier âge minimum (calcul précis : on compare année/mois/jour)
    const birth = new Date(body.dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    if (age < 13) {
      return NextResponse.json({ error: 'Tu dois avoir au moins 13 ans.' }, { status: 400 });
    }

    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const existing = await userRef.get();
    const existingData = existing.data() ?? {};

    // Résolution Epic — on stocke l'ID Epic permanent (et pas le pseudo qui peut changer)
    let epicAccountId = '';
    let epicDisplayName = '';
    if (body.games.includes('rocket_league')) {
      const typed = body.epicAccountId?.trim() || '';
      epicDisplayName = typed;
      // Si la saisie a changé, on retente la résolution. Sinon on garde l'ID stocké.
      if (typed && typed !== existingData.epicDisplayName) {
        const resolved = await resolveEpicAccount(typed);
        if (resolved) {
          epicAccountId = resolved.id;
          epicDisplayName = resolved.displayName;
        } else {
          // Fallback : on garde la saisie comme identifiant de lookup
          epicAccountId = typed;
        }
      } else {
        epicAccountId = existingData.epicAccountId || typed;
      }
    }

    const profileData: Record<string, unknown> = {
      uid,
      displayName: clampString(body.displayName, LIMITS.displayName),
      avatarUrl: safeUrl(body.avatarUrl),
      bio: clampString(body.bio, LIMITS.bio),
      country: body.country,
      dateOfBirth: body.dateOfBirth,
      games: body.games,
      epicAccountId,
      epicDisplayName,
      rlTrackerUrl: body.games.includes('rocket_league') ? safeUrl(body.rlTrackerUrl) : '',
      pseudoTM: body.games.includes('trackmania') ? body.pseudoTM?.trim() || '' : '',
      loginTM: body.games.includes('trackmania') ? body.loginTM?.trim() || '' : '',
      tmIoUrl: body.games.includes('trackmania') ? safeUrl(body.tmIoUrl) : '',
      isAvailableForRecruitment: body.isAvailableForRecruitment || false,
      recruitmentRole: body.isAvailableForRecruitment ? body.recruitmentRole || '' : '',
      recruitmentMessage: body.isAvailableForRecruitment ? clampString(body.recruitmentMessage, LIMITS.recruitmentMessage) : '',
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!existing.exists) {
      profileData.createdAt = FieldValue.serverTimestamp();
    }

    await userRef.set(profileData, { merge: true });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API Profile] POST error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
