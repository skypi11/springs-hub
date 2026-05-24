// POST /api/admin/users/mass
// Actions admin qui touchent tous les utilisateurs en batch :
//   - action='force_disconnect_all'  → revokeRefreshTokens Firebase pour tous
//     (sauf l'admin qui clique, pour éviter le suicide de session). Sert à
//     forcer une re-connexion Discord — typiquement pour la migration des
//     refresh_token (Lot 2 du rang RL).
//   - action='sync_discord_all'      → syncDiscordMember pour tous (pseudo
//     serveur + 7 rôles). Bonus : complète le cron nocturne à la demande.
//
// SCALABILITÉ : pagination cursor + état persisté par action dans `_cron_state`.
// Chaque appel traite MAX_PER_RUN users puis renvoie `partial: true` + le
// cursor. L'admin (ou un script) relance l'appel jusqu'à `partial: false`.
// Coût par run constant peu importe la taille de la base — scale infiniment.
//
// Confirmation server-side : `confirm: 'FORCER'` requis pour la déco (très
// destructive — toutes les sessions tombent). 'sync_discord_all' n'a pas
// besoin de confirm car réversible et bénin.
//
// Voir docs/rl-rank-verification-plan.md.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { syncDiscordMember } from '@/lib/discord-role-sync';
import { loadCronState, saveCronState } from '@/lib/cron-state';
import type { Firestore } from 'firebase-admin/firestore';

export const maxDuration = 60;

// Limites par run (sous le timeout Vercel 60s Hobby avec marge)
const FORCE_DISCO_LIMIT_PER_RUN = 500;   // ~10ms / revokeRefreshTokens = 5s
const DISCORD_SYNC_LIMIT_PER_RUN = 200;  // 80ms + sync ≈ ~30s

// Pagine la collection users avec un cursor persisté par action.
async function fetchUsersPage(
  db: Firestore,
  stateKey: string,
  limit: number,
): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[]; cycleComplete: boolean }> {
  const state = await loadCronState(db, stateKey);

  let query = db.collection('users').orderBy('__name__').limit(limit);
  if (state?.lastCursor) {
    const cursorDoc = await db.collection('users').doc(state.lastCursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snap = await query.get();
  const cycleComplete = snap.docs.length < limit;
  return { docs: snap.docs, cycleComplete };
}

async function advanceCursor(
  db: Firestore,
  stateKey: string,
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  cycleComplete: boolean,
  processed: number,
): Promise<void> {
  const state = await loadCronState(db, stateKey);
  const newCursor = cycleComplete || docs.length === 0 ? null : docs[docs.length - 1].id;
  await saveCronState(db, stateKey, {
    lastCursor: newCursor,
    lastRunAt: Date.now(),
    processed,
    cycleStartedAt: state?.lastCursor ? state.cycleStartedAt : Date.now(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const adminUid = await verifyAuth(req);
    if (!adminUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(adminUid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, adminUid));
    if (blocked) return blocked;

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';
    const reset = body?.reset === true;

    const db = getAdminDb();

    if (action === 'force_disconnect_all') {
      if (body?.confirm !== 'FORCER') {
        return NextResponse.json({
          error: "Confirmation requise : envoie { confirm: 'FORCER' }.",
        }, { status: 400 });
      }

      const stateKey = 'mass_force_disconnect';
      if (reset) await saveCronState(db, stateKey, { lastCursor: null, lastRunAt: Date.now() });

      const { docs, cycleComplete } = await fetchUsersPage(db, stateKey, FORCE_DISCO_LIMIT_PER_RUN);
      const adminAuth = getAdminAuth();
      const targets = docs.filter(d => d.id !== adminUid); // on s'épargne soi-même
      let revoked = 0;
      let failed = 0;
      const failedIds: string[] = [];

      for (const doc of targets) {
        try {
          await adminAuth.revokeRefreshTokens(doc.id);
          revoked++;
        } catch (err) {
          failed++;
          failedIds.push(doc.id);
          console.error(`[mass force_disconnect] ${doc.id}`, err);
        }
      }

      await advanceCursor(db, stateKey, docs, cycleComplete, docs.length);

      await writeAdminAuditLog(db, {
        action: 'user_force_disconnected',
        adminUid,
        targetType: 'user',
        targetId: 'mass',
        targetLabel: `Mass force-déco run — ${revoked} déconnectés (${failed} échec) | ${cycleComplete ? 'cycle COMPLET' : 'à relancer'}`,
      });

      return NextResponse.json({
        ok: true,
        partial: !cycleComplete,
        message: cycleComplete
          ? `${revoked} session(s) révoquée(s) — cycle TERMINÉ.`
          : `${revoked} session(s) révoquée(s). Relance pour continuer (${docs.length} traités ce run).`,
        revoked,
        failed,
        failedIds: failed > 0 ? failedIds : undefined,
        processedThisRun: docs.length,
        cycleComplete,
        note: 'Toi-même n\'a PAS été déconnecté(e) — pour ne pas casser ta session admin.',
      });
    }

    if (action === 'sync_discord_all') {
      const stateKey = 'mass_sync_discord';
      if (reset) await saveCronState(db, stateKey, { lastCursor: null, lastRunAt: Date.now() });

      const { docs, cycleComplete } = await fetchUsersPage(db, stateKey, DISCORD_SYNC_LIMIT_PER_RUN);
      let synced = 0;
      let notOnServer = 0;
      let noDiscord = 0;
      let errored = 0;
      const startedAt = Date.now();
      const HARD_DEADLINE_MS = 50_000; // marge sous le timeout Vercel function (60s Hobby)

      let lastProcessedIndex = -1;
      for (let i = 0; i < docs.length; i++) {
        if (Date.now() - startedAt > HARD_DEADLINE_MS) {
          // Sortie anticipée — on persiste le cursor au dernier user traité
          // pour reprendre au bon endroit au prochain run.
          break;
        }
        const doc = docs[i];
        try {
          const r = await syncDiscordMember(db, doc.id);
          if (r === 'synced') synced++;
          else if (r === 'not_on_server') notOnServer++;
          else if (r === 'no_discord_id') noDiscord++;
          else errored++;
        } catch (err) {
          errored++;
          console.error(`[mass sync_discord] ${doc.id}`, err);
        }
        lastProcessedIndex = i;
        await new Promise(r => setTimeout(r, 80));
      }

      // Si on a été stoppé par le deadline avant la fin de la page, on persiste
      // le cursor au dernier user effectivement traité (pas docs[length-1]).
      const processedDocs = lastProcessedIndex >= 0 ? docs.slice(0, lastProcessedIndex + 1) : [];
      const reachedEndOfPage = lastProcessedIndex === docs.length - 1;
      const effectiveCycleComplete = reachedEndOfPage && cycleComplete;
      await advanceCursor(db, stateKey, processedDocs, effectiveCycleComplete, processedDocs.length);

      return NextResponse.json({
        ok: true,
        partial: !effectiveCycleComplete,
        message: effectiveCycleComplete
          ? `${synced} joueur(s) synchronisé(s) sur Discord — cycle TERMINÉ.`
          : `${synced} joueur(s) synchronisé(s). Relance pour continuer (${processedDocs.length} traités ce run).`,
        synced,
        notOnServer,
        noDiscord,
        errored,
        processedThisRun: processedDocs.length,
        cycleComplete: effectiveCycleComplete,
      });
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
  } catch (err) {
    captureApiError('API admin/users/mass error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
