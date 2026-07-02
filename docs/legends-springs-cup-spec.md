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

## 3. Éligibilité — règles MMR (⚠️ calibrage à confirmer)

- Le MMR qui compte est le **MMR 2v2** (décision Matt — même pour un tournoi 3v3).
- **MMR de référence** ⏳ : formule proposée `réf = 70 % × MMR actuel + 30 % × peak all-time` (curseur réglable). Rationale : le peak seul condamne les ex-boostés de fin de saison ; l'actuel seul permet le tank (rare selon Matt, mais le peak le limite).
- **Règles d'équipe** (appliquées sur le MMR de référence) :
  1. **Toute composition de 3 joueurs alignable** (n'importe quel trio parmi titulaires + subs) doit respecter : **moyenne ≤ 1850** ET **écart max-min ≤ 150**. (Cette règle unique couvre : sub trop fort, sub trop faible « pour baisser la moyenne », joueur prête-nom.)
  2. **Plafond individuel : aucun joueur au-dessus de 1900** (sur le MMR de référence).
- ⚠️ **OUVERT (N1)** : ces chiffres (1850/1900/150) sont-ils bien calibrés pour du **2v2** (≈ niveau SSL accepté) ? La note d'origine disait « max GC3 » — en 2v2 ça correspondrait plutôt à ~1700-1750.
- **Capture du MMR** : pas d'API publique fiable (tracker.gg n'en expose pas, scraping interdit/fragile). Le dirigeant **déclare** actuel + peak par joueur à l'inscription ; le site calcule moyenne/écarts/plafonds et lève les drapeaux ; l'**admin vérifie via le lien tracker** (fiable car comptes vérifiés obligatoires). ~10 s par joueur.
- **Comptes vérifiés Aedral (Epic/Steam) OBLIGATOIRES** pour tous les joueurs inscrits (le « gate compét » prévu de longue date).

## 4. Roster & inscription

- **3 titulaires + 2 remplaçants max.** Équipe formée sur Aedral **obligatoire** (structure + équipe RL sur le site) — règle structurante d'adoption.
- L'inscription **fige un snapshot** du roster : les changements ultérieurs de l'équipe sur le site n'affectent pas l'inscription. **Roster lock total** une fois inscrit.
- **Une inscription par Qualif** (pas d'inscription circuit). Ouverture **J-14**, fermeture **J-3** (mercredi soir pour un Qualif le samedi) ⏳.
- Inscription **gratuite**, réalisée par un **dirigeant ou manager** de la structure.
- **Validation manuelle** par les admins de compétition : vérif trackers/MMR, registre des bans, homogénéité de l'équipe, sérieux, etc.
- **Refus automatique** si un joueur ou la structure figure au **registre des bans**, avec motif affiché.
- **Règle noyau (conservation des points)** ⏳ : proposition — une équipe conserve ses points de circuit si **au moins 2 de ses 3 titulaires** figuraient dans le roster (titulaires ou subs) de sa précédente participation ; sinon elle repart à 0 (nouvelle équipe). ⚠️ OUVERT (N5) : validation + le nom d'équipe peut-il changer ?
- ⚠️ **OUVERT (N6)** : ajout d'un champ **date de naissance** au profil (obligatoire pour s'inscrire en compétition, visible UNIQUEMENT des admins de compétition, jamais public — RGPD). Âge minimum ? Enjeu mineurs/LAN ?

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
- Le bot doit y être invité **hors mécanisme structure** → prévoir un lien d'invitation admin classique. ⚠️ OUVERT (N8) : confirmer les droits admin de Matt sur ce serveur.
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

## 11. Classement d'un Qualif & barème de points

- **Placement unique de 1 à 32** : le bracket donne le groupe d'élimination (1er, 2e, 3e, 4e, 5-6, 7-8, 9-12, 13-16, 17-24, 25-32), puis **le délta de buts départage à l'intérieur du groupe**.
- ⏳ Ordre de départage proposé : délta de buts → buts marqués → (3e critère à définir). **Forfaits exclus du calcul du délta** (des deux côtés) — proposé.
- **Barème v2** ⏳ (calibré pour : gagner domine, mais la régularité paie — cohérent avec « 3 meilleurs résultats sur 4 ») :

| Places | Points |
|---|---|
| 1 à 8 | 40 · 34 · 30 · 26 · 24 · 22 · 20 · 19 |
| 9 à 16 | 18 · 17 · 16 · 15 · 14 · 13 · 12 · 11 |
| 17 à 24 | 10 · 10 · 9 · 9 · 8 · 8 · 7 · 7 |
| 25 à 32 | 6 · 6 · 5 · 5 · 4 · 4 · 3 · 3 |

- Propriétés : 3× 10e place (51 pts) > 1 victoire isolée (40) ; 3× 16e (33) < 1 victoire. Simulation de cutlines top-16 à faire avant de figer.
- ⏳ **Tie-breaker cutline top-16** proposé : 1) meilleur placement unique du circuit, 2) délta de buts cumulé sur les Qualifs comptabilisés, 3) résultat du Qualif le plus récent. ⚠️ OUVERT (N4).
- ⚠️ **OUVERT (N7)** : forfait d'un qualifié LAN → repêchage de la 17e ?

## 12. Côté public / visiteurs

- **Bracket live public** sur le site, pages de match publiques (scores, statut) — codes de room cachés (équipes concernées + admins uniquement).
- Badge « EN STREAM » + lien stream sur le match casté.
- Détail du rendu public : latitude donnée par Matt (« fait pour le mieux »).

## 13. Principes d'architecture (pour le plan à venir)

- **Moteur de compétition GÉNÉRIQUE**, pas du code jetable Legends Cup : formats configurables (double élim aujourd'hui ; d'autres formats demain), phases, matchs, règles d'éligibilité paramétrables. La Legends Springs Cup = **une instance** du moteur.
- Pensé **gate-friendly** pour le futur premium : « les structures créent leurs tournois sur mesure » (demande explicite de Matt).
- Réutilise l'existant : équipes/structures Aedral, comptes vérifiés, bot Discord, permissions, notifications, R2 (screenshots litiges).

## 14. Questions ouvertes (round 3)

- **N1** — Caps 1850/1900/150 : calibrés pour du MMR **2v2** (niveau SSL accepté) ou à redescendre (~1700-1750, esprit « max GC3 ») ?
- **N2** — Formule MMR 70 % actuel / 30 % peak all-time : validée ?
- **N3** — Barème v2 + départage intra-groupe (délta → buts marqués → ?) + forfaits exclus du délta : OK ?
- **N4** — Tie-breaker cutline top-16 : OK ?
- **N5** — Règle noyau précise (2/3 titulaires vs roster de la précédente participation, sinon 0 point) + changement de nom d'équipe autorisé ?
- **N6** — Date de naissance : âge minimum ? enjeu mineurs/LAN ?
- **N7** — Repêchage 17e si forfait LAN ?
- **N8** — Matt a-t-il les droits admin sur le serveur Discord Springs E-Sport (pour inviter le bot) ?

## 15. Repères de timeline build

- **Aujourd'hui : 2 juillet.** Inscriptions Qualif 1 ouvrent le **12 septembre** → flux inscription + validation + admin de compétition prêts pour ~5 septembre.
- Moteur de bracket + déroulement de match prêts pour le **26 septembre** (Qualif 1).
- ≈ 10 semaines devant nous pour ~6-8 semaines de build estimées : marge OK, mais le plan d'architecture doit être validé rapidement.
