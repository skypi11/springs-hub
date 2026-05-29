import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { canUserCustomizeOgDisplay } from '@/lib/plan-limits';
import { isKnownGame } from '@/lib/games-registry';
import type { OgDisplayPreferences } from '@/types';

// POST /api/profile/og-display
// Met à jour les préférences d'affichage OG du user authentifié.
//
// Body : Partial<OgDisplayPreferences>
// { ranks?: string[], showStructure?: boolean, showTeam?: boolean,
//   primaryGameForStructure?: string | null }
//
// Validation server-side :
// - ranks : array de game IDs valides (selon games-registry), cap 2,
//   dédupliqué en préservant l'ordre.
// - showStructure / showTeam : booléens (autres types → ignorés).
// - primaryGameForStructure : game ID valide OU null OU absent.
//
// Gate : canUserCustomizeOgDisplay(user) doit être true. Aujourd'hui toujours
// true (gratuit pour tous), mais le check est en place pour le jour où on
// bascule sur un Pro Joueur (cf. feedback_freemium_reserve). En cas de gate
// futur fermé, on renvoie 402 Payment Required.
//
// Rate limit : 1 write toutes les ~2s (limiters.write). Suffisant pour
// déclencher des saves debounced depuis le live preview de Settings.
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Token manquant' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
    }
    const userData = userSnap.data() ?? {};

    if (!canUserCustomizeOgDisplay(userData as { uid?: string })) {
      // Aujourd'hui jamais déclenché (helper retourne true). Le jour du gate
      // premium, ce 402 sera renvoyé pour les non-Pro.
      return NextResponse.json(
        { error: 'Customisation OG réservée aux comptes Pro' },
        { status: 402 },
      );
    }

    const body = (await req.json()) as Partial<OgDisplayPreferences>;
    const validated: OgDisplayPreferences = {};

    // ranks : array de game IDs valides, cap 2, dédupliqué (ordre préservé)
    if (Array.isArray(body.ranks)) {
      const seen = new Set<string>();
      const valid: string[] = [];
      for (const gid of body.ranks) {
        if (typeof gid !== 'string') continue;
        if (seen.has(gid)) continue;
        if (!isKnownGame(gid)) continue;
        seen.add(gid);
        valid.push(gid);
        if (valid.length >= 2) break;
      }
      validated.ranks = valid;
    }

    if (typeof body.showStructure === 'boolean') {
      validated.showStructure = body.showStructure;
    }
    if (typeof body.showTeam === 'boolean') {
      validated.showTeam = body.showTeam;
    }

    if (body.primaryGameForStructure === null) {
      validated.primaryGameForStructure = null;
    } else if (typeof body.primaryGameForStructure === 'string') {
      if (isKnownGame(body.primaryGameForStructure)) {
        validated.primaryGameForStructure = body.primaryGameForStructure;
      }
    }

    // Merge avec l'existant : on écrit UNIQUEMENT les champs fournis,
    // les autres restent inchangés. Ça permet un PATCH partiel depuis l'UI
    // (un toggle ne réécrit pas toutes les ranks).
    await userRef.set(
      {
        ogDisplay: validated,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { mergeFields: ['ogDisplay', 'updatedAt'] },
    );

    return NextResponse.json({ success: true, ogDisplay: validated });
  } catch (err) {
    captureApiError('API Profile og-display POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
