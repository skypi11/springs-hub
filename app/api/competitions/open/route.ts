import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/competitions/open — compétitions dont la fenêtre d'inscription est
// ouverte, pour la bannière du dashboard connecté (spec Legends §15.5).
// Les admins compét et les comptes du bac à sable voient EN PLUS les
// compétitions en brouillon (leur terrain de test) — le public, jamais.

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const now = new Date();

    const openSnap = await db.collection('competitions')
      .where('status', '==', 'registration')
      .get();
    const competitions = openSnap.docs
      .filter(d => {
        // Les compétitions de test (isDev) ne fuient jamais dans la bannière
        // publique, même en fenêtre d'inscription — elles rejoignent la
        // section « brouillons/test » réservée aux testeurs plus bas.
        if (d.data().isDev === true) return false;
        const r = d.data().registration;
        const opensAt = r?.opensAt?.toDate?.() ?? null;
        const closesAt = r?.closesAt?.toDate?.() ?? null;
        return opensAt && closesAt && now >= opensAt && now <= closesAt;
      })
      .map(d => ({
        id: d.id,
        name: (d.data().name as string) ?? '',
        game: (d.data().game as string) ?? '',
        closesAt: d.data().registration?.closesAt?.toDate?.()?.toISOString() ?? null,
        isDraft: false,
      }));

    // Terrain de test : brouillons visibles des admins compét + comptes fictifs.
    const [requesterIsCompAdmin, userSnap] = await Promise.all([
      isCompetitionAdmin(uid),
      db.collection('users').doc(uid).get(),
    ]);
    if (requesterIsCompAdmin || userSnap.data()?.isDev === true) {
      // Terrain de test des testeurs : les brouillons + les compétitions de
      // test (isDev) à tout statut non terminé (elles n'apparaissent pas dans
      // la liste publique ci-dessus). Dédupliqué sur l'id déjà présent.
      const present = new Set(competitions.map(c => c.id));
      const [draftSnap, devSnap] = await Promise.all([
        db.collection('competitions').where('status', '==', 'draft').get(),
        db.collection('competitions').where('isDev', '==', true).get(),
      ]);
      for (const d of [...draftSnap.docs, ...devSnap.docs]) {
        if (present.has(d.id)) continue;
        const status = (d.data().status as string) ?? 'draft';
        if (status === 'finished' || status === 'archived') continue;
        present.add(d.id);
        competitions.push({
          id: d.id,
          name: (d.data().name as string) ?? '',
          game: (d.data().game as string) ?? '',
          closesAt: null,
          isDraft: true,
        });
      }
    }

    return NextResponse.json({ competitions });
  } catch (err) {
    captureApiError('API Competitions/Open GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
