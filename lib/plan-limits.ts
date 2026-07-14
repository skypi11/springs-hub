// Centralisation des limites par plan pour préparer le freemium.
//
// Système actuel : `structures.premium: boolean` (legacy, en place depuis le
// chantier ballchasing replays). On le wrap maintenant en un type `StructurePlan`
// extensible, toute la logique passe par `getStructurePlan(data)` qui normalise.
//
// Cette indirection permet, le jour où on shippe le freemium :
//   - d'ajouter d'autres plans ('team', 'enterprise') sans toucher 50 fichiers
//   - de tweak les quotas par plan dans 1 seul endroit
//   - de retrouver vite toutes les features pro via `// FUTURE_PRO_FEATURE` dans le code
//
// IMPORTANT : ne pas shipper de paywall sans demande explicite de Matt.
// Cf. CLAUDE.md "Pas de monétisation immédiate", l'objectif An 1 est l'adoption gratuite.

import { UPLOAD_LIMITS } from '@/lib/upload-limits';

export type StructurePlan = 'free' | 'pro';

export const STRUCTURE_PLANS: readonly StructurePlan[] = ['free', 'pro'];

// Métadonnées affichage (label user-facing). Utilisé pour l'UI future.
export const PLAN_META: Record<StructurePlan, { label: string; tagline: string }> = {
  free: {
    label: 'Gratuit',
    tagline: 'Toutes les fonctionnalités essentielles',
  },
  pro: {
    label: 'Pro',
    tagline: 'Stockage étendu, branding custom, automations',
  },
};

// Normalisation : lit le plan depuis un doc structure Firestore.
// Accepte les 2 formats : `plan: 'free'|'pro'` (nouveau) OU `premium: true|false` (legacy).
// Le legacy `premium: true` → 'pro'. Tout le reste → 'free'.
export function getStructurePlan(structureData: Record<string, unknown> | null | undefined): StructurePlan {
  if (!structureData) return 'free';
  const planField = structureData.plan;
  if (planField === 'pro') return 'pro';
  if (planField === 'free') return 'free';
  // Fallback legacy
  if (structureData.premium === true) return 'pro';
  return 'free';
}

// Limites par plan, source de vérité unique pour TOUS les quotas/caps freemium.
// Quand on shippe le pricing, on modifie UNIQUEMENT cet objet.
export const PLAN_LIMITS = {
  free: {
    // Stockage R2 partagé docs + replays
    storageBytes: UPLOAD_LIMITS.STRUCTURE_STORAGE_QUOTA_BYTES,        // 500 MB
    // Parsing ballchasing (replays/semaine via auto-parse)
    weeklyParseQuota: 20,
    // Templates exercices partagés à la structure
    // (compat ascendante : les structures qui avaient plus de templates avant
    // l'application de cette limite ne perdent rien, c'est l'AJOUT du 16e qui
    // est bloqué côté API check)
    maxSharedTemplates: 15,
    // Équipes max par structure (limite douce, jamais hard cap aujourd'hui)
    maxTeams: Infinity,
    // Branding avancé : couleur d'accent custom (autre que l'or Aedral),
    // sub-domain `aran.aedral.com` (nécessite Vercel Pro côté infra),
    // favicon custom, logo grand format sur la page publique.
    // ⚠️ NE COUVRE PAS la bannière de structure : elle existe DÉJÀ en gratuit.
    customBranding: false,
    // Boutons Discord interactifs (RSVP event, valider exo depuis Discord, etc.)
    // au-delà des embeds simples. Nécessite endpoint /api/discord/interactions.
    interactiveDiscordButtons: false,
    // Dashboard staff agrégé : tendances 30j équipe, comparaisons joueurs, MVP,
    // win rate cross-events. ⚠️ NE COUVRE PAS les stats individuelles d'un joueur
    // sur son propre profil, celles-ci restent gratuites (cf. placeholder profil).
    advancedAnalytics: false,
    // Hosting tournois white-label : organiser ses propres tournois avec
    // branding de la structure (vs branding Aedral). Phase 3+ feature.
    whiteLabelTournaments: false,
    // Rappel AUTOMATIQUE hebdo des dispos par le bot (post dimanche dans le
    // salon d'équipe). GRATUIT au lancement (l'adoption des dispos EST le
    // problème n°1 — la gater se tirerait une balle dans le pied) mais
    // gate-ready : le jour du pricing, passer free→false suffit à en faire un
    // levier Pro. Le bouton manuel de relance, lui, reste gratuit pour toujours.
    autoAvailabilityReminder: true,
  },
  pro: {
    storageBytes: UPLOAD_LIMITS.STRUCTURE_STORAGE_QUOTA_BYTES_PREMIUM, // 5 GB
    weeklyParseQuota: 100,
    maxSharedTemplates: 50,
    maxTeams: Infinity,
    customBranding: true,
    interactiveDiscordButtons: true,
    advancedAnalytics: true,
    whiteLabelTournaments: true,
    autoAvailabilityReminder: true,
  },
} as const satisfies Record<StructurePlan, Record<string, unknown>>;

