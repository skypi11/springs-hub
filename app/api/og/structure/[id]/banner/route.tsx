import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isLegacyStructureId } from '@/lib/structure-slug';
import { captureApiError } from '@/lib/sentry';
import { GET as embedGET } from '../route';

// GET /api/og/structure/[id]/banner
// Variante "download" 1200×630 de la bannière OG structure. Miroir
// symétrique de /api/og/profile/[slug]/banner — même rationale, voir doc
// du fichier profile/banner pour le détail.
//
// Cas d'usage : un dirigeant de structure veut télécharger la bannière
// "carte de visite" 1200×630 de sa structure pour la poster manuellement
// sur Twitter/Facebook/Discord communautés, etc.
//
// Implémentation : délègue le rendu à la route embed (../route.tsx) puis
// clone la Response avec headers attachment + no-cache. Pré-check existence
// pour retourner 404 propre (vs fallback générique de l'embed).
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const db = getAdminDb();

    // Pré-check existence + status='active' (structures pending/suspendues
    // ne sont pas téléchargeables publiquement, comme pour le story).
    let exists = false;
    if (isLegacyStructureId(id)) {
      const snap = await db.collection('structures').doc(id).get();
      exists = snap.exists && snap.data()?.status === 'active';
    } else {
      const snap = await db.collection('structures').where('slug', '==', id).limit(1).get();
      exists = !snap.empty && snap.docs[0].data().status === 'active';
    }
    if (!exists) {
      return new Response('Not found', { status: 404 });
    }

    const embedRes = await embedGET(req, ctx);
    if (embedRes.status !== 200) {
      return new Response('Error', { status: embedRes.status });
    }

    const headers = new Headers(embedRes.headers);
    headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    headers.set(
      'Content-Disposition',
      `attachment; filename="aedral-structure-banniere-${id}.png"`,
    );
    return new Response(embedRes.body, { status: 200, headers });
  } catch (err) {
    captureApiError('API OG/structure/banner GET error', err);
    return new Response('Error', { status: 500 });
  }
}
