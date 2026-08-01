import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import { MANIA_CUP_FAQ_COLLECTION } from '@/lib/mania-cup-faq';
import {
  MANIA_CUP_SETTINGS_DOC,
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  normalizeNumber,
  getManiaCupSettings,
  type ManiaCupSettings,
  type NumericSettingKey,
} from '@/lib/mania-cup-settings';

// Réglages de la Springs Mania Cup : liens de billetterie, tarifs, jauge.
//
// GET — public (les tarifs s'affichent sur le site, ce ne sont pas des secrets)
// PUT — admins de compétition
//
// Pourquoi en base et non en constantes : un tarif change, et Matt ne code pas.
// Les y laisser lui imposait un déploiement pour corriger un chiffre.

function ref() {
  return getAdminDb().collection(MANIA_CUP_FAQ_COLLECTION).doc(MANIA_CUP_SETTINGS_DOC);
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
    return NextResponse.json({ settings: await getManiaCupSettings(getAdminDb()) });
  } catch (err) {
    captureApiError('mania-cup/settings:GET', err);
    return NextResponse.json({ settings: DEFAULT_SETTINGS });
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

    const urls = {
      ticketingPlayerUrl: cleanUrl(body.ticketingPlayerUrl),
      ticketingSpectatorUrl: cleanUrl(body.ticketingSpectatorUrl),
      ticketingCompanionUrl: cleanUrl(body.ticketingCompanionUrl),
    };

    // Un lien non vide mais rejeté doit être signalé : sinon l'organisateur
    // croit avoir enregistré et le découvre le jour de l'annonce.
    const rejected = (Object.keys(urls) as (keyof typeof urls)[]).filter(
      (k) => clampString(body[k], 400) && !urls[k]
    );
    if (rejected.length > 0) {
      return NextResponse.json(
        { error: 'Les liens doivent être des adresses HelloAsso en https.' },
        { status: 400 }
      );
    }

    const numbers = Object.fromEntries(
      (Object.keys(SETTINGS_BOUNDS) as NumericSettingKey[]).map((k) => [
        k,
        normalizeNumber(k, body[k]),
      ])
    ) as Record<NumericSettingKey, number>;

    const settings: ManiaCupSettings = { ...urls, ...numbers };

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
