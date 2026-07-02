# Moteur de compétitions Aedral — Plan d'architecture (v2)

> **Statut : DRAFT v2 — à valider par Matt avant la première ligne de code.**
> v1 le 02/07/2026 ; **v2 le même jour après review adversariale multi-agents** (4 lentilles : data model Firestore, sécurité/RGPD, moteur de bracket, delivery/ops — 32 findings dont 5 bloquants, tous intégrés ci-dessous).
> Spec fonctionnelle de référence : [legends-springs-cup-spec.md](legends-springs-cup-spec.md) (complète, validée).
> Objectif : un **moteur générique** dont la Legends Springs Cup est la première instance — réutilisable pour tout format futur et, à terme, pour les tournois premium créés par les structures.

---

## 1. Principes d'architecture

1. **Générique d'abord** : aucune logique « Legends Cup » en dur. Tout est de la **configuration** portée par les documents (`format`, `eligibility`, `registration`, `schedule`…). La Legends Cup = 1 circuit + 4 compétitions + 1 LAN, créés depuis le panel admin.
2. **Server-authoritative** : toutes les écritures passent par des API routes (Admin SDK). Aucune écriture client directe sur les collections compétition. Rate limiting Upstash existant appliqué.
3. **Temps réel là où ça compte** : `onSnapshot` sur le bracket et les matchs pendant l'événement. Les pages froides lisent via API.
4. **Le cœur critique est une lib pure testée** : génération/progression de bracket = code pur sans I/O (`lib/tournament/`), property tests Vitest exhaustifs. Ce composant n'a pas le droit d'être faux un jour de tournoi.
5. **Admin-in-the-loop** : rien d'irréversible n'est automatique (forfaits, litiges, dérogations, tiebreaks). Les timers sont des deadlines stockées ; l'expiration est appliquée **en transaction** au premier événement suivant (voir §5).
6. **Réutiliser l'existant** : équipes/structures, comptes vérifiés + tracker, bot Discord, notifications, audit log, R2, OG, PostHog, permissions.
7. **⚠️ Réconcilier l'existant (review)** : `competitions` et `competition_registrations` **existent déjà** dans `firestore.rules` avec des règles permissives (lecture publique / lecture authentifiée) et un consommateur en prod (`app/api/profile/history/route.ts` query `where('userId','==',uid)`). Le Lot 0 inclut obligatoirement : bascule des rules en deny-all **dans le même commit** que le premier write du nouveau schéma, audit/purge des éventuels docs legacy en prod, adaptation de `profile/history` au nouveau schéma (via `rosterUids`).

## 2. Modèle de données

Toutes les collections en `allow write: if false` (écritures Admin SDK uniquement). Lecture précisée par collection.

### `circuits`
```js
{
  name, game, competitionIds: [...],
  pointsScale: { "1": 40, ... "32": 3 },      // lu sur la PLACE COMPRESSÉE (voir §3)
  bestResultsCount: 3, lanTeamCount: 16,
  tieBreakers: ["best_placement", "goal_diff_total", "latest_event"],
  status, createdAt, createdBy
}
```
Lecture : publique.

### `competitions`
```js
{
  name, game, circuitId | null,
  format: {
    kind: "double_elim", maxTeams: 32,
    // (review) le BO est exprimé EN RELATIF à la fin de chaque bracket — les numéros
    // absolus de rounds changent avec N : { winners: 2 dernières rondes BO7, ... }
    bo: { default: 5, overrides: [{ bracket, roundsFromEnd, bo }] },   // + grandFinal: 7
    bracketReset: true,
    forfeitScore: { games: 3, goalsPerGame: 1 },   // BO7 : dérivé (4 manches)
  },
  eligibility: { requireVerifiedAccounts, minAge, mmr: {...} },        // inchangé (spec §3)
  roster: { starters: 3, subsMax: 2 },
  registration: { opensAt, closesAt, waitlist: true },
  schedule: { days: [...], phasePlan: [...], matchCheckinMinutes: 5, scoreCounterMinutes: 3 },
  discord: { guildId, participantRoleId, categoryId },
  status: "draft" | "registration" | "validation" | "seeding" | "live" | "finished" | "archived",
  createdAt, createdBy
}
```
Lecture : publique. **(review)** La règle permissive existante est remplacée ; les docs legacy éventuels sont audités/purgés au Lot 0.

