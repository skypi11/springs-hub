// État persistant entre runs de cron.
//
// Permet aux crons de traiter une collection en plusieurs runs (cursor-based
// pagination) — essentiel à la scalabilité. Sans état : un cron qui scanne
// 50k users d'un coup explose le timeout Vercel (60s Hobby, 300s Pro).
//
// Pattern d'usage typique dans un cron :
//
//   const state = await loadCronState(db, 'discord-sync');
//   const startAfterId = state?.lastCursor || null;
//   const snap = await db.collection('users')
//     .orderBy('__name__')
//     .startAfter(startAfterId ? db.collection('users').doc(startAfterId) : '')
//     .limit(200)
//     .get();
//   // ... traite snap.docs ...
//   const newCursor = snap.docs.length < 200 ? null : snap.docs[snap.docs.length - 1].id;
//   await saveCronState(db, 'discord-sync', { lastCursor: newCursor, lastRunAt: Date.now(), processed: snap.size });
//
// Quand `lastCursor` revient à null → cycle complet → on recommence au prochain run.

import type { Firestore } from 'firebase-admin/firestore';

export interface CronState {
  lastCursor: string | null;     // ID du dernier doc traité (null = début / cycle complet)
  lastRunAt: number;             // ms epoch du dernier run
  processed?: number;            // nb de docs traités au dernier run (debug)
  cycleStartedAt?: number;       // ms epoch du début du cycle en cours (pour estimer temps total)
}

const COLLECTION = '_cron_state';

export async function loadCronState(
  db: Firestore,
  key: string,
): Promise<CronState | null> {
  const snap = await db.collection(COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  return {
    lastCursor: typeof data.lastCursor === 'string' ? data.lastCursor : null,
    lastRunAt: typeof data.lastRunAt === 'number' ? data.lastRunAt : 0,
    processed: typeof data.processed === 'number' ? data.processed : undefined,
    cycleStartedAt: typeof data.cycleStartedAt === 'number' ? data.cycleStartedAt : undefined,
  };
}

export async function saveCronState(
  db: Firestore,
  key: string,
  state: CronState,
): Promise<void> {
  await db.collection(COLLECTION).doc(key).set(state, { merge: true });
}
