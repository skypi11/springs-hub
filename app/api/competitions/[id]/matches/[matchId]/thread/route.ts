import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { getMatchSideForUser } from '@/lib/competitions/match-access';

// Fil de discussion du match (Lot 4C, spec §10) : messages entre les deux
// camps (capitaines + staff) et les admins. Primitive « thread attaché à un
// objet » — première instance : le match.
//
// TOUT passe par l'API (rules deny-all sur la sous-collection) :
// - le droit du STAFF est résolu LIVE (getMatchSideForUser) — une ACL statique
//   l'exclurait (spec §8) ;
// - les docs portent authorUid (modération/audit) qui ne doit JAMAIS partir
//   vers un autre joueur (archi §8) — la réponse sert nom + camp, sans uid.
//
// Lecture : toute personne impliquée (roster/capitaine/staff d'un camp, admin).
// Écriture : capitaine ou staff d'un camp (même autorité que les scores), admin.

const MAX_MESSAGES = 100;
const MAX_BODY = 500;

async function loadContext(req: NextRequest, params: Promise<{ id: string; matchId: string }>) {
  const { id, matchId } = await params;
  const db = getAdminDb();
  // Auth AVANT toute lecture : un anonyme reçoit 401 que la compétition existe
  // ou non — pas d'oracle d'existence sur les compéts masquées (review Lot 4).
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
  const match = matchSnap.data()!;
  const [isAdmin, access] = await Promise.all([
    isCompetitionAdmin(uid),
    getMatchSideForUser(db, { teamA: match.teamA ?? null, teamB: match.teamB ?? null }, uid),
  ]);
  return { db, uid, ref, match, isAdmin, access };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  // Limiter par UID (pas par IP) : à la LAN ou en LAN-party, des dizaines de
  // joueurs partagent la même IP — un bucket IP les 429-erait en chaîne
  // (review Lot 4). L'anonyme n'atteint jamais la lecture (401 au contexte).
  const preUid = await verifyAuth(req);
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, preUid ?? undefined));
  if (blocked) return blocked;
  try {
    const ctx = await loadContext(req, params);
    if ('error' in ctx) return NextResponse.json({ error: 'not_found' }, { status: ctx.error });
    const { ref, isAdmin, access } = ctx;
    // Lecture : un camp, le staff des DEUX camps (lecteur légitime spec §10,
    // même s'il ne peut pas écrire), ou un admin.
    if (!isAdmin && !access.side && !access.dualStaff) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const snap = await ref.collection('messages')
      .orderBy('createdAt', 'asc').limitToLast(MAX_MESSAGES).get();
    const messages = snap.docs.map(d => {
      const m = d.data();
      return {
        id: d.id,
        side: (m.side as string) ?? 'admin',        // 'a' | 'b' | 'admin'
        authorName: (m.authorName as string) ?? '',
        body: (m.body as string) ?? '',
        createdAt: m.createdAt?.toDate?.()?.toISOString() ?? null,
        // Nonce client renvoyé pour retirer l'optimiste correspondant (pas de
        // PII — random généré côté client). Jamais d'authorUid (archi §8).
        clientNonce: (m.clientNonce as string) ?? null,
      };
    });
    return NextResponse.json({
      messages,
      canPost: isAdmin || (!!access.side && access.canSubmitScores),
    });
  } catch (err) {
    captureApiError('API Competitions/Match/Thread GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  try {
    const preUid = await verifyAuth(req);
    if (!preUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const blocked = await checkRateLimit(limiters.chat, rateLimitKey(req, preUid));
    if (blocked) return blocked;

    const ctx = await loadContext(req, params);
    if ('error' in ctx) return NextResponse.json({ error: 'not_found' }, { status: ctx.error });
    const { db, uid, ref, isAdmin, access } = ctx;

    // Écrire = capitaine ou staff d'un camp (même autorité que les scores),
    // ou admin. Un joueur du roster non-capitaine lit sans écrire (spec §10).
    const side: 'a' | 'b' | 'admin' | null = isAdmin && !access.side
      ? 'admin'
      : access.side && access.canSubmitScores ? access.side : isAdmin ? 'admin' : null;
    if (!side) {
      return NextResponse.json({ error: 'Réservé aux capitaines, au staff des équipes du match et aux admins.' }, { status: 403 });
    }

    const bodyJson = await req.json().catch(() => ({}));
    const body = typeof bodyJson.body === 'string' ? bodyJson.body.trim().slice(0, MAX_BODY) : '';
    if (!body) return NextResponse.json({ error: 'Message vide.' }, { status: 400 });
    // Nonce client (écho optimiste) : borné, sans caractère de contrôle.
    const clientNonce = typeof bodyJson.clientNonce === 'string' && bodyJson.clientNonce.length <= 64
      ? bodyJson.clientNonce
      : null;

    const userSnap = await db.collection('users').doc(uid).get();
    const authorName = (userSnap.data()?.displayName as string)
      || (userSnap.data()?.discordUsername as string)
      || (side === 'admin' ? 'Admin' : 'Capitaine');

    await ref.collection('messages').add({
      side,
      authorUid: uid,        // modération/audit — jamais servi (rules deny-all)
      authorName,
      body,
      ...(clientNonce ? { clientNonce } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API Competitions/Match/Thread POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