### `competition_registrations` — snapshot d'inscription
```js
{
  competitionId, circuitTeamId, structureId, teamId,
  name, tag, logoUrl, captainUid,
  rosterUids: [...],                          // (review) dénormalisé pour les queries
                                              //   "inscriptions d'un joueur" (profile/history)
  roster: [{ uid, role, displayName, declaredCurrentMmr, declaredPeakMmr, refMmr,
             epicId/steamId, trackerUrl, discordId, country, age, verified }],
  computed: { worstLineupAvg, worstLineupGap, flags: [...] },
  status: "pending" | "approved" | "rejected" | "waitlisted" | "withdrawn",
  review: { by, at, reason, derogations: [{uid, note}] },
  generalCheckin: { done, byUid, at } | null, // (review) check-in général 14h30 — manquait
  discord: {
    provisioningStatus: "none" | "queued" | "partial" | "done" | "error",  // (review) découplé
    roleId, textChannelId, voiceChannelId,    // remplis AU FIL de la création (reprise idempotente)
  },
  seed: number | null,
  createdBy, createdAt
}
```
Lecture : **rules deny-all** (MMR, âges, Discord IDs, notes de dérogation sur mineurs). Liste publique « équipes inscrites » via API (nom/tag/logo/pseudos). **(review — bloquant)** : la règle existante `allow read: if request.auth != null` est basculée en deny **dans le même commit** que le premier write.

### `competition_matches`
```js
{
  competitionId, bracket, round, slot, phase, bo,
  teamA / teamB: registrationId | null,
  sourceA / sourceB: { type: "winner_of" | "loser_of" | "seed" | "bye", ref },
  status: "pending" → "checkin" → "ready" → "live" → "awaiting_scores"
        → "score_review" | "disputed" | "awaiting_forfeit_validation"
        → "completed" | "walkover" | "cancelled",       // (review) 2 états terminaux ajoutés
  checkin: { openedAt, deadline, a: {done, at}, b: {done, at} },   // byUid déplacé en privé
  roomHost: "a" | "b",
  scores: { a: [...], b: [...], aSubmittedAt, bSubmittedAt, counterDeadline,
            final: [...], validatedBy },
  // (review) délta ET buts marqués/encaissés — la spec exige "buts marqués" comme
  // 2e clé de départage, le délta seul ne suffit pas (3-2×3 et 1-0×3 = même délta) :
  stats: { a: { goalsFor, goalsAgainst }, b: { goalsFor, goalsAgainst } },
  forfeit: { team: "a" | "b" | "both", requestedAt, validatedBy, reason } | null,
  dispute: { openedBy, openedAt, auto, resolvedBy, resolution } | null,
  // (review) PAS d'URLs de screenshots ici : keys R2 dans la sous-collection privée
  cast: { featured, streamUrl } | null,
  winner: "a" | "b" | null,
  updatedAt
}
```
Lecture : **publique** (bracket live en onSnapshot). **(review)** : AUCUN uid/snowflake dans ce doc — `participantUids` et `checkin.byUid` sont déplacés dans la sous-collection ACL (le chantier profile-slugs a précisément retiré les snowflakes du public).

