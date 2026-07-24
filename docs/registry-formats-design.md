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

## 9. RUNTIME MULTI-ÉTAPES — design d'implémentation (cadré 25/07, session Fable 5)

Concrétisation de la décision A (§2) : poules→playoff, suisse→bracket, etc.
Contrat suivi par le build — les invariants ci-dessous ne se re-débattent pas.

### 9a. Modèle de données (rétrocompat totale)

- `Competition.stages?: TournamentStage[]` — présent = tournoi multi-étapes.
  Absent = mono-étape (TOUT l'existant). Helper unique `stagesOf(comp)` :
  absent → `[{ kind: kindOf(format), format }]`.
- **INVARIANT : `stages[0].format === comp.format`** (l'étape 1 EST le format
  top-level). Conséquence : tout le code existant qui lit `comp.format` pour
  l'étape 1 (bornes publish, faisabilité, BO, seeding) reste juste sans
  branche. Les étapes suivantes se lisent par `formatOfStage(comp, n)`.
- `Competition.currentStage?: number` (1-based, absent = 1) — l'étape ACTIVE.
  Posé à 1 au publish, incrémenté par `advance_stage`. Une seule étape est
  jouable à la fois.
- `Competition.stageResults?: StageResult[]` — FIGÉ à chaque passage d'étape :
  `{ stage, placements (compressés, complets), advanced (ordre de seed de
  l'étape suivante), tiebreakResolutions (archivées), closedAt }`. Public-safe
  (registrationId uniquement). Sert : classement final concaténé sans
  recomputation, affichage des résultats d'étape, idempotence.
- `CompetitionMatch.stage?: number` (1-based, absent = 1 — tous les docs
  existants).

### 9b. Ids de match — préfixe d'étape au niveau du PONT

- Étape 1 : ids moteur NUS (`W1-1`, `R2-3`…) — zéro changement pour l'existant.
- Étape N ≥ 2 : `E{N}_{engineId}` (ex. `E2_W1-1`). Le préfixe est appliqué par
  `bracket-store` à la sérialisation (ids ET refs `winner_of`/`loser_of` — les
  docs publics restent auto-cohérents) et retiré à la reconstruction. **Les
  moteurs purs ignorent les étapes.** Aucune collision possible entre étapes,
  même de même kind (RR→RR).
- Toute reconstruction se fait PAR ÉTAPE : filtrer les docs sur
  `doc.stage ?? 1` AVANT `reconstructBracket` — un bracket pur = une étape.

### 9c. Runtime

- Statut compétition inchangé : `live` couvre toutes les étapes.
- `tiebreakResolutions` reste PLAT et s'applique à l'étape COURANTE ; archivé
  dans `stageResults` au passage, puis remis à `{}`. Zéro changement du
  mécanisme resolve_tiebreak.
- **Action console `advance_stage`** (pattern transactionnel identique à
  `generate_next_round`) : gates (live + étape courante finie via
  `engineFor(kind étape)` + AUCUNE égalité irrésolue — le seed et le
  classement doivent raconter la même histoire), placements figés, top
  `transfer.advanceCount` re-seedé (`standings` = ordre du classement — défaut ;
  `random`), génération `engineFor(next.kind).generate(...)`, matérialisation
  préfixée en transaction (re-check status/currentStage/withdrawn frais, docs
  neufs non avancés), `currentStage++`, phasePlan étendu (entries par défaut de
  l'étape suivante, phases offsettées), notifs qualifiés/éliminés best-effort.
- `generate_next_round` (suisse) opère sur l'étape COURANTE (un suisse peut
  être une étape).
- Retrait (`withdraw_team`) : cascade moteur sur l'étape courante si l'équipe
  y siège ; une équipe déjà éliminée à une étape antérieure = statut
  d'inscription + `withdrawn` seulement (son placement d'étape est déjà figé).
- **Clôture** : exige `currentStage` = dernière étape + finie + résolue.
  Placements finaux = placements de l'étape finale (1..K) ++ éliminés des
  étapes antérieures à LEUR placement d'étape (alignés par construction : les
  éliminés de l'étape m sont classés advanceCount+1..M). `goalDiff`/`goalsFor`
  des FinalPlacement = CUMUL de toutes les étapes jouées par l'équipe.
- `SeedingStrategy` += `'standings'` (défaut des transferts). `mmr`/`circuit`
  = chantier seeding (suivant) ; `manual` au transfert = non supporté v1
  (refusé à la validation, jamais ignoré en silence).

### 9d. Validation & création

- Payload compétition : champ `stages[]` OPTIONNEL — chaque étape validée par
  le validateur de son kind, transferts : `advanceCount` ≥ 2, dans les bornes
  du format SUIVANT (min/max moteur), dernière étape sans transfert, étapes
  intermédiaires avec transfert obligatoire, 2-4 étapes (1 = ne pas envoyer le
  champ). Cohérence `stages[0].format` ↔ `format` imposée serveur.
- Le phasePlan de CRÉATION ne couvre que l'étape 1 (validé contre elle) ; les
  entries des étapes suivantes naissent à l'`advance_stage`
  (`buildDefaultPhasePlan` du format, offsettées). L'UI de création n'expose
  pas encore les stages (refonte Opus) — création via API/scripts en attendant.

### 9e. Vue publique

- `/api/competitions/[id]/matches` expose `stage` ; `/standings` sert le
  classement PAR ÉTAPE. La fiche affiche UN ONGLET PAR ÉTAPE (« Poules » /
  « Phase finale ») — une seule instance du viewer montée à la fois (piège
  singleton brackets-viewer respecté). Résultats d'étape close = stageResults.

