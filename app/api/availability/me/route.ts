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
  validSlotsForWeek,
} from '@/lib/availability';

const MAX_SLOTS_PER_WEEK = 200; // garde-fou (la vraie valeur max est 164)

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
// Upsert mes dispos pour une semaine donnée.
// Body: { mondayYmd: "YYYY-MM-DD", slots: string[] }
export async function PUT(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const mondayYmd = typeof body.mondayYmd === 'string' ? body.mondayYmd : null;
    const slots = Array.isArray(body.slots) ? body.slots : null;

    if (!mondayYmd || !/^\d{4}-\d{2}-\d{2}$/.test(mondayYmd)) {
      return NextResponse.json({ error: 'mondayYmd invalide.' }, { status: 400 });
    }
    if (getMondayYmd(mondayYmd) !== mondayYmd) {
      return NextResponse.json({ error: "La date doit être un lundi." }, { status: 400 });
    }
    if (!slots) {
      return NextResponse.json({ error: 'slots requis (array).' }, { status: 400 });
    }
    if (slots.length > MAX_SLOTS_PER_WEEK) {
      return NextResponse.json({ error: 'Trop de slots.' }, { status: 400 });
    }

    // Semaine passée (antérieure à la semaine courante) → refusée.
    const todayYmd = parisYmd(new Date());
    const currentMonday = getMondayYmd(todayYmd);
    if (mondayYmd < currentMonday) {
      return NextResponse.json({ error: "Les semaines passées ne peuvent pas être modifiées." }, { status: 400 });
    }

    // Validation : tous les slots doivent être valides pour cette semaine.
    const valid = validSlotsForWeek(mondayYmd);
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const s of slots) {
      if (typeof s !== 'string') continue;
      if (!valid.has(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      cleaned.push(s);
    }
    cleaned.sort();

    // Filtre supplémentaire : si c'est la semaine courante, on interdit l'édition
    // des slots appartenant à un jour passé (< todayYmd).
    const filtered = mondayYmd === currentMonday
      ? cleaned.filter(s => s.slice(0, 10) >= todayYmd)
      : cleaned;

    // Merge avec l'existant : on ne touche PAS aux slots des jours passés
    // pour la semaine courante (ils restent figés en lecture seule).
    const db = getAdminDb();
    const weekId = getIsoWeekId(mondayYmd);
    const ref = db.collection('user_availability').doc(`${uid}_${weekId}`);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? (existingSnap.data()!.slots as string[] ?? []) : [];

    const frozenPastSlots = mondayYmd === currentMonday
      ? existing.filter(s => s.slice(0, 10) < todayYmd)
      : [];

    const merged = Array.from(new Set([...frozenPastSlots, ...filtered])).sort();

    await ref.set({
      userId: uid,
      isoWeek: weekId,
      weekStart: mondayYmd,
      slots: merged,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });

    return NextResponse.json({ success: true, slots: merged });
  } catch (err) {
    captureApiError('API availability/me PUT error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
