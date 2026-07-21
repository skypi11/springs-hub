# Refonte de la console admin compétition — cahier des charges

Déclencheur : Matt a déroulé tout le flux jour-de-match d'une compétition
(`demo-single-elim` : check-in → lancement de phase → imposition de scores →
clôture) le 21/07/2026 et a remonté une série de bugs + un ressenti global
« la console est vraiment bof, pas intuitive, incomplète ».

Objectif énoncé par Matt : **une console COMPLÈTE** — tout doit pouvoir être
vu et vérifié depuis là par les admins, **sans changer de page** — **intuitive
et agréable à utiliser**.

## Retours bruts (source de vérité)

### Bugs de correctness
1. ✅ **FAIT (commit 83e1c23)** — Saisie / imposition de score (modale « Imposer le
   score » / `ForceScoreModal` + `ScoreEntryForm` de la page match, logique mutualisée
   dans `lib/competitions/match-score.ts`, 14 tests) :
   - rangées auto-gérées (4-0 en BO5 impossible à construire, 2-1 ouvre la manche suivante) ;
   - fin de l'échec silencieux (`sent` réinitialisé sur échec côté console).
1bis. **Timer de contre-saisie PAS AFFICHÉ** (retour Matt 21/07, à investiguer) : quand
   UNE équipe a rentré son score, il devrait y avoir un **compte à rebours de 3 min**
   pour que l'autre équipe saisisse aussi — Matt dit qu'il ne s'affiche pas. Voir le bloc
   `counter && otherSubmitted && !alreadySubmitted` dans `ScoreEntryForm`
   (`app/competitions/[id]/match/[matchId]/page.tsx`) + comment `counter`/`otherSubmitted`
   sont calculés côté page. Vérifier aussi que la deadline de contre-saisie est bien posée
   serveur au 1er submit.
2. **Chevauchement visuel** : dans les rangées de phase, le point/pastille de check-in
   se **chevauche avec le code de room**.
3. **Fil du match** :
   - un message envoyé met **~2 s à s'afficher** (pas d'affichage optimiste) ;
   - **pas de différenciation de couleur** entre les pseudos des 2 équipes.

### UX / manques
4. **Pas de bracket dans la console** — Matt veut voir l'arbre du tournoi depuis l'admin.
5. **Codes de room cryptiques** (`AEDRAL-W21-V8F·8Q…`) et on **ne distingue pas
   le code du salon du mot de passe**. → simplifier + séparer/étiqueter clairement.
6. **Impossible de cliquer une équipe** dans la console pour voir sa composition /
   roster / staff.
7. **Compte à rebours du check-in pas assez visible.**

