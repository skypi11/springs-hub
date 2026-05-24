import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { loadCronState, saveCronState } from '@/lib/cron-state';

// POST /api/admin/backfill-counters
// Recalcule `counters.teams` et `counters.members` pour toutes les structures
// en lisant l'état réel. À lancer pour réconcilier (ex: après un import ou
// une suspicion de drift) — les writes incrémentent/décrémentent normalement
// en direct.
//
// SCALABILITÉ : pagination cursor + état persisté dans `_cron_state`. Chaque
// run traite STRUCTURES_PER_RUN structures puis renvoie `partial: true`.
// Relance jusqu'à `partial: false`. Coût par run constant peu importe la
// taille de la base.
//
// Pour chaque page de structures, on bat les sub_teams + structure_members
// via `where structureId IN (chunk de 30)` — 1 query / 30 structures.
//
// Idempotent : peut être relancé sans risque (écrase avec la vraie valeur).
// Option `{ reset: true }` pour relancer un cycle depuis le début.

export const maxDuration = 60;

const STRUCTURES_PER_RUN = 200;
const FIRESTORE_IN_CHUNK = 30;
const STATE_KEY = 'backfill_counters';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const body = await req.json().catch(() => ({}));
    if (body?.reset === true) {
      await saveCronState(db, STATE_KEY, { lastCursor: null, lastRunAt: Date.now() });
    }

    const state = await loadCronState(db, STATE_KEY);

    // Pagination structures
    let query: FirebaseFirestore.Query = db
      .collection('structures')
      .orderBy('__name__')
      .limit(STRUCTURES_PER_RUN);
    if (state?.lastCursor) {
      const cursorDoc = await db.collection('structures').doc(state.lastCursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }
    const structuresSnap = await query.get();
    const structureIds = structuresSnap.docs.map(d => d.id);

    // Batch fetch teams + members via where IN par chunks de 30
    const teamsCountByStructure = new Map<string, number>();
    const membersCountByStructure = new Map<string, number>();

    for (let i = 0; i < structureIds.length; i += FIRESTORE_IN_CHUNK) {
      const chunk = structureIds.slice(i, i + FIRESTORE_IN_CHUNK);
      const [teamsSnap, membersSnap] = await Promise.all([
        db.collection('sub_teams')
          .where('structureId', 'in', chunk)
          .where('status', '==', 'active')
          .get(),
        db.collection('structure_members').where('structureId', 'in', chunk).get(),
      ]);
      for (const doc of teamsSnap.docs) {
        const sid = doc.data().structureId as string | undefined;
        if (!sid) continue;
        teamsCountByStructure.set(sid, (teamsCountByStructure.get(sid) ?? 0) + 1);
      }
      for (const doc of membersSnap.docs) {
        const sid = doc.data().structureId as string | undefined;
        if (!sid) continue;
        membersCountByStructure.set(sid, (membersCountByStructure.get(sid) ?? 0) + 1);
      }
    }

    // Écriture batchée — chunks de 400 (limite Firestore : 500 ops)
    const CHUNK = 400;
    const updates = structuresSnap.docs.map(doc => ({
      id: doc.id,
      teams: teamsCountByStructure.get(doc.id) ?? 0,
      members: membersCountByStructure.get(doc.id) ?? 0,
    }));
    for (let i = 0; i < updates.length; i += CHUNK) {
      const batch = db.batch();
      for (const u of updates.slice(i, i + CHUNK)) {
        batch.update(db.collection('structures').doc(u.id), {
          counters: { teams: u.teams, members: u.members },
        });
      }
      await batch.commit();
    }

    // Advance cursor / cycle complete
    const cycleComplete = structuresSnap.docs.length < STRUCTURES_PER_RUN;
    const newCursor = cycleComplete ? null : structuresSnap.docs[structuresSnap.docs.length - 1].id;
    await saveCronState(db, STATE_KEY, {
      lastCursor: newCursor,
      lastRunAt: Date.now(),
      processed: updates.length,
      cycleStartedAt: state?.lastCursor ? state.cycleStartedAt : Date.now(),
    });

    return NextResponse.json({
      ok: true,
      partial: !cycleComplete,
      structuresUpdatedThisRun: updates.length,
      cycleComplete,
      message: cycleComplete
        ? `${updates.length} structure(s) recalculée(s) — cycle TERMINÉ.`
        : `${updates.length} structure(s) recalculée(s). Relance pour continuer.`,
    });
  } catch (err) {
    captureApiError('API Admin/BackfillCounters POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
