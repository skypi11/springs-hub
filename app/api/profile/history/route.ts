import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

type TMHistory = {
  participantId: string;
  editionsPlayed: number;
  finalesReached: number;
  bestFinalePosition: number | null;
};

type RLHistory = {
  competitions: { id: string; name: string; status: string }[];
};

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  const uid = req.nextUrl.searchParams.get('uid');
  if (!uid) {
    return NextResponse.json({ error: 'uid requis' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const user = userSnap.data() ?? {};

    const [tm, rl] = await Promise.all([
      loadTmHistory(db, user),
      loadRlHistory(db, uid),
    ]);

    return NextResponse.json({ tm, rl });
  } catch (err) {
    captureApiError('API Profile History GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

async function loadTmHistory(
  db: FirebaseFirestore.Firestore,
  user: FirebaseFirestore.DocumentData,
): Promise<TMHistory | null> {
  const loginTM = (user.loginTM || '').trim();
  const pseudoTM = (user.pseudoTM || '').trim();
  if (!loginTM && !pseudoTM) return null;

  let participantDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  if (loginTM) {
    const byLogin = await db
      .collection('participants')
      .where('loginTM', '==', loginTM)
      .limit(1)
      .get();
    if (!byLogin.empty) participantDoc = byLogin.docs[0];
  }
  if (!participantDoc && pseudoTM) {
    const byPseudo = await db
      .collection('participants')
      .where('pseudoTM', '==', pseudoTM)
      .limit(1)
      .get();
    if (!byPseudo.empty) participantDoc = byPseudo.docs[0];
  }
  if (!participantDoc) return null;

  const participantId = participantDoc.id;
  const resultsSnap = await db
    .collection('results')
    .where('playerId', '==', participantId)
    .get();

  const editionsSet = new Set<string>();
  const finalesSet = new Set<string>();
  let best: number | null = null;
  for (const d of resultsSnap.docs) {
    const r = d.data() as { editionId?: string; phase?: string; position?: number };
    if (r.editionId) editionsSet.add(r.editionId);
    if (r.phase === 'finale' && r.editionId) {
      finalesSet.add(r.editionId);
      if (typeof r.position === 'number' && r.position > 0) {
        if (best === null || r.position < best) best = r.position;
      }
    }
  }

  return {
    participantId,
    editionsPlayed: editionsSet.size,
    finalesReached: finalesSet.size,
    bestFinalePosition: best,
  };
}

async function loadRlHistory(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<RLHistory> {
  const regsSnap = await db
    .collection('competition_registrations')
    .where('userId', '==', uid)
    .get();

  if (regsSnap.empty) return { competitions: [] };

  const compIds = Array.from(
    new Set(
      regsSnap.docs
        .map(d => (d.data().competitionId as string | undefined) || '')
        .filter(Boolean),
    ),
  );
  if (compIds.length === 0) return { competitions: [] };

  const comps: { id: string; name: string; status: string }[] = [];
  for (const id of compIds.slice(0, 20)) {
    const snap = await db.collection('competitions').doc(id).get();
    if (!snap.exists) continue;
    const data = snap.data() ?? {};
    if (data.game !== 'rocket_league') continue;
    comps.push({
      id,
      name: (data.name as string) || 'Compétition',
      status: (data.status as string) || 'unknown',
    });
  }
  return { competitions: comps };
}
