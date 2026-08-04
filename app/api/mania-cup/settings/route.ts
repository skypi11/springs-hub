import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import { MANIA_CUP_FAQ_COLLECTION } from '@/lib/mania-cup-faq';
import { TICKET_KINDS } from '@/lib/helloasso/types';
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

/**
 * Ce que le site public a besoin de connaître : des tarifs et des liens.
 *
 * La correspondance des tarifs HelloAsso et le libellé du champ de code n'y
 * figurent pas — ce sont des réglages de tuyauterie, sans intérêt pour un
 * visiteur, et rien ne gagne à les publier. La console les lit par sa propre
 * route, réservée aux administrateurs.
 */
function publicSettings(s: ManiaCupSettings) {
  return {
    ticketingPlayerUrl: s.ticketingPlayerUrl,
    ticketingSpectatorUrl: s.ticketingSpectatorUrl,
    ticketingCompanionUrl: s.ticketingCompanionUrl,
    ticketingPcRentalUrl: s.ticketingPcRentalUrl,
    priceEuros: s.priceEuros,
    spectatorDayEuros: s.spectatorDayEuros,
    spectatorTwoDaysEuros: s.spectatorTwoDaysEuros,
    companionEuros: s.companionEuros,
    pcRentalEuros: s.pcRentalEuros,
    prizePoolEuros: s.prizePoolEuros,
    maxPlayers: s.maxPlayers,
  };
}

/** Contrôle de la correspondance des tarifs. Renvoie le problème à afficher,
 *  ou null si tout est bon. */
function validateTierMap(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'La correspondance des tarifs n’est pas un JSON valide.';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'La correspondance des tarifs doit être un objet { "tarif": "catégorie" }.';
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return 'La correspondance des tarifs est vide.';
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || !(TICKET_KINDS as readonly string[]).includes(value)) {
      return `« ${key} » pointe sur une catégorie inconnue. Attendu : ${TICKET_KINDS.join(', ')}.`;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    return NextResponse.json({ settings: publicSettings(await getManiaCupSettings(getAdminDb())) });
  } catch (err) {
    captureApiError('mania-cup/settings:GET', err);
    return NextResponse.json({ settings: publicSettings(DEFAULT_SETTINGS) });
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

    // Tout ce PUT est PARTIEL : un champ absent du corps garde sa valeur.
    // Deux écrans de la console éditent ces réglages, et l'un ne doit pas
    // effacer le travail de l'autre simplement parce qu'il ne le connaît pas.
    const previous = await getManiaCupSettings(getAdminDb());

    const URL_KEYS = [
      'ticketingPlayerUrl',
      'ticketingSpectatorUrl',
      'ticketingCompanionUrl',
      'ticketingPcRentalUrl',
    ] as const;

    const urls = {} as Record<(typeof URL_KEYS)[number], string>;
    const rejected: string[] = [];
    for (const key of URL_KEYS) {
      if (body[key] === undefined) {
        urls[key] = previous[key];
        continue;
      }
      const cleaned = cleanUrl(body[key]);
      // Un lien non vide mais rejeté doit être signalé : sinon l'organisateur
      // croit avoir enregistré et le découvre le jour de l'annonce.
      if (clampString(body[key], 400) && !cleaned) rejected.push(key);
      urls[key] = cleaned;
    }
    if (rejected.length > 0) {
      return NextResponse.json(
        { error: 'Les liens doivent être des adresses HelloAsso en https.' },
        { status: 400 }
      );
    }

    const numbers = Object.fromEntries(
      (Object.keys(SETTINGS_BOUNDS) as NumericSettingKey[]).map((k) => [
        k,
        body[k] === undefined ? previous[k] : normalizeNumber(k, body[k]),
      ])
    ) as Record<NumericSettingKey, number>;

    // La correspondance des tarifs décide à quoi sert chaque billet vendu :
    // l'enregistrer cassée, ce serait laisser tous les paiements suivants
    // partir en relecture manuelle sans que personne comprenne pourquoi.
    let tierMap = previous.helloAssoTierMap;
    if (body.helloAssoTierMap !== undefined) {
      tierMap = clampString(body.helloAssoTierMap, 2000).trim();
      if (tierMap) {
        const problem = validateTierMap(tierMap);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      }
    }

    const codeField =
      body.helloAssoCodeField !== undefined
        ? clampString(body.helloAssoCodeField, 120).trim() || DEFAULT_SETTINGS.helloAssoCodeField
        : previous.helloAssoCodeField;

    const settings: ManiaCupSettings = {
      ...urls,
      ...numbers,
      helloAssoTierMap: tierMap,
      helloAssoCodeField: codeField,
    };

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
