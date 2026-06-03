import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb, verifyAuth, isAdmin as isAdminUid } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';
import { isValidRLPlatform, buildTrackerGgUrl, type RLPlatform } from '@/lib/rl-platform';
import { pickValorantRiotId, type DiscordConnection } from '@/lib/discord-connections';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { computeAge } from '@/lib/age';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { isValidRLRank } from '@/lib/rl-ranks';
import { sendAdminAlert } from '@/lib/admin-discord-alert';

type ProfileStructure = {
  id: string;
  /** Slug propre pour construire l'URL publique côté client via getStructureHref(). */
  slug: string | null;
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
      slug: (s.slug as string | undefined) ?? null,
      name: (s.name as string) || '',
      tag: (s.tag as string) || '',
      logoUrl: (s.logoUrl as string) || '',
      role,
      teams,
    };
  });
}

// Champs privés, jamais renvoyés aux autres utilisateurs.
// `dateOfBirth` sert uniquement à calculer l'âge côté serveur.
// Champs strippés pour les visiteurs tiers (non owner). Les champs Valorant
// 'rank'/'rr'/'source'/'syncedAt' restent publics (affichés sur la fiche)
// mais le PUUID Riot est filtré (identifiant immuable utilisé en interne pour
// la vérif anti-mensonge, pas besoin d'être exposé même si non secret au sens
// strict). La connection Discord riotgames porte le même PUUID et reste filtrée
// par visibleOnProfile.
const PRIVATE_FIELDS = [
  'dateOfBirth', 'discordId', 'isBanned', 'banReason', 'bannedAt', 'bannedBy',
  'valorantPuuid', 'valorantPuuidLinkedAt',
  // RiotID brut résolu par le sync : strippé pour les tiers. Le RiotID exposé
  // aux tiers passe UNIQUEMENT par le champ dérivé `valorantRiotId`, lui-même
  // gaté sur la visibilité de la connection (voir plus bas), pour que le toggle
  // « Masqué » de Settings → Comptes liés protège réellement l'identité Riot.
  'valorantRiotName', 'valorantRiotTag',
];

