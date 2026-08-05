import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { HelloAssoOrder } from './types';

// Accès à l'API HelloAsso.
//
// Ce module existe pour une raison de sécurité, pas de confort : HelloAsso ne
// signe pas les notifications envoyées aux comptes associatifs (la signature
// HMAC est réservée à ses partenaires). Le corps d'un webhook est donc une
// donnée que N'IMPORTE QUI peut nous poster. La seule chose infalsifiable est
// ce que l'API nous répond quand c'est NOUS qui appelons, avec nos clés.
//
// Règle absolue : aucune place n'est jamais confirmée sur la foi du corps reçu.
// Le webhook sert de sonnette ; la vérité se lit ici.

const TOKEN_DOC = '_helloasso/oauth';

/** Marge de sécurité avant expiration : on renouvelle un peu en avance plutôt
 *  que de découvrir l'expiration au milieu d'un rattachement. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Un formulaire HelloAsso dont on lit les commandes.
 *
 * L'événement en a deux, de natures différentes : la BILLETTERIE (`Event`)
 * pour les inscriptions et les entrées, et une BOUTIQUE (`Shop`) pour la
 * location de matériel — une boutique gère des produits avec photo,
 * description et stock par référence, ce qu'un tarif de billetterie ne sait
 * pas faire. Les deux vivent sous la même association et arrivent par la même
 * notification : c'est le type et l'identifiant qui les distinguent.
 */
export interface HelloAssoForm {
  type: 'Event' | 'Shop';
  slug: string;
}

export interface HelloAssoConfig {
  clientId: string;
  clientSecret: string;
  /** Identifiant de l'association dans les URL HelloAsso. */
  organizationSlug: string;
  /** Les formulaires du périmètre Mania Cup. Le premier est la billetterie. */
  forms: HelloAssoForm[];
  /** Bascule vers le bac à sable pour les essais. */
  apiBase: string;
}

export function getHelloAssoConfig(): HelloAssoConfig | null {
  // `.trim()` sur chaque valeur : un retour à la ligne collé par mégarde dans
  // une variable Vercel produit une panne d'authentification impossible à
  // diagnostiquer à l'œil.
  const clientId = (process.env.HELLOASSO_CLIENT_ID || '').trim();
  const clientSecret = (process.env.HELLOASSO_CLIENT_SECRET || '').trim();
  const organizationSlug = (process.env.HELLOASSO_ORG_SLUG || '').trim();
  const formSlug = (process.env.HELLOASSO_FORM_SLUG || '').trim();
  if (!clientId || !clientSecret || !organizationSlug || !formSlug) return null;

  const forms: HelloAssoForm[] = [{ type: 'Event', slug: formSlug }];

  // La boutique de location arrivera plus tard : le connecteur la lit dès
  // qu'elle est déclarée, sans autre changement.
  const shopSlug = (process.env.HELLOASSO_SHOP_SLUG || '').trim();
  if (shopSlug) forms.push({ type: 'Shop', slug: shopSlug });

  return {
    clientId,
    clientSecret,
    organizationSlug,
    forms,
    apiBase: (process.env.HELLOASSO_API_BASE || 'https://api.helloasso.com').trim(),
  };
}

/** Le connecteur est-il utilisable ? Même esprit que `isEncryptionAvailable()` :
 *  on refuse bruyamment plutôt que de valider à l'aveugle. */
