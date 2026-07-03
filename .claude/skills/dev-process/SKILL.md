---
name: dev-process
description: Cycle de travail complet du projet Aedral — à suivre pour TOUT chantier de code substantiel (nouvelle feature, lot Legends, refonte). Encode la méthode validée sur les Lots 0-2 : contexte → scouting → build → vérification → review adversariale → livraison → sauvegarde. Objectif — la même rigueur quel que soit le modèle qui exécute.
---

# Cycle de développement Aedral

Ce skill encode la méthode de travail éprouvée sur ce repo. Il est écrit pour
être suivi PAS À PAS, sans improvisation sur les étapes — l'ordre et les
vérifications ne sont pas optionnels. En cas de conflit avec CLAUDE.md,
CLAUDE.md gagne.

## 0. Avant tout chantier

- **Relire les sources de vérité du module touché.** Pour le module
  compétitions : `docs/legends-springs-cup-spec.md` ET
  `docs/legends-cup-architecture.md` — TOUJOURS, avant la première ligne.
  Les décisions métier déjà tranchées (spec §11, décisions R5, archi §2-§8)
  ne se re-débattent pas : elles s'implémentent à la lettre.
- **Relire les mémoires du chantier** (`project_legends_lot*`, etc.) : elles
  listent les pièges déjà rencontrés — chaque piège ignoré se repaye.
- Chantier estimé en heures/journées, jamais en semaines.

## 1. Scouting (jamais de build à l'aveugle)

Avant d'écrire : localiser et LIRE les briques existantes à réutiliser
(helpers, patterns de routes, composants voisins). Ce repo a déjà un helper
pour presque tout : notifications (`lib/notifications.ts`), audit admin
(`lib/admin-audit-log.ts`), rate-limit, permissions
(`lib/structure-permissions.ts`), slugs (`lib/user-slug.ts`,
`lib/structure-slug.ts`)… Dupliquer un helper existant = défaut de scouting.

## 2. Build — règles non négociables

- **Logique à risque = lib PURE testée** (pattern `lib/tournament`,
  `lib/competitions/mmr`) : zéro I/O, tests Vitest quasi 1:1. La couche
  route/UI ne fait qu'orchestrer.
- **Server-authoritative** : le serveur recalcule TOUT, jamais de confiance
  au payload client (résolutions, caps, gates).
- **Pièges Firestore documentés** : pas de `.where` en transaction (lookups
  doc à id déterministe), tous les gets avant tous les writes, compteurs
  dénormalisés pour les caps, garde `createdAt` sur les docs réécrits en
  place (anti-TOCTOU).
- **Copy UI** : appliquer le skill `aedral-style`. Des faits, jamais d'avis
  sur l'utilisateur. Sentence case, zéro exclamation, zéro emoji produit.
- **Jamais de solution « à peu près »** : si un raccourci est tentant,
  c'est le signal de s'arrêter et de faire la version premium.

## 3. Vérification locale (dans cet ordre, tout doit être vert)

1. `npx tsc --noEmit` — zéro erreur.
2. `npx eslint .` — zéro erreur ET zéro warning (piège : `next build` ne
   lint pas, la dette s'accumule en silence).
3. `npx vitest run` — toute la suite.
4. **E2e synthétiques** pour tout flux serveur substantiel : script versionné
   dans `scripts/e2e-*.mjs` (modèles : `e2e-legends-lot1-ef.mjs`,
   `e2e-legends-sandbox.mjs`). Conventions dures :
   - données préfixées (`e2e_<chantier>_`), cleanup TOUJOURS exécuté en
     `finally` (la DB est PARTAGÉE avec la prod) ;
   - auth synthétique : custom token Admin SDK → échange REST
     `signInWithCustomToken` avec header `Referer: https://aedral.com/`
     (clé API restreinte par referer) ;
   - redémarrer le dev server avant un run (un serveur de session longue
     rend des 500 fantômes — piège documenté) ;
   - ne JAMAIS lancer un e2e qui seed/cleanup le bac à sable partagé
     (`dev-lgd-*`) pendant que Matt teste.

## 4. Review adversariale (le filet qui attrape ce que tu rates)

Quand : composant critique (moteur, transactions, argent, données de
mineurs), fin de lot, ou > ~500 lignes de logique nouvelle. Pas pour un fix
de copy ou un composant d'affichage trivial.

Comment : `Workflow({ name: 'adversarial-review', args: { context, dimensions, budget } })`
— le workflow versionné dans `.claude/workflows/adversarial-review.js`.
- `context` : fichiers à auditer + docs sources + décisions métier déjà
  tranchées (à ne pas re-débattre).
- `dimensions` : 3 à 5 lentilles SPÉCIALISÉES (ex. transactions/concurrence,
  sécurité/fuites, conformité spec, robustesse, UX/DA). Une lentille = un
  prompt d'expert qui ne rend QUE des défauts concrets avec scénario.
- `budget` : `eco` (chantier moyen), `normal` (fin de lot), `critique`
  (composant qui n'a pas le droit d'être faux — les réfuteurs doivent
  PROUVER les bugs par des tests exécutés).

Traitement des résultats — posture senior obligatoire :
- Un finding « survivant » n'est pas automatiquement vrai : relire, trier,
  regrouper les doublons, hiérarchiser SANS inflation.
- Un finding réfuté n'est pas automatiquement faux : vérifier la réfutation
  sur les blockers.
- Chaque bug corrigé reçoit un TEST DE RÉGRESSION reproduisant le scénario
  exact prouvé.
- Ce qui est reporté (pas corrigé) est NOTÉ en mémoire avec son lot de
  destination — jamais silencieusement abandonné.

## 5. Livraison

- Commits en français, préfixe conventionnel (`feat(legends):`,
  `fix:`, `docs(claude):`), corps qui explique le POURQUOI.
- Push automatique après chaque commit, sans demander.
- Branches courtes `legends/*` pour le module compétitions ; merge sur main
  quand le lot est validé par Matt (le feature gating protège la prod).
- Si la branche de test change : réassigner `preview.aedral.com` (voir
  mémoire `project_preview_domain`) + push pour matérialiser l'alias.

## 6. Sauvegarde d'état (fin de session OU demande explicite)

1. CLAUDE.md : section du chantier à jour (fait / restes / pièges).
2. Mémoire projet (`~/.claude/projects/.../memory/`) : état, décisions,
   pièges nouveaux, restes avec leur destination. MEMORY.md (index) à jour.
3. Si features USER-VISIBLE shippées en prod : template d'annonce Discord
   via `scripts/add-announce-template.mjs`.
4. Commit + push de la doc.

## Calibrage économique (quel modèle / quel effort pour quoi)

La méthode ci-dessus fonctionne avec n'importe quel modèle. Réserver le
modèle le plus puissant / l'effort max aux endroits où le JUGEMENT compte :
- **Effort max justifié** : conception/architecture d'un nouveau lot,
  moteur/transactions critiques, débogage retors, arbitrages de design.
- **Effort high suffit** : build guidé par une spec claire, UI, CRUD,
  intégration de retours de test, e2e.
- **Reviews adversariales** : le PANEL compense le modèle — un panel
  `budget: normal` sur un modèle moyen attrape plus qu'une lecture unique
  d'un grand modèle. Garder `critique` pour les composants de tournoi/argent.
