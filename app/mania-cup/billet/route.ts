import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';

// Raccourci vers la billetterie : aedral.com/mania-cup/billet
//
// Trois raisons de ne pas communiquer directement l'adresse HelloAsso.
//
// Elle n'est pas maîtrisée : HelloAsso la fabrique à partir du titre donné à la
// création, et elle devient DÉFINITIVE dès la première vente. Une campagne
// nommée « … #1 Joueur » garde ce mot dans son adresse pour toujours, y compris
// pour les spectateurs à qui elle laisse croire qu'ils ne sont pas au bon
// endroit.
//
// Elle est longue, et ce lien va sur une affiche, dans un message Discord, dans
// une bouche-à-oreille. « aedral.com/mania-cup/billet » se retient et se dicte.
//
// Elle peut changer. Le jour où l'organisation refait sa billetterie, il suffit
// de coller la nouvelle adresse dans la console : tout ce qui a été imprimé et
// partagé continue de fonctionner.

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  try {
    const settings = await getManiaCupSettings(getAdminDb());
    const target = settings.ticketingUrl?.trim();

    // Billetterie pas encore ouverte : on renvoie sur la présentation plutôt
    // que sur une page d'erreur. Le lien peut circuler avant l'ouverture.
    if (!target) {
      return NextResponse.redirect(`${origin}/mania-cup?billetterie=bientot`, 307);
    }

    // Redirection temporaire, jamais permanente : une 308 se met en cache dans
    // les navigateurs et resterait collée à l'ancienne adresse le jour où elle
    // change — ce qui est précisément ce que ce raccourci doit éviter.
    return NextResponse.redirect(target, 307);
  } catch (err) {
    captureApiError('mania-cup/billet', err);
    return NextResponse.redirect(`${origin}/mania-cup`, 307);
  }
}
