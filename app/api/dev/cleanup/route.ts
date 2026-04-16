import { NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';

// POST /api/dev/cleanup — supprime toutes les données de seed dev.
// Filtre tout ce qui a le flag `isDev: true` dans les collections concernées,
// plus les comptes Firebase Auth associés et l'admin dev.

const COLLECTIONS_WITH_ISDEV = [
  'users',
  'structures',
  'structure_members',
  'sub_teams',
  'structure_events',
  'event_presences',
  'structure_invitations',
  'structure_member_history',
  'admins',
];

export async function POST() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Dev only' }, { status: 403 });
  }

  const db = getAdminDb();
  const adminAuth = getAdminAuth();
  const report: Record<string, number> = {};

  for (const col of COLLECTIONS_WITH_ISDEV) {
    const snap = await db.collection(col).where('isDev', '==', true).get();
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    if (snap.size > 0) await batch.commit();
    report[col] = snap.size;
  }

  // Nettoyer les structure_members orphelins rattachés à la structure dev —
  // les accept/auto-join créent ces docs sans hériter du flag isDev du seed.
  const orphanMembersSnap = await db.collection('structure_members')
    .where('structureId', '==', 'dev_test_structure')
    .get();
  if (orphanMembersSnap.size > 0) {
    const batch = db.batch();
    for (const doc of orphanMembersSnap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
  report.orphanMembers = orphanMembersSnap.size;

  // Même raison : les invitations créées en runtime (join_request, direct_invite,
  // invite_link, auto-join) ne portent pas isDev et trainent après un reset.
  const orphanInvSnap = await db.collection('structure_invitations')
    .where('structureId', '==', 'dev_test_structure')
    .get();
  if (orphanInvSnap.size > 0) {
    const batch = db.batch();
    for (const doc of orphanInvSnap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
  report.orphanInvitations = orphanInvSnap.size;

  // Historique : les accept/leave en runtime n'héritent pas du flag isDev, on cible par structureId
  const orphanHistorySnap = await db.collection('structure_member_history')
    .where('structureId', '==', 'dev_test_structure')
    .get();
  if (orphanHistorySnap.size > 0) {
    const batch = db.batch();
    for (const doc of orphanHistorySnap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
  report.orphanHistory = orphanHistorySnap.size;

  // Supprimer les comptes Firebase Auth dev
  const devUids = [
    'discord_dev_founder',
    'discord_dev_cofounder',
    'discord_dev_manager',
    'discord_dev_coach',
    'discord_dev_player1',
    'discord_dev_player2',
    'discord_dev_player3',
    'discord_dev_player4',
    'discord_dev_admin',
    'discord_dev_recruit1',
    'discord_dev_recruit2',
    'discord_dev_recruit3',
  ];
  let authDeleted = 0;
  for (const uid of devUids) {
    try {
      await adminAuth.deleteUser(uid);
      authDeleted++;
    } catch {
      // user déjà absent — on ignore
    }
  }
  report.firebaseAuth = authDeleted;

  return NextResponse.json({ ok: true, deleted: report });
}