export type PlanLimitKey = keyof typeof PLAN_LIMITS['free'];
// Union des valeurs possibles pour CHAQUE clé entre free et pro (ex: storageBytes
// est toujours number, customBranding est boolean).
type PlanLimitValue<K extends PlanLimitKey> =
  | typeof PLAN_LIMITS['free'][K]
  | typeof PLAN_LIMITS['pro'][K];

// Lookup typé d'une limite pour un plan donné.
// Préférable au lookup direct `PLAN_LIMITS[plan][key]` pour la lisibilité au call site.
// (Cast nécessaire : TS n'infère pas le union depuis l'accès indexed sur as const)
export function getLimit<K extends PlanLimitKey>(
  plan: StructurePlan,
  key: K,
): PlanLimitValue<K> {
  return PLAN_LIMITS[plan][key] as PlanLimitValue<K>;
}

// Helper raccourci : true si une feature booléenne est activée pour ce plan.
// Plus lisible côté UI que `getLimit(plan, 'customBranding') === true`.
export function hasFeature(
  plan: StructurePlan,
  feature: PlanLimitKey,
): boolean {
  return PLAN_LIMITS[plan][feature] === true;
}

// ─── Features joueur (user-level) ─────────────────────────────────────────────
// Distinct des features structure : ces helpers gardent les fonctionnalités
// activables côté profil joueur (vs côté structure ci-dessus).
// Aujourd'hui tout retourne true (gratuit pour tous). Le jour où on shippe un
// Pro Joueur (à ~2€/mois, non écarté mais pas avant 2k+ users actifs cf.
// project_ownership_and_business_model), on flippe le return ici sans toucher
// l'UI ni les écritures Firestore qui sont déjà gate-friendly.
//
// Cf. mémoire feedback_freemium_reserve pour la règle d'architecture.

/**
 * True si l'user peut personnaliser le contenu de ses OG images (rangs
 * affichés, structure/équipe à montrer ou cacher, jeu principal). Aujourd'hui
 * gratuit pour tous → toujours true. Candidate Pro Joueur future.
 *
 * Si l'user ne peut PAS customiser :
 * - les routes OG ignorent `user.ogDisplay` et retombent sur la logique auto
 * - l'UI Settings tab "Affichage public" affiche les inputs grisés avec un
 *   tooltip "Disponible avec Aedral Pro" (UX teasing premium)
 *
 * @param _user user concerné — paramètre conservé pour la future logique
 *   premium ; aujourd'hui non utilisé (préfixe `_` pour ESLint).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function canUserCustomizeOgDisplay(_user: { uid?: string } | null | undefined): boolean {
  // FUTURE_PRO_FEATURE : return _user?.plan === 'pro' || _user?.discoveryCredits > 0
  return true;
}
