// Quota ballchasing, limite hebdomadaire par structure + plafond global Aedral.
//
// Modèle : 1 abonnement Patreon ballchasing partagé pour toute la plateforme.
// Tier Gold ($2/mois) au 2026-05 : 350 uploads/semaine, max 350/jour.
//
// Stratégie :
// - Quota par structure : 20/semaine, laisse une équipe RL active scrim 3-4×
//   par semaine sans saturer, et permet ~14 structures actives en parallèle.
// - Quota global Aedral : 320/semaine, marge 30 sous le plafond ballchasing
//   pour absorber les retries / edge cases sans risquer de fail tier.
// - Reset hebdo aligné sur lundi 00:00 Europe/Paris (on tolère un décalage de
//   1-2h selon DST en stockant le lundi 00:00 UTC le plus proche, pas critique
//   pour un compteur hebdomadaire).
// - On compte uniquement les uploads RÉUSSIS (ballchasingStatus === 'uploaded'
//   avec ballchasingUploadedAt dans la semaine courante). Les failed / pending
//   / quota_exceeded ne consomment pas de quota.

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

export const STRUCTURE_WEEKLY_QUOTA = 20;
export const GLOBAL_WEEKLY_QUOTA = 320;

// Lundi 00:00 UTC le plus proche dans le passé. Approximation acceptable de
// "lundi 00:00 Europe/Paris", le décalage est de 1h (hiver) ou 2h (été), ce
// qui ne change rien pour un compteur hebdomadaire.
export function getWeekStartDate(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysFromMonday,
    0, 0, 0, 0,
  ));
}

export interface QuotaCount {
  used: number;
  quota: number;
  remaining: number;
  weekStartIso: string;
}

// Compte les uploads ballchasing réussis pour une structure cette semaine.
export async function getStructureWeeklyCount(
  db: Firestore,
  structureId: string,
): Promise<QuotaCount> {
  const weekStart = getWeekStartDate();
  const snap = await db.collection('replays')
    .where('structureId', '==', structureId)
    .where('ballchasingStatus', '==', 'uploaded')
    .where('ballchasingUploadedAt', '>=', Timestamp.fromDate(weekStart))
    .get();
  const used = snap.size;
  return {
    used,
    quota: STRUCTURE_WEEKLY_QUOTA,
    remaining: Math.max(0, STRUCTURE_WEEKLY_QUOTA - used),
    weekStartIso: weekStart.toISOString(),
  };
}

// Compte les uploads ballchasing réussis sur toute la plateforme cette semaine.
export async function getGlobalWeeklyCount(db: Firestore): Promise<QuotaCount> {
  const weekStart = getWeekStartDate();
  const snap = await db.collection('replays')
    .where('ballchasingStatus', '==', 'uploaded')
    .where('ballchasingUploadedAt', '>=', Timestamp.fromDate(weekStart))
    .get();
  const used = snap.size;
  return {
    used,
    quota: GLOBAL_WEEKLY_QUOTA,
    remaining: Math.max(0, GLOBAL_WEEKLY_QUOTA - used),
    weekStartIso: weekStart.toISOString(),
  };
}

export interface QuotaCheckResult {
  ok: boolean;
  reason?: 'structure' | 'global';
  structureCount: QuotaCount;
  globalCount: QuotaCount;
}

// Vérifie qu'on peut forward un replay de plus pour cette structure cette
// semaine. Retourne `ok: false` avec le reason si quota dépassé (structure
// d'abord car erreur user-facing plus utile, sinon global).
export async function checkBallchasingQuota(
  db: Firestore,
  structureId: string,
): Promise<QuotaCheckResult> {
  const [structureCount, globalCount] = await Promise.all([
    getStructureWeeklyCount(db, structureId),
    getGlobalWeeklyCount(db),
  ]);
  if (structureCount.remaining <= 0) {
    return { ok: false, reason: 'structure', structureCount, globalCount };
  }
  if (globalCount.remaining <= 0) {
    return { ok: false, reason: 'global', structureCount, globalCount };
  }
  return { ok: true, structureCount, globalCount };
}

// Message d'erreur user-friendly pour bcStatus='quota_exceeded'.
export function quotaErrorMessage(reason: 'structure' | 'global'): string {
  if (reason === 'structure') {
    return `Quota stats hebdo atteint (${STRUCTURE_WEEKLY_QUOTA}/semaine). Reset lundi prochain.`;
  }
  return 'Quota plateforme ballchasing atteint pour cette semaine. Réessaie lundi.';
}
