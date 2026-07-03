// Bac à sable de test du module compétitions — structures et joueurs FICTIFS
// pour dérouler inscription + validation + provisioning en conditions réelles
// sans comptes bis. Server-only, piloté par /api/admin/competitions/sandbox.
//
// Principes :
// - Tous les docs portent `isDev: true` → invisibles des annuaires publics et
//   des stats (filtrage déjà en place : /api/structures, /api/players,
//   /api/public/stats). Les uids sont préfixés `discord_dev_` (jamais un vrai
//   snowflake, compatible avec les gardes du système dev existant).
// - Les dirigeants fictifs sont impersonables via le système admin existant
//   (/api/admin/impersonate/start — admins Aedral, audit-loggé, bannière).
// - Les profils couvrent exprès tous les cas de la file de validation :
//   mineur (dérogation), âge inconnu, compte non vérifié, signalements smurf
//   + flag admin, rosters propres.
// - Idempotent : doc ids déterministes, re-seed = upsert. Le cleanup retire
//   TOUT, y compris les traces créées pendant les tests (inscriptions,
//   circuit_teams, notifications) et recale les compteurs approvedCount.

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';

const UID = (slug: string) => `discord_dev_lgd_${slug}`;

export const SANDBOX_STRUCTURES = [
  {
    id: 'dev-lgd-wolves',
    name: 'TEST Wolves Esport',
    tag: 'WLV',
    ownerUid: UID('wolves_owner'),
    teams: [
      {
        id: 'dev-lgd-wolves-alpha',
        name: 'Wolves Alpha',
        playerSlugs: ['wolves_p1', 'wolves_p2', 'wolves_p3'],
        subSlugs: ['wolves_p4', 'wolves_p5'],
      },
      {
        id: 'dev-lgd-wolves-academy',
        name: 'Wolves Academy',
        playerSlugs: ['wolves_p6', 'wolves_p7', 'wolves_p8'],
        subSlugs: [],
      },
    ],
  },
  {
    id: 'dev-lgd-ravens',
    name: 'TEST Ravens Club',
    tag: 'RVN',
    ownerUid: UID('ravens_owner'),
    teams: [
      {
        id: 'dev-lgd-ravens-main',
        name: 'Ravens Main',
        playerSlugs: ['ravens_p1', 'ravens_p2', 'ravens_p3'],
        subSlugs: ['ravens_p4'],
      },
      {
        id: 'dev-lgd-ravens-rookies',
        name: 'Ravens Rookies',
        playerSlugs: ['ravens_p5', 'ravens_p6', 'ravens_p7'],
        subSlugs: [],
      },
    ],
  },
] as const;

interface SandboxUser {
  slug: string;
  displayName: string;
  rlRank: string;
  /** null = pas de date de naissance renseignée (cas « âge inconnu »). */
  dateOfBirth: string | null;
  /** false = pas de compte Epic/Steam lié (drapeau unverified_account). */
  verified: boolean;
  /** Signalements smurf pending + flag admin (agrégat anonymisé console). */
  smurfCase?: boolean;
  country: string;
}

