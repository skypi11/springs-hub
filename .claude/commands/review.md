---
description: Audit global du projet Aedral (sécurité + UX/DA + features) via 3 agents parallèles, avec rapport markdown sauvegardé dans docs/audits/
---

Lance un audit complet du projet Aedral en **3 agents parallèles** (un seul `Agent` tool call avec 3 invocations) pour ne pas polluer le contexte principal. Chaque agent a un focus spécifique et retourne un rapport markdown structuré.

## Agent 1 — Sécurité & qualité de code

Working dir : `c:/Users/mattm/springs-hub`. Audit sécurité Lots 9.1→9.7 déjà fait en avril 2026 (voir memory `project_security_audit_20260418.md`). Focus sur ce qui a été shippé depuis.

**Chercher (priorisé par sévérité)** :

Sécurité :
- Endpoints API sans `verifyAuth` ou check `isAdmin` quand requis
- Validation input manquante / faible côté serveur
- CSRF/state cookies absents ou mal configurés sur les flows OAuth
- Données sensibles exposées dans les réponses GET publiques (ex: champs privés non filtrés)
- Lectures/écritures Firestore client direct qui devraient passer par API
- Tokens stockés en localStorage / cookies non-httpOnly
- Injections potentielles (HTML inline, dangerouslySetInnerHTML, eval)
- Permissions structures/admins mal vérifiées
- Rate limiting absent sur les endpoints d'écriture
- Writes Firestore depuis des GET publics (cron logic mal placée)

Qualité code :
- Patterns Firestore problématiques : `setInterval` polling, `.where()` dans transactions (interdit), reads inutiles, N+1
- TypeScript `any`/`unknown` non castés
- Functions très longues (>200 lignes) à extraire
- Duplication significative
- Error handling absent ou silencieux sur des operations critiques
- TODO/FIXME/HACK comments en code shippé
- Dead code (imports unused, fichiers orphelins)

**Ignorer** : style, UX/visuel, roadmap, tests unitaires (sauf gros gaps).

**Format de retour** (markdown, ~500-800 mots max) :

```
## Audit sécurité & qualité de code — résumé exécutif
[2-3 phrases]

## 🔴 Critique (à fixer cette semaine)
1. **Titre court** — Description en 1-3 phrases. `file:line` → action suggérée

## 🟠 Important (à fixer ce mois)
[idem]

## 🟡 À surveiller / dette technique
[idem]

## ✅ Points positifs notables
[1-3 trucs qui sont bien faits]
```

Cap 15 findings max, priorisés. Précis sur file:line.

## Agent 2 — UX & cohérence design

Working dir : `c:/Users/mattm/springs-hub`. Contexte DA Aedral : voir `app/design-system.css` et `CLAUDE.md` section Design system.

**Rappels DA** :
- Mono noir/or, biseaux clip-path (pas de coins arrondis), texture hex `.hex-bg`
- Palette : `--s-bg #0a0a0a`, `--s-surface #111`, `--s-violet #7B2FBE` (système/nav UNIQUEMENT), `--s-gold #FFB800` (rare, CTA premium), `--s-blue #0081FF` (RL), `--s-green #00D936` (TM)
- Bordures TOUJOURS neutres `--s-border` (jamais violet)
- Typo : Bebas Neue (display), Outfit (corps), JAMAIS <12px (memory `feedback_lisibilite`)
- Composants centralisés : `.panel`, `.bevel`/`.bevel-sm`, `.pillar-card`, `.comp-card`, `.tag`, `.btn-springs`
- Anti-patterns : violet partout, rounded corners, hex flottants décoratifs, scroll horizontal (memory `feedback_no_horizontal_scroll`)

**Chercher** :
1. Incohérences visuelles entre pages
2. Anti-patterns Aedral (rounded-lg/xl/full, violet sur du contenu, fontSize <12px, scroll horizontal)
3. États vides/loading/erreur soignés ou juste Loader2 brutal ?
4. Accessibilité (aria-label sur icon-only, contrast, focus)
5. Mobile/responsive (débordements, scroll horizontal)
6. Cohérence de copy (tone, capitalization)
7. Hiérarchie info visuelle vs fonctionnelle
8. Saturation d'animations (`animate-fade-in-d*`)

**Ignorer** : logique business, sécurité.

**Format de retour** identique à Agent 1 (sections Critique/Important/Polish/Wins), 15 findings max, ~500-800 mots.

## Agent 3 — Feature completeness & roadmap

Working dir : `c:/Users/mattm/springs-hub`. Référence : `CLAUDE.md` section "Phases de développement" + `.claude/projects/c--Users-mattm-springs-hub/memory/project_ux_roadmap.md` (si existe).

**Chercher** :

1. **Tableau exhaustif des routes** `app/**/page.tsx` + leur statut (✅ complet / 🟡 partiel / 🔴 vide / 💀 mort)
2. **API routes** `app/api/**/route.ts` : vraies données ou mocks/stubs ?
3. **Composants** `components/` : importés nulle part ? Legacy "Springs" non migré ?
4. **Phase 2 bis UX roadmap** : items restants
5. **Phase 3 Compétitions** : code existant / à construire
6. **TODO/FIXME/HACK comments** : inventaire top 15
7. **Fichiers orphelins**

**Format de retour** :

```
## Audit features & roadmap — résumé exécutif
[3-4 phrases]

## 📍 Statut des routes principales
| Route | Statut | Commentaire |

## 📋 Phase 2 bis — items restants
## 🚧 Phase 3 — état actuel
## 💀 Code mort / orphelin
## 📝 TODOs marquants
## ✅ Wins récents notables
```

Cap ~900 mots.

## Après les 3 agents — synthèse + sauvegarde

Une fois les 3 rapports remontés :

1. **Synthétise** dans un rapport global au format suivant :
   - TL;DR (3-4 lignes max)
   - Section 🔴 "À fixer cette semaine" — items Critiques cross-agents
   - Section 🟠 "À fixer ce mois" — items Importants en tableau (numéro, item, localisation, action)
   - Phase 2 bis + Phase 3 statut
   - Code mort
   - ✅ Wins notables
   - 🎯 Reco pour la suite

2. **Sauvegarde le rapport** dans `docs/audits/YYYY-MM-DD-review.md` (date du jour) avec une commande Write. Garde l'historique pour comparer les reviews.

3. **Affiche la synthèse à l'utilisateur** dans le chat.

4. **Demande à l'utilisateur** ce qu'il veut faire des findings : fix les critiques tout de suite, planifier, ignorer, etc.