Sous-collections (toutes **deny-all**, servies par API) :
- **`/private/room`** → `{ name, password }` — servie aux 2 équipes + admins compét.
- **`/private/acl`** → `{ participantUids: [...], staffUids: [...] }` — rempli par l'orchestration à **chaque** matérialisation de teamA/teamB (la propagation crée les matchs avec des équipes TBD — review) ; les rules du thread font `get()` sur CE doc.
- **`/private/dispute`** → `{ screenshotKeys: {a: [...], b: [...]} }` — **keys R2, pas d'URLs** ; servies via endpoint signé (pattern replays, `getDownloadSignedUrl`) après contrôle « membre du match ou admin compét ».
- **`/messages/{id}`** → thread : lecture client via rules `uid in get(acl).participantUids || isCompetitionAdmin() || isAedralAdmin()` (review : sans `isAedralAdmin`, Matt serait bloqué) ; écriture via API rate-limitée.

### `circuit_teams`
```js
{
  circuitId, name, tag,
  participations: [{ competitionId, registrationId, rosterUids,
                     placement, points, goalDiff, goalsFor }],   // (review) goalsFor pour tiebreak circuit
}
```
Lecture : publique **mais** `rosterUids` retiré du doc public (snowflakes) → stocké dans une sous-collection privée, le classement public n'a besoin que de nom/points/placements.

**(review) Résolution d'identité — contraintes dures** :
- **Max 1 participation par compétition par circuit_team** (vérifié en transaction à l'approbation).
- Ambiguïté = **jamais de rattachement silencieux** : 2 inscriptions qui matchent le même historique (split d'équipe), ou 1 inscription qui matche 2 circuit_teams → flag **`identity_conflict`** dans la file de validation, arbitrage admin explicite (qui hérite des points, l'autre repart à 0), journalisé.
- Nom du snapshot ≠ nom du circuit_team → flag **`name_mismatch`** (changement de nom = accord admin, cf. spec).

### `competition_bans`, `competition_admins`
Inchangés (v1). CRUD bans + admins réservé : bans → admins compét ; nomination d'admins compét → admins Aedral complets uniquement (pas d'auto-promotion). Rappel : **un admin Aedral complet est automatiquement admin compétition** (Matt a accès à tout, partout).

### `rulebooks` — règlement de compétition (ajout Matt 02/07)
```js
{
  scope: { circuitId } | { competitionId },   // un règlement pour tout le circuit OU par tournoi
  markdown, version: number,                  // édité via MarkdownEditor (composant existant)
  updatedAt, updatedBy,
}
```
- Sous-collection **`/versions/{n}`** : chaque modification archive la version précédente — **traçabilité légale** : on doit pouvoir prouver QUELLE version du règlement une équipe a acceptée.
- Lecture : **publique** (page `/competitions/…/reglement`). Écriture : admins compét (via API).
- **Acceptation obligatoire à l'inscription** : le wizard bloque la soumission sans la case « J'ai lu et j'accepte le règlement » ; la registration enregistre `rulebookAccepted: { version, at, byUid }`.
- Si le règlement change APRÈS des inscriptions validées : les équipes concernées sont notifiées (in-app + Discord) — pas de re-acceptation forcée, mais la version acceptée reste tracée.

### Date de naissance — **DÉCISION FIGÉE (review, bloquant)**
`firestore.rules` actuel : `users/{uid}` est **lisible par tout utilisateur connecté** → interdiction d'y mettre `birthDate` (fuite RGPD certaine, données de mineurs). Donc :
- `birthDate` stocké dans **`user_secrets/{uid}`** (collection deny-all existante, déjà server-only).
- Le doc `users` ne porte RIEN de nouveau ; l'âge est calculé côté serveur et dénormalisé dans le snapshot d'inscription ; le profil public affiche l'âge via l'API existante.

## 3. Le moteur de bracket — `lib/tournament/` (pur, testé)