// Cas limites concentrés dans Wolves Alpha : mineur en titulaire, non-vérifié
// et joueur signalé smurf en remplaçants. Les autres équipes sont des dossiers
// propres pour tester le chemin nominal (et le cap → liste d'attente).
export const SANDBOX_USERS: SandboxUser[] = [
  { slug: 'wolves_owner', displayName: 'TEST Sam (Wolves)', rlRank: 'Champion II', dateOfBirth: '1998-04-12', verified: true, country: 'FR' },
  { slug: 'wolves_p1', displayName: 'TEST Nova', rlRank: 'Grand Champion I', dateOfBirth: '2002-06-08', verified: true, country: 'FR' },
  { slug: 'wolves_p2', displayName: 'TEST Drift', rlRank: 'Champion III', dateOfBirth: '2003-11-21', verified: true, country: 'BE' },
  { slug: 'wolves_p3', displayName: 'TEST Pixel', rlRank: 'Champion I', dateOfBirth: '2011-03-15', verified: true, country: 'FR' },       // mineur → dérogation
  { slug: 'wolves_p4', displayName: 'TEST Ghost', rlRank: 'Champion II', dateOfBirth: '2001-09-02', verified: false, country: 'FR' },     // non vérifié
  { slug: 'wolves_p5', displayName: 'TEST Wraith', rlRank: 'Diamond III', dateOfBirth: '2000-01-27', verified: true, smurfCase: true, country: 'FR' }, // signalé smurf
  { slug: 'wolves_p6', displayName: 'TEST Comet', rlRank: 'Champion I', dateOfBirth: '2004-05-19', verified: true, country: 'FR' },
  { slug: 'wolves_p7', displayName: 'TEST Sonar', rlRank: 'Champion II', dateOfBirth: '2002-12-03', verified: true, country: 'FR' },
  { slug: 'wolves_p8', displayName: 'TEST Vertex', rlRank: 'Diamond II', dateOfBirth: '2005-08-30', verified: true, country: 'BE' },
  { slug: 'ravens_owner', displayName: 'TEST Lena (Ravens)', rlRank: 'Diamond I', dateOfBirth: '1996-02-14', verified: true, country: 'FR' },
  { slug: 'ravens_p1', displayName: 'TEST Falcon', rlRank: 'Champion III', dateOfBirth: '2001-07-11', verified: true, country: 'FR' },
  { slug: 'ravens_p2', displayName: 'TEST Orbit', rlRank: 'Champion II', dateOfBirth: '2003-03-25', verified: true, country: 'FR' },
  { slug: 'ravens_p3', displayName: 'TEST Blitz', rlRank: 'Champion I', dateOfBirth: '2004-10-07', verified: true, country: 'CH' },
  { slug: 'ravens_p4', displayName: 'TEST Echo', rlRank: 'Diamond III', dateOfBirth: null, verified: true, country: 'FR' },               // âge inconnu → dérogation
  { slug: 'ravens_p5', displayName: 'TEST Rune', rlRank: 'Champion I', dateOfBirth: '2002-01-16', verified: true, country: 'FR' },
  { slug: 'ravens_p6', displayName: 'TEST Zenith', rlRank: 'Diamond II', dateOfBirth: '2003-06-29', verified: true, country: 'FR' },
  { slug: 'ravens_p7', displayName: 'TEST Aster', rlRank: 'Champion II', dateOfBirth: '2000-11-09', verified: true, country: 'FR' },
];

export const SANDBOX_UIDS = SANDBOX_USERS.map(u => UID(u.slug));
const SANDBOX_STRUCTURE_IDS = SANDBOX_STRUCTURES.map(s => s.id);
const SMURF_REPORT_IDS = ['dev-lgd-report-1', 'dev-lgd-report-2'];

// ── Seed ────────────────────────────────────────────────────────────────────