export function isHelloAssoConfigured(): boolean {
  return getHelloAssoConfig() !== null;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Jeton d'accès, mis en cache dans Firestore.
 *
 * Le cache n'est pas une optimisation : HelloAsso plafonne le nombre de jetons
 * valides simultanés par clé, et limite sévèrement les appels d'authentification
 * (quelques dizaines par heure). Chaque instance de fonction Vercel qui
 * demanderait son propre jeton ferait tomber tout le monde. Le partage passe
 * donc par la base, seul endroit que toutes les instances voient.
 */
async function getAccessToken(db: Firestore, cfg: HelloAssoConfig): Promise<string> {
  const ref = db.doc(TOKEN_DOC);
  const snap = await ref.get();
  const cached = snap.data() as CachedToken | undefined;
  if (cached?.accessToken && cached.expiresAtMs > Date.now() + EXPIRY_MARGIN_MS) {
    return cached.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const res = await fetch(`${cfg.apiBase}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new HelloAssoError(
      `Authentification HelloAsso refusée (${res.status})`,
      res.status,
      await res.text().catch(() => '')
    );
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new HelloAssoError('Réponse d’authentification HelloAsso sans jeton', 502, '');
  }

  const expiresAtMs = Date.now() + (json.expires_in ?? 1800) * 1000;
  await ref.set({ accessToken: json.access_token, expiresAtMs, refreshedAt: FieldValue.serverTimestamp() });
  return json.access_token;
}

export class HelloAssoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = 'HelloAssoError';
  }

  /** Une panne passagère mérite un rejeu ; une erreur de configuration, non. */
  get isTransient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

async function apiFetch<T>(
  db: Firestore,
  cfg: HelloAssoConfig,
  path: string,
  retryOnAuth = true
): Promise<T> {
  const token = await getAccessToken(db, cfg);
  const res = await fetch(`${cfg.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });

  // Jeton révoqué avant son échéance (rotation côté HelloAsso, dépassement du
  // plafond de jetons) : on efface le cache et on retente une fois.
  if (res.status === 401 && retryOnAuth) {
    await db.doc(TOKEN_DOC).delete().catch(() => {});
    return apiFetch<T>(db, cfg, path, false);
  }

  if (!res.ok) {
    throw new HelloAssoError(
      `HelloAsso ${path} a répondu ${res.status}`,
      res.status,
      await res.text().catch(() => '')
    );
  }
  return (await res.json()) as T;
}

/**
 * La commande, telle que HelloAsso la connaît. C'est LA source de vérité du
 * rattachement : les champs personnalisés y figurent toujours, alors que le
 * corps du webhook peut ne pas les transporter.
 */
export async function fetchOrder(
  db: Firestore,
  cfg: HelloAssoConfig,
  orderId: number
): Promise<HelloAssoOrder> {
  return apiFetch<HelloAssoOrder>(db, cfg, `/v5/orders/${orderId}`);
}

interface PagedOrders {
  data?: HelloAssoOrder[];
  pagination?: { continuationToken?: string; totalPages?: number; pageIndex?: number };
}

/**
 * Toutes les commandes du formulaire, page par page.
 *
 * `withDetails=true` est indispensable ici : sur les points d'entrée qui
 * RENVOIENT UNE LISTE, les champs personnalisés — donc le code d'inscription —
 * ne sont pas inclus par défaut.
 */
export async function* iterateFormOrders(
  db: Firestore,
  cfg: HelloAssoConfig,
  pageSize = 100
): AsyncGenerator<HelloAssoOrder> {
  for (const form of cfg.forms) {
    let token: string | undefined;
    // Borne de sécurité : sans elle, un jeton de pagination qui ne bouge pas
    // ferait tourner la réconciliation jusqu'au délai maximal de la fonction.
    for (let page = 0; page < 50; page++) {
      const qs = new URLSearchParams({
        pageSize: String(pageSize),
        withDetails: 'true',
      });
      if (token) qs.set('continuationToken', token);

      const res = await apiFetch<PagedOrders>(
        db,
        cfg,
        `/v5/organizations/${cfg.organizationSlug}/forms/${form.type}/${form.slug}/orders?${qs}`
      );

      for (const order of res.data ?? []) yield order;

      const next = res.pagination?.continuationToken;
      if (!next || next === token || (res.data ?? []).length === 0) break;
      token = next;
    }
  }
}

export interface HelloAssoTier {
  id: number;
  label: string;
  priceCents: number;
  /** D'où vient ce tarif : la billetterie ou la boutique. */
  formType: HelloAssoForm['type'];
  formSlug: string;
}

/**
 * Les tarifs et produits de tous les formulaires du périmètre, pour que
 * l'organisation associe chacun à sa catégorie sans recopier d'identifiants.
 *
 * Un formulaire injoignable n'interrompt pas les autres : la boutique peut être
 * déclarée avant d'exister, ou archivée après l'événement.
 */
export async function fetchFormTiers(
  db: Firestore,
  cfg: HelloAssoConfig
): Promise<HelloAssoTier[]> {
  const out: HelloAssoTier[] = [];
  for (const form of cfg.forms) {
    try {
      const res = await apiFetch<{ tiers?: { id?: number; label?: string; price?: number }[] }>(
        db,
        cfg,
        `/v5/organizations/${cfg.organizationSlug}/forms/${form.type}/${form.slug}/public`
      );
      for (const t of res.tiers ?? []) {
        out.push({
          id: Number(t.id ?? 0),
          label: t.label ?? '',
          priceCents: Number(t.price ?? 0),
          formType: form.type,
          formSlug: form.slug,
        });
      }
    } catch (err) {
      if (err instanceof HelloAssoError && err.status === 404) continue;
      throw err;
    }
  }
  return out;
}
