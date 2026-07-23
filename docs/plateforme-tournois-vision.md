# Plateforme de création de tournois Aedral — vision & carte cible

> **Source de vérité du chantier « usine à tournois ».** Établie le 23/07/2026 à
> partir d'un relevé multi-agents de l'état de l'art (Challonge, start.gg,
> Toornament, Battlefy) + audit du module compétition Aedral existant.
> À lire avant de toucher au moteur de tournoi ou à la page de création.
> Voir aussi mémoires `project_tournament_view_scalable`, `project_freemium_prep`.

## 1. Vision (validée par Matt, 23/07)

Aedral ne construit pas **un** tournoi : Aedral construit **l'usine à tournois
générique** — une plateforme où n'importe quel organisateur (à terme, une
**structure premium**) choisit son format et règle **tous** les paramètres
lui-même, façon **Challonge / start.gg / Toornament**, mais **« en mieux, à la
sauce Aedral »**.

**Le « en mieux » n'est pas du marketing — le relevé le prouve.** Challonge,
start.gg, Toornament et Battlefy sont des **générateurs de bracket secs** : ils
crachent un arbre et laissent l'organisateur se débrouiller avec le reste. Or
**les quatre partagent exactement les mêmes trous** — et ces trous sont
précisément ce qu'Aedral a **déjà** construit (voir §4).

**Cible produit** : la création de tournoi par les structures = future feature
**premium** (cf. `project_freemium_prep`). Donc la page de création ne vise pas
que les admins Aedral — elle sera utilisée par des **dirigeants non-techniciens**
→ UX guidée, garde-fous, gate-friendly. **PAS de paywall maintenant.**

## 2. Carte des formats cibles

Ce que proposent les références du marché, et où en est Aedral :

| Format | Challonge | start.gg | Toornament | Battlefy | **Aedral** |
|---|:-:|:-:|:-:|:-:|:-:|
| Élimination simple | ✅ | ✅ | ✅ | ✅ | ✅ **fait** |
| Élimination double | ✅ | ✅ | ✅ | ✅ | ✅ **fait** |
| **Round robin / poules** | ✅ | ✅ | ✅ | ✅ | ❌ à faire |
| **Suisse (Swiss)** | ✅ | ✅ | ✅ | ✅ | ❌ à faire |
| **Poules → playoff (multi-phases)** | ✅ | ✅ | ✅ | ~ | ❌ à faire |
| **Ligue (flux continu, planning étalé)** | ~ | ~ | ✅ | ~ | ❌ à faire |
| **Free-for-all / Battle Royale (barème placement)** | ✅ | ✅ | ✅ | ~ | ❌ à faire |
| Gauntlet / échelle | ❌ | ~ | ✅ | ❌ | ❌ (niche) |
| Ladder / matchmaking continu | ❌ | ✅ | ❌ | ❌ | ❌ (niche) |
| Course (Single Race / Time Trial / Grand Prix) | ✅ | ❌ | ~ | ❌ | ❌ (TM) |

> **Vérification** : « tournament.com » (cité par Matt) **n'est pas un concurrent
> réel** — domaine parké ; « tournaments.com » = hub d'actu sportive, pas un
> outil de bracket. Les vraies références sont les 4 ci-dessus.

