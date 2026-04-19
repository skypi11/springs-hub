import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveEpicAccount } from '@/lib/tracker-gg';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { computeAge } from '@/lib/age';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { isValidRLRank } from '@/lib/rl-ranks';

type ProfileStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  role: 'fondateur' | 'co_fondateur' | 'responsable' | 'coach_structure' | 'manager_equipe' | 'coach_equipe' | 'capitaine' | 'joueur' | 'remplacant' | 'membre';
  teams: { id: string; name: string; game: string; role: 'joueur' | 'remplacant' | 'coach' | 'manager' | 'capitaine' }[];
};

async function fetchUserStructures(uid: string): Promise<ProfileStructure[]> {
  const db = getAdminDb();
  const memberSnap = await db.collection('structure_members').where('userId', '==', uid).get();
  if (memberSnap.empty) return [];

  const structureIds = Array.from(new Set(
    memberSnap.docs.map(d => d.data().structureId as string).filter(Boolean)
  ));
  if (structureIds.length === 0) return [];

  const structuresById = await fetchDocsByIds(db, 'structures', structureIds);
  const activeIds = structureIds.filter(sid => structuresById.get(sid)?.status === 'active');
  if (activeIds.length === 0) return [];

  const teamsByStructure = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (let i = 0; i < activeIds.length; i += 30) {
    const chunk = activeIds.slice(i, i + 30);
    const snap = await db.collection('sub_teams').where('structureId', 'in', chunk).get();
    for (const t of snap.docs) {
      const sid = t.data().structureId as string;
      if (!teamsByStructure.has(sid)) teamsByStructure.set(sid, []);
      teamsByStructure.get(sid)!.push(t);
    }
  }

  return activeIds.map(sid => {
    const s = structuresById.get(sid)!;
    const founderId = s.founderId as string;
    const coFounderIds = (s.coFounderIds ?? []) as string[];
    const managerIds = (s.managerIds ?? []) as string[];
    const coachIds = (s.coachIds ?? []) as string[];

    const teams: ProfileStructure['teams'] = [];
    for (const t of teamsByStructure.get(sid) ?? []) {
      const d = t.data();
      if ((d.status ?? 'active') === 'archived') continue;
      const playerIds = (d.playerIds ?? []) as string[];
      const subIds = (d.subIds ?? []) as string[];
      const staffIds = (d.staffIds ?? []) as string[];
      const staffRoles = (d.staffRoles ?? {}) as Record<string, 'coach' | 'manager'>;
      const captainId = (d.captainId ?? null) as string | null;

      if (staffIds.includes(uid)) {
        teams.push({ id: t.id, name: d.name as string, game: d.game as string, role: staffRoles[uid] ?? 'coach' });
      }
      if (captainId === uid) {
        teams.push({ id: t.id, name: d.name as string, game: d.game as string, role: 'capitaine' });
      } else if (playerIds.includes(uid)) {
        teams.push({ id: t.id, name: d.name as string, game: d.game as string, role: 'joueur' });
      } else if (subIds.includes(uid)) {
        teams.push({ id: t.id, name: d.name as string, game: d.game as string, role: 'remplacant' });
      }
    }

    let role: ProfileStructure['role'];
    if (founderId === uid) role = 'fondateur';
    else if (coFounderIds.includes(uid)) role = 'co_fondateur';
    else if (managerIds.includes(uid)) role = 'responsable';
    else if (coachIds.includes(uid)) role = 'coach_structure';
    else if (teams.some(t => t.role === 'manager')) role = 'manager_equipe';
    else if (teams.some(t => t.role === 'coach')) role = 'coach_equipe';
    else if (teams.some(t => t.role === 'capitaine')) role = 'capitaine';
    else if (teams.some(t => t.role === 'joueur' || t.role === 'remplacant')) role = 'joueur';
    else role = 'membre';

    return {
      id: sid,
      name: (s.name as string) || '',
      tag: (s.tag as string) || '',
      logoUrl: (s.logoUrl as string) || '',
      role,
      teams,
    };
  });
}

// Champs privés — jamais renvoyés aux autres utilisateurs.
// `dateOfBirth` sert uniquement à calculer l'âge côté serveur.
const PRIVATE_FIELDS = ['dateOfBirth', 'discordId', 'isBanned', 'banReason', 'bannedAt', 'bannedBy'];

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
    const structures = await fetchUserStructures(uid);

    if (isOwner) {
      return NextResponse.json({ ...data, structures });
    }

    // Vue publique : on calcule l'âge et on retire les champs privés
    const publicData: Record<string, unknown> = { ...data, age: computeAge(data.dateOfBirth), structures };
    for (const field of PRIVATE_FIELDS) delete publicData[field];
    return NextResponse.json(publicData);
  } catch (err) {
    captureApiError('API Profile GET error', err);
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

    // Rate limit après auth — on peut utiliser le uid comme clé
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

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
    if (body.games.includes('rocket_league') && !body.rlTrackerUrl?.trim()) {
      return NextResponse.json({ error: "L'URL RL Tracker est obligatoire pour RL." }, { status: 400 });
    }
    if (body.games.includes('trackmania') && !body.pseudoTM?.trim()) {
      return NextResponse.json({ error: 'Le pseudo Ubisoft est obligatoire pour TM.' }, { status: 400 });
    }
    if (body.games.includes('trackmania') && !body.tmIoUrl?.trim()) {
      return NextResponse.json({ error: "L'URL Trackmania.io est obligatoire pour TM." }, { status: 400 });
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
      rlRank: body.games.includes('rocket_league') && isValidRLRank(body.rlRank) ? body.rlRank : '',
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
    captureApiError('API Profile POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