- `generateDoubleElim(teams, options)` : 4→32 équipes avec byes, câblage complet, **match de reset PRÉ-CRÉÉ** (visible « si nécessaire » sur le bracket public — standard esport), phases assignées via `phasePlan`, BO résolu par `roundsFromEnd`.
- `advanceMatch(bracket, matchId, outcome)` avec **(review)** `outcome = { winner } | { doubleForfeit } | { walkover }` :
  - **Double forfait** (règle métier proposée, à valider par Matt — R5-1) : les deux équipes éliminées ; le match aval côté winners devient un **walkover** pour l'adversaire (état terminal, pas de check-in) ; délta conventionnel **−3/−4 pour chacune** ; placement = groupe du match forfaité, départagées entre elles par leur délta antérieur.
  - **Reset non joué** (l'équipe winners gagne GF1) → le match reset passe à **`cancelled`** (état terminal, résout l'affichage public et le statut `finished`).
- `withdrawTeam(bracket, registrationId)` **(review)** : disqualification/abandon en cours de tournoi — applique en cascade le forfait conventionnel à tous les matchs futurs atteignables, fige le placement au groupe courant, marque la registration `withdrawn`. Action console « Disqualifier » en 1 transaction (sinon, jour 2, chaque phase attend 5 min de check-in + validation pour une équipe partie).
- `replaceTeamInBracket(bracket, oldReg, newReg)` **(review)** : promotion waitlist avant le round 1 (spec §8) — swap + MAJ ACL + provisioning Discord express. Bouton console dédié. **Personne en waitlist → le slot devient un bye** (un bye ne génère PAS de score conventionnel ±3 chez l'adversaire — sinon iniquité au départage).
- `placementOf` + `rankWithinGroups(placements, stats, headToHead)` :
  - **(review, bloquant) N < 32 : places COMPRESSÉES 1→N** — le barème lit la place compressée (un groupe nominal vide décale les suivants). Sinon deux Qualifs de tailles différentes paient différemment la même performance relative → contestation garantie au cutline.
  - **(review) Biais des byes sur le délta** : le délta est **normalisé par match réellement joué** dans le départage (une équipe avec bye a un match de moins — même biais que le forfait exclu, que la spec a explicitement rejeté).
  - Clés : délta normalisé → buts marqués → face-à-face s'il a eu lieu → **`needs_admin_tiebreak`**. **(review)** Le face-à-face sera souvent indisponible (équipes d'un même groupe ont perdu contre des adversaires différents) → la console traite le tiebreak admin comme un **flux nominal** : liste des égalités, ordre imposé par drag & drop, journalisé.
- **Tests Vitest exhaustifs** : 4→32 équipes, byes en cascade, double forfait, walkover, reset joué/annulé, disqualification jour 2, remplacement waitlist, places compressées (« 20 équipes → places 1..20, points cohérents »), délta normalisé, complétude du câblage.

## 4. Classement circuit

- Recalcul serveur à la clôture d'un Qualif (action admin). **(review)** La clôture est **BLOQUÉE tant qu'un `needs_admin_tiebreak` est ouvert** — aucun point n'est écrit tant que les places 1→N ne sont pas toutes uniques (pas de standing partiel/faux publié).
- `participations` stocke placement, points, goalDiff **et goalsFor** (tiebreak circuit auditables).
- Identité d'équipe : règles de conflit du §2 (unicité par compétition, `identity_conflict`, `name_mismatch`).

## 5. Timers sans daemon — durci (review)

Chaque expiration est appliquée en **`runTransaction` par match avec garde d'état** (relire status + deadline DANS la transaction, transition légale uniquement — pattern `structures/join` existant). Règle de course explicite : une contre-saisie qui arrive **avant la finalisation effective** est traitée normalement (litige si différente), même après la deadline.

