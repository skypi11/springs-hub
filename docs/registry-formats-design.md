# Registry de formats de tournoi — design & spec d'implémentation

> Contrat de design validé avec Matt le 23/07/2026, à suivre pour l'implémentation.
> Contexte produit : [docs/plateforme-tournois-vision.md](plateforme-tournois-vision.md).
> Faits techniques d'intégration (contrat moteur, ce qui casse pour un round
> robin, points de branchement) : voir le cadrage multi-agents résumé plus bas (§7).
> **Lire aussi `docs/legends-cup-architecture.md` avant de toucher au module.**

## 1. Objectif

Transformer le module compét (aujourd'hui 2 formats en dur : `double_elim`,
`single_elim`) en une **plateforme générique de création de tournois** pilotée par
une **registry de formats** : chaque format déclare tout ce qui le concerne, et la
page de création + la validation + la génération se construisent à partir de ces
déclarations. Ajouter un format = ajouter une fiche.

Modèle béni à répliquer : `lib/games-registry.ts` (une fiche par jeu).

## 2. Décision A — un tournoi = une SÉQUENCE de phases (validé Matt)

On ne modélise PAS « 1 tournoi = 1 format ». On modélise **un tournoi = une liste
ordonnée de phases** :

- Une élim simple = **1 phase**. Un poules→playoff = **2 phases** (round robin
  puis élim). Un suisse→bracket = 2 phases. Extensible à N phases.
- Chaque phase porte : son **format** (`kind`), sa **config** (les réglages du
  format), et une **règle de transfert** vers la phase suivante (top-N qualifiés +
  stratégie de re-seeding). La dernière phase n'a pas de transfert.
- **Rétrocompat obligatoire** : une compétition existante (`double_elim` /
  `single_elim`) = un tournoi à **une seule phase** de ce format. Le `CompetitionFormat`
  actuel et les préréglages Legends doivent continuer à fonctionner (migration
  douce, valeurs par défaut à la lecture — jamais de big bang).

Le multi-phases devient ainsi le modèle de base, pas un cas spécial bricolé.
⚠️ Ne pas confondre avec le `phasePlan`/`PhasePlanEntry` existant (= découpage
TEMPOREL des rondes d'UN bracket sur des jours). Ici « phase » = **étape de format**
(poules PUIS bracket). Les deux coexistent : une étape de format contient son propre
découpage temporel interne.

## 3. La fiche d'un format (`FormatDef`) — data vs comportement SÉPARÉS

Point technique (axe D) : la fiche a deux parties, à ne pas mélanger pour ne pas
embarquer le moteur serveur dans le bundle client.

### 3a. Partie DÉCLARATIVE (data pure, partagée client + serveur)
- `id` (kind stable, ex `'round_robin'`), `label`, `description`, `icon`/`color`.
- `configFields[]` : les réglages exposés à l'organisateur. Chaque champ =
  `{ key, label, type ('number'|'boolean'|'select'|'list'), default, min/max/options,
  help, level: 'essential' | 'advanced' }` — **le `level` = axe C.1** (la page montre
  les essentiels, replie les avancés).
- `presets[]` : configs 1-clic (ex « Ligue simple », « Poules de 4 ») — **ADN Aedral**.
- `capabilities` : `{ producesRanking | producesWinner, canBeGroupStage,
  canBeFinalStage, supportsPools, supportsMmrSeeding }` — **c'est ce qui pilote le
  multi-phases générique** (une phase de groupes = un format `canBeGroupStage` ; une
  phase finale = un format `canBeFinalStage` ; la page compose « [groupe] → top-N →
  [final] » sans code par combinaison).
- `summarize(config, teamCount)` → texte d'aperçu (**axe C.2** : « 16 équipes en
  4 poules → 24 matchs, ~3 h »). Doit être pur et léger (tourne côté client).

