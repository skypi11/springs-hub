# Legends Springs Cup — Spécification fonctionnelle

> **Statut : DRAFT en cours de validation avec Matt** — dernière mise à jour : 2026-07-02.
> Source : notes manuscrites de Matt + 2 rounds de questions/réponses (session du 02/07).
> Les points marqués ⏳ sont **en attente de validation** ; les ⚠️ sont des questions ouvertes.
> Règle de travail : **aucun code tant que cette spec n'est pas validée.**

---

## 1. Le circuit

- **4 Qualifs** (appelés aussi « Majors ») online + **1 LAN finale**. Rocket League 3v3.
- Dates (calendrier fourni par Matt le 02/07) :
  - Qualif 1 : **26-27 septembre 2026**
  - Qualif 2 : **10-11 octobre 2026**
  - Qualif 3 : **24-25 octobre 2026**
  - Qualif 4 : **7-8 novembre 2026**
  - **LAN finale « Legends Springs Cup » : 21-22 novembre 2026**
  - (LAN Trackmania séparée le 3-4 octobre — hors scope de cette spec)
- Début **15 h** les deux jours de chaque Qualif. Check-in général à **14 h 30**.
- Les Qualifs distribuent des **points de circuit** → les **16 meilleures équipes** vont à la LAN.
- **Seuls les 3 meilleurs résultats (sur 4) de chaque équipe comptent** — pour ne pas pénaliser une absence ou une contre-performance.
- **Prizepool : 1 200 € cash à la LAN uniquement.** Aucun cashprize sur les Qualifs. Les Qualifs rapportent : des points + la qualification.
- La **LAN a son propre format**, à spécifier plus tard (hors scope pour l'instant).

## 2. Format d'un Qualif (identique pour les 4)

- **32 équipes max**. Pas de limite d'équipes par structure.
- **Double élimination complète** (winner + loser bracket, élimination après 2 défaites) avec **bracket reset** en grande finale.
- **BO5** partout, sauf **demi-finales, finales et grande finale en BO7** — winner bracket, loser bracket ET grande finale.
- **Sur 2 jours**, ~5 phases par jour. Découpage validé (cohérent avec « un full-winner joue 3 matchs le jour 1 ») :
  - **Jour 1** : P1 = WR1 · P2 = WR2 + LR1 · P3 = WR3 + LR2 · P4 = LR3 · P5 = LR4
  - **Jour 2** : demi-finales WB + LR5 · LR6 · LR7 · finale WB · finale LB · grande finale (+ reset)
  - Le planning des phases reste ajustable par l'admin dans l'outil.
- **Une « phase »** = un créneau où tous les matchs se lancent en même temps (facilite le cast).
- **Seeding aléatoire**, modifiable manuellement par l'admin avant publication.
- **< 32 équipes** → byes. **> 32 validées** → premier validé-premier servi + **liste d'attente**.

## 3. Éligibilité — règles MMR ✅ VALIDÉES (02/07)

- Le MMR qui compte est le **MMR 2v2** (décision Matt — même pour un tournoi 3v3). **Caps confirmés calibrés pour le 2v2.**
- **MMR de référence** ✅ : `réf = 70 % × MMR actuel + 30 % × peak all-time` (arrondi, curseur réglable). Rationale : le peak seul condamne les ex-boostés de fin de saison ; l'actuel seul permet le tank (rare selon Matt, mais le peak le limite).
- **Règles d'équipe** (appliquées sur le MMR de référence) :
  1. **Toute composition de 3 joueurs alignable** (n'importe quel trio parmi titulaires + subs) doit respecter : **moyenne ≤ 1850** ET **écart max-min ≤ 150**. (Cette règle unique couvre : sub trop fort, sub trop faible « pour baisser la moyenne », joueur prête-nom.)
  2. **Plafond individuel : aucun joueur au-dessus de 1900** (sur le MMR de référence).
- **Capture du MMR** : pas d'API publique fiable (tracker.gg n'en expose pas, scraping interdit/fragile). Le dirigeant **déclare** actuel + peak par joueur à l'inscription ; le site calcule moyenne/écarts/plafonds et lève les drapeaux ; l'**admin vérifie via le lien tracker** (fiable car comptes vérifiés obligatoires). ~10 s par joueur.
- **Comptes vérifiés Aedral (Epic/Steam) OBLIGATOIRES** pour tous les joueurs inscrits (le « gate compét » prévu de longue date).

## 4. Roster & inscription

- **3 titulaires + 2 remplaçants max.** Équipe formée sur Aedral **obligatoire** (structure + équipe RL sur le site) — règle structurante d'adoption.
- L'inscription **fige un snapshot** du roster : les changements ultérieurs de l'équipe sur le site n'affectent pas l'inscription. **Roster lock total** une fois inscrit.
- **Une inscription par Qualif** (pas d'inscription circuit). Ouverture **J-14**, fermeture **J-3** (mercredi soir pour un Qualif le samedi) ⏳.
- Inscription **gratuite**, réalisée par un **dirigeant ou manager** de la structure.
- **Validation manuelle** par les admins de compétition : vérif trackers/MMR, registre des bans, homogénéité de l'équipe, sérieux, etc.
- **Refus automatique** si un joueur ou la structure figure au **registre des bans**, avec motif affiché.
- **Règle noyau (conservation des points)** ✅ : une équipe conserve ses points de circuit si **au moins 2 de ses 3 titulaires** figuraient dans le roster (titulaires ou subs) de sa précédente participation ; sinon elle repart à 0 (nouvelle équipe). **Le nom d'équipe ne peut pas changer** entre deux participations, sauf accord des admins de compétition.
- **Date de naissance** ✅ : nouveau champ profil (le joueur renseigne sa date de naissance). **La date n'est jamais publique, mais l'ÂGE calculé s'affiche sur le profil public.** Les admins de compétition voient l'âge à la validation. **Chaque compétition a un paramètre « âge minimum »** configurable ; l'inscription est bloquée si un joueur du roster est en dessous. ⚠️ Valeur de l'âge minimum pour la Legends Cup à fixer par Matt (paramètre, non bloquant pour le build).

## 5. Registre des bans (nouveau)

- Bans de **joueurs** ET de **structures** : motif, durée ou permanent.
- Géré par les admins de compétition. Consulté automatiquement à l'inscription (refus auto + motif).
- La liste Springs existante est incomplète/peu fiable → reconstruction manuelle dans le registre, appuyée sur les **vrais comptes** (Discord + jeux) qu'Aedral connaît.

## 6. Rôle « admin de compétition » (nouveau)

- Rôle **scopé compétitions uniquement** — distinct des admins Aedral complets (`aedral_admins`).
- Périmètre : valider/refuser les inscriptions, gérer les litiges, forcer scores/forfaits, voir les codes de room, gérer le registre des bans, déclencher le cleanup Discord post-Qualif.
- **Accès en lecture** aux infos des équipes inscrites : comptes Discord, comptes de jeu, âge, pays des joueurs + staff des équipes.
- **Aucun accès** au reste de l'admin du site (users, structures, messages…).
- Nommés par un admin Aedral complet (Matt).

## 7. Intégration Discord — serveur SPRINGS E-SPORT

- Tout se passe sur le **serveur Discord Springs E-Sport** (pas le serveur communautaire Aedral).
- Le bot doit y être invité **hors mécanisme structure** → prévoir un lien d'invitation admin classique. ✅ Matt a les droits admin sur le serveur Springs E-Sport (il clique le lien, le bot arrive avec les bonnes permissions).
- À la **validation** d'une inscription, le bot crée automatiquement :
  - un rôle générique **« Participant Legend »** (commun au circuit) + un **rôle au nom de l'équipe** ;
  - un **salon vocal + un salon textuel** privés par équipe, visibles uniquement par l'équipe et le staff.
- **Adhésion au serveur obligatoire** pour tous les joueurs inscrits — vérifiée par le bot à l'inscription.
- Notifications Discord : lancement des check-ins, pings de match, etc.
- **Cleanup post-Qualif** : suppression des salons + rôles d'équipe via une **action explicite d'un admin de compétition** (pas automatique).

## 8. Jour de match — déroulement

- **Check-in général 14 h 30, durée 20 min**, par le **capitaine seul**. Équipe manquante → soumis à décision admin ; remplacement par la liste d'attente possible avant le round 1.
- **Check-in par phase : 5 min**, capitaine seul. Lancé dès que toutes les équipes d'une phase sont disponibles, avec message Discord. Toutes les équipes d'une phase lancent leurs matchs en même temps.
- **Pas de forfait automatique** : équipe non check-in → état « en attente de validation du forfait par un admin », avec message du type *« L'équipe adverse n'a pas check-in, attendez la validation d'un admin »*. Vaut pour 1 ou 2 équipes absentes.
- **Room** : nom + mot de passe **générés par le site**. **Créateur de la room = l'équipe du haut du bracket**, affiché explicitement sur la page de match (« Room à créer par : [ÉQUIPE] »).
- **Les admins voient les codes de toutes les rooms** (pour spectater/caster).
- **Cast : 1 match par phase**, choisi par l'admin, badge « EN STREAM » sur le bracket public + lien stream. **Pas de différé** : le cast se cale sur le check-in.

## 9. Scores & litiges

- **Score de chaque manche** saisi par les capitaines **ou le staff** des DEUX équipes.
- Quand la première équipe a saisi toutes les manches → l'autre a **3 minutes** pour saisir aussi. Sinon : les scores de la première équipe sont retenus + **notification admin** (« une équipe n'a pas saisi »).
- **Scores différents → litige automatique.** + un **bouton litige manuel** (erreur de saisie, etc.).
- Litige : **gel du match**, notification admins, demande aux capitaines d'**uploader les captures d'écran de chaque manche**. Décision admin finale, débloque le bracket.

## 10. Page de match & fil de discussion

- La **page de match** centralise : check-in, room (nom/MDP, qui crée), saisie des scores, litige, statut cast.
- **Fil de discussion** attaché au match : messages entre capitaines/staff des deux équipes + admins. Temps réel via Firestore.
- **Décision d'architecture** : le fil est une **primitive réutilisable** (« thread attaché à un objet ») — pas une messagerie générale. Réutilisable plus tard pour les scrims, candidatures, tournois premium. Validé par Matt.

## 11. Classement d'un Qualif & barème de points ✅ VALIDÉ (02/07)

- **Placement unique de 1 à 32** : le bracket donne le groupe d'élimination (1er, 2e, 3e, 4e, 5-6, 7-8, 9-12, 13-16, 17-24, 25-32), puis **le délta de buts départage à l'intérieur du groupe**.
- Ordre de départage intra-groupe ⏳ : délta de buts → buts marqués → face-à-face s'il a eu lieu → décision admin.
- **Forfaits = score conventionnel** ⏳ (proposition suite à la remarque de Matt : exclure le match du délta désavantagerait le vainqueur du forfait, qui aurait un match de moins pour construire son délta) : un forfait est enregistré **3-0 en BO5 (chaque manche 1-0) → délta ±3** ; **4-0 / ±4 en BO7**.
- **Barème v2** ✅ (calibré pour : gagner domine, mais la régularité paie — cohérent avec « 3 meilleurs résultats sur 4 ») :

| Places | Points |
|---|---|
| 1 à 8 | 40 · 34 · 30 · 26 · 24 · 22 · 20 · 19 |
| 9 à 16 | 18 · 17 · 16 · 15 · 14 · 13 · 12 · 11 |
| 17 à 24 | 10 · 10 · 9 · 9 · 8 · 8 · 7 · 7 |
| 25 à 32 | 6 · 6 · 5 · 5 · 4 · 4 · 3 · 3 |

- Propriétés : 3× 10e place (51 pts) > 1 victoire isolée (40) ; 3× 16e (33) < 1 victoire.
- **Scénarios simulés pour présentation au président de Springs E-Sport** : page partageable → https://claude.ai/code/artifact/b93a210f-bdb2-457c-87a9-e0e3da1d7acc (trajectoires, départage délta, forfait, cutline — chiffres réglables).
- **Tie-breaker cutline top-16** ✅ : 1) meilleur placement unique du circuit, 2) délta de buts cumulé sur les Qualifs comptabilisés, 3) résultat du Qualif le plus récent.
- **Forfait d'un qualifié LAN** ✅ : repêchage en cascade dans l'ordre du classement (17e, puis 18e, etc.).

