import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { getMatchSideForUser } from '@/lib/competitions/match-access';
import { uploadBuffer, generateDownloadUrl, deleteFileSilent } from '@/lib/storage';

// Captures d'écran de LITIGE (spec §9, archi §2) : uploadées par le capitaine
// ou le staff de chaque camp pendant un litige, servies en URLs SIGNÉES aux
// seuls membres du match + admins (keys R2 privées dans /private/dispute —
// jamais d'URL publique en doc). Les deux camps voient toutes les captures
// (transparence de l'instruction).

const MAX_BYTES = 4 * 1024 * 1024;          // 4 Mo (limite body serverless)
const MAX_PER_SIDE = 10;
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

async function loadContext(req: NextRequest, params: Promise<{ id: string; matchId: string }>) {
  const { id, matchId } = await params;
  const db = getAdminDb();
  // Auth AVANT toute lecture : pas d'oracle d'existence 401/404 sur les
  // compétitions masquées (review Lot 4).
  const uid = await verifyAuth(req);
  if (!uid) return { error: 401 as const };
  const compSnap = await db.collection('competitions').doc(id).get();
  if (!compSnap.exists) return { error: 404 as const };
  if (isCompetitionHidden(compSnap.data()!) && !(await canViewHiddenCompetition(db, uid))) {
    return { error: 404 as const };
  }
  const ref = db.collection('competition_matches').doc(`${id}__${matchId}`);
  const matchSnap = await ref.get();
  if (!matchSnap.exists) return { error: 404 as const };
  return { db, id, matchId, uid, match: matchSnap.data()!, ref };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;
  try {
    const ctx = await loadContext(req, params);
    if ('error' in ctx) return NextResponse.json({ error: 'not_found' }, { status: ctx.error });
    const { db, uid, match, ref } = ctx;

    const isAdmin = await isCompetitionAdmin(uid);
    const access = await getMatchSideForUser(db, { teamA: match.teamA ?? null, teamB: match.teamB ?? null }, uid);
    if (!isAdmin && !access.side) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const disputeSnap = await ref.collection('private').doc('dispute').get();
    const keys = (disputeSnap.data()?.screenshotKeys as { a?: string[]; b?: string[] } | undefined) ?? {};
    const sign = async (list: string[] | undefined) =>
      Promise.all((list ?? []).map(async key => ({
        key,
        url: await generateDownloadUrl(key, 300, undefined, 'inline'),
      })));
    const [a, b] = await Promise.all([sign(keys.a), sign(keys.b)]);
    return NextResponse.json({ a, b });
  } catch (err) {
    captureApiError('API Competitions/Match/Screenshots GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  try {
    const preUid = await verifyAuth(req);
    if (!preUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, preUid));
    if (blocked) return blocked;

    const ctx = await loadContext(req, params);
    if ('error' in ctx) return NextResponse.json({ error: 'not_found' }, { status: ctx.error });
    const { db, id, matchId, uid, match, ref } = ctx;

    // Upload réservé aux camps du match (capitaine ou staff), litige ouvert.
    const disputeOpen = !!match.dispute && match.dispute.resolvedBy == null;
    if (!disputeOpen) {
      return NextResponse.json({ error: "Pas de litige en cours sur ce match." }, { status: 409 });
    }
    const access = await getMatchSideForUser(db, { teamA: match.teamA ?? null, teamB: match.teamB ?? null }, uid);
    if (!access.side || !access.canSubmitScores) {
      return NextResponse.json({ error: 'Réservé au capitaine ou au staff des équipes du match.' }, { status: 403 });
    }
    const side = access.side;

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 });
    const ext = ALLOWED[file.type];
    if (!ext) return NextResponse.json({ error: 'Format accepté : PNG, JPEG ou WebP.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Capture trop lourde (4 Mo max).' }, { status: 400 });

    const key = `competitions/${id}/disputes/${matchId}/${side}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadBuffer(key, buffer, file.type, 'private, max-age=0');

    // Enregistrement transactionnel avec cap par camp — l'upload orphelin est
    // nettoyé si le cap est atteint entre-temps.
    try {
      await db.runTransaction(async tx => {
        const dRef = ref.collection('private').doc('dispute');
        const dSnap = await tx.get(dRef);
        const existing = ((dSnap.data()?.screenshotKeys as Record<string, string[]> | undefined)?.[side]) ?? [];
        if (existing.length >= MAX_PER_SIDE) throw new Error('cap');
        tx.set(dRef, { screenshotKeys: { [side]: FieldValue.arrayUnion(key) } }, { merge: true });
      });
    } catch (err) {
      await deleteFileSilent(key);
      if (err instanceof Error && err.message === 'cap') {
        return NextResponse.json({ error: `Maximum ${MAX_PER_SIDE} captures par équipe.` }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true, key });
  } catch (err) {
    captureApiError('API Competitions/Match/Screenshots POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export const maxDuration = 60;
