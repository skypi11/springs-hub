import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';
import {
  getHelloAssoConfig,
  fetchOrder,
  HelloAssoError,
  type HelloAssoConfig,
} from '@/lib/helloasso/client';
import { parseOrder, parseTierMap } from '@/lib/helloasso/reconcile';
import { applyOrderItem } from '@/lib/helloasso/apply';
import type { HelloAssoNotification, HelloAssoOrder } from '@/lib/helloasso/types';

// Notification de paiement HelloAsso.
//
// ─────────────────────────────────────────────────────────────────────────────
// CE QUI ARRIVE ICI N'EST PAS DIGNE DE CONFIANCE.
//
// HelloAsso réserve la signature de ses notifications à ses partenaires
// commerciaux ; un compte associatif n'y a pas droit. Le corps reçu est donc
// une donnée que n'importe qui peut fabriquer et poster, pour peu qu'il
// connaisse l'adresse. « Paiement de 30 € reçu, code LAN-4242 » est une phrase
// qu'un inconnu peut nous dire.
//
// D'où la règle qui structure tout ce fichier : le corps sert UNIQUEMENT à
// apprendre qu'il s'est passé quelque chose et sur quelle commande. Tout ce qui
// décide d'une place — le tarif, le montant, l'état, le code d'inscription —
// est relu chez HelloAsso par un appel sortant authentifié avec nos clés.
//
// Trois barrières, de la plus faible à la plus solide :
//   1. un segment secret dans l'URL, qu'on ne publie nulle part ;
//   2. une liste d'adresses IP autorisées, si elle est configurée ;
//   3. la relecture serveur à serveur, qui est la seule infalsifiable.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Adresses annoncées par HelloAsso. Laissées en variable d'environnement et
 *  non en dur : l'éditeur ne publie aucune garantie de stabilité, et une IP
 *  changée sans préavis couperait les paiements en silence. Variable absente =
 *  pas de filtrage, ce qui est le bon défaut : la relecture chez HelloAsso
 *  protège déjà, mieux vaut laisser passer que bloquer la production. */
function allowedIps(): string[] {
  return (process.env.HELLOASSO_ALLOWED_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * L'appelant, vu de Vercel.
 *
 * On lit l'entrée LA PLUS À GAUCHE de `x-forwarded-for` : c'est celle que la
 * plateforme a constatée. Les suivantes peuvent avoir été ajoutées par
 * l'appelant lui-même, donc lire la dernière serait usurpable.
 */
function callerIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.headers.get('x-real-ip') || '').trim();
}

/** Comparaison à durée constante : une comparaison naïve laisse deviner le
 *  secret caractère par caractère en mesurant le temps de réponse. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ secret: string }> }) {
  const expected = (process.env.HELLOASSO_WEBHOOK_SECRET || '').trim();
  const { secret } = await ctx.params;

  // Pas de secret configuré : la route n'existe pas. On ne veut surtout pas
  // d'un endpoint ouvert qui écrirait des paiements pendant une installation
  // à moitié faite.
  if (!expected || !secretMatches(secret, expected)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ips = allowedIps();
  if (ips.length > 0) {
    const ip = callerIp(req);
    if (!ips.includes(ip)) {
      captureApiError('mania-cup/webhook:ip', new Error(`IP refusée : ${ip || 'inconnue'}`));
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const cfg = getHelloAssoConfig();
  if (!cfg) {
    // Sans clés, impossible de vérifier quoi que ce soit. On répond 503 plutôt
    // que 200 : HelloAsso rejouera, et le paiement ne sera pas perdu.
    captureApiError('mania-cup/webhook', new Error('HelloAsso non configuré'));
    return NextResponse.json({ error: 'Connecteur HelloAsso non configuré' }, { status: 503 });
  }

  try {
    const raw = await req.text();
    const body = JSON.parse(raw) as HelloAssoNotification;
    const eventType = String(body.eventType ?? '');

    // Un changement de nom d'association change son identifiant d'URL, ce qui
    // casserait tous nos appels en silence. On le signale plutôt que de
    // l'ignorer poliment.
    if (eventType === 'Organization') {
      captureApiError(
        'mania-cup/webhook',
        new Error('HelloAsso signale une modification de l’organisation — vérifier HELLOASSO_ORG_SLUG')
      );
      return NextResponse.json({ ok: true, ignored: 'organization' });
    }

    if (eventType !== 'Order' && eventType !== 'Payment') {
      return NextResponse.json({ ok: true, ignored: eventType || 'inconnu' });
    }

    const orderId = extractOrderId(eventType, body.data);
    if (!orderId) {
      return NextResponse.json({ ok: true, ignored: 'commande introuvable dans la notification' });
    }

    const db = getAdminDb();

    // ── Le seul point de vérité : on redemande la commande à HelloAsso ──────
    let order: HelloAssoOrder;
    try {
      order = await fetchOrder(db, cfg, orderId);
    } catch (err) {
      if (err instanceof HelloAssoError && err.isTransient) {
        // Panne passagère : on demande explicitement le rejeu.
        return NextResponse.json({ error: 'HelloAsso indisponible' }, { status: 503 });
      }
      throw err;
    }

    if (!belongsToUs(order, cfg)) {
      // L'adresse de notification est commune à toute l'association : elle
      // reçoit aussi les adhésions et les dons. Ce n'est pas une anomalie.
      return NextResponse.json({ ok: true, ignored: 'hors périmètre Mania Cup' });
    }

    const settings = await getManiaCupSettings(db);
    const items = parseOrder(order, {
      tiers: parseTierMap(settings.helloAssoTierMap),
      codeFieldLabel: settings.helloAssoCodeField,
    });

    const results = [];
    for (const item of items) {
      results.push(
        await applyOrderItem(db, item, {
          source: 'webhook',
          expectedPlayerAmountCents: settings.priceEuros * 100,
        })
      );
    }

    return NextResponse.json({ ok: true, orderId, items: results });
  } catch (err) {
    captureApiError('mania-cup/webhook', err);
    // 500 volontaire : HelloAsso rejouera. Répondre 200 sur une erreur
    // reviendrait à perdre le paiement définitivement.
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/**
 * Sur quelle commande porte cette notification ?
 *
 * Les deux formes de notification n'ont pas la même structure : une
 * notification `Order` décrit la commande elle-même, une notification
 * `Payment` décrit un paiement qui la référence. Un lecteur générique se
 * tromperait de champ une fois sur deux.
 */
function extractOrderId(eventType: string, data: Record<string, unknown> | undefined): number | null {
  if (!data) return null;
  if (eventType === 'Order') {
    const id = Number(data.id);
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  const order = data.order as { id?: unknown } | undefined;
  const id = Number(order?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * La commande relève-t-elle de la Mania Cup ?
 *
 * L'adresse de notification est commune à toute l'association : elle reçoit
 * aussi ses adhésions, ses dons et ses autres événements. On ne retient que les
 * formulaires déclarés — la billetterie, et la boutique de location quand elle
 * existera.
 */
function belongsToUs(order: HelloAssoOrder, cfg: HelloAssoConfig): boolean {
  if (order.organizationSlug && order.organizationSlug !== cfg.organizationSlug) return false;
  if (!order.formSlug) return true;
  return cfg.forms.some(
    (f) => f.slug === order.formSlug && (!order.formType || f.type === order.formType)
  );
}

// HelloAsso teste l'adresse en GET au moment où on la déclare. Répondre 200
// évite de croire à une panne alors que tout est en place.
export async function GET() {
  return NextResponse.json({ ok: true, service: 'mania-cup/helloasso' });
}