### 3b. Partie COMPORTEMENT (serveur uniquement)
- `generate(teamIds, config)` → `Bracket` (RÉUTILISER le type `Bracket` existant, cf. §7).
- `validate(config, ctx)` → erreurs — **deux niveaux (axe C.3)** :
  1. par-champ (bornes, types) ;
  2. **croisée** : entre réglages (nb poules × taille) ET **entre phases**
     (le top-N d'une phase doit être accueillable par le format suivant — ex : un
     bracket d'après exige un nombre de qualifiés compatible). Bloque à la SAISIE,
     jamais un plantage après coup (contre le pain point Battlefy).
- `computeStandings/Placements(bracket, ...)` → classement / placements 1→N.
- `buildPhasePlan(config)` → découpage temporel interne (rondes/journées).

Registry = `FORMATS_REGISTRY: Record<FormatKind, FormatDef>`. La partie déclarative
peut vivre côté partagé ; le comportement est importé serveur-only.

## 4. Le seeding = brique transverse de première classe (axe B)

Le seeding n'est PAS un détail par-format : c'est LE différenciateur Aedral (les 4
concurrents seedent à la main / avec des rangs périmés — cf. relevé). Modéliser une
`SeedingStrategy` transverse réutilisable : `'manual' | 'random' | 'mmr' | 'circuit'`
(par MMR de référence `computeRefMmr`, ou par classement circuit `standings.ts`).
Appliquée à l'entrée d'une phase (seeding initial) ET au transfert entre phases
(re-seeding des qualifiés). Un format déclare juste s'il la supporte
(`capabilities.supportsMmrSeeding`).

## 5. Rétrocompat & migration douce

- La registry INCLUT `double_elim` et `single_elim` (on migre l'existant DEDANS,
  sans changer leur comportement — mêmes moteurs `generateDoubleElim/SingleElim`,
  mêmes préréglages Legends).
- Une compétition déjà en base = un tournoi 1 phase. Les champs `CompetitionFormat`
  actuels restent lus ; les nouveaux champs (séquence de phases) ont des défauts à
  la lecture (`bracketReset` absent → false, etc. — pattern déjà en place).
- Aucune donnée existante ne doit casser. Vérifier via les compétitions `draft`/`isDev`.

## 6. Plan d'implémentation (ordre pour Fable)

1. **Types + rétrocompat** : `FormatDef`, `PhaseConfig` (format + config + transfert),
   `SeedingStrategy`. Faire cohabiter avec `CompetitionFormat`/`phasePlan` existants.
2. **Registry socle** : `FORMATS_REGISTRY` avec `double_elim` + `single_elim` migrés
   dedans (comportement inchangé, prouvé par les tests existants qui doivent rester verts).
3. **Format `round_robin`** (le premier nouveau) : moteur `generateRoundRobin` (méthode
   du cercle, poules multiples, aller simple/retour) + `round-robin-standings.ts`
   (points V/N/D + départages dont confrontation directe) + configFields + presets
   (« Ligue simple », « Poules de N ») + capabilities (`producesRanking`,
   `canBeGroupStage`).
4. **Property tests** round robin sur le moule de `tournament.test.ts` (toutes tailles,
   nb d'appariements = C(n,2) ×legs, chaque paire une fois, pas 2× la même équipe/journée).
5. Multi-phases (transfert top-N + re-seeding) et les autres formats (suisse, etc.)
   viennent APRÈS, sur la même fondation.

## 7. Faits techniques d'intégration (issus du cadrage multi-agents — à respecter)

- **Réutiliser le type `Bracket`** (`lib/tournament/types.ts`) : double ET simple élim
  le retournent déjà → tout l'aval (jour-de-match, matérialisation Firestore, console,
  ACL, viewer) est format-agnostique. Un match de poule = un `PureMatch` (2 équipes
  fixes, sources `'seed'`/`'none'`, jamais `winner_of`/`loser_of`). Étendre :
  `BracketKind += 'round_robin'`, `BracketSide += 'round_robin'`, `PureMatch += group?`,
  `Bracket += groups?/matchdays?`.
- `advanceMatch` / `withdrawTeam` / `replaceTeam` **réutilisables** (propagate = no-op
  en RR faute de consumers) — vérifier par test que propagate ne fait rien.
- **Classement dans un module DÉDIÉ** (`round-robin-standings.ts`), PAS dans
  `placements.ts` (dont `championOf`/`eliminationGroups` sont intrinsèquement élim).
  Réutiliser `computeTeamStats` + `headToHead` (à exporter). Fin de poule = `isConcluded`
  (tous matchs terminaux), PAS `isFinished` (championOf).
- **Router sur `kind` à 3 points SEULEMENT** : `close-competition` (prédicat de fin +
  calcul placements), `bracket-store.reconstructBracket` (dérivation taille/poules/
  journées), `brackets-viewer-adapter` (stage type). Le reste de l'aval est déjà agnostique.
- **Vue** : le viewer `brackets-viewer` rend le round robin nativement (stage type
  `round_robin`, `group_id`=poule, `round_id`=journée), MAIS son classement natif a un
  tri figé → **désactiver `showRankingTable`** et afficher NOTRE table de classement
  (thémée Aedral, `.round-robin` de design-system.css à sortir du gris #a7a7a7). Le
  viewer sert juste à la grille des matchs.
- BO : `boForRound` (distance à la fin d'un arbre) n'a pas de sens en RR → `bo.default`
  pour tous les matchs de poule.
