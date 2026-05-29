import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';
import {
  getWeekStartDate,
  STRUCTURE_WEEKLY_QUOTA,
  GLOBAL_WEEKLY_QUOTA,
} from '@/lib/ballchasing-quota';
import { isBallchasingConfigured } from '@/lib/ballchasing';

type PerStructure = {
  structureId: string;
  /** Slug propre pour construire l'URL publique (peut être null si non backfillé). */
  structureSlug: string | null;
  structureName: string;
  structureTag: string;
  used: number;
  quota: number;
  pctOfQuota: number;
  failed: number;
  quotaExceeded: number;
};

// GET /api/admin/ballchasing
// Vue admin du quota ballchasing : compteur global Aedral cette semaine,
// répartition par structure, top consommateurs, échecs et quota_exceeded.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();
    const weekStart = getWeekStartDate();
    const weekStartTs = Timestamp.fromDate(weekStart);

    // Tous les replays uploadés (status=uploaded) sur ballchasing cette semaine
    const uploadedSnap = await db.collection('replays')
      .where('ballchasingStatus', '==', 'uploaded')
      .where('ballchasingUploadedAt', '>=', weekStartTs)
      .get();

    // Tous les failed cette semaine, pour visibilité, on regarde updatedAt
    // ou createdAt si pas d'updatedAt. Filtrage approximatif côté serveur.
    const failedSnap = await db.collection('replays')
      .where('ballchasingStatus', '==', 'failed')
      .get();
    const failedThisWeek = failedSnap.docs.filter(d => {
      const t = d.data().createdAt as Timestamp | undefined;
      return t && t.toDate() >= weekStart;
    });

    const quotaExceededSnap = await db.collection('replays')
      .where('ballchasingStatus', '==', 'quota_exceeded')
      .get();
    const quotaExceededThisWeek = quotaExceededSnap.docs.filter(d => {
      const t = d.data().createdAt as Timestamp | undefined;
      return t && t.toDate() >= weekStart;
    });

    // Aggrège par structure
    const byStructure = new Map<string, PerStructure>();
    const structureIds = new Set<string>();
    function getOrCreate(structureId: string): PerStructure {
      let s = byStructure.get(structureId);
      if (!s) {
        s = {
          structureId,
          structureSlug: null,
          structureName: '',
          structureTag: '',
          used: 0,
          quota: STRUCTURE_WEEKLY_QUOTA,
          pctOfQuota: 0,
          failed: 0,
          quotaExceeded: 0,
        };
        byStructure.set(structureId, s);
        structureIds.add(structureId);
      }
      return s;
    }
    for (const d of uploadedSnap.docs) {
      const sid = d.data().structureId as string | undefined;
      if (!sid) continue;
      getOrCreate(sid).used++;
    }
    for (const d of failedThisWeek) {
      const sid = d.data().structureId as string | undefined;
      if (!sid) continue;
      getOrCreate(sid).failed++;
    }
    for (const d of quotaExceededThisWeek) {
      const sid = d.data().structureId as string | undefined;
      if (!sid) continue;
      getOrCreate(sid).quotaExceeded++;
    }

    // Hydrate les noms de structure
    const structures = await fetchDocsByIds(db, 'structures', Array.from(structureIds));
    for (const s of byStructure.values()) {
      const struct = structures.get(s.structureId);
      s.structureSlug = (struct?.slug as string | undefined) ?? null;
      s.structureName = (struct?.name as string | undefined) ?? '';
      s.structureTag = (struct?.tag as string | undefined) ?? '';
      s.pctOfQuota = s.quota > 0 ? Math.round((s.used / s.quota) * 100) : 0;
    }

    const sortedStructures = Array.from(byStructure.values())
      .sort((a, b) => b.used - a.used);

    const globalUsed = uploadedSnap.size;
    const globalPct = GLOBAL_WEEKLY_QUOTA > 0
      ? Math.round((globalUsed / GLOBAL_WEEKLY_QUOTA) * 100)
      : 0;

    return NextResponse.json({
      weekStartIso: weekStart.toISOString(),
      ballchasingConfigured: isBallchasingConfigured(),
      global: {
        used: globalUsed,
        quota: GLOBAL_WEEKLY_QUOTA,
        remaining: Math.max(0, GLOBAL_WEEKLY_QUOTA - globalUsed),
        pct: globalPct,
      },
      structureQuotaPerWeek: STRUCTURE_WEEKLY_QUOTA,
      structures: sortedStructures,
      failedCount: failedThisWeek.length,
      quotaExceededCount: quotaExceededThisWeek.length,
    });
  } catch (err) {
    captureApiError('API admin ballchasing', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