| Mécanisme | Détail |
|---|---|
| Tick | Route `/api/competitions/[id]/tick` : **authentifiée + rate-limitée**, appelable par la console admin (30 s) **ET par les pages de match des participants** (idempotente par design → survit à une console fermée). Verrou soft Upstash (SETNX ~10 s) contre les ticks concurrents de plusieurs admins. N'écrit un doc **que s'il y a une transition réelle** (pas de fan-out onSnapshot pour rien). |
| Console | Timer dans un **Web Worker** (Chrome throttle les `setInterval` des onglets en arrière-plan — l'admin sera alt-tabbé sur Discord) + bandeau « console inactive » via Page Visibility. |
| Check-in général | Stocké sur la registration (`generalCheckin`), vue console « équipes manquantes à l'échéance » → forfait / **remplacement waitlist** (bouton dédié). |

## 6. Intégration Discord — provisioning découplé (review)

Volumétrie réelle : ~10-15 calls par équipe (rôle + 2 salons + overwrites + assignations × 3-5 membres) → **300-500 calls pour 32 équipes**, sur des endpoints à rate-limit serré. Et le seul backoff du repo est un retry unique dans `sendAnnouncementDM` — tout `lib/discord-competition.ts` est du code neuf. Donc :
- **L'approbation n'appelle PAS Discord en synchrone** : elle écrit le statut + met le provisioning en file (`discord.provisioningStatus`).
- Bouton console « Provisionner » (batch, progression visible, **reprise idempotente** — les IDs créés sont stockés au fil de l'eau).
- Vrai helper de **backoff 429** générique (respect de `retry_after`).
- Joueur ayant quitté le serveur entre inscription et approbation → **warning non bloquant** (les overwrites par user donnent l'accès salon sans rôle).
- Le reste (rôles, salons privés, adhésion obligatoire, cleanup admin, lien d'invitation du bot) : inchangé (v1).

## 7. Pages

Public + dirigeants : inchangé (v1) — hub circuit, page compétition + bracket live, page de match (zone privée : check-in, room, scores, litige, thread), wizard d'inscription avec nudge vérification **+ étape d'acceptation du règlement**, mes inscriptions. **+ page publique `/competitions/…/reglement`** (rendu markdown, numéro de version affiché) et **éditeur de règlement** dans le panel admin compét.

**Console live admin — enrichie (review)** :
- Phases et matchs temps réel, check-ins manquants, timers échus, litiges (screenshots via URLs signées), forfaits, codes rooms, match casté, tick.
- **Lancement de phase PARTIEL** ✅ (validé Matt, avec amendement) : **action explicite d'un admin compétition** (jamais automatique) — l'admin peut ouvrir le check-in des matchs dont les 2 équipes sont connues pendant qu'un litige bloque les autres, avec sous-état « en attente du match X ». Sans ça, un litige de 30 min sur UN match gèle 28 équipes.
- **Disqualifier / retirer du bracket** (cascade §3) · **Remplacer par la waitlist** · **UI de tiebreak admin** (drag & drop, audit-loggé).
- **Export/impression du bracket + rooms pré-générées** (1 clic) — pilier du plan B (§10).
- File de validation : **(review)** les signalements/flags anti-smurf sont montrés en **agrégat anonymisé** (« 2 signalements smurf en attente », « flag admin : oui ») — jamais l'identité des signaleurs ni les notes (les admins compét sont des bénévoles de la scène ; le modèle de confidentialité actuel dit explicitement « le joueur ne doit pas savoir qu'il est flaggé » et protège le reporter).

## 8. Sécurité & conformité (durci — review)

- `birthDate` → `user_secrets` (décision figée, §2).
- Rules : bascule des règles permissives existantes (`competitions`, `competition_registrations`) en deny **dans le même commit** que les premiers writes ; fonction `isCompetitionAdmin()` **+ `isAedralAdmin()`** sur les lectures privilégiées ; sync + deploy selon le workflow rules existant.
- **`getMatchSideForUser(match, uid)`** : fonction d'autorité UNIQUE (scores, check-in, room, forfait, litige, thread). Le camp est **toujours dérivé serveur** de l'identité du caller — jamais un paramètre client (sinon : le capitaine A saisit aussi pour B, scores concordants frauduleux auto-validés). Staff : résolu **live** via `lib/structure-permissions` sur le structureId de l'inscription (choix documenté : un staff ajouté pendant l'event peut aider ; le roster joueur, lui, reste verrouillé).
- Screenshots litiges : keys R2 privées + URLs signées (jamais d'URL publique en doc).
- Aucune donnée à caractère personnel (uids/snowflakes inclus) dans les docs à lecture publique.
- Audit log sur toute action admin (validation, litige, forfait, ban, tiebreak, disqualification, remplacement).
- **Vérifier au Lot 0 que le projet Firebase `monthly-cup` est bien en plan Blaze** (review : en Spark, le quota 50k reads/jour tomberait à mi-Qualif et tuerait le site ENTIER, vieux site Springs compris — case à cocher de 2 min qui conditionne le temps réel).

## 9. Intégrations transverses

Inchangées (v1) sauf : anti-smurf en agrégat anonymisé (§7). OG cards + palmarès auto re-phasés après le tournoi test (§10) — pas nécessaires au Qualif 1, le standing circuit ne sert qu'à partir du Qualif 2.

## 10. Phasage du build — v2 rééquilibré (review : Lot 3 était sous-dimensionné)

| Lot | Contenu | Deadline |
|---|---|---|
| **0 — Socle** (sem. 1) | Collections + **bascule rules existantes** + audit legacy + adaptation `profile/history` + `isCompetitionAdmin` + CRUD admin compétitions/circuits + birthDate (**user_secrets**) Settings + **vérif plan Blaze** | 11 juil. |
| **1 — Inscription** (sem. 2-3) | Wizard complet (+ **acceptation du règlement**) + file de validation (+ flags agrégés, dérogations, conflits d'identité) + provisioning Discord **découplé** + registre bans + **feature règlement** (page publique + éditeur versionné) | 25 juil. |
| **2 — Bracket + machine d'états** (sem. 4-5) | `lib/tournament` complète (double forfait, walkover, cancelled, withdraw, replace, places compressées) + tests + seeding + pages publiques + **squelette machine d'états match + console live** (même flux onSnapshot que le bracket public — démarré ICI, pas au Lot 3) | 8 août |
| **3 — Jour de match** (sem. 6-7) | Check-ins (général + phase, partiel), rooms, scores + timers transactionnels + tick, litiges + screenshots signés, forfaits/disqualification/waitlist, console complète | 22 août |
| **3bis — Simulation** (fin sem. 7) | **Script « tournoi fantôme »** : seed 32 équipes fake + déroulé complet d'un bracket via les vraies API (scores, forfaits, litige, reset) — rejouable à 13/20/27/32 équipes. Dérisque la logique AVANT le test humain | 22 août |
| **4 — Circuit + threads** (sem. 8) | Places uniques + points + standing best-3 + tiebreaks + cutline + **threads de match** (hors chemin critique — les salons Discord d'équipe couvrent le besoin en attendant) | 29 août |
| **5 — Test humain + runbook** (sem. 9) | **Tournoi test grandeur nature** (valide les HUMAINS : admins, capitaines, Discord — la logique est déjà validée par 3bis) + **runbook jour J** + bannières/annonces/PostHog | 5 sept. |
| Buffer (sem. 10) | Corrections + **2e dry-run console avec les vrais admins compét** + ouverture inscriptions le **12 sept.** | 12 sept. |
| Post-Qualif 1 | OG cards résultats, palmarès auto, polish | oct. |

**Runbook jour J (sem. 9, 1 page)** : bracket + rooms imprimables avant le round 1 ; procédure dégradée si Vercel/Firestore tombe (« les salons Discord d'équipe existent déjà : distribution des rooms en vocal, scores collectés puis ressaisis via force-score admin ») ; **minimum 2-3 admins de compétition formés** avant le Qualif 1 ; canal d'annonce de statut.

## 11. Hors scope volontaire

Inchangé (v1) : format LAN, TM natif, tournois self-service structures (premium futur), messagerie générale.

## 11 bis. Stratégie de branches & tests (demande Matt 02/07 : « ne rien casser »)

- **Branches courtes par chantier** (`legends/lot-0`, `legends/inscription-wizard`, …) : rien ne part sur `main` tant que ce n'est pas stable. Chaque push de branche déclenche automatiquement un **Vercel Preview** — une URL de test privée, complète et fonctionnelle, SANS toucher aedral.com. C'est là que Matt teste « tant qu'on veut ».
- **Merges fréquents** (tous les 2-4 jours, jamais une méga-branche de 10 semaines — l'intégration tardive est plus risquée que le trunk) + **feature gating** : même mergé sur main, TOUT le module compétitions reste invisible sur aedral.com — pas d'entrée de nav, pages accessibles uniquement aux admins, compétitions en statut `draft`. Le public ne voit rien tant qu'on n'a pas explicitement publié.
- **⚠️ La base de données, elle, est partagée** (un seul projet Firebase — les previews et le local parlent à la même Firestore que la prod). Conséquences gérées :
  - les données de test vivent dans des compétitions `draft` clairement nommées (« TEST — ne pas toucher ») + script de cleanup ;
  - le script « tournoi fantôme » (Lot 3bis) crée et détruit ses propres données ;
  - **`firestore.rules` est GLOBAL** : chaque déploiement de rules touche la prod immédiatement → les changements de rules sont conçus pour être rétro-compatibles (collections nouvelles = additives) et déployés consciemment, jamais en réflexe.
- Le travail quotidien reste local-first (localhost:3000, workflow habituel) ; la preview Vercel sert aux validations de Matt.

## 12. Décisions R5 — TOUTES TRANCHÉES ✅ (Matt, 02/07)

- **R5-1 — Double forfait** ✅ : les deux équipes éliminées, l'adversaire du match suivant passe en walkover, délta −3/−4 chacune, placement = groupe du match forfaité.
- **R5-2 — Lancement de phase partiel** ✅ avec amendement : c'est une **action explicite d'un admin compétition** (jamais automatique). Le cast reste calé sur le match casté.
- **R5-3 — Matchs BO7** ✅ : 2 dernières rondes du winners (demi-finales + finale) + 2 dernières rondes du losers (demi + finale) + grande finale (+ reset).
- **R5-4 — Équipe disqualifiée/abandonnante** ✅ : placement figé au groupe atteint au moment du retrait (délta figé), matchs restants en forfaits conventionnels.

## 13. Le règlement de compétition (ajout Matt 02/07)

Deux livrables distincts :
1. **La feature** (Lot 1) : collection `rulebooks` versionnée + page publique + éditeur admin compét + acceptation obligatoire au wizard avec version tracée (§2, §7).
2. **Le CONTENU** — rédaction d'un règlement complet et solide, hors code, à produire AVANT l'ouverture des inscriptions (12 sept, idéalement avec l'annonce Vague 2 début août). Doit couvrir : format et règles sportives (tout est dans la spec), code de conduite et sanctions (triche, smurf, toxicité — adossé au registre de bans), procédure de litige, **cadre légal français** (loi République numérique 2016 + décret 2017-871 sur les compétitions de jeux vidéo : inscription gratuite → pas de « sacrifice financier », prizepool 1 200 € < 10 000 € → pas de garantie financière exigée, mineurs → autorisation parentale, cohérent avec notre système de dérogation), conditions Epic Games pour les tournois communautaires Rocket League, RGPD (données collectées, MMR, date de naissance), droit à l'image (cast/stream). Rédigé par Claude avec recherche juridique sourcée, **relecture par un professionnel recommandée avant publication** (à voir avec Springs E-Sport qui a l'habitude des événements déclarés).
- ✅ **Organisateur légal : SPRINGS E-SPORT** (orthographe exacte, décision Matt 02/07). Le règlement nomme SPRINGS E-SPORT comme organisateur (responsabilités, litiges, versement des prix) ; Aedral est la plateforme technique d'accueil.