// GET /api/profile?uid=discord_XXX OU /api/profile?slug=noxx-26, lire un profil
// On accepte les deux pour la transition slug : les liens internes utilisent le
// slug, mais l'API publique reste compat avec l'uid pour les intégrations.
// Si le requester est le propriétaire (token Firebase), renvoie le document complet.
// Sinon, masque les champs privés et expose uniquement `age` calculé serveur.
export async function GET(req: NextRequest) {
  const uidParam = req.nextUrl.searchParams.get('uid');
  const slugParam = req.nextUrl.searchParams.get('slug');
  if (!uidParam && !slugParam) {
    return NextResponse.json({ error: 'uid ou slug requis' }, { status: 400 });
  }

  // Rate-limit : endpoint public + enrichi (fetch structures/sub_teams), protège
  // contre le scraping en masse des profils.
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const db = getAdminDb();

    // Lookup direct par uid si fourni, sinon lookup par slug via where()
    let snap: FirebaseFirestore.DocumentSnapshot | null = null;
    if (uidParam) {
      snap = await db.collection('users').doc(uidParam).get();
    } else if (slugParam) {
      const querySnap = await db.collection('users').where('slug', '==', slugParam).limit(1).get();
      if (!querySnap.empty) snap = querySnap.docs[0];
    }

    if (!snap || !snap.exists) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // L'uid effectif pour les checks d'ownership et les lookups dépendants
    const uid = snap.id;

    const data = snap.data() ?? {};
    const requesterUid = await verifyAuth(req);
    const isOwner = requesterUid === uid;
    const structures = await fetchUserStructures(uid);
    // Flag smurf suspecté : admin-only, jamais visible par le joueur lui-même
    // (sinon il s'en va avant qu'on enquête) ni par les autres visiteurs (risque
    // diffamation). On le strippe partout sauf pour les admins consultant la
    // fiche d'un autre joueur.
    const requesterIsAdmin = requesterUid ? await isAdminUid(requesterUid) : false;
    const canSeeSmurfFlag = requesterIsAdmin && !isOwner;

    // Identité RL « officielle » : on ne considère VÉRIFIÉ que les snapshots
    // explicitement confirmés par le joueur (rlEpicId via Lot 2, rlSteamId via
    // le nouveau flow Steam). Avoir Steam OpenID lié à Aedral (steamLinked)
    // ou Epic sur Discord ne suffit PAS, beaucoup de joueurs ont un Steam
    // mais jouent RL sur Epic (et inversement). Voir docs/rl-rank-verification-plan.md.
    const hasOfficialEpic = !!data.rlEpicId;
    const hasOfficialSteam = !!data.rlSteamId;
    // Priorité Epic post-F2P : tracker.gg/epic est plus fiable que tracker.gg/steam.
    const useEpic = hasOfficialEpic;
    const useSteam = !useEpic && hasOfficialSteam;
    const rlAccountFields = {
      rlAccountVerified: hasOfficialEpic || hasOfficialSteam,
      rlAccountName: useEpic
        ? ((data.rlEpicName as string) || '')
        : useSteam
          ? ((data.rlSteamName as string) || '')
          : '',
      rlAccountPlatform: useEpic ? 'epic' : useSteam ? 'steam' : '',
      // SteamID64 exposé uniquement quand on l'utilise pour l'URL tracker.gg
      rlSteamId64: useSteam ? (data.rlSteamId as string) : '',
    };

    // Identité Valorant « vérifiée » — miroir du système RL ci-dessus.
    // Contrairement à RL (où Epic/Steam peut différer du compte de JEU réel,
    // d'où l'exigence d'un link explicite), Valorant n'a qu'UN compte Riot :
    // la connection Discord `riotgames` EST le compte de jeu, attestée par
    // l'OAuth Discord (preuve de possession non déclarative). On considère donc
    // VÉRIFIÉ dès qu'on a un PUUID stocké (posé au 1er sync HenrikDev) OU une
    // connection riotgames liée. Voir memory project_valorant_verification_plan.
    const valorantConnections = data.discordConnections as DiscordConnection[] | undefined;
    const valorantRiot = pickValorantRiotId(valorantConnections);
    // VÉRIFIÉ = preuve de possession d'un compte Riot : PUUID stocké (posé au
    // 1er sync) OU connection Discord riotgames liée (OAuth). Ce booléen ne
    // révèle pas l'identité → il est exposé à tous (owner + tiers).
    const valorantAccountVerified = !!data.valorantPuuid || !!valorantRiot;
    // RiotID "Name#TAG" pour le lien tracker.gg. On le résout en préférant le
    // RiotID stocké au sync (valorantRiotName/Tag) — fiable, tag garanti — et on
    // tombe sur la connection Discord seulement si elle a déjà le tag (sinon URL
    // tracker.gg cassée). Tant qu'il manque, le badge reste « vérifié » sans lien.
    const valorantRiotIdFull = (() => {
      const storedName = (data.valorantRiotName as string | undefined)?.trim();
      const storedTag = (data.valorantRiotTag as string | undefined)?.trim();
      if (storedName && storedTag) return `${storedName}#${storedTag}`;
      if (valorantRiot && valorantRiot.tag) return `${valorantRiot.name}#${valorantRiot.tag}`;
      return '';
    })();
    // Le RiotID est l'identité de jeu publiquement résolvable (lien direct vers
    // l'historique tracker.gg). Contrairement à RL (compte lié par action dédiée
    // = consentement explicite à l'exposition), Valorant capte le compte via la
    // connection Discord, masquée par défaut. On respecte donc le toggle
    // `visibleOnProfile` : un tiers ne voit le RiotID (et le lien tracker) que si
    // l'user a rendu sa connection Riot visible. L'owner voit toujours le sien.
    const riotConnVisible = (valorantConnections ?? []).some(
      c => c.type === 'riotgames' && c.visibleOnProfile === true,
    );
    // Rang Valorant : exposé UNIQUEMENT s'il vient du sync auto HenrikDev. Les
    // rangs déclarés legacy (source 'declared', saisie manuelle supprimée) ne
    // doivent plus fuiter — un rang affiché = forcément vérifié. Tous les
    // consommateurs du profil (badge, settings owner) héritent de ce gate.
    const valorantRankVerified = data.valorantRankSource === 'henrikdev'
      ? ((data.valorantRank as string) || '')
      : '';

    // Flag smurf : récupéré uniquement quand un admin (non-owner) consulte la
    // fiche. Stocké dans user_admin_flags/{uid} (collection server-only) pour
    // ne pas leaker via Firestore client.
    let suspectedSmurfFlag: Record<string, unknown> | null = null;
    if (canSeeSmurfFlag) {
      try {
        const flagSnap = await getAdminDb().collection('user_admin_flags').doc(uid).get();
        const flag = flagSnap.data()?.suspectedSmurf;
        if (flag && typeof flag === 'object') {
          // Sérialise les Timestamps en ISO pour le JSON
          const flaggedAt = flag.flaggedAt;
          const flaggedAtIso = flaggedAt && typeof flaggedAt === 'object' && 'toDate' in flaggedAt
            ? (flaggedAt as { toDate: () => Date }).toDate().toISOString()
            : null;
          suspectedSmurfFlag = {
            flaggedAt: flaggedAtIso,
            flaggedBy: flag.flaggedBy ?? null,
            reportId: flag.reportId ?? null,
            note: flag.note ?? null,
          };
        }
      } catch (err) {
        console.error('[Profile GET] smurf flag fetch failed:', err);
      }
    }

    if (isOwner) {
      // L'owner ne voit JAMAIS son propre flag (sinon il fuit avant enquête).
      // Le filtrage est garanti par construction : on n'a pas fetché le flag
      // ci-dessus pour les owners.
      return NextResponse.json({
        uid, ...data, ...rlAccountFields,
        valorantAccountVerified, valorantRiotId: valorantRiotIdFull,
        valorantRank: valorantRankVerified,
        structures,
      });
    }

    // Vue publique : on calcule l'âge et on retire les champs privés
    const publicData: Record<string, unknown> = {
      uid,
      ...data,
      ...rlAccountFields,
      valorantAccountVerified,
      // Gaté sur la visibilité de la connection Riot (cf. plus haut). Le badge
      // « vérifié » reste affiché via le booléen ; seul le lien tracker dépend
      // de ce champ, donc un RiotID masqué = badge vérifié sans lien pour le tiers.
      valorantRiotId: riotConnVisible ? valorantRiotIdFull : '',
      valorantRank: valorantRankVerified,
      age: computeAge(data.dateOfBirth),
      structures,
    };
    for (const field of PRIVATE_FIELDS) delete publicData[field];
    // Inject le flag uniquement quand on l'a fetché (= admin viewer)
    if (suspectedSmurfFlag) publicData.suspectedSmurfFlag = suspectedSmurfFlag;

    // Discord connections : filtrer côté serveur sur visibleOnProfile.
    // Sécu critique, sans ça, le toggle "Masqué" dans Settings ne protège rien,
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

// POST /api/profile, sauvegarder son profil
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

    // Rate limit après auth, on peut utiliser le uid comme clé
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

    // RL : on stocke (rlPlatform, rlPlatformId), modèle cross-platform.
    // On mirror dans les champs legacy (epicAccountId/epicDisplayName/rlTrackerUrl)
    // pour que le code qui lit encore ces champs fonctionne, sera nettoyé plus tard.
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

    // Connexions Discord, on n'accepte du client QUE les changements de
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
      // PAS de rang Valorant déclaratif : le rang Valorant provient UNIQUEMENT du
      // sync auto HenrikDev (compte Riot lié, source 'henrikdev'), donc impossible
      // de mentir. La saisie manuelle a été retirée. On ne touche pas ici aux
      // champs valorantRank/valorantRankSource (gérés par le sync, merge:true).
      isAvailableForRecruitment: body.isAvailableForRecruitment || false,
      recruitmentRole: body.isAvailableForRecruitment ? body.recruitmentRole || '' : '',
      recruitmentMessage: body.isAvailableForRecruitment ? clampString(body.recruitmentMessage, LIMITS.recruitmentMessage) : '',
      ...(updatedConnections ? { discordConnections: updatedConnections } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Détection changement de rang RL, voir docs/rl-rank-verification-plan.md.
    // Si le joueur modifie son rang déclaré, on horodate (rlRankChangedAt) :
    //  - le cooldown anti-spam des signalements saute pour ce joueur
    //    (l'API /api/profile/[uid]/rank-report compare cette date),
    //  - et on ping l'admin sur Discord pour qu'il puisse jeter un œil.
    const newRank = profileData.rlRank as string;
    const oldRank = (existingData.rlRank as string) || '';
    const rankChanged = existing.exists && newRank !== oldRank;
    if (rankChanged) {
      profileData.rlRankChangedAt = FieldValue.serverTimestamp();
    }

    if (!existing.exists) {
      profileData.createdAt = FieldValue.serverTimestamp();
    }

    await userRef.set(profileData, { merge: true });

    // Ping admin Discord post-écriture (fire-and-forget), seulement si le rang
    // a vraiment changé (pas à la création du profil).
    if (rankChanged) {
      try {
        const fromLabel = oldRank || '(vide)';
        const toLabel = newRank || '(retiré)';
        await sendAdminAlert(db, {
          title: '🔁 Rang RL modifié',
          description: `**${(profileData.displayName as string) || uid}** a changé son rang : \`${fromLabel}\` → \`${toLabel}\`\n\n`
            + `[Voir le profil](https://aedral.com/profile/${uid})`,
        });
      } catch (err) {
        console.error('[Profile POST] rank change admin alert failed:', err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Profile POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
