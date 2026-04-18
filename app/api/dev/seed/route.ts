import { NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { DEV_UIDS, DEV_STRUCTURE_ID } from '@/lib/dev-seed-constants';

// POST /api/dev/seed — peuple Firestore avec un jeu complet de comptes de test
// couvrant TOUS les rôles (structure + équipe) et 3 équipes actives + 1 archivée.
// Dev-only : bloqué en production. Tous les documents créés ont `isDev: true`
// pour permettre un cleanup en un appel via /api/dev/cleanup.

// IDs d'équipes — stables pour faciliter le debug en console Firestore.
const TEAM_ELITE_ID = 'dev_team_rl_elite';
const TEAM_ACADEMY_ID = 'dev_team_rl_academy';
const TEAM_TM_ID = 'dev_team_tm_squad';
const TEAM_LEGACY_ID = 'dev_team_rl_legacy'; // archivée

type UserSeed = {
  uid: string;
  displayName: string;
  username: string;
  games: string[];
  rlRank?: string;
  rlMmr?: number;
  pseudoTM?: string;
};

const DEV_USERS: UserSeed[] = [
  { uid: DEV_UIDS.founder,          displayName: 'Fondateur Dev',         username: 'founder_dev',          games: ['rocket_league', 'trackmania'] },
  { uid: DEV_UIDS.cofounder,        displayName: 'Co-fondateur Dev',      username: 'cofounder_dev',        games: ['rocket_league'] },
  { uid: DEV_UIDS.responsable,      displayName: 'Responsable Dev',       username: 'responsable_dev',      games: ['rocket_league'] },
  { uid: DEV_UIDS.coachStructure,   displayName: 'Coach Structure Dev',   username: 'coach_struct_dev',     games: ['rocket_league', 'trackmania'] },
  { uid: DEV_UIDS.teamManager,      displayName: "Manager d'équipe Dev",  username: 'team_manager_dev',     games: ['rocket_league'] },
  { uid: DEV_UIDS.teamCoach,        displayName: "Coach d'équipe Dev",    username: 'team_coach_dev',       games: ['rocket_league'] },

  { uid: DEV_UIDS.rlEliteCaptain,   displayName: 'Capitaine Elite',       username: 'elite_cap_dev',        games: ['rocket_league'], rlRank: 'Grand Champion II', rlMmr: 1550 },
  { uid: DEV_UIDS.rlEliteP1,        displayName: 'Elite Joueur 1',        username: 'elite_p1_dev',         games: ['rocket_league'], rlRank: 'Grand Champion I',  rlMmr: 1450 },
  { uid: DEV_UIDS.rlEliteP2,        displayName: 'Elite Joueur 2',        username: 'elite_p2_dev',         games: ['rocket_league'], rlRank: 'Grand Champion I',  rlMmr: 1420 },
  { uid: DEV_UIDS.rlEliteSub1,      displayName: 'Elite Remplaçant 1',    username: 'elite_sub1_dev',       games: ['rocket_league'], rlRank: 'Champion III',      rlMmr: 1330 },
  { uid: DEV_UIDS.rlEliteSub2,      displayName: 'Elite Remplaçant 2',    username: 'elite_sub2_dev',       games: ['rocket_league'], rlRank: 'Champion III',      rlMmr: 1310 },

  { uid: DEV_UIDS.rlAcademyCaptain, displayName: 'Capitaine Academy',     username: 'acad_cap_dev',         games: ['rocket_league'], rlRank: 'Champion II',       rlMmr: 1220 },
  { uid: DEV_UIDS.rlAcademyP1,      displayName: 'Academy Joueur 1',      username: 'acad_p1_dev',          games: ['rocket_league'], rlRank: 'Champion I',        rlMmr: 1160 },
  { uid: DEV_UIDS.rlAcademyP2,      displayName: 'Academy Joueur 2',      username: 'acad_p2_dev',          games: ['rocket_league'], rlRank: 'Diamant III',       rlMmr: 1080 },
  { uid: DEV_UIDS.rlAcademySub,     displayName: 'Academy Remplaçant',    username: 'acad_sub_dev',         games: ['rocket_league'], rlRank: 'Diamant II',        rlMmr: 1020 },

  { uid: DEV_UIDS.tmCaptain,        displayName: 'Capitaine TM',          username: 'tm_cap_dev',           games: ['trackmania'], pseudoTM: 'TM-Cap' },
  { uid: DEV_UIDS.tmPlayer,         displayName: 'TM Joueur',             username: 'tm_p_dev',             games: ['trackmania'], pseudoTM: 'TM-Player' },

  { uid: DEV_UIDS.pureMember,       displayName: 'Membre Simple',         username: 'pure_member_dev',      games: ['rocket_league'] },
  { uid: DEV_UIDS.admin,            displayName: 'Admin Dev',             username: 'admin_dev',            games: ['rocket_league', 'trackmania'] },
];

// Joueurs libres au recrutement — pas membres de la structure dev.
const DEV_RECRUITS: (UserSeed & { rlRank: string; rlMmr: number })[] = [
  { uid: DEV_UIDS.recruit1, displayName: 'Recrue 1 Dev', username: 'recruit1_dev', games: ['rocket_league'], rlRank: 'Champion III',     rlMmr: 1320 },
  { uid: DEV_UIDS.recruit2, displayName: 'Recrue 2 Dev', username: 'recruit2_dev', games: ['rocket_league'], rlRank: 'Diamant II',       rlMmr: 1020 },
  { uid: DEV_UIDS.recruit3, displayName: 'Recrue 3 Dev', username: 'recruit3_dev', games: ['rocket_league'], rlRank: 'Grand Champion I', rlMmr: 1480 },
];

type MembershipSeed = { uid: string; game: string; role: string };

// Rôle stocké dans structure_members — informatif, l'affichage est dérivé
// read-time par computeMemberRole. On met `fondateur`/`co_fondateur` pour les
// 2 premiers, `joueur` pour tous ceux qui jouent, `membre` pour ceux qui ne
// sont rattachés à aucune équipe.
const MEMBERSHIPS: MembershipSeed[] = [
  { uid: DEV_UIDS.founder,          game: 'rocket_league', role: 'fondateur' },
  { uid: DEV_UIDS.founder,          game: 'trackmania',    role: 'fondateur' },
  { uid: DEV_UIDS.cofounder,        game: 'rocket_league', role: 'co_fondateur' },
  { uid: DEV_UIDS.responsable,      game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.coachStructure,   game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.coachStructure,   game: 'trackmania',    role: 'joueur' },
  { uid: DEV_UIDS.teamManager,      game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.teamCoach,        game: 'rocket_league', role: 'joueur' },

  { uid: DEV_UIDS.rlEliteCaptain,   game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.rlEliteP1,        game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.rlEliteP2,        game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.rlEliteSub1,      game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.rlEliteSub2,      game: 'rocket_league', role: 'joueur' },

  { uid: DEV_UIDS.rlAcademyCaptain, game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.rlAcademyP1,      game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.rlAcademyP2,      game: 'rocket_league', role: 'joueur' },
  { uid: DEV_UIDS.rlAcademySub,     game: 'rocket_league', role: 'joueur' },

  { uid: DEV_UIDS.tmCaptain,        game: 'trackmania',    role: 'joueur' },
  { uid: DEV_UIDS.tmPlayer,         game: 'trackmania',    role: 'joueur' },

  { uid: DEV_UIDS.pureMember,       game: 'rocket_league', role: 'membre' },
];

export async function POST() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Dev only' }, { status: 403 });
  }

  const db = getAdminDb();
  const adminAuth = getAdminAuth();
  const batch = db.batch();

  // 1) Firebase Auth + docs users
  const allUsers: UserSeed[] = [...DEV_USERS, ...DEV_RECRUITS];
  for (const u of allUsers) {
    try {
      await adminAuth.getUser(u.uid);
    } catch {
      await adminAuth.createUser({ uid: u.uid, displayName: u.displayName });
    }
  }

  for (const u of DEV_USERS) {
    const userRef = db.collection('users').doc(u.uid);
    batch.set(userRef, {
      uid: u.uid,
      discordId: u.uid.replace('discord_', ''),
      discordUsername: u.username,
      displayName: u.displayName,
      discordAvatar: '',
      games: u.games,
      country: 'FR',
      ...(u.rlRank ? { rlRank: u.rlRank } : {}),
      ...(u.rlMmr ? { rlMmr: u.rlMmr } : {}),
      ...(u.pseudoTM ? { pseudoTM: u.pseudoTM } : {}),
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // 1bis) Recrues — flaguées recrutables
  for (const r of DEV_RECRUITS) {
    const userRef = db.collection('users').doc(r.uid);
    batch.set(userRef, {
      uid: r.uid,
      discordId: r.uid.replace('discord_', ''),
      discordUsername: r.username,
      displayName: r.displayName,
      discordAvatar: '',
      games: r.games,
      country: 'FR',
      rlRank: r.rlRank,
      rlMmr: r.rlMmr,
      isAvailableForRecruitment: true,
      recruitmentRole: 'joueur',
      recruitmentMessage: `Salut, je suis ${r.displayName} (${r.rlRank}), dispo en soirée et weekends. À la recherche d'une structure sérieuse pour progresser.`,
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // 2) Admin Springs
  batch.set(db.collection('admins').doc(DEV_UIDS.admin), {
    uid: DEV_UIDS.admin,
    isDev: true,
    addedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // 3) Structure dev — 2 jeux
  batch.set(db.collection('structures').doc(DEV_STRUCTURE_ID), {
    name: 'Dev Test Squad',
    tag: 'DEV',
    logoUrl: '',
    coverUrl: '',
    description: 'Structure de test pour le dev — couvre tous les rôles + 3 équipes actives + 1 archivée. Supprimez via /api/dev/cleanup.',
    games: ['rocket_league', 'trackmania'],
    founderId: DEV_UIDS.founder,
    coFounderIds: [DEV_UIDS.cofounder],
    managerIds: [DEV_UIDS.responsable],
    coachIds: [DEV_UIDS.coachStructure],
    status: 'active',
    recruiting: {
      active: true,
      positions: [{ game: 'rocket_league', role: 'joueur' }],
      message: '## On cherche un **4e joueur Elite** 🚀\n\nSquad GC qui scrim **3 soirs/semaine**. Ambiance détendue mais compétitive.\n\n- Niveau **min. Champion III**\n- Dispo soirées + weekends\n- Communication vocale obligatoire',
    },
    achievements: [],
    socials: {},
    discordUrl: '',
    isDev: true,
    validatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // 4) structure_members + historique (1 entrée ouverte par membre seed)
  for (const m of MEMBERSHIPS) {
    // Pattern ID déterministe ${structureId}_${userId} (unique par user quelle que soit la game).
    // On suffixe par game pour permettre un user multi-jeu dans la même structure.
    const memberRef = db.collection('structure_members').doc(`${DEV_STRUCTURE_ID}_${m.uid}_${m.game}`);
    batch.set(memberRef, {
      structureId: DEV_STRUCTURE_ID,
      userId: m.uid,
      game: m.game,
      role: m.role,
      isDev: true,
      joinedAt: FieldValue.serverTimestamp(),
    });
    const historyRef = db.collection('structure_member_history').doc();
    batch.set(historyRef, {
      structureId: DEV_STRUCTURE_ID,
      userId: m.uid,
      game: m.game,
      role: m.role,
      joinReason: m.role === 'fondateur' ? 'founder' : 'other',
      joinedAt: FieldValue.serverTimestamp(),
      leftAt: null,
      leftReason: null,
      isDev: true,
    });
  }

  // 5) Équipes — 3 actives + 1 archivée
  //    staffRoles = rôle staff par uid (manager vs coach) — manque = 'coach' par défaut.

  // RL Elite (active) — équipe principale RL, avec manager d'équipe dans le staff
  batch.set(db.collection('sub_teams').doc(TEAM_ELITE_ID), {
    structureId: DEV_STRUCTURE_ID,
    game: 'rocket_league',
    name: 'Elite',
    label: 'Équipe principale',
    order: 0,
    groupOrder: 0,
    status: 'active' as const,
    playerIds: [DEV_UIDS.rlEliteCaptain, DEV_UIDS.rlEliteP1, DEV_UIDS.rlEliteP2],
    subIds: [DEV_UIDS.rlEliteSub1, DEV_UIDS.rlEliteSub2],
    staffIds: [DEV_UIDS.teamManager, DEV_UIDS.coachStructure],
    staffRoles: {
      [DEV_UIDS.teamManager]: 'manager',
      [DEV_UIDS.coachStructure]: 'coach',
    },
    captainId: DEV_UIDS.rlEliteCaptain,
    isDev: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  // RL Academy (active) — équipe de développement, avec coach d'équipe dans le staff
  batch.set(db.collection('sub_teams').doc(TEAM_ACADEMY_ID), {
    structureId: DEV_STRUCTURE_ID,
    game: 'rocket_league',
    name: 'Academy',
    label: 'Équipe réserve',
    order: 1,
    groupOrder: 0,
    status: 'active' as const,
    playerIds: [DEV_UIDS.rlAcademyCaptain, DEV_UIDS.rlAcademyP1, DEV_UIDS.rlAcademyP2],
    subIds: [DEV_UIDS.rlAcademySub],
    staffIds: [DEV_UIDS.teamCoach],
    staffRoles: { [DEV_UIDS.teamCoach]: 'coach' },
    captainId: DEV_UIDS.rlAcademyCaptain,
    isDev: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  // TM Squad (active) — équipe Trackmania, 2 joueurs
  batch.set(db.collection('sub_teams').doc(TEAM_TM_ID), {
    structureId: DEV_STRUCTURE_ID,
    game: 'trackmania',
    name: 'TM Squad',
    label: 'Team TM',
    order: 0,
    groupOrder: 0,
    status: 'active' as const,
    playerIds: [DEV_UIDS.tmCaptain, DEV_UIDS.tmPlayer],
    subIds: [],
    staffIds: [DEV_UIDS.coachStructure],
    staffRoles: { [DEV_UIDS.coachStructure]: 'coach' },
    captainId: DEV_UIDS.tmCaptain,
    isDev: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  // RL Legacy (archived) — pour tester l'UI équipes archivées
  batch.set(db.collection('sub_teams').doc(TEAM_LEGACY_ID), {
    structureId: DEV_STRUCTURE_ID,
    game: 'rocket_league',
    name: 'Legacy',
    label: 'Ancienne équipe',
    order: 2,
    groupOrder: 0,
    status: 'archived' as const,
    playerIds: [DEV_UIDS.rlEliteP1, DEV_UIDS.rlAcademyP1],
    subIds: [],
    staffIds: [],
    staffRoles: {},
    captainId: null,
    isDev: true,
    createdAt: FieldValue.serverTimestamp(),
    archivedAt: FieldValue.serverTimestamp(),
  });

  // 6) Events — 1 entraînement Elite + 1 scrim Academy + 1 entraînement TM
  const now = Date.now();
  const ts = (offsetMs: number) => Timestamp.fromMillis(now + offsetMs);
  const H = 3600 * 1000;
  const D = 86_400 * 1000;

  type EventSeed = {
    id: string;
    title: string;
    type: 'training' | 'scrim' | 'match' | 'other';
    teamId: string;
    createdBy: string;
    startsAt: Timestamp;
    endsAt: Timestamp;
    adversaire?: string | null;
    invited: string[];
  };

  const events: EventSeed[] = [
    {
      id: 'dev_event_elite_training',
      title: 'Entraînement mécaniques Elite',
      type: 'training',
      teamId: TEAM_ELITE_ID,
      createdBy: DEV_UIDS.teamManager,
      startsAt: ts(2 * H),
      endsAt: ts(3 * H + 30 * 60 * 1000),
      invited: [
        DEV_UIDS.rlEliteCaptain, DEV_UIDS.rlEliteP1, DEV_UIDS.rlEliteP2,
        DEV_UIDS.rlEliteSub1, DEV_UIDS.rlEliteSub2,
        DEV_UIDS.teamManager, DEV_UIDS.coachStructure,
      ],
    },
    {
      id: 'dev_event_academy_scrim',
      title: 'Scrim Academy vs Team X',
      type: 'scrim',
      teamId: TEAM_ACADEMY_ID,
      createdBy: DEV_UIDS.teamCoach,
      startsAt: ts(2 * D),
      endsAt: ts(2 * D + 90 * 60 * 1000),
      adversaire: 'Team X',
      invited: [
        DEV_UIDS.rlAcademyCaptain, DEV_UIDS.rlAcademyP1, DEV_UIDS.rlAcademyP2,
        DEV_UIDS.rlAcademySub, DEV_UIDS.teamCoach,
      ],
    },
    {
      id: 'dev_event_tm_training',
      title: 'Session TM hunting',
      type: 'training',
      teamId: TEAM_TM_ID,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(4 * D),
      endsAt: ts(4 * D + 2 * H),
      invited: [DEV_UIDS.tmCaptain, DEV_UIDS.tmPlayer, DEV_UIDS.coachStructure],
    },
  ];

  for (const ev of events) {
    batch.set(db.collection('structure_events').doc(ev.id), {
      structureId: DEV_STRUCTURE_ID,
      createdBy: ev.createdBy,
      title: ev.title,
      type: ev.type,
      description: '',
      location: '',
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      target: { scope: 'teams', teamIds: [ev.teamId] },
      status: 'scheduled',
      completedAt: null,
      completedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      compteRendu: '',
      aTravailler: '',
      adversaire: ev.adversaire ?? null,
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const userId of ev.invited) {
      const pRef = db.collection('event_presences').doc(`${ev.id}_${userId}`);
      batch.set(pRef, {
        eventId: ev.id,
        structureId: DEV_STRUCTURE_ID,
        userId,
        status: 'pending',
        wasStructureMember: true,
        respondedAt: null,
        updatedBy: null,
        history: [],
        isDev: true,
      });
    }
  }

  // 7) Invitation : join_request de recruit1 vers la structure dev
  batch.set(db.collection('structure_invitations').doc('dev_join_request_recruit1'), {
    type: 'join_request',
    structureId: DEV_STRUCTURE_ID,
    applicantId: DEV_UIDS.recruit1,
    createdBy: DEV_UIDS.recruit1,
    game: 'rocket_league',
    role: 'joueur',
    message: 'Salut, Champion 3 RL, je cherche une structure pour grind vers le GC. Dispo soir + weekends.',
    status: 'pending',
    isDev: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return NextResponse.json({
    ok: true,
    structure: DEV_STRUCTURE_ID,
    users: DEV_USERS.length,
    recruits: DEV_RECRUITS.length,
    teams: { active: 3, archived: 1 },
    events: events.length,
    rolesCovered: [
      'fondateur', 'co_fondateur', 'responsable', 'coach_structure',
      'manager_equipe', 'coach_equipe', 'capitaine', 'joueur', 'remplacant', 'membre',
      'admin_springs', 'recrue_libre',
    ],
  });
}
