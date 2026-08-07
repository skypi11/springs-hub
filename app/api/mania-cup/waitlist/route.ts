import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';
import { MANIA_CUP_REGISTRATIONS } from '@/lib/mania-cup';
import {
  MANIA_CUP_WAITLIST, rangDe, placesReservees, invitationActive,
  type EntreeAttente,
} from '@/lib/mania-cup-waitlist';
import { lireFileAttente, compterPlacesReglees } from '@/lib/mania-cup-waitlist-server';

// Liste d'attente : le joueur s'y met, ou s'en retire.
//
// GET  — sa position, et l'état de la file
// POST — { action: 'join' | 'leave' }
//
// Aucune place n'est promise ici : rejoindre la file, c'est demander à être
// prévenu. C'est l'organisation qui invite, une place à la fois.

export async function GET(req: NextRequest) {
  try {
    const db = getAdminDb();
    const uid = await verifyAuth(req);

    const [{ entrees }, reglees, settings] = await Promise.all([
      lireFileAttente(db),
      compterPlacesReglees(db),
      getManiaCupSettings(db),
    ]);
    const maintenant = Date.now();
    const occupees = reglees + placesReservees(entrees, maintenant);

    return NextResponse.json({
      // Le public voit la longueur de la file, jamais qui y figure.
      enAttente: entrees.filter((e) => e.statut === 'waiting' || e.statut === 'invited').length,
      complet: occupees >= settings.maxPlayers,
      // C'est le SERVEUR qui dit si l'invitation court encore. Comparer une
      // échéance à l'horloge du navigateur ferait dépendre une réservation de
      // l'heure réglée sur la machine du joueur.
      moi: uid ? etatDuJoueur(entrees, uid, maintenant) : null,
    });
  } catch (err) {
    captureApiError('mania-cup/waitlist:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

function etatDuJoueur(
  entrees: EntreeAttente[],
  uid: string,
  maintenant: number
) {
  const e = entrees.find((x) => x.uid === uid);
  return {
    rang: rangDe(entrees, uid),
    statut: e?.statut ?? null,
    expireA: e?.expireA ?? null,
    /** Une place lui est-elle réservée en ce moment ? */
    invitationActive: e ? invitationActive(e, maintenant) : false,
  };
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });

    const limited = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (limited) return limited;

    const body = (await req.json()) as { action?: unknown };
    const action = body?.action;
    if (action !== 'join' && action !== 'leave') {
      return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection(MANIA_CUP_WAITLIST).doc(uid);

    if (action === 'leave') {
      // On garde la trace du passage plutôt que de supprimer : si la personne
      // revient, son ordre d'arrivée d'origine n'a plus à être reconstitué de
      // mémoire, et l'organisation voit qui s'est désisté.
      await ref.set({ status: 'left', leftAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true, statut: 'left' });
    }

    // Déjà inscrit et réglé : la file n'a pas de sens pour lui.
    const reg = await db.collection(MANIA_CUP_REGISTRATIONS).doc(uid).get();
    if (reg.exists && (reg.data()?.status as string) === 'confirmed') {
      return NextResponse.json(
        { error: 'Ta place est déjà réglée — tu n’as pas besoin de la liste d’attente.' },
        { status: 409 }
      );
    }

    const existant = await ref.get();
    const statutActuel = existant.data()?.status as string | undefined;
    if (statutActuel === 'waiting' || statutActuel === 'invited') {
      const { entrees } = await lireFileAttente(db);
      return NextResponse.json({ ok: true, statut: statutActuel, rang: rangDe(entrees, uid) });
    }

    // Un retour dans la file repart à la date du jour : reprendre son ancien
    // rang après s'être désisté passerait devant des gens qui, eux, ont attendu.
    await ref.set(
      { uid, status: 'waiting', createdAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    const { entrees } = await lireFileAttente(db);
    return NextResponse.json({ ok: true, statut: 'waiting', rang: rangDe(entrees, uid) });
  } catch (err) {
    captureApiError('mania-cup/waitlist:POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
