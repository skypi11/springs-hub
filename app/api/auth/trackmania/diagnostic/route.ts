import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { trackmaniaRedirectUri } from '@/lib/trackmania-oauth';

// GET /api/auth/trackmania/diagnostic — admin uniquement.
//
// Nadeo répond « invalid_client — check the redirect URI » sans jamais dire
// QUELLE adresse il a reçue. Cette route affiche ce que le serveur envoie
// réellement, pour le comparer caractère par caractère à ce qui est déclaré
// sur api.trackmania.com. La comparaison à l'œil sur deux URLs recopiées à la
// main est la première cause de perte de temps sur ce genre de panne.
//
// Le client_id n'est PAS un secret (il circule en clair dans l'URL
// d'autorisation), mais il reste tronqué ici : on veut vérifier qu'il est bien
// chargé et sans espace parasite, pas le publier. Le secret n'est jamais exposé,
// seulement sa présence et sa longueur.
export async function GET(req: NextRequest) {
  const uid = await verifyAuth(req);
  if (!uid || !(await isCompetitionAdmin(uid))) {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
  }

  const origin = req.nextUrl.origin;
  const redirectUri = trackmaniaRedirectUri(origin);
  const clientId = process.env.TM_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.TM_OAUTH_CLIENT_SECRET ?? '';

  return NextResponse.json({
    // À déclarer À L'IDENTIQUE dans l'application Nadeo
    redirectUriEnvoye: redirectUri,
    origineDetectee: origin,
    clientId: {
      present: clientId.length > 0,
      longueur: clientId.length,
      apercu: clientId ? `${clientId.slice(0, 6)}…${clientId.slice(-4)}` : null,
      // Un espace ou un retour à la ligne collé en fin de variable est invisible
      // dans l'interface Vercel et suffit à faire échouer l'authentification.
      espacesParasites: clientId !== clientId.trim(),
    },
    clientSecret: {
      present: clientSecret.length > 0,
      longueur: clientSecret.length,
      espacesParasites: clientSecret !== clientSecret.trim(),
    },
    urlAutorisation: clientId
      ? `https://api.trackmania.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(
          clientId
        )}&redirect_uri=${encodeURIComponent(redirectUri)}&state=DIAGNOSTIC`
      : null,
  });
}
