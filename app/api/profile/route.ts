import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';
import { isValidRLPlatform, buildTrackerGgUrl, type RLPlatform } from '@/lib/rl-platform';
import type { DiscordConnection } from '@/lib/discord-connections';
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

  // Rate-limit : endpoint public + enrichi (fetch structures/sub_teams) — protège
  // contre le scraping en masse des profils.
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

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

    // Identité RL « officielle » pour la fiche — calculée AVANT tout filtrage
    // des connexions Discord. C'est précisément l'objectif : la fiche doit
    // afficher le compte de jeu vérifié + son lien tracker, indépendamment du
    // toggle « visible sur profil » des connexions (qui sert à masquer les
    // réseaux sociaux, pas l'identité de jeu publique).
    // Le pseudo Epic n'est pas sensible — il est déjà sur tracker.gg pour
    // quiconque cherche le joueur. Voir docs/rl-rank-verification-plan.md.
    const allConns = (data.discordConnections as DiscordConnection[] | undefined) ?? [];
    const verifiedEpic = allConns.find(c => c.type === 'epicgames' && c.verified && c.name);
    const epicNameForUrl = (data.rlEpicName as string) || verifiedEpic?.name || '';
    const rlAccountFields = {
      rlAccountVerified: !!data.rlEpicId || !!data.steamLinked?.steamId64,
      rlAccountName: epicNameForUrl
        || (data.steamLinked?.personaName as string)
        || '',
      rlAccountPlatform: epicNameForUrl
        ? 'epic'
        : (data.steamLinked?.steamId64 ? 'steam' : ''),
      rlSteamId64: data.steamLinked?.steamId64 || '',
    };

    if (isOwner) {
      return NextResponse.json({ ...data, ...rlAccountFields, structures });
    }

    // Vue publique : on calcule l'âge et on retire les champs privés
    const publicData: Record<string, unknown> = {
      ...data,
      ...rlAccountFields,
      age: computeAge(data.dateOfBirth),
      structures,
    };
    for (const field of PRIVATE_FIELDS) delete publicData[field];

    // Discord connections : filtrer côté serveur sur visibleOnProfile.
    // Sécu critique — sans ça, le toggle "Masqué" dans Settings ne protège rien,
    // les connexions privées (Twitter/Spotify/Twitch/Epic IDs) seraient leakées
    // à n'importe quel visiteur qui appelle GET /api/profile?uid=X.
    if (Array.isArray(publicData.discordConnections)) {
      publicData.discordConnections = (publicData.discordConnections as DiscordConnection[])
        .filter(c => c.visibleOnProfile === true);
    }

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
    if (body.games.includes('rocket_league')) {
      if (!isValidRLPlatform(body.rlPlatform)) {
        return NextResponse.json({ error: 'Sélectionne ta plateforme pour Rocket League.' }, { status: 400 });
      }
      if (!body.rlPlatformId?.trim()) {
        return NextResponse.json({ error: 'Ton identifiant sur cette plateforme est obligatoire pour RL.' }, { status: 400 });
      }
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

    // RL : on stocke (rlPlatform, rlPlatformId) — modèle cross-platform.
    // On mirror dans les champs legacy (epicAccountId/epicDisplayName/rlTrackerUrl)
    // pour que le code qui lit encore ces champs fonctionne — sera nettoyé plus tard.
    let rlPlatform: RLPlatform | '' = '';
    let rlPlatformId = '';
    let legacyEpicAccountId = existingData.epicAccountId ?? '';
    let legacyEpicDisplayName = existingData.epicDisplayName ?? '';
    let legacyRlTrackerUrl = '';
    if (body.games.includes('rocket_league') && isValidRLPlatform(body.rlPlatform)) {
      const platform: RLPlatform = body.rlPlatform;
      const platformId = clampString(body.rlPlatformId, 100).trim();
      rlPlatform = platform;
      rlPlatformId = platformId;
      legacyRlTrackerUrl = buildTrackerGgUrl(platform, platformId);
      // Si plateforme Epic, on synchronise les champs legacy pour rétrocompat
      if (platform === 'epic') {
        legacyEpicAccountId = platformId;
        legacyEpicDisplayName = platformId;
      }
    }

    // Connexions Discord — on n'accepte du client QUE les changements de
    // visibleOnProfile. Les autres champs (type, id, name, verified) sont
    // pilotés par le pull au login Discord et ne doivent pas être modifiables
    // par l'user (sinon il pourrait spoofer "j'ai un compte Twitch vérifié").
    let updatedConnections: DiscordConnection[] | undefined;
    const existingConnections = (existingData.discordConnections ?? []) as DiscordConnection[];
    if (Array.isArray(body.connectionVisibility)) {
      const visMap = new Map<string, boolean>(
        body.connectionVisibility
          .filter((v: unknown): v is { type: string; visible: boolean } =>
            typeof v === 'object' && v !== null &&
            typeof (v as { type: unknown }).type === 'string' &&
            typeof (v as { visible: unknown }).visible === 'boolean'
          )
          .map((v: { type: string; visible: boolean }) => [v.type, v.visible])
      );
      updatedConnections = existingConnections.map(c => ({
        ...c,
        visibleOnProfile: visMap.has(c.type) ? visMap.get(c.type)! : (c.visibleOnProfile ?? false),
      }));
    }

    const profileData: Record<string, unknown> = {
      uid,
      displayName: clampString(body.displayName, LIMITS.displayName),
      avatarUrl: safeUrl(body.avatarUrl),
      bio: clampString(body.bio, LIMITS.bio),
      country: body.country,
      dateOfBirth: body.dateOfBirth,
      games: body.games,
      rlPlatform,
      rlPlatformId,
      // Legacy fields (rétrocompat avec lecteurs existants)
      epicAccountId: legacyEpicAccountId,
      epicDisplayName: legacyEpicDisplayName,
      rlTrackerUrl: legacyRlTrackerUrl,
      rlRank: body.games.includes('rocket_league') && isValidRLRank(body.rlRank) ? body.rlRank : '',
      pseudoTM: body.games.includes('trackmania') ? body.pseudoTM?.trim() || '' : '',
      loginTM: body.games.includes('trackmania') ? body.loginTM?.trim() || '' : '',
      tmIoUrl: body.games.includes('trackmania') ? safeUrl(body.tmIoUrl) : '',
      isAvailableForRecruitment: body.isAvailableForRecruitment || false,
      recruitmentRole: body.isAvailableForRecruitment ? body.recruitmentRole || '' : '',
      recruitmentMessage: body.isAvailableForRecruitment ? clampString(body.recruitmentMessage, LIMITS.recruitmentMessage) : '',
      ...(updatedConnections ? { discordConnections: updatedConnections } : {}),
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