export async function seedCompetitionSandbox(db: Firestore, adminAuth: Auth): Promise<{ users: number; structures: number; teams: number }> {
  // 1) Comptes Firebase Auth (requis par l'impersonation admin).
  for (const u of SANDBOX_USERS) {
    const uid = UID(u.slug);
    try {
      await adminAuth.getUser(uid);
    } catch {
      try {
        await adminAuth.createUser({ uid, displayName: u.displayName });
      } catch { /* course bénigne */ }
    }
  }

  const batch = db.batch();

  // 2) users + user_secrets
  for (const u of SANDBOX_USERS) {
    const uid = UID(u.slug);
    const structure = SANDBOX_STRUCTURES.find(s =>
      s.ownerUid === uid || s.teams.some(t =>
        (t.playerSlugs as readonly string[]).includes(u.slug) || (t.subSlugs as readonly string[]).includes(u.slug)));
    batch.set(db.collection('users').doc(uid), {
      uid,
      discordId: uid.replace('discord_', ''),   // jamais un vrai snowflake
      discordUsername: u.slug.replace('_', '.'),
      displayName: u.displayName,
      discordAvatar: '',
      games: ['rocket_league'],
      country: u.country,
      rlRank: u.rlRank,
      ...(u.verified ? {
        rlEpicId: `dev-lgd-epic-${u.slug}`,
        rlEpicName: u.displayName.replace(/\s+/g, ''),
      } : {}),
      ...(u.dateOfBirth ? { hasDateOfBirth: true } : {}),
      ...(structure ? { structurePerGame: { rocket_league: [structure.id] } } : {}),
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (u.dateOfBirth) {
      batch.set(db.collection('user_secrets').doc(uid), { dateOfBirth: u.dateOfBirth }, { merge: true });
    }
  }

  // 3) Cas smurf : 2 signalements pending + flag admin (agrégat anonymisé).
  const smurf = SANDBOX_USERS.find(u => u.smurfCase)!;
  const smurfUid = UID(smurf.slug);
  SMURF_REPORT_IDS.forEach((rid, i) => {
    batch.set(db.collection('rank_reports').doc(rid), {
      targetUid: smurfUid,
      targetName: smurf.displayName,
      game: 'rocket_league',
      targetRank: smurf.rlRank,
      targetRlRank: smurf.rlRank,
      motif: 'smurf',
      message: 'Signalement fictif du bac à sable',
      reporterUid: `dev-lgd-reporter-${i + 1}`,
      reporterName: `TEST Reporter ${i + 1}`,
      status: 'pending',
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  batch.set(db.collection('user_admin_flags').doc(smurfUid), {
    suspectedSmurf: {
      flaggedAt: Timestamp.now(),
      flaggedBy: 'sandbox',
      reportId: SMURF_REPORT_IDS[0],
      note: 'Flag fictif du bac à sable',
    },
  }, { merge: true });

  // 4) Structures + membres + équipes
  let teamsCount = 0;
  for (const s of SANDBOX_STRUCTURES) {
    batch.set(db.collection('structures').doc(s.id), {
      name: s.name,
      slug: s.id,
      tag: s.tag,
      logoUrl: '',
      description: 'Structure fictive du bac à sable compétitions — invisible du public, supprimable en un clic depuis /admin/competitions.',
      games: ['rocket_league'],
      founderId: s.ownerUid,
      coFounderIds: [],
      managerIds: [],
      coachIds: [],
      status: 'active',
      isDev: true,
      validatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const memberSlugs = new Set<string>();
    for (const t of s.teams) {
      for (const slug of [...t.playerSlugs, ...t.subSlugs]) memberSlugs.add(slug);
    }
    const ownerSlug = SANDBOX_USERS.find(u => UID(u.slug) === s.ownerUid)!.slug;
    memberSlugs.add(ownerSlug);
    for (const slug of memberSlugs) {
      const uid = UID(slug);
      batch.set(db.collection('structure_members').doc(`${s.id}_${uid}_rocket_league`), {
        structureId: s.id,
        userId: uid,
        game: 'rocket_league',
        role: uid === s.ownerUid ? 'fondateur' : 'joueur',
        isDev: true,
        joinedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    for (const t of s.teams) {
      teamsCount += 1;
      batch.set(db.collection('sub_teams').doc(t.id), {
        structureId: s.id,
        game: 'rocket_league',
        name: t.name,
        status: 'active',
        playerIds: t.playerSlugs.map(UID),
        subIds: t.subSlugs.map(UID),
        captainId: UID(t.playerSlugs[0]),
        isDev: true,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  await batch.commit();
  return { users: SANDBOX_USERS.length, structures: SANDBOX_STRUCTURES.length, teams: teamsCount };
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export async function cleanupCompetitionSandbox(db: Firestore, adminAuth: Auth): Promise<{ registrations: number; circuitTeams: number }> {
  let registrationsDeleted = 0;
  let circuitTeamsDeleted = 0;
  const touchedCompetitionIds = new Set<string>();

  // 1) Inscriptions laissées par les tests (+ circuit_teams qu'elles ont créées).
  for (const sid of SANDBOX_STRUCTURE_IDS) {
    const regsSnap = await db.collection('competition_registrations')
      .where('structureId', '==', sid).get();
    for (const doc of regsSnap.docs) {
      const r = doc.data();
      touchedCompetitionIds.add(r.competitionId as string);
      const ctId = r.circuitTeamId as string | null;
      if (ctId) {
        const ctRef = db.collection('circuit_teams').doc(ctId);
        const ctSnap = await ctRef.get();
        // On ne supprime une circuit_team que si elle ne porte aucune
        // participation close (le bac à sable n'en produit pas — garde-fou
        // au cas où des données réelles partageraient l'id).
        if (ctSnap.exists && ((ctSnap.data()?.participations as unknown[]) ?? []).length === 0) {
          await ctRef.collection('private').doc('state').delete().catch(() => {});
          await ctRef.delete();
          circuitTeamsDeleted += 1;
        }
      }
      await doc.ref.delete();
      registrationsDeleted += 1;
    }
  }

  // 2) Compteurs approvedCount recalés sur la réalité post-suppression.
  for (const compId of touchedCompetitionIds) {
    const agg = await db.collection('competition_registrations')
      .where('competitionId', '==', compId)
      .where('status', '==', 'approved')
      .count().get();
    await db.collection('competitions').doc(compId)
      .update({ approvedCount: agg.data().count || 0 }).catch(() => {});
  }

  // 3) Notifications reçues par les comptes fictifs.
  for (let i = 0; i < SANDBOX_UIDS.length; i += 10) {
    const chunk = SANDBOX_UIDS.slice(i, i + 10);
    const snap = await db.collection('notifications').where('userId', 'in', chunk).get();
    for (const doc of snap.docs) await doc.ref.delete();
  }

  // 4) Signalements fictifs (ids déterministes + tout signalement accumulé
  //    pendant les tests sur les comptes fictifs).
  for (const rid of SMURF_REPORT_IDS) {
    await db.collection('rank_reports').doc(rid).delete().catch(() => {});
  }
  for (let i = 0; i < SANDBOX_UIDS.length; i += 10) {
    const chunk = SANDBOX_UIDS.slice(i, i + 10);
    const snap = await db.collection('rank_reports').where('targetUid', 'in', chunk).get();
    for (const doc of snap.docs) await doc.ref.delete();
  }

  // 5) Structures, membres, historique, équipes.
  for (const sid of SANDBOX_STRUCTURE_IDS) {
    for (const coll of ['structure_members', 'structure_member_history']) {
      const snap = await db.collection(coll).where('structureId', '==', sid).get();
      for (const doc of snap.docs) await doc.ref.delete();
    }
    const teamsSnap = await db.collection('sub_teams').where('structureId', '==', sid).get();
    for (const doc of teamsSnap.docs) await doc.ref.delete();
    await db.collection('structures').doc(sid).delete();
  }

  // 6) Comptes fictifs (docs + secrets + flags + Auth).
  const batch = db.batch();
  for (const uid of SANDBOX_UIDS) {
    batch.delete(db.collection('users').doc(uid));
    batch.delete(db.collection('user_secrets').doc(uid));
    batch.delete(db.collection('user_admin_flags').doc(uid));
  }
  await batch.commit();
  await adminAuth.deleteUsers(SANDBOX_UIDS).catch(() => {});

  return { registrations: registrationsDeleted, circuitTeams: circuitTeamsDeleted };
}

// ── État (pour le panel admin) ──────────────────────────────────────────────

export async function getSandboxState(db: Firestore): Promise<{
  exists: boolean;
  structures: Array<{
    id: string;
    name: string;
    tag: string;
    owner: { uid: string; displayName: string };
    teams: Array<{ name: string; playersCount: number }>;
  }>;
}> {
  const snaps = await db.getAll(...SANDBOX_STRUCTURE_IDS.map(id => db.collection('structures').doc(id)));
  const exists = snaps.some(s => s.exists);
  if (!exists) return { exists: false, structures: [] };
  return {
    exists: true,
    structures: SANDBOX_STRUCTURES.map(s => ({
      id: s.id,
      name: s.name,
      tag: s.tag,
      owner: {
        uid: s.ownerUid,
        displayName: SANDBOX_USERS.find(u => UID(u.slug) === s.ownerUid)?.displayName ?? s.ownerUid,
      },
      teams: s.teams.map(t => ({
        name: t.name,
        playersCount: t.playerSlugs.length + t.subSlugs.length,
      })),
    })),
  };
}
