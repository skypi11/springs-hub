import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { checkRateLimit, limiters, rateLimitKey } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { captureApiError } from '@/lib/sentry';

// POST /api/account/delete — RGPD art. 17 (droit à l'effacement).
// Règles :
//   - Bloqué si l'utilisateur est fondateur d'une ou plusieurs structures :
//     il doit d'abord transférer ou demander la suppression de sa structure.
//   - L'utilisateur est retiré de tous les rosters, memberships, invitations,
//     notifications, puis le profil users/{uid} est supprimé et le compte
//     Firebase Auth est révoqué.
//   - Les audit logs contenant son UID sont conservés (obligation légale —
//     intégrité de la plateforme, durée 3 ans).
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const rl = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (rl) return rl;

    const db = getAdminDb();

    // 1) Garde fondateur : on bloque tant qu'une structure a cet uid en founderId.
    const foundedSnap = await db.collection('structures').where('founderId', '==', uid).get();
    if (!foundedSnap.empty) {
      const names = foundedSnap.docs.map(d => d.data().name ?? d.id).slice(0, 5);
      return NextResponse.json({
        error: 'Vous êtes encore fondateur(rice) d\'une ou plusieurs structures. Transférez la propriété avant de supprimer votre compte.',
        structures: names,
      }, { status: 409 });
    }

    // 2) Collecter tout ce qu'il faut nettoyer.
    const [
      membershipsSnap,
      coFoundedSnap,
      managedSnap,
      teamsPlayersSnap,
      teamsSubsSnap,
      teamsStaffSnap,
      teamsCaptainSnap,
      notificationsSnap,
      invitationsCreatedSnap,
      invitationsApplicantSnap,
    ] = await Promise.all([
      db.collection('structure_members').where('userId', '==', uid).get(),
      db.collection('structures').where('coFounderIds', 'array-contains', uid).get(),
      db.collection('structures').where('managerIds', 'array-contains', uid).get(),
      db.collection('sub_teams').where('playerIds', 'array-contains', uid).get(),
      db.collection('sub_teams').where('subIds', 'array-contains', uid).get(),
      db.collection('sub_teams').where('staffIds', 'array-contains', uid).get(),
      db.collection('sub_teams').where('captainId', '==', uid).get(),
      db.collection('notifications').where('userId', '==', uid).get(),
      db.collection('structure_invitations').where('createdBy', '==', uid).get(),
      db.collection('structure_invitations').where('applicantId', '==', uid).get(),
    ]);

    // Merger les 4 snapshots d'équipes sans doublon pour faire un seul update par team.
    const teamsToUpdate = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [teamsPlayersSnap, teamsSubsSnap, teamsStaffSnap, teamsCaptainSnap]) {
      for (const d of snap.docs) teamsToUpdate.set(d.id, d.data());
    }

    // 3) Batch writes — Firestore cap 500 ops/batch, on chunke par sécurité.
    const BATCH_CAP = 400;
    let batch = db.batch();
    let opsInBatch = 0;
    const flushIfFull = async () => {
      if (opsInBatch >= BATCH_CAP) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    };

    // structure_members → delete
    for (const d of membershipsSnap.docs) {
      batch.delete(d.ref);
      opsInBatch++;
      await flushIfFull();
    }

    // structures → retrait de coFounderIds / managerIds
    const structuresToUpdate = new Map<string, { ref: FirebaseFirestore.DocumentReference; updates: Record<string, unknown> }>();
    for (const d of coFoundedSnap.docs) {
      const cur = structuresToUpdate.get(d.id) ?? { ref: d.ref, updates: {} };
      cur.updates.coFounderIds = FieldValue.arrayRemove(uid);
      structuresToUpdate.set(d.id, cur);
    }
    for (const d of managedSnap.docs) {
      const cur = structuresToUpdate.get(d.id) ?? { ref: d.ref, updates: {} };
      cur.updates.managerIds = FieldValue.arrayRemove(uid);
      structuresToUpdate.set(d.id, cur);
    }
    for (const { ref, updates } of structuresToUpdate.values()) {
      batch.update(ref, { ...updates, updatedAt: FieldValue.serverTimestamp() });
      opsInBatch++;
      await flushIfFull();
    }

    // sub_teams → retirer de tous les arrays + nullifier captainId si besoin + retirer staffRoles[uid]
    for (const [teamId, teamData] of teamsToUpdate.entries()) {
      const updates: Record<string, unknown> = {
        playerIds: FieldValue.arrayRemove(uid),
        subIds: FieldValue.arrayRemove(uid),
        staffIds: FieldValue.arrayRemove(uid),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (teamData.captainId === uid) updates.captainId = null;
      if (teamData.staffRoles && typeof teamData.staffRoles === 'object' && uid in teamData.staffRoles) {
        updates[`staffRoles.${uid}`] = FieldValue.delete();
      }
      batch.update(db.collection('sub_teams').doc(teamId), updates);
      opsInBatch++;
      await flushIfFull();
    }

    // notifications → delete
    for (const d of notificationsSnap.docs) {
      batch.delete(d.ref);
      opsInBatch++;
      await flushIfFull();
    }

    // invitations → delete (les invitations créées par l'user ET les demandes en tant que candidat)
    const invitationIds = new Set<string>();
    for (const d of invitationsCreatedSnap.docs) invitationIds.add(d.id);
    for (const d of invitationsApplicantSnap.docs) invitationIds.add(d.id);
    for (const id of invitationIds) {
      batch.delete(db.collection('structure_invitations').doc(id));
      opsInBatch++;
      await flushIfFull();
    }

    // users/{uid} → delete le profil
    batch.delete(db.collection('users').doc(uid));
    opsInBatch++;

    // Flush final
    if (opsInBatch > 0) await batch.commit();

    // 4) Audit log AVANT la suppression Firebase Auth — on garde la trace.
    // Note : adminUid = uid car ici l'acteur est l'utilisateur lui-même (RGPD
    // self-service). Le champ est historiquement nommé "admin" mais représente
    // l'acteur de l'action.
    await writeAdminAuditLog(db, {
      action: 'self_delete_account',
      adminUid: uid,
      targetType: 'user',
      targetId: uid,
      metadata: {
        memberships: membershipsSnap.size,
        teamsUpdated: teamsToUpdate.size,
        structuresUpdated: structuresToUpdate.size,
        notifications: notificationsSnap.size,
        invitations: invitationIds.size,
      },
    });

    // 5) Firebase Auth : suppression du compte (idempotent).
    try {
      await getAdminAuth().deleteUser(uid);
    } catch {
      // Peut déjà avoir été supprimé — on ignore pour l'idempotence.
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API Account/Delete POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