**Insight fort** : le **Free-for-all avec barème par placement**, c'est
**exactement Trackmania** (points F1). Le moteur FFA débloquerait un TM Monthly
Cup **natif** sur Aedral (aujourd'hui encore sur le vieux site).

### Paramètres à couvrir par format (synthèse)

- **Élim simple/double** *(déjà fait — à enrichir)* : seeding, BO par tour,
  petite finale / matchs de classement, byes auto, cap. Manque vs concurrents :
  « skip 1st round » (têtes de série directement au 2ᵉ tour), BO winners/losers
  réglés en 1 geste (start.gg force la double config — pain point à battre),
  tailles > 32.
- **Round robin / poules** : nb de poules, aller simple / aller-retour (×2, ×3),
  barème de points (victoire / nul / défaite + par manche), **tiebreakers
  ordonnés** (victoires → diff manches → diff buts → confrontation directe →
  force du calendrier), BO/match, seeding intra-poule, **top-N qualifiés**.
- **Suisse** : nb de rondes (défaut ⌈log2(N)⌉), appariement sans rematch par
  scores voisins, barème, tiebreakers (Buchholz / force du calendrier), BO/ronde,
  top-N qualifiés.
- **Poules → playoff (multi-phases)** : composer N phases de types différents
  (RR→élim, Suisse→élim…), top-N transférés + **re-seeding** entre phases, barème
  propre à chaque phase. **C'est la colonne vertébrale de start.gg/Toornament.**
- **Free-for-all** : joueurs par match, qualifiés par match, barème par placement
  (+ kills), nb de rounds.
- **Ligue** : divisions, aller-retour, calendrier des journées étalé.

### Paramètres transverses (tous formats)

Seeding (manuel / aléatoire / **par MMR-classement = le « en mieux » Aedral**) ·
check-in · saisie de score · BO réglable par tour/phase · barème + tiebreakers
ordonnés · top-N entre phases · taille · **type de participation** (équipe / 1v1
solo / FFA).

## 3. Ce qui manque à Aedral aujourd'hui (audit du repo)

- **Seulement 2 formats** (élim simple/double). `BracketKind = double_elim | single_elim`.
- **Création 100 % admin-only** (gate `isAdmin`) — aucun self-service structure.
- **Mono-jeu de fait** : le moteur compét est câblé Rocket League (`CompetitionGame = 'rocket_league'`).
- **Seeding uniquement aléatoire** + réordre manuel — pas de seeding par MMR/classement, *alors qu'Aedral a déjà `computeRefMmr` et `standings.ts` sous la main*.
- **Bornes 4→32 équipes** (`MAX_TEAMS = 32`) — pas de gros bracket 64/128.
- **Équipe-only** : roster starters/subs — pas de 1v1 / solo / FFA natif.
- **Form « kind-aware » en dur** (`if kind === …`) — aucune registry de formats.

## 4. Le « en mieux Aedral » — différenciateurs PROUVÉS par le relevé

Les 4 concurrents ont **les mêmes faiblesses**, qu'Aedral comble déjà :

| Faiblesse commune aux concurrents | Ce qu'Aedral a **déjà** |
|---|---|
| Avancement + litiges **manuels et stressants** (email, report, DQ à la main) | **Jour-de-match intégré** : check-in 2 niveaux, rooms auto copiables, saisie par les 2 camps, litige auto + captures (URLs signées), **console live « salle de contrôle »** |
| **Seeding faussé** par rangs périmés / manuels, **zéro anti-smurf** | **Anti-smurf par MMR** (refMmr 70/30, worst-lineup) + **comptes Epic/Steam vérifiés obligatoires** |
| Discord via **bots tiers fragiles** | **Discord natif** : provisioning rôle+salons privés par équipe, **boutons de présence signés** dans Discord |
| **No-show** récurrent, **aucune coordination d'agenda** | **Calendrier + dispos/consensus** : coordination AVANT le match, rappels bot |
| Tournoi **jetable**, repart de zéro à chaque fois | **Structures & rosters persistants vérifiés** (zéro re-saisie, identité de circuit, snapshot roster) |
| **Orga desktop-only**, mobile faible | UI Aedral déjà **responsive / mobile-first** |
| Pubs, caps bas (Toornament 32), PayPal-only, entry fees gated | **Cœur gratuit** volontaire (ne JAMAIS gater check-in / dispo / Discord — anti-pattern TeamSnap documenté) |

**Positionnement** : les autres gèrent l'**arbre**. Aedral gère **l'APRÈS-seeding**
— tout ce qui fait qu'un tournoi se joue vraiment. C'est le pitch massue.

## 5. Plan de construction proposé (à valider)

L'architecture cible = une **registry de formats** (chaque format déclare son
« descripteur de config » : réglages, défauts, validation), sur le modèle béni
de la `games-registry`. La page de création se construit alors **toute seule** à
partir de ces descripteurs → extensible à l'infini, self-service, gate-friendly.

**Ordre proposé :**

1. **Fondation — la registry de formats + généraliser le form** *(design d'abord, ~30 min ensemble)*.
2. **Round robin / poules** — brique des poules ET du two-stage. *(Fable)*
3. **Suisse.** *(Fable)*
4. **Free-for-all / Battle Royale** — débloque Trackmania natif. *(Fable)*
5. **Compositions multi-phases** (poules → playoff) — assemble les briques. *(Fable)*
6. **Seeding par MMR / classement** — le différenciateur.
7. **Refonte de la page de création** — pilotée par la registry, self-service structures, gate premium. *(Opus, UI/DA)*
8. **Élargissements** : bornes > 32, multi-jeux (Game Registry), formats 1v1/solo (TM Monthly Cup natif).

Répartition modèles : **moteurs → Fable 5** (cœur algo), **refonte création → Opus 4.8** (UI/DA/UX).

## 6. Décisions validées (Matt, 23/07)

1. **Priorité v1** : **round robin + poules→playoff d'abord**, **Suisse** ensuite. ✅
2. **Multi-phases GÉNÉRIQUE = objectif confirmé** : pouvoir composer *n'importe
   quelle* combinaison (suisse → bracket, round robin → bracket, etc.). C'est
   l'étape 5 et la raison d'être de la construction en briques composables + du
   concept de « phase » déjà présent (`phasePlan`). À garder en ligne de mire
   **dès le design** des moteurs : chaque moteur doit pouvoir être une phase
   alimentée par le top-N de la précédente, avec re-seeding entre les deux.
3. **1v1 / solo : PAS prioritaire** — on reste **équipe** d'abord (le gros des
   compètes esport). Le 1v1 Rocket League existe mais s'ajoutera facilement plus
   tard (le moteur d'arbre gère déjà 2 « participants » par match, équipe ou solo).
   **Trackmania = chantier À PART** (FFA / course, points F1) — hors périmètre
   immédiat, donc le FFA sort de la priorité v1.
4. **Taille max : viser 128** (64 = minimum acquis d'office). `MAX_TEAMS = 32`
   n'est qu'un **garde-fou** — le moteur (`nextPowerOfTwo` + `seedOrder` récursif,
   generate.ts) marche déjà pour toute puissance de 2. Passer à 64/128 = relever la
   constante + étendre les property tests + **ajouter les libellés de rondes
   au-delà de « Seizièmes »** (`TournamentBracket.tsx` s'arrête à roundCount-4 →
   manque « Trente-deuxièmes »… ; cosmétique). **256 possible** mais nécessite une
   passe d'**affichage** (bracket de 256 = visuellement énorme) + un œil sur le coût
   Firestore (~255 matchs simple élim / ~510 double). Pas un gros chantier.
5. **Démarrage** : cadrer la **registry de formats** ensemble (Opus), puis
   **round robin** sur Fable.
