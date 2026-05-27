// Sync nocturne du rang Valorant via HenrikDev API.
//
// Itère sur les users avec 'valorant' in games + Riot Discord connection liée,
// fetch leur rang actuel via HenrikDev, met à jour user.valorantRank/RR.
//
// Utilisé par :
// - Route dédiée GET /api/cron/sync-valorant-ranks (test manuel via bearer)
// - Greffe sur le cron quotidien /api/cron/expire-invitations (Vercel Hobby
//   1 cron/jour seulement → on empile sur celui qui tourne déjà à 3h).
//
// Pagination par cursor avec état persisté dans `_cron_state/valorant_rank_sync`
// (pattern identique aux autres passes cron — voir expire-invitations).
// Cycle complet sur quelques jours acceptable car le rang Val bouge lentement
// et que le rang déclaratif (saisi par le user) est dispo en fallback immédiat.

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { pickValorantRiotId, type DiscordConnection } from '@/lib/discord-connections';
import { fetchValorantMmr, fetchValorantAccountByPuuid } from '@/lib/valorant-henrikdev';
import { loadCronState, saveCronState } from '@/lib/cron-state';

const STATE_KEY = 'valorant_rank_sync';

// Limites par run — respectent le timeout Vercel Hobby (60s) avec marge.
// HenrikDev sans API key : 30 req/min → 200 req/run prend ~7min, trop.
// Avec API key (60 req/min) : ~200 req prend ~3min30s, encore trop.
// → On limite à 50 users par run (rate-safe sans API key, et 1 minute de
// boulot effectif). Cycle complet 5k users = 100 jours. Acceptable car
// rang Val bouge lentement et fallback déclaratif dispo.
const USERS_LIMIT_PER_RUN = 50;
const HENRIKDEV_DELAY_MS = 1100; // ~55 req/min, marge sous le 60 with key

interface SyncStats {
  scanned: number;
  synced: number;
  errors: number;
  notRanked: number; // 404 HenrikDev = joueur non classé / inconnu
}

/**
 * Sync le rang Valorant d'un batch d'users via HenrikDev.
 * Retourne les stats du run pour logging.
 *
 * Ignore les users qui :
 * - n'ont pas 'valorant' dans games
 * - n'ont pas de Riot Discord connection liée (on respecte le déclaratif)
 *
 * Cursor-paginé : reprend là où le dernier run s'était arrêté. Cycle complet
 * en plusieurs jours acceptable car rang Val bouge lentement et fallback
 * déclaratif dispo immédiatement.
 */
export async function syncValorantRanksBatch(db: Firestore): Promise<SyncStats> {
  const stats: SyncStats = { scanned: 0, synced: 0, errors: 0, notRanked: 0 };
  const state = await loadCronState(db, STATE_KEY);
  const cursor = state?.lastCursor ?? null;

  // Query indexée sur games array-contains 'valorant' + tri par uid pour
  // pagination stable.
  let query = db
    .collection('users')
    .where('games', 'array-contains', 'valorant')
    .orderBy('__name__')
    .limit(USERS_LIMIT_PER_RUN);
  if (cursor) query = query.startAfter(cursor);

  const snap = await query.get();
  if (snap.empty) {
    // Fin de cycle — reset le cursor pour recommencer au prochain run.
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
    const connections = data.discordConnections as DiscordConnection[] | undefined;
    const riotId = pickValorantRiotId(connections);
    if (!riotId) continue; // pas de Riot lié → on respecte la saisie déclarative

    // Si on n'a pas de tag (Discord renvoie parfois juste le name sans #TAG),
    // on résout d'abord via le PUUID. Cas typique : user fraîchement loggé
    // avant que le callback Discord ait pu enrichir la connection.
    let resolvedName = riotId.name;
    let resolvedTag = riotId.tag;
    if (!resolvedTag) {
      await new Promise(r => setTimeout(r, HENRIKDEV_DELAY_MS));
      const acc = await fetchValorantAccountByPuuid(riotId.puuid);
      if (!acc.ok) {
        if (acc.status === 404) stats.notRanked++;
        else stats.errors++;
        continue;
      }
      resolvedName = acc.data.name;
      resolvedTag = acc.data.tag;
    }

    // Sleep avant call MMR pour respecter rate-limit HenrikDev
    await new Promise(r => setTimeout(r, HENRIKDEV_DELAY_MS));

    const res = await fetchValorantMmr({ name: resolvedName, tag: resolvedTag });
    if (!res.ok) {
      if (res.status === 404) {
        stats.notRanked++;
      } else {
        stats.errors++;
      }
      continue;
    }

    // Update silencieux si le rang n'a pas changé (évite les writes Firestore inutiles)
    const oldRank = (data.valorantRank as string) || '';
    const oldRR = typeof data.valorantRR === 'number' ? data.valorantRR : null;
    const oldSource = (data.valorantRankSource as string) || '';
    if (oldRank === res.data.rank && oldRR === res.data.rr && oldSource === 'henrikdev') {
      continue;
    }

    // Storage PUUID immuable (anti-mensonge) + détection changement.
    // Si l'user a relié un autre compte Riot dans Discord, on log et on
    // accepte le changement (futur : alerter staff, flagger éventuellement).
    const updates: Record<string, unknown> = {
      valorantRank: res.data.rank,
      valorantRR: res.data.rr,
      valorantRankSource: 'henrikdev',
      valorantRankSyncedAt: FieldValue.serverTimestamp(),
    };
    const oldPuuid = (data.valorantPuuid as string) || '';
    if (!oldPuuid) {
      updates.valorantPuuid = riotId.puuid;
      updates.valorantPuuidLinkedAt = FieldValue.serverTimestamp();
    } else if (oldPuuid !== riotId.puuid) {
      console.warn(`[valorant-sync] PUUID change detected for user ${doc.id}: ${oldPuuid} → ${riotId.puuid}`);
      updates.valorantPuuid = riotId.puuid;
      updates.valorantPuuidLinkedAt = FieldValue.serverTimestamp();
    }
    await doc.ref.update(updates);
    stats.synced++;
  }

  // Persiste le cursor pour le prochain run. Si moins de USERS_LIMIT remontés,
  // on est en fin de cycle → reset à null.
  const isEndOfCycle = snap.docs.length < USERS_LIMIT_PER_RUN;
  await saveCronState(db, STATE_KEY, {
    lastCursor: isEndOfCycle ? null : lastProcessedUid,
    lastRunAt: Date.now(),
    processed: stats.scanned,
  });

  return stats;
}
