import { NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// POST /api/dev/seed — peuple Firestore avec des comptes et une structure de test.
// Dev-only : bloqué en production. Tous les documents créés ont `isDev: true` pour
// permettre un cleanup en un appel via /api/dev/cleanup.

const DEV_STRUCTURE_ID = 'dev_test_structure';
const DEV_SUBTEAM_ID = 'dev_test_subteam';

const DEV_USERS = [
  { uid: 'discord_dev_founder',   displayName: 'Fondateur Dev',    username: 'founder_dev' },
  { uid: 'discord_dev_cofounder', displayName: 'Co-fondateur Dev', username: 'cofounder_dev' },
  { uid: 'discord_dev_manager',   displayName: 'Manager Dev',      username: 'manager_dev' },
  { uid: 'discord_dev_coach',     displayName: 'Coach Dev',        username: 'coach_dev' },
  { uid: 'discord_dev_player1',   displayName: 'Joueur 1 Dev',     username: 'player1_dev' },
  { uid: 'discord_dev_player2',   displayName: 'Joueur 2 Dev',     username: 'player2_dev' },
  { uid: 'discord_dev_player3',   displayName: 'Joueur 3 Dev',     username: 'player3_dev' },
  { uid: 'discord_dev_player4',   displayName: 'Joueur 4 Dev',     username: 'player4_dev' },
  { uid: 'discord_dev_admin',     displayName: 'Admin Dev',        username: 'admin_dev' },
] as const;

export async function POST() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Dev only' }, { status: 403 });
  }

  const db = getAdminDb();
  const adminAuth = getAdminAuth();
  const batch = db.batch();

  // 1) Users Firestore + comptes Firebase Auth (pour que les custom tokens fonctionnent)
  for (const u of DEV_USERS) {
    try {
      await adminAuth.getUser(u.uid);
    } catch {
      await adminAuth.createUser({ uid: u.uid, displayName: u.displayName });
    }
    const userRef = db.collection('users').doc(u.uid);
    batch.set(userRef, {
      uid: u.uid,
      discordId: u.uid.replace('discord_', ''),
      discordUsername: u.username,
      displayName: u.displayName,
      discordAvatar: '',
      games: ['rocket_league'],
      country: 'FR',
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // 2) Admin dev — ajouter dans la collection admins
  batch.set(db.collection('admins').doc('discord_dev_admin'), {
    uid: 'discord_dev_admin',
    isDev: true,
    addedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // 3) Structure dev
  batch.set(db.collection('structures').doc(DEV_STRUCTURE_ID), {
    name: 'Dev Test Squad',
    tag: 'DEV',
    logoUrl: '',
    coverUrl: '',
    description: 'Structure de test pour le dev. Supprimez via /api/dev/cleanup.',
    games: ['rocket_league'],
    founderId: 'discord_dev_founder',
    coFounderIds: ['discord_dev_cofounder'],
    managerIds: ['discord_dev_manager'],
    coachIds: ['discord_dev_coach'],
    status: 'active',
    recruiting: { active: true, positions: [{ game: 'rocket_league', role: 'joueur' }] },
    achievements: [],
    socials: {},
    discordUrl: '',
    isDev: true,
    validatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // 4) Membres — tous sauf admin rejoignent la structure dev
  //    Rôle structurel : fondateur / co_fondateur / joueur (manager/coach sont dans les arrays côté structure)
  const memberships: { uid: string; role: string }[] = [
    { uid: 'discord_dev_founder',   role: 'fondateur' },
    { uid: 'discord_dev_cofounder', role: 'co_fondateur' },
    { uid: 'discord_dev_manager',   role: 'joueur' },
    { uid: 'discord_dev_coach',     role: 'joueur' },
    { uid: 'discord_dev_player1',   role: 'joueur' },
    { uid: 'discord_dev_player2',   role: 'joueur' },
    { uid: 'discord_dev_player3',   role: 'joueur' },
    { uid: 'discord_dev_player4',   role: 'joueur' },
  ];
  for (const m of memberships) {
    const memberRef = db.collection('structure_members').doc(`${DEV_STRUCTURE_ID}_${m.uid}`);
    batch.set(memberRef, {
      structureId: DEV_STRUCTURE_ID,
      userId: m.uid,
      game: 'rocket_league',
      role: m.role,
      isDev: true,
      joinedAt: FieldValue.serverTimestamp(),
    });
  }

  // 5) Une sous-équipe RL avec 3 titulaires + 1 remplaçant
  batch.set(db.collection('sub_teams').doc(DEV_SUBTEAM_ID), {
    structureId: DEV_STRUCTURE_ID,
    game: 'rocket_league',
    name: 'Équipe Principale',
    playerIds: ['discord_dev_player1', 'discord_dev_player2', 'discord_dev_player3'],
    subIds: ['discord_dev_player4'],
    staffIds: ['discord_dev_coach', 'discord_dev_manager'],
    isDev: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  // 6) Deux events (un à venir, un dans quelques jours)
  //    startsAt/endsAt DOIVENT être des Firestore Timestamp — les API serveur
  //    appellent `.toMillis()` / `.toDate()` dessus (cf availability route).
  const now = Date.now();
  const in2h = Timestamp.fromMillis(now + 2 * 3600 * 1000);
  const in3h = Timestamp.fromMillis(now + 3 * 3600 * 1000);
  const in3d = Timestamp.fromMillis(now + 3 * 86400 * 1000);
  const in3dEnd = Timestamp.fromMillis(now + 3 * 86400 * 1000 + 90 * 60 * 1000);

  // Utilisateurs invités pour chaque event (target = teams) = titulaires + subs + staff
  // de la sous-équipe ciblée. Même pattern que /api/structures/[id]/events (route POST).
  const invitedUserIds = [
    'discord_dev_player1', 'discord_dev_player2', 'discord_dev_player3',
    'discord_dev_player4',
    'discord_dev_coach', 'discord_dev_manager',
  ];

  batch.set(db.collection('structure_events').doc('dev_event_training'), {
    structureId: DEV_STRUCTURE_ID,
    createdBy: 'discord_dev_coach',
    title: 'Entraînement Mécaniques',
    type: 'training',
    description: 'Session mécaniques + aerials',
    location: '',
    startsAt: in2h,
    endsAt: in3h,
    target: { scope: 'teams', teamIds: [DEV_SUBTEAM_ID] },
    status: 'scheduled',
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    compteRendu: '',
    aTravailler: '',
    adversaire: null,
    isDev: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('structure_events').doc('dev_event_scrim'), {
    structureId: DEV_STRUCTURE_ID,
    createdBy: 'discord_dev_manager',
    title: 'Scrim vs équipe X',
    type: 'scrim',
    description: '',
    location: '',
    startsAt: in3d,
    endsAt: in3dEnd,
    target: { scope: 'teams', teamIds: [DEV_SUBTEAM_ID] },
    status: 'scheduled',
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    compteRendu: '',
    aTravailler: '',
    adversaire: 'Équipe X',
    isDev: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // 7) Presences — une ligne par (event, user invité). Sans ces rows,
  //    /api/calendar/me ne renverra pas les events (il query event_presences
  //    WHERE userId==uid), et la vue joueur sera vide.
  for (const eventId of ['dev_event_training', 'dev_event_scrim']) {
    for (const userId of invitedUserIds) {
      const pRef = db.collection('event_presences').doc(`${eventId}_${userId}`);
      batch.set(pRef, {
        eventId,
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

  await batch.commit();
  return NextResponse.json({ ok: true, users: DEV_USERS.length, structure: DEV_STRUCTURE_ID });
}