## 10. SEEDING MMR / CIRCUIT — design d'implémentation (cadré 24/07, session Fable 5)

Concrétisation de l'axe B (§4) : le seeding devient une stratégie de première
classe — le différenciateur prouvé face aux 4 concurrents (seeding manuel /
rangs périmés / zéro anti-smurf).

### 10a. Valeur de seed d'une équipe

- **MMR** : `registration.computed.worstLineupAvg` — déjà calculé SERVEUR à la
  soumission (moyenne de la compo alignable la PLUS FORTE, spec §3) : c'est la
  force attendue en tournoi, cohérente avec l'anti-smurf. Fallback si absent :
  moyenne des `roster[].refMmr` ; sinon 0 (fin de liste). Départages : moyenne
  du roster complet, puis nom (stable, auditable).
- **Circuit** : rang au classement du circuit de la compétition
  (`computeCircuitStandings`, participations réelles, tiebreakers §11).
  Inscriptions sans identité circuit ou jamais classées : APRÈS les classées,
  ordonnées par valeur MMR puis nom. Compétition hors circuit : stratégie
  REFUSÉE (jamais de fallback silencieux).
- **Seed 1 = la plus forte** — `seedOrder` du moteur étale les têtes de série
  (1 vs dernier, 2 vs avant-dernier…).

### 10b. Points d'application

- **Seeding initial** (statut `seeding`) : action route bracket
  `seed_by { strategy: 'random' | 'mmr' | 'circuit' }` — réordonne
  `comp.seeding`, l'admin garde le réordonnancement manuel par-dessus, la
  stratégie est journalisée dans l'audit log.
- **Transferts multi-étapes** : `StageTransfer.reseed` accepte désormais
  `'mmr'` et `'circuit'` — `advance_stage` fournit un `seedRank`
  (Map registrationId → rang) à `computeStageAdvance`, qui ordonne les
  qualifiées par ce rang. `'standings'` reste le défaut. Un reseed `circuit`
  sur une compétition devenue hors circuit = 409 actionnable.
- La lib pure vit dans `lib/competitions/seeding.ts` (zéro I/O, testée).

### 10c. UI console — panneau Seeding (NOUVEAU)

Constat du scouting : AUCUNE UI de seeding n'existait (open_seeding/shuffle/
reorder/publish pilotés par scripts uniquement — un admin ne pouvait pas
publier un bracket sans dev). La console gagne un panneau « Seeding » quand
`status === 'seeding'` : liste ordonnée (crest, nom, valeur MMR / points
circuit), boutons de stratégie (Aléatoire / Par MMR / Par classement du
circuit si `circuitId`), réordonnancement manuel ↑/↓, CTA « Publier le
bracket » (bornes + faisabilité servies par le GET bracket existant). DA
sobre niveau 2 — le polish visuel appartient à la passe Opus.

## 8. Moteur SUISSE — décisions de design (cadré 23/07, session Fable 5)

Le Suisse est un TROISIÈME modèle, distinct de l'arbre et du round robin :
les appariements de la ronde N+1 dépendent des RÉSULTATS des rondes 1..N
(scores voisins, jamais de re-match). Conséquences structurelles :

- **Génération INCRÉMENTALE des rondes** : `generateSwiss` ne produit que la
  ronde 1 (appariement « slide » par seed : 1 vs n/2+1, 2 vs n/2+2…) ;
  `generateSwissNextRound(bracket)` calcule et AJOUTE la ronde suivante quand
  la précédente est terminale. La matérialisation Firestore suit : le publish
  n'écrit que la ronde 1, une action console `generate_next_round` écrit les
  docs de chaque ronde suivante (start.gg/Battlefy fonctionnent ainsi — on ne
  peut pas apparier des résultats qui n'existent pas).
- **Appariement Monrad avec backtracking** : ordre du classement courant
  (points puis départages), chaque équipe appariée à la plus proche non déjà
  rencontrée ; si le glouton se coince (que des re-matchs), retour arrière —
  un appariement valide est TOUJOURS trouvé s'il en existe un. La variante
  « fold par groupe de score » pourra devenir un réglage plus tard.
- **Bye (effectif impair)** : l'équipe la moins bien classée SANS bye
  antérieur reçoit un match de bye (teamA posée, côté B void → walkover, même
  modèle que les byes d'arbre). Au classement suisse, une victoire par
  walkover VAUT les points d'une victoire (sans stats de manches/buts) —
  sémantique DIFFÉRENTE du round robin (siège vidé = match exclu), documentée
  dans swiss-standings.
- **Nombre de rondes** : `format.swissRounds`, défaut ⌈log2(maxTeams)⌉,
  bornes 1-12. Porté par `Bracket.swissRounds` (posé à la génération ET à la
  reconstruction depuis le format — sans lui, un bracket suisse n'est JAMAIS
  « fini », fail-safe bruyant plutôt que clôture prématurée).
- **Départages** : points → Buchholz (somme des points des adversaires
  rencontrés) → face-à-face s'il a eu lieu → diff de manches → diff de buts →
  buts marqués → arbitrage admin. Classement GLOBAL (pas de poules) ;
  placements par blocs contigus comme le RR (groupes `rank{K}`).
- **Ids** : `S{ronde}-{slot}` (slot global par ronde). `BracketSide` et
  `BracketKind` += `'swiss'`. Sources : ronde 1 = `seed`/`seed` ; rondes
  suivantes = `seed`/`seed` AUSSI (les équipes sont connues au moment de la
  génération de la ronde — la reconstruction des `teams[]` lit la ronde 1 où
  tout le monde apparaît, bye compris).
