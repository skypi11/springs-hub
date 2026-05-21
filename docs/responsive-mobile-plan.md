# Chantier responsive mobile — Aedral

Plan de chantier vivant. Le site a été développé desktop-first et est rendu
responsive progressivement. Mettre à jour ce fichier au fil de l'avancement.

> **Pour reprendre** : lire ce fichier, vérifier l'état git, puis attaquer le
> prochain lot non terminé. Les numéros de ligne sont indicatifs — re-`grep`
> le pattern avant d'éditer.

## Fondation — OK, NE PAS TOUCHER

Le layout est déjà responsive : `components/layout/Sidebar.tsx` (drawer mobile,
hamburger `fixed` < lg, backdrop), `components/layout/LayoutShell.tsx`
(`flex-1 lg:ml-[260px] ... pt-14 lg:pt-0`, `overflow-x-hidden`),
`components/ui/CompactStickyHeader.tsx` (`lg:left-[260px]`). La PWA est en place
(`app/manifest.ts` + icônes). Le travail porte uniquement sur le CONTENU des pages.

## Patterns transverses

- **Padding de page** : `px-8 py-8` → `px-4 sm:px-6 lg:px-8 py-6 lg:py-8`.
- **Grilles figées** : `grid-cols-3` (layout 2/3+1/3) → `grid-cols-1 lg:grid-cols-3`
  + enfant `col-span-2` → `lg:col-span-2`. `grid-cols-2` formulaires →
  `grid-cols-1 sm:grid-cols-2`. 3 cartes égales → `grid-cols-1 sm:grid-cols-3`.
- **Tailles de police absolues** : `fontSize: 'Npx'` desktop → `clamp()` ou classe
  responsive (`text-2xl sm:text-4xl`...).
- **Modales/popovers largeur fixe** : `w-[Npx]` → `w-[calc(100vw-2rem)] sm:w-[Npx]`
  ou `max-w-[calc(100vw-2rem)]`. Bon modèle : drawer `w-full sm:w-[480px]`.
- **Toolbars `flex`** : vérifier `flex-wrap` présent.
- Règle projet : ZÉRO scroll horizontal. `overflow-x-hidden` du shell masque mais
  ne corrige pas — tester chaque page à 375px et 320px.

## Avancement

### ✅ Lot 1 — TERMINÉ (commits jusqu'à `1b1034b`)
- Padding `px-8 py-8` → responsive sur 15 pages.
- Grilles `grid-cols-3` → repliables : `community/structure/[id]`, `general-tab`,
  `teams-tab` (rosters), `profile/[id]`, `create-structure`.
- Grilles `grid-cols-2` formulaires → `grid-cols-1 sm:grid-cols-2` : `settings`,
  `general-tab`, `profile/[id]`, `create-structure`.
- Fix bandeau d'accueil (`ConnectedDashboard`) : boutons qui débordaient → flex-wrap.

### ⬜ Lot 2 — Hero structure publique + sous-nav réglages
- **`app/community/structure/[id]/page.tsx`** — le hero : zone en `aspect-ratio: 6/1`
  → sur mobile ~62px de haut, et l'identité (logo `w-[110px]` + nom `fontSize:46px`
  + CTA) est posée en `absolute inset-0 flex items-end` → déborde. À repenser pour
  mobile : empiler logo / nom / CTA, réduire le `46px` (clamp), et soit augmenter
  la hauteur de la zone hero sur mobile, soit passer l'identité hors de la zone
  bannière sur petit écran.
- **`app/settings/page.tsx`** — `grid grid-cols-[220px_1fr]` (sous-nav latérale
  220px + contenu) : `grid-cols-1 lg:grid-cols-[220px_1fr]` + transformer l'aside
  en barre horizontale scrollable ou accordéon sur mobile.

### ⬜ Lot 3 — my-structure en profondeur + modales
- **`app/community/my-structure/page.tsx`** — header (`p-8`, titre `text-4xl`,
  bloc boutons sans `flex-wrap`) ; vérifier les onglets denses.
- **`tabs/teams-tab.tsx`** — rosters déjà traités (Lot 1) ; vérifier le reste
  (formulaire création équipe, menus kebab `min-w-[220px]`).
- **`tabs/general-tab.tsx`** — emoji picker `width:320px` `absolute` peut déborder.
- Modales/popovers largeur fixe : `MonthView.tsx` `w-[300px]`, `CalendarSection.tsx`
  `w-[280px]`, menus `min-w-[220px]` (`MemberActionsMenu.tsx`, `teams-tab.tsx`).

### ⬜ Lot 4 — Calendrier + admin
- **`components/calendar/`** — vues structurellement larges : `WeekView.tsx`
  `aside w-[230px]`, `MonthView.tsx` `grid-cols-7`, heatmap `TeamAvailabilityView`.
  Envisager une vue mobile dédiée (liste/jour). `CalendarSection.tsx` : nombreux
  `grid-cols-2`.
- **`app/admin/*`** — basse priorité (admins sur desktop). `grid-cols-3` figés.

## Méthode de validation
Après chaque lot : `npx tsc --noEmit` + `npm run build`, commit, push. Tester sur
mobile réel (Matt teste sur son téléphone) — il pointe les écrans cassés, on corrige.
