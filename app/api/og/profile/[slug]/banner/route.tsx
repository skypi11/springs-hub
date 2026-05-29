import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isLegacyUid } from '@/lib/user-slug';
import { captureApiError } from '@/lib/sentry';
import { GET as embedGET } from '../route';

// GET /api/og/profile/[slug]/banner
// Variante "download" 1200×630 de la bannière OG profile. Identique au rendu
// de la route embed (../route.tsx), avec uniquement les headers HTTP modifiés :
//   - Cache-Control privé sans cache (toujours version fraîche)
//   - Content-Disposition attachment (déclenche le download navigateur)
//
// Cas d'usage : un user veut télécharger sa bannière 1200×630 pour la poster
// manuellement sur Twitter/X, Facebook, comme thumbnail YouTube, etc. (vs la
// route embed qui sert juste l'image dans le `og:image` meta tag pour les bots
// Discord/Twitter qui crawlent).
//
// Implémentation : on appelle le GET de la route embed pour le rendu (zéro
// duplication des ~600 lignes de JSX/loading), puis on clone la Response avec
// des headers différents. Pré-check existence user pour retourner 404 propre
// si user introuvable / banni (l'embed lui retombe sur un fallback Aedral
// générique, ce qu'on NE veut PAS pour un download explicite).
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await ctx.params;
    const db = getAdminDb();

    // Pré-check : user existe et n'est pas banni ? On évite de servir un
    // fallback générique en download (l'user veut SON image ou rien).
    let exists = false;
    if (isLegacyUid(slug)) {
      const snap = await db.collection('users').doc(slug).get();
      exists = snap.exists && snap.data()?.isBanned !== true;
    } else {
      const snap = await db.collection('users').where('slug', '==', slug).limit(1).get();
      exists = !snap.empty && snap.docs[0].data().isBanned !== true;
    }
    if (!exists) {
      return new Response('Not found', { status: 404 });
    }

    // Délègue le rendu à la route embed (zéro duplication).
    const embedRes = await embedGET(req, ctx);
    if (embedRes.status !== 200) {
      return new Response('Error', { status: embedRes.status });
    }

    // Clone avec headers download. Body est un ReadableStream, on le passe tel quel.
    const headers = new Headers(embedRes.headers);
    headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    headers.set(
      'Content-Disposition',
      `attachment; filename="aedral-profil-banniere-${slug}.png"`,
    );
    return new Response(embedRes.body, { status: 200, headers });
  } catch (err) {
    captureApiError('API OG/profile/banner GET error', err);
    return new Response('Error', { status: 500 });
  }
}
