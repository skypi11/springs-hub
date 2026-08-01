import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import { MANIA_CUP_FAQ_COLLECTION } from '@/lib/mania-cup-faq';

// Réglages publics de la Springs Mania Cup — pour l'instant, les liens de
// billetterie HelloAsso.
//
// Pourquoi en base et pas en variable d'environnement : Matt créera sa
// billetterie après la mise en ligne du site. Une variable d'environnement
// l'obligerait à redéployer ; ici il colle ses liens dans la console et tous
// les boutons du site s'activent aussitôt.
//
// Un lien par tarif : joueur, spectateur, accompagnant. HelloAsso permet de
// pointer directement un tarif, et envoyer un accompagnant sur la page
// générique lui ferait choisir le mauvais billet — celui à 10 €, qui ne donne
// pas accès à la zone de jeu.

const SETTINGS_DOC = 'settings';

export interface ManiaCupSettings {
  ticketingPlayerUrl: string;
  ticketingSpectatorUrl: string;
  ticketingCompanionUrl: string;
}

const EMPTY: ManiaCupSettings = {
  ticketingPlayerUrl: '',
  ticketingSpectatorUrl: '',
  ticketingCompanionUrl: '',
};

function ref() {
  return getAdminDb().collection(MANIA_CUP_FAQ_COLLECTION).doc(SETTINGS_DOC);
}

/** N'accepte que des URL HelloAsso en https : un lien collé de travers enverrait
 *  les joueurs n'importe où, et c'est une page de paiement. */
function cleanUrl(raw: unknown): string {
  const v = clampString(raw, 400);
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return '';
    if (u.hostname !== 'helloasso.com' && !u.hostname.endsWith('.helloasso.com')) return '';
    return u.toString();
  } catch {
    return '';
  }
}

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const snap = await ref().get();
    const d = snap.data() ?? {};
    return NextResponse.json({
      settings: {
        ticketingPlayerUrl: (d.ticketingPlayerUrl as string) ?? '',
        ticketingSpectatorUrl: (d.ticketingSpectatorUrl as string) ?? '',
        ticketingCompanionUrl: (d.ticketingCompanionUrl as string) ?? '',
      } satisfies ManiaCupSettings,
    });
  } catch (err) {
    captureApiError('mania-cup/settings:GET', err);
    return NextResponse.json({ settings: EMPTY });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid || !(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

    const settings: ManiaCupSettings = {
      ticketingPlayerUrl: cleanUrl(body.ticketingPlayerUrl),
      ticketingSpectatorUrl: cleanUrl(body.ticketingSpectatorUrl),
      ticketingCompanionUrl: cleanUrl(body.ticketingCompanionUrl),
    };

    // Un lien non vide mais rejeté par la validation doit être signalé, sinon
    // l'organisateur croit avoir enregistré et découvre le problème le jour J.
    const rejected = (['ticketingPlayerUrl', 'ticketingSpectatorUrl', 'ticketingCompanionUrl'] as const)
      .filter((k) => clampString(body[k], 400) && !settings[k]);
    if (rejected.length > 0) {
      return NextResponse.json(
        { error: 'Les liens doivent être des adresses HelloAsso en https.' },
        { status: 400 }
      );
    }

    await ref().set(
      { ...settings, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid },
      { merge: true }
    );

    return NextResponse.json({ settings });
  } catch (err) {
    captureApiError('mania-cup/settings:PUT', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