## 12. Côté public / visiteurs

- **Bracket live public** sur le site, pages de match publiques (scores, statut) — codes de room cachés (équipes concernées + admins uniquement).
- Badge « EN STREAM » + lien stream sur le match casté.
- Détail du rendu public : latitude donnée par Matt (« fait pour le mieux »).

## 13. Principes d'architecture (pour le plan à venir)

- **Moteur de compétition GÉNÉRIQUE**, pas du code jetable Legends Cup : formats configurables (double élim aujourd'hui ; d'autres formats demain), phases, matchs, règles d'éligibilité paramétrables. La Legends Springs Cup = **une instance** du moteur.
- Pensé **gate-friendly** pour le futur premium : « les structures créent leurs tournois sur mesure » (demande explicite de Matt).
- Réutilise l'existant : équipes/structures Aedral, comptes vérifiés, bot Discord, permissions, notifications, R2 (screenshots litiges).

## 14. Questions ouvertes (round 4 — dernières)

Les rounds 1-3 sont clos (tout validé). Restent 3 micro-points :

- **R4-1** — **Forfait = score conventionnel** (3-0 / ±3 en BO5, 4-0 / ±4 en BO7) : à valider (remplace l'exclusion du délta, voir §11).
- **R4-2** — 3e/4e clés de départage intra-groupe (après délta → buts marqués) : face-à-face s'il a eu lieu, puis décision admin — à valider.
- **R4-3** — **Valeur de l'âge minimum** pour la Legends Cup (le champ est un paramètre par compétition, non bloquant pour le build).

## 15. Intégrations à l'existant (proposées par Claude, à discuter)

Idées qui réutilisent l'infra déjà construite — coût marginal faible, cohérence maximale :

1. **Palmarès automatique** : le placement final d'un Qualif alimente automatiquement la section PALMARÈS de la page publique de la structure (feature existante) — plus le badge circuit sur la page équipe.
2. **Nudge de vérification dans le flux d'inscription** : à l'inscription, les joueurs non vérifiés du roster sont listés avec le bouton « Vérifier en 1 clic » existant (`VerifyAccountNudge`) → l'inscription devient LE moteur de conversion des comptes vérifiés.
3. **Flags anti-smurf à la validation** : les admins de compétition voient les `user_admin_flags` (suspectedSmurf) et les signalements de rang existants (`rank_reports`) directement dans l'écran de validation d'une équipe.
4. **Cartes OG de résultats** : réutiliser le système OG existant pour générer des visuels partageables « Team A 3-1 Team B » et « Qualifié LAN » (hype réseaux sociaux, zéro friction).
5. **Bannière d'inscription sur le dashboard** : pendant les fenêtres J-14 → J-3, bannière « Inscriptions Qualif N ouvertes » sur l'accueil connecté + annonce Discord via le système d'annonces existant.
6. **Funnel PostHog** : événements `comp_registration_*` pour mesurer l'adoption (la Cup EST la stratégie d'acquisition — il faut la mesurer).

## 16. Repères de timeline build


- **Aujourd'hui : 2 juillet.** Inscriptions Qualif 1 ouvrent le **12 septembre** → flux inscription + validation + admin de compétition prêts pour ~5 septembre.
- Moteur de bracket + déroulement de match prêts pour le **26 septembre** (Qualif 1).
- ≈ 10 semaines devant nous pour ~6-8 semaines de build estimées : marge OK, mais le plan d'architecture doit être validé rapidement.
