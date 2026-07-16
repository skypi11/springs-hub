import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';

// Check-in GÉNÉRAL (spec §8 : 14 h 30, 20 min, CAPITAINE SEUL). Ouvert par un
// admin depuis la console (generalCheckin passe de null à {done:false}) ;
// chaque capitaine confirme ici la présence de son équipe. Une équipe
// manquante à l'échéance = décision admin (forfait ou remplacement waitlist),
// jamais automatique — la console liste les manquants.
//
// GET : statut du check-in de SA propre équipe (pour la fiche/page équipe).
// POST : confirme (capitaine uniquement, dérivé serveur du snapshot).

async function findOwnRegistration(
  db: FirebaseFirestore.Firestore,
  competitionId: string,
  uid: string,
) {
  const snap = await db.collection('competition_registrations')
    .where('competitionId', '==', competitionId)
    .where('rosterUids', 'array-contains', uid)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const { id } = await params;
    const db = getAdminDb();
    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (isCompetitionHidden(compSnap.data()!) && !(await canViewHiddenCompetition(db, uid))) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const reg = await findOwnRegistration(db, id, uid);
    if (!reg) return NextResponse.json({ registration: null });
    const r = reg.data();
    return NextResponse.json({
      registration: {
        id: reg.id,
        name: r.name ?? '',
        status: r.status ?? 'pending',
        isCaptain: r.captainUid === uid,
        generalCheckin: r.generalCheckin
          ? { done: r.generalCheckin.done === true }
          : null,
      },
    });
  } catch (err) {
    captureApiError('API Competitions/Checkin GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (isCompetitionHidden(compSnap.data()!) && !(await canViewHiddenCompetition(db, uid))) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const reg = await findOwnRegistration(db, id, uid);
    if (!reg) return NextResponse.json({ error: 'Aucune inscription trouvée pour ton équipe.' }, { status: 404 });

    const result = await db.runTransaction<{ ok: true } | { ok: false; status: number; msg: string }>(async tx => {
      const fresh = await tx.get(reg.ref);
      if (!fresh.exists) return { ok: false, status: 404, msg: 'Inscription introuvable.' };
      const r = fresh.data()!;
      if (r.captainUid !== uid) return { ok: false, status: 403, msg: 'Seul le capitaine peut check-in (spec).' };
      if (r.status !== 'approved') return { ok: false, status: 409, msg: "L'inscription n'est pas validée." };
      if (!r.generalCheckin) return { ok: false, status: 409, msg: "Le check-in général n'est pas encore ouvert." };
      if (r.generalCheckin.done === true) return { ok: false, status: 409, msg: 'Check-in déjà fait.' };
      tx.update(reg.ref, {
        // byUid : jamais public — les registrations sont deny-all.
        generalCheckin: { done: true, byUid: uid, at: Timestamp.now() },
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true };
    });

    if (!result.ok) return NextResponse.json({ error: result.msg }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API Competitions/Checkin POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
