// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ANALYTICS, Source de vérité unique pour tous les events PostHog.       ║
// ║  Tout passe par track() avec un nom d'event typé pour éviter les fautes  ║
// ║  de frappe et garder une convention cohérente (snake_case + verbe au    ║
// ║  passé : structure_joined, todo_completed, og_share_clicked).            ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// DESIGN INTENT (Matt 2026-05-30) :
//   - Tous les events sont déclarés ici dans `EventName` → on ne peut pas se
//     tromper de nom au call site (typecheck) et on a une liste centrale.
//   - Cookieless par défaut (RGPD France strict). Si on veut un opt-in cookie
//     plus tard pour persister l'identité visiteur cross-device, on bumpe ici.
//   - Pas de tracking côté serveur pour l'instant (l'audit-log Firestore couvre
//     l'audit critique, PostHog c'est de la data produit comportementale).
//
// USAGE :
//   import { track } from '@/lib/analytics';
//   track('structure_joined', { structureId, game });

import posthog from 'posthog-js';

// Liste exhaustive des events trackés. Ajouter ici AVANT le call site.
// Convention : snake_case + verbe au passé (action déjà accomplie au moment
// du track), pas de préfixe redondant ("event_created" ok, "user_event_created" no).
export type EventName =
  // ─── Auth ───────────────────────────────────────────────────────────
  | 'user_signed_up'              // premier login Discord (compte créé)
  | 'user_signed_in'              // chaque login Discord (returning user)
  // ─── Structure (création / appartenance) ────────────────────────────
  | 'structure_requested'         // demande de création envoyée
  | 'structure_created'           // demande validée par admin (côté admin)
  | 'structure_joined'            // accepte invitation ou join_request acceptée
  // ─── Calendar / events ──────────────────────────────────────────────
  | 'event_created'               // staff crée un event (training/scrim/match/...)
  | 'event_presence_updated'      // user répond à sa présence
  // ─── Exercices (todos) ──────────────────────────────────────────────
  | 'todo_created'                // staff assigne un exo
  | 'todo_completed'              // user valide un exo (tous steps done + lock)
  // ─── Recrutement ────────────────────────────────────────────────────
  | 'recruitment_opened'          // user toggle isAvailableForRecruitment ON
  // ─── Partage social ─────────────────────────────────────────────────
  | 'og_share_clicked'            // user clique sur ShareButton / ShareBannerButton
  // ─── Onboarding ─────────────────────────────────────────────────────
  | 'onboarding_completed'        // OnboardingWizard finalisé
  | 'onboarding_reminder_sent'    // DM J+3 envoyé par le cron (serveur)
  // ─── Vérification compte de jeu (funnel anti-friction, palier A 14/06) ─
  | 'account_verify_prompt_shown' // le nudge de vérif s'affiche (≥1 action dispo)
  | 'account_verify_clicked'      // user clique un bouton de vérif (props: game, method)
  | 'account_verified';           // vérification réussie (props: game, method)

// Propriétés communes recommandées par event (non strict, juste pour guider).
// PostHog accepte n'importe quel JSON, le typage ici est documentaire.
export type EventProperties = Record<string, string | number | boolean | null | undefined>;

/**
 * Track un event. No-op silencieusement si PostHog n'est pas init (dev sans
 * clé, SSR, navigateur sans JS). On ne throw JAMAIS, l'analytics ne doit
 * jamais casser le produit.
 */
export function track(name: EventName, properties?: EventProperties): void {
  if (typeof window === 'undefined') return;
  if (!posthog.__loaded) return;
  try {
    posthog.capture(name, properties);
  } catch {
    // silencieux : analytics ne casse jamais le produit
  }
}

/**
 * Identify le user courant après login Discord. À appeler depuis AuthContext
 * sur onAuthStateChanged quand fbUser est truthy.
 *
 * @param uid - uid Firebase (format `discord_SNOWFLAKE`)
 * @param traits - propriétés persistantes attachées au user (displayName,
 *                 isAdmin, games, etc.). Visibles dans PostHog → People.
 */
export function identify(uid: string, traits?: EventProperties): void {
  if (typeof window === 'undefined') return;
  if (!posthog.__loaded) return;
  try {
    posthog.identify(uid, traits);
  } catch {
    // silencieux
  }
}

/**
 * Reset la session PostHog. À appeler au logout pour que les events suivants
 * (visiteur anonyme) ne soient pas attribués à l'ex-user.
 */
export function reset(): void {
  if (typeof window === 'undefined') return;
  if (!posthog.__loaded) return;
  try {
    posthog.reset();
  } catch {
    // silencieux
  }
}

/**
 * Capture un pageview manuellement (utile pour les navigations App Router qui
 * ne déclenchent pas auto). PostHog le fait normalement avec autocapture mais
 * sur App Router c'est moins fiable, on le fait à la main depuis le provider.
 */
export function capturePageview(url?: string): void {
  if (typeof window === 'undefined') return;
  if (!posthog.__loaded) return;
  try {
    posthog.capture('$pageview', url ? { $current_url: url } : undefined);
  } catch {
    // silencieux
  }
}

// ─── Consent management (RGPD, niveau 3 "transparence + opt-out") ──────────
//
// État stocké en localStorage :
//   - 'accepted'  : user a explicitement cliqué OK sur le bandeau
//   - 'opted-out' : user a explicitement désactivé (bandeau ou Settings)
//   - absent      : user n'a pas encore choisi (bandeau visible, tracking actif
//                   par défaut = trust-by-default cohérent avec page privacy
//                   transparente + opt-out facile)
//
// Le PostHogProvider lit cet état au mount et appelle opt_out_capturing()
// si nécessaire AVANT le premier capture. Le bandeau ne s'affiche que si
// l'état est absent (= premier visit, pas encore de choix).

const CONSENT_KEY = 'aedral_analytics_consent';
export type ConsentState = 'accepted' | 'opted-out' | null;

/** Lit le consent depuis localStorage. Retourne null si jamais choisi. */
export function getConsent(): ConsentState {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    if (v === 'accepted' || v === 'opted-out') return v;
    return null;
  } catch {
    return null;
  }
}

/** True si l'user a explicitement désactivé l'analytics (Settings ou bandeau). */
export function hasOptedOut(): boolean {
  return getConsent() === 'opted-out';
}

/**
 * Active l'analytics (consent explicite). Appelé depuis le bandeau "OK" ou
 * Settings toggle ON. Persiste le choix en localStorage, re-active PostHog
 * si désactivé précédemment.
 */
export function optIn(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    if (posthog.__loaded) posthog.opt_in_capturing();
  } catch {
    // silencieux
  }
}

/**
 * Désactive l'analytics. Appelé depuis le bandeau "Désactiver" ou Settings
 * toggle OFF. PostHog ne capture plus rien jusqu'à un optIn() futur.
 */
export function optOut(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CONSENT_KEY, 'opted-out');
    if (posthog.__loaded) posthog.opt_out_capturing();
  } catch {
    // silencieux
  }
}
