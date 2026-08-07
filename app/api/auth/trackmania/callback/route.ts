import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { tmIoUrlFromAccountId } from '@/lib/trackmania-identity';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isValidNext } from '@/lib/return-to';
import {
  exchangeTrackmaniaCode,
  fetchTrackmaniaIdentity,
  trackmaniaRedirectUri,
} from '@/lib/trackmania-oauth';

// GET /api/auth/trackmania/callback
//
// Retour de Nadeo après « Se connecter avec Ubisoft ». Écrit l'identité
// Trackmania VÉRIFIÉE sur le profil, puis renvoie le joueur à l'inscription.
//
// Les champs `pseudoTM` / `loginTM` existaient déjà mais étaient déclaratifs
// (saisis à la main). On les remplit ici avec les valeurs officielles et on
// ajoute `tmAccountId` + `tmVerifiedAt` : c'est cet accountId qui permettra de
// rapprocher automatiquement un inscrit de ses résultats remontés par le
// serveur de jeu.

/** Retour par défaut si aucune page d'origine n'a été mémorisée. */
const FALLBACK_RETURN_TO = '/mania-cup/inscription';

function back(origin: string, returnTo: string | undefined, err?: string) {
  const path = returnTo && isValidNext(returnTo) ? returnTo : FALLBACK_RETURN_TO;
  const url = new URL(path, origin);
  if (err) url.searchParams.set('tm_error', err);
  else url.searchParams.set('tm', 'ok');
  return NextResponse.redirect(url);
}

function clearCookies(res: NextResponse) {
  res.cookies.delete('tm_oauth_state');
  res.cookies.delete('tm_oauth_uid');
  res.cookies.delete('tm_oauth_next');
  return res;
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const returnTo = req.cookies.get('tm_oauth_next')?.value;

  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');

    // Le joueur a refusé l'autorisation chez Nadeo
    if (req.nextUrl.searchParams.get('error')) {
      return clearCookies(back(origin, returnTo, 'refus'));
    }

    const expectedState = req.cookies.get('tm_oauth_state')?.value;
    const uid = req.cookies.get('tm_oauth_uid')?.value;

    // Anti-CSRF : le state renvoyé doit correspondre au cookie httpOnly posé au
    // départ. Sans ça, un tiers pourrait faire lier SON compte Trackmania au
    // profil d'une victime.
    if (!code || !state || !expectedState || state !== expectedState || !uid) {
      return clearCookies(back(origin, returnTo, 'session'));
    }

    const accessToken = await exchangeTrackmaniaCode({
      code,
      redirectUri: trackmaniaRedirectUri(origin),
    });
    const identity = await fetchTrackmaniaIdentity(accessToken);

    const db = getAdminDb();

    // Un compte Trackmania ne peut être lié qu'à un seul compte Aedral : sinon
    // deux personnes pourraient s'inscrire avec la même identité de jeu, et le
    // rapprochement des résultats deviendrait ambigu.
    const already = await db
      .collection('users')
      .where('tmAccountId', '==', identity.accountId)
      .limit(1)
      .get();
    if (!already.empty && already.docs[0].id !== uid) {
      return clearCookies(back(origin, returnTo, 'deja_lie'));
    }

    // L'adresse de la fiche publique se déduit de l'identifiant : on la pose
    // ici plutôt que de la faire recopier au joueur. Sans elle, deux choses
    // cassaient — le formulaire de complétion de profil le bloquait sur
    // l'accueil, et la synchronisation nocturne des trophées l'ignorait, car
    // elle ne sait retrouver les joueurs que par ce champ.
    //
    // On n'écrase JAMAIS une adresse déjà saisie : si elle diverge de
    // l'identifiant vérifié, c'est un sujet à regarder, pas à effacer en
    // silence. Le repli de lecture (`tmAccountIdOf`) fait autorité de toute
    // façon, l'identifiant vérifié passant devant.
    const patch: Record<string, unknown> = {
      tmAccountId: identity.accountId,
      pseudoTM: identity.displayName,
      loginTM: identity.accountId,
      tmVerifiedAt: FieldValue.serverTimestamp(),
      // Lier son compte Ubisoft, c'est déclarer qu'on joue à Trackmania.
      // L'omettre laissait le profil incohérent — jeu non pratiqué, mais
      // identité de jeu vérifiée — et redemandait au joueur de cocher la case.
      games: FieldValue.arrayUnion('trackmania'),
    };
    const dejaSaisie = ((await db.collection('users').doc(uid).get()).data()?.tmIoUrl as string) ?? '';
    if (!dejaSaisie.trim()) {
      const url = tmIoUrlFromAccountId(identity.accountId);
      if (url) patch.tmIoUrl = url;
    }

    await db.collection('users').doc(uid).set(patch, { merge: true });

    return clearCookies(back(origin, returnTo));
  } catch (err) {
    captureApiError('auth/trackmania/callback', err);
    return clearCookies(back(origin, returnTo, 'technique'));
  }
}
