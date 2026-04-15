import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// Cap sur la taille du résultat — on renvoie les meilleurs candidats triés
const MAX_SUGGESTIONS = 30;

// GET /api/structures/[id]/recruitment-suggestions
// Candidats suggérés pour une structure (dirigeant uniquement).
// Retourne les joueurs isAvailableForRecruitment dont le jeu matche les positions ouvertes.
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await context.params;

    const db = getAdminDb();

    // Vérifier accès dirigeant/staff
    const structSnap = await db.collection('structures').doc(structureId).get();
    if (!structSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const structData = structSnap.data()!;
    const isFounder = structData.founderId === uid;
    const isCoFounder = (structData.coFounderIds ?? []).includes(uid);
    const isManager = (structData.managerIds ?? []).includes(uid);
    if (!isFounder && !isCoFounder && !isManager) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const recruiting = structData.recruiting || { active: false, positions: [] };
    const openGames: string[] = Array.from(new Set(
      (recruiting.positions || [])
        .map((p: { game?: string }) => p.game)
        .filter((g: string | undefined): g is string => Boolean(g))
    ));

    // Pas de position ouverte → pas de suggestion
    if (!recruiting.active || openGames.length === 0) {
      return NextResponse.json({ suggestions: [], openGames: [] });
    }

    // Joueurs dispos au recrutement (Firestore fait le filtre, on raffine côté serveur)
    const playersSnap = await db.collection('users')
      .where('isAvailableForRecruitment', '==', true)
      .limit(200)
      .get();

    // Joueurs déjà membres de cette structure — à exclure
    const membersSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .get();
    const memberIds = new Set(membersSnap.docs.map(d => d.data().userId));

    // Joueurs déjà invités en direct par cette structure — à exclure
    const invitedSnap = await db.collection('structure_invitations')
      .where('structureId', '==', structureId)
      .where('type', '==', 'direct_invite')
      .where('status', '==', 'pending')
      .get();
    const invitedIds = new Set(invitedSnap.docs.map(d => d.data().targetUserId));

    const suggestions: Array<{
      uid: string;
      displayName: string;
      discordAvatar: string;
      avatarUrl: string;
      country: string;
      games: string[];
      matchingGames: string[];
      recruitmentRole: string;
      recruitmentMessage: string;
      rlRank: string;
      rlMmr: number | null;
      pseudoTM: string;
    }> = [];

    for (const doc of playersSnap.docs) {
      if (doc.id === uid) continue;
      if (memberIds.has(doc.id)) continue;
      if (invitedIds.has(doc.id)) continue;

      const data = doc.data();
      if (data.isDev === true && process.env.NODE_ENV === 'production') continue;

      const playerGames: string[] = data.games || [];
      const matchingGames = openGames.filter(g => playerGames.includes(g));
      if (matchingGames.length === 0) continue;

      suggestions.push({
        uid: doc.id,
        displayName: data.displayName || data.discordUsername || '',
        discordAvatar: data.discordAvatar || '',
        avatarUrl: data.avatarUrl || '',
        country: data.country || '',
        games: playerGames,
        matchingGames,
        recruitmentRole: data.recruitmentRole || '',
        recruitmentMessage: data.recruitmentMessage || '',
        rlRank: data.rlStats?.rank || data.rlRank || '',
        rlMmr: data.rlStats?.mmr || data.rlMmr || null,
        pseudoTM: data.pseudoTM || '',
      });
    }

    // Tri : plus de jeux qui matchent d'abord, puis MMR RL desc, puis nom
    suggestions.sort((a, b) => {
      if (a.matchingGames.length !== b.matchingGames.length) {
        return b.matchingGames.length - a.matchingGames.length;
      }
      if ((a.rlMmr || 0) !== (b.rlMmr || 0)) {
        return (b.rlMmr || 0) - (a.rlMmr || 0);
      }
      return a.displayName.localeCompare(b.displayName);
    });

    return NextResponse.json({
      suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
      openGames,
    });
  } catch (err) {
    captureApiError('API Recruitment Suggestions GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