### Détails de mise en page (retours Matt 21/07)
- Dans la modale d'imposition de score, le libellé **« Manche N » doit être CENTRÉ
  entre les deux saisies** (aujourd'hui à gauche) → grille `[1fr_auto_1fr]` :
  `[saisie A] [Manche N] [saisie B]`. Concerne `ForceScoreModal` (console) et,
  par cohérence, `ScoreEntryForm` (page match).

### Clarté (à traiter aussi)
8. Le nombre affiché au classement final (`-0.33`, `+4.5`…) est le **delta de buts
   normalisé par match joué**, pas les points — illisible pour un humain. Sur une
   démo hors circuit il n'y a pas de points de barème (colonne masquée). À rendre
   clair (label, ou repenser l'affichage) + prévoir une démo rattachée à un circuit
   pour montrer les vrais points.

## Vision — « salle de contrôle », tout sur une page

- **Centre** : le **bracket interactif** (brackets-viewer déjà en place). Cliquer un
  match le **sélectionne**.
- **Panneau de droite** : le **détail du match sélectionné**, tout réuni —
  - 2 équipes en tête, **cliquables → compo/roster/staff** (modèle « Le Dossier ») ;
  - check-in par équipe + **compte à rebours gros et lisible** ;
  - **Salon** et **Mot de passe** sur 2 lignes séparées, étiquetées, boutons copier ;
  - saisie/imposition de score **corrigée** ;
  - litige + captures ;
  - fil du match (**pseudos colorés par équipe, message instantané**).
- **Barre du haut** : actions globales (ouvrir check-in, forcer échéances, clôturer)
  + compteurs (phase / à trancher / en jeu / terminés).
- **Zone « À trancher »** conservée en évidence ; un clic ramène au match dans le bracket.

## Phasage proposé

- **Lot 1 — bugs** (correctness) — ✅ **CLÔTURÉ** :
  - ✅ saisie de score (rangées auto + validation BO + fin de l'échec muet) — commit 83e1c23.
  - ✅ **1bis timer de contre-saisie** : le serveur posait déjà `counterDeadline` +
    `score_review` au 1er submit ; le manque était l'AFFICHAGE — la vue de l'équipe
    qui a saisi en premier (`actionKind === 'submitted'`) montre désormais le décompte,
    et la console affiche un décompte VIVANT (`ConsoleCountdown`) sur `checkin`/`score_review`.
  - ✅ **« Manche N » centré** entre les 2 saisies (grilles `[1fr_…_1fr]`) dans
    `ForceScoreModal` (console) ET `ScoreEntryForm` (page match).
  - ✅ **code salon vs mot de passe** : au dépli dossier, 2 lignes labellisées
    « Salon » / « Mot de passe » + bouton copier (texte copié labellisé) ; chip de
    rangée = nom puis mot de passe en muted.
  - ✅ **chevauchement pastille/room** : cellule check-in = 2 pastilles (A/B) +
    `overflow-hidden`, tags retirés de la rangée (détail nommé au dépli).
  - ✅ **compte à rebours du check-in** : page match agrandi (44px + label « Temps
    restant ») ; console = `ConsoleCountdown`.
  - ✅ **fil de match instantané** : optimistic UI par **nonce client** (le serveur
    renvoie le nonce → écho instantané même pour un texte répété, pas de doublon),
    rollback + garde de brouillon ; pseudos différenciés par équipe (crest + couleur
    mine/adverse/admin). Logique pure `lib/competitions/match-thread.ts` (14 tests).
  - ✅ **delta lisible** : labellisé « Diff/match » + `title` explicatif (le nombre est
    une diff. de buts MOYENNE par match) dans `ClosedSummary`, `FinalStandings` (fiche
    publique) et `TiebreakCard`. Reste TODO produit : **une démo rattachée à un circuit**
    (avec `pointsScale`) pour montrer les vrais points de barème.
  - Review adversariale 5 lentilles + contre-vérification (18 agents) : 0 blocker/major,
    6 findings mineurs corrigés (garde brouillon, nonce anti-doublon, mobile
    `ScoreEntryForm` empilé A/B, alignement en-tête `FinalStandings`).

  La console est `app/admin/competitions/[id]/console/page.tsx`, la page match
  `app/competitions/[id]/match/[matchId]/page.tsx`, le helper de score
  `lib/competitions/match-score.ts`, le fil `lib/competitions/match-thread.ts`. Démo
  re-seedée : `demo-single-elim` (`node --env-file=.env.local scripts/seed-demo-single-elim.mjs`).
- **Lot 2 — bracket dans la console + sélection → panneau de détail : ✅ FAIT.**
  Section « Bracket » repliable (composant `TournamentBracket` réutilisé, rendu
  après « À trancher », apparaît dès le bracket publié) ; clic sur un match →
  `ConsoleSelectedMatch` (en-tête faceoff + Lancer/Fermer + dossier `RowDossier`
  réutilisé avec toutes les actions) ; `selectedMatch` relu frais à chaque poll ;
  défilement doux vers le panneau. Serveur : `game` + `sourceA/sourceB` au payload.
  Review adversariale 4 lentilles (11 agents) : 0 blocker/major, 4 correctifs
  cosmétiques (Lancer neutre, badges bracket en bleu dans la console via override
  scopé `.con-anchor`, BO dé-dupliqué, anti-double-dossier bracket↔ligne).
  **Reste pour Lot 4** : rail de droite (le détail est pour l'instant pleine
  largeur sous le bracket) + fusion/allègement des phases (aujourd'hui conservées
  en dessous). NB : le viewer `brackets-viewer` est un SINGLETON → une seule
  instance rendue (la console en rend une, comme la fiche sur sa page).
- **Lot 3 — inspection des équipes depuis la console : ✅ FAIT.** Équipes
  cliquables dans le panneau de détail (les 2 équipes en tête) ET dans la liste
  « Équipes » (validées + liste d'attente) → `TeamDossierModal` (lecture seule,
  via `ModalBackdrop`) : roster (titulaires/remplaçants, capitaine badgé, vérifié,
  lien profil, pseudo Discord, Tracker) + « Staff & direction » (dirigeant,
  co-fondateurs, responsables, managers, coachs). Données via l'endpoint admin
  existant `/registrations` (zéro nouvel endpoint), chargées à la demande + cache
  par équipe (refetch si l'équipe manque → dé-périme aussi le staff LIVE).
  Review 3 lentilles (9 agents) : 0 blocker/major, 2 correctifs (cache per-équipe
  au lieu de « un dossier chargé bloque tout », anti-débordement horizontal du
  pseudo Discord dans la modale).
- **Lot 4 — cohésion control-room** (mise en page finale, agréable) : rail de
  droite pour le panneau de détail + fusion/allègement des phases (aujourd'hui
  bracket + panneau + phases coexistent). Reste aussi une passe extraction (la
  console `page.tsx` fait ~1680 lignes).

Toujours lire `docs/legends-springs-cup-spec.md` + `docs/legends-cup-architecture.md`
avant de toucher au module. La console est `app/admin/competitions/[id]/console/page.tsx`,
les actions POSTent vers `app/api/admin/competitions/[id]/console/route.ts`.
