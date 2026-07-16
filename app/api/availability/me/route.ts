import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import {
  addDays,
  getMondayYmd,
  getIsoWeekId,
  parisYmd,
  mergeFrozenPastSlots,
  validateWeekSlots,
  MAX_WEEKS_PER_REQUEST,
} from '@/lib/availability';

// GET /api/availability/me
// Renvoie mes dispos pour 3 semaines : précédente (lecture seule, pour le bouton
// "copier la semaine précédente"), courante, et suivante.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();

    const todayYmd = parisYmd(new Date());
    const currentMonday = getMondayYmd(todayYmd);
    const nextMonday = addDays(currentMonday, 7);
    const prevMonday = addDays(currentMonday, -7);

    const mondays = [prevMonday, currentMonday, nextMonday];
    const docIds = mondays.map(m => `${uid}_${getIsoWeekId(m)}`);

    const refs = docIds.map(id => db.collection('user_availability').doc(id));
    const snaps = await db.getAll(...refs);

    const weeks = mondays.map((mondayYmd, i) => {
      const d = snaps[i].exists ? snaps[i].data() : null;
      return {
        mondayYmd,
        weekId: getIsoWeekId(mondayYmd),
        slots: (d?.slots ?? []) as string[],
      };
    });

    return NextResponse.json({
      today: todayYmd,
      previous: weeks[0],
      current: weeks[1],
      next: weeks[2],
    });
  } catch (err) {
    captureApiError('API availability/me GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// PUT /api/availability/me
// Upsert mes dispos sur une ou plusieurs semaines.
// Body: { weeks: [{ mondayYmd: "YYYY-MM-DD", slots: string[] }] }
//   ou  { mondayYmd: "YYYY-MM-DD", slots: string[] }  (contrat mono-semaine historique)
// Les semaines partent dans une transaction unique : l'auto-save du client envoie
// courante + suivante, jamais l'une sans l'autre.
export async function PUT(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = (await req.json()) as Record<string, unknown> | null;
    const multi = Array.isArray(body?.weeks);
    const rawWeeks: unknown[] = multi ? (body!.weeks as unknown[]) : [body];

    if (rawWeeks.length === 0) {
      return NextResponse.json({ error: 'weeks requis (array non vide).' }, { status: 400 });
    }
    if (rawWeeks.length > MAX_WEEKS_PER_REQUEST) {
      return NextResponse.json({ error: 'Trop de semaines.' }, { status: 400 });
    }

    const todayYmd = parisYmd(new Date());
    const parsed: { mondayYmd: string; weekId: string; slots: string[] }[] = [];
    const seenWeeks = new Set<string>();

    for (const raw of rawWeeks) {
      const week = validateWeekSlots(raw, todayYmd);
      if (!week.ok) return NextResponse.json({ error: week.error }, { status: 400 });
      // Deux entrées sur la même semaine viseraient le même doc dans la transaction.
      if (seenWeeks.has(week.mondayYmd)) {
        return NextResponse.json({ error: 'Semaine en double.' }, { status: 400 });
      }
      seenWeeks.add(week.mondayYmd);
      parsed.push({
        mondayYmd: week.mondayYmd,
        weekId: getIsoWeekId(week.mondayYmd),
        slots: week.slots,
      });
    }

    const db = getAdminDb();
    const refs = parsed.map(p => db.collection('user_availability').doc(`${uid}_${p.weekId}`));

    const saved = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...refs);
      const merged = parsed.map((p, i) => ({
        ...p,
        slots: mergeFrozenPastSlots(
          p.mondayYmd,
          todayYmd,
          p.slots,
          snaps[i].exists ? ((snaps[i].data()!.slots as string[] | undefined) ?? []) : [],
        ),
      }));
      merged.forEach((m, i) => {
        tx.set(refs[i], {
          userId: uid,
          isoWeek: m.weekId,
          weekStart: m.mondayYmd,
          slots: m.slots,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: false });
      });
      return merged;
    });

    // `slots` = ce qui est réellement en base après fusion des jours figés ; le
    // client se recale dessus.
    return multi
      ? NextResponse.json({ success: true, weeks: saved })
      : NextResponse.json({ success: true, weeks: saved, slots: saved[0].slots });
  } catch (err) {
    captureApiError('API availability/me PUT error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
