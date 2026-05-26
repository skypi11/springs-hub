// Centralisation des limites par plan pour préparer le freemium.
//
// Système actuel : `structures.premium: boolean` (legacy, en place depuis le
// chantier ballchasing replays). On le wrap maintenant en un type `StructurePlan`
// extensible — toute la logique passe par `getStructurePlan(data)` qui normalise.
//
// Cette indirection permet, le jour où on shippe le freemium :
//   - d'ajouter d'autres plans ('team', 'enterprise') sans toucher 50 fichiers
//   - de tweak les quotas par plan dans 1 seul endroit
//   - de retrouver vite toutes les features pro via `// FUTURE_PRO_FEATURE` dans le code
//
// IMPORTANT : ne pas shipper de paywall sans demande explicite de Matt.
// Cf. CLAUDE.md "Pas de monétisation immédiate" — l'objectif An 1 est l'adoption gratuite.

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

// Limites par plan — source de vérité unique pour TOUS les quotas/caps freemium.
// Quand on shippe le pricing, on modifie UNIQUEMENT cet objet.
export const PLAN_LIMITS = {
  free: {
    // Stockage R2 partagé docs + replays
    storageBytes: UPLOAD_LIMITS.STRUCTURE_STORAGE_QUOTA_BYTES,        // 500 MB
    // Parsing ballchasing (replays/semaine via auto-parse)
    weeklyParseQuota: 20,
    // Templates exercices partagés à la structure
    maxSharedTemplates: 50,
    // Équipes max par structure (limite douce, jamais hard cap aujourd'hui)
    maxTeams: Infinity,
    // Branding custom (couleur d'accent, bannière custom au-delà des standards)
    customBranding: false,
    // Boutons Discord interactifs (vote présence, etc.) au-delà des embeds simples
    interactiveDiscordButtons: false,
    // Analytics agrégées (stats RL, performance joueurs cross-events)
    advancedAnalytics: false,
    // Hosting tournois white-label avec branding de la structure
    whiteLabelTournaments: false,
  },
  pro: {
    storageBytes: UPLOAD_LIMITS.STRUCTURE_STORAGE_QUOTA_BYTES_PREMIUM, // 5 GB
    weeklyParseQuota: 100,
    maxSharedTemplates: 500,
    maxTeams: Infinity,
    customBranding: true,
    interactiveDiscordButtons: true,
    advancedAnalytics: true,
    whiteLabelTournaments: true,
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
