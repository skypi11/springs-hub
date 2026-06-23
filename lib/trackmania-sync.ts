// Sync nocturne des trophées + COTD Trackmania via tm.io.
//
// Pattern identique à lib/valorant-sync.ts :
//   - Itère sur les users avec 'trackmania' in games + tmIoUrl renseigné
//   - Cursor-paginé (pagination Firestore + cron-state persisté)
//   - Sleep entre requêtes pour rester poli avec tm.io (community-driven,
//     pas de rate-limit officiel mais on respecte 1 req/seconde)
//   - Stocke les stats en BD avec un timestamp lastSyncedAt
//
// Utilisé par :
// - Greffe dans /api/cron/expire-invitations (cron quotidien Vercel Hobby)
// - Route dédiée /api/cron/sync-trackmania-trophies (test manuel + à la demande)
// - Route /api/me/sync-tm-trophies (bouton "Sync mes trophées" dans Settings)
//
// Important : on a besoin de tmIoUrl pour extraire l'accountId. Si l'user n'a
// que pseudoTM (pas d'URL), on skip — tm.io n'expose pas de recherche par pseudo.

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { fetchTmStats, extractAccountId } from '@/lib/trackmania-tm-io';
import { loadCronState, saveCronState } from '@/lib/cron-state';

const STATE_KEY = 'trackmania_trophies_sync';

// Limites par run, respectent le timeout Vercel Hobby (60s) :
// 25 users × 2 requêtes (player + cotd) × ~500ms latence + 1s sleep entre users
// = ~50s effectifs. Marge sous les 60s. Cycle complet sur N users TM = N/25 jours.
const USERS_LIMIT_PER_RUN = 25;
const TM_IO_DELAY_MS = 1000;

interface SyncStats {
  scanned: number;
  synced: number;
  errors: number;
  noAccountId: number; // users TM sans tmIoUrl valide → skippés
}

/** Update une seule fiche user à la demande (bouton Settings).
 *  Pas de pagination, retourne true si la sync a réussi. */
export async function syncTrackmaniaTrophiesForUser(
  db: Firestore,
  uid: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return { ok: false, reason: 'user_not_found' };
  const data = snap.data() ?? {};
  const tmIoUrl = typeof data.tmIoUrl === 'string' ? data.tmIoUrl : '';
  const accountId = extractAccountId(tmIoUrl);
  if (!accountId) {
    return { ok: false, reason: 'no_tm_io_url' };
  }
  const res = await fetchTmStats(accountId);
  if (!res.ok) {
    return { ok: false, reason: `tm_io_${res.status}` };
  }
  await snap.ref.update(buildUpdates(accountId, res.data));
  return { ok: true };
}

/**
 * Sync les trophées Trackmania d'un batch d'users via tm.io.
 * Cursor-paginé : reprend où le dernier run s'était arrêté.
 *
 * Ignore les users qui :
 * - n'ont pas 'trackmania' dans games
 * - n'ont pas de tmIoUrl avec accountId extractible
 */
export async function syncTrackmaniaTrophiesBatch(db: Firestore): Promise<SyncStats> {
  const stats: SyncStats = { scanned: 0, synced: 0, errors: 0, noAccountId: 0 };
  const state = await loadCronState(db, STATE_KEY);
  const cursor = state?.lastCursor ?? null;

  let query = db
    .collection('users')
    .where('games', 'array-contains', 'trackmania')
    .orderBy('__name__')
    .limit(USERS_LIMIT_PER_RUN);
  if (cursor) query = query.startAfter(cursor);

  const snap = await query.get();
  if (snap.empty) {
    await saveCronState(db, STATE_KEY, {
      lastCursor: null,
      lastRunAt: Date.now(),
      processed: 0,
    });
    return stats;
  }

  let lastProcessedUid: string | null = null;

  for (const doc of snap.docs) {
    stats.scanned++;
    lastProcessedUid = doc.id;
    const data = doc.data();
    const tmIoUrl = typeof data.tmIoUrl === 'string' ? data.tmIoUrl : '';
    const accountId = extractAccountId(tmIoUrl);
    if (!accountId) {
      stats.noAccountId++;
      continue;
    }

    // Sleep avant call pour respecter rate-limit soft tm.io (community-driven)
    await new Promise(r => setTimeout(r, TM_IO_DELAY_MS));

    const res = await fetchTmStats(accountId);
    if (!res.ok) {
      stats.errors++;
      continue;
    }

    // Update silencieux si rien n'a changé (évite writes Firestore inutiles)
    const oldTrophies = typeof data.tmTrophies === 'number' ? data.tmTrophies : null;
    const oldCotdBest = typeof data.tmCotdBestRank === 'number' ? data.tmCotdBestRank : null;
    if (oldTrophies === res.data.trophies && oldCotdBest === res.data.cotdBestRank) {
      continue;
    }

    await doc.ref.update(buildUpdates(accountId, res.data));
    stats.synced++;
  }

  const isEndOfCycle = snap.docs.length < USERS_LIMIT_PER_RUN;
  await saveCronState(db, STATE_KEY, {
    lastCursor: isEndOfCycle ? null : lastProcessedUid,
    lastRunAt: Date.now(),
    processed: stats.scanned,
  });

  return stats;
}

// Helper : payload commun pour update Firestore (cron + sync à la demande).
function buildUpdates(accountId: string, data: FetchedTmData) {
  return {
    tmAccountId: accountId,
    tmDisplayName: data.displayName || null,
    tmTrophies: data.trophies,
    tmEchelon: data.echelon,
    tmClubTag: data.clubTag,
    tmCotdBestRank: data.cotdBestRank,
    tmCotdBestDiv: data.cotdBestDiv,
    tmCotdCount: data.cotdCount,
    tmCotdAvgRank: data.cotdAvgRank,
    tmStatsSyncedAt: FieldValue.serverTimestamp(),
  };
}

// Type helper pour TS (extract du return type de fetchTmStats côté ok)
type FetchedTmData = {
  accountId: string;
  displayName: string;
  trophies: number;
  echelon: number;
  clubTag: string | null;
  cotdBestRank: number | null;
  cotdBestDiv: number | null;
  cotdCount: number;
  cotdAvgRank: number | null;
};
