# Le bot raconte le tournoi — plan et décisions

Source : cartographie multi-agents du 2026-07-27 (8 lecteurs par zone du module
compétition + 2 critiques, « organisateur » et « joueur »). **123 moments** du
cycle de vie recensés, **72 sans aucun message Discord**.

Ce document remplace la cartographie brute : il ne garde que les décisions.

## Le principe

Un message ne se justifie que s'il **appelle une action** du destinataire, ou
l'informe d'une **décision qui le touche directement**. Tout le reste est du
bruit qui fait couper les notifications du serveur — et un salon coupé emporte
les messages importants avec lui.

C'est pourquoi le premier geste de ce chantier a été une **suppression**, pas un
ajout (voir « Ce qu'on n'enverra pas »).

## Architecture

Tous les envois passent par **`lib/competitions/tournament-broadcast.ts`**, seul
chemin d'écriture vers Discord pendant un tournoi. Avant, six routes parlaient
chacune à leur façon et la mention — la seule chose qui NOTIFIE réellement —
était oubliée une fois sur deux.

- textes purs et testables : `lib/competitions/broadcast-messages.ts`
- règle de mention unique : salon d'équipe → ping du rôle ; **salon d'annonces →
  jamais** (il informe le serveur, il n'a pas à réveiller 200 personnes) ;
  salon staff → premier rôle staff
- garde `isDev` : une compétition du bac à sable n'écrit jamais chez personne
- **accusé de livraison** (`DeliveryReport`) remonté dans la réponse des routes :
  sans lui, une équipe qui dit « on n'a rien reçu » est indiscernable d'une
  équipe qui n'a pas regardé

## Lot 1 — le jour de match

Fait (commit `e51965c`, tests unitaires verts, **preuve d'exécution Discord à
faire**) :

- [x] room (nom + mot de passe) jointe au message de check-in — le bot la
      promettait dans son mot d'accueil et ne la donnait jamais ; elle est
      aléatoire, donc introuvable ailleurs
- [x] check-in adressé à chaque camp, lien vers la page du match
- [x] check-in relancé → les deux camps
- [x] forfait validé / score forcé → les deux camps, avec le motif
- [x] équipe retirée → elle + chaque adversaire touché par la cascade
- [x] bracket publié → chaque équipe reçoit SON adversaire et son heure

Reste :

- [ ] **litige ouvert → les deux équipes** (« match gelé, dépose tes captures »).
      Aujourd'hui seul le staff est prévenu ; les joueurs, qui doivent produire
      la preuve, restent devant leur écran sans consigne
- [ ] **score en attente de contre-saisie** → au camp qui n'a pas saisi. Sans
      ça, un score devient officiel contre une équipe qui n'a jamais su qu'on
      l'attendait

## Lot 2 — l'organisateur garde la main

- [ ] **action « Annonce »** (texte libre → salon d'annonces et/ou tous les
      salons d'équipe). C'est l'outil le plus utilisé un jour de tournoi et il
      n'existe pas : retard, incident, consigne de dernière minute. Sans lui,
      il faut écrire à la main dans 32 salons
- [ ] **contrôle du dispositif** avant tournoi (bot présent, droits, salons,
      N équipes provisionnées sur N, joueurs absents du serveur) + passage
      automatique à J-1 dans le salon staff
- [ ] **relance du check-in général à T-5**, en ne mentionnant que les équipes
      qui n'ont pas confirmé (zéro manquant → aucun message)
- [ ] **joueur inscrit absent du serveur Discord** : il ne recevra rien de tout
      ce qui précède. Aujourd'hui c'est un drapeau silencieux
- [ ] **qui peut faire le check-in** nommé explicitement (c'est l'inscripteur,
      pas le capitaine de jeu — à 14h30 l'équipe est là et personne ne peut
      confirmer)
- [ ] repères horaires : phase suivante annoncée, fin de journée, reprise

## Lot 3 — le récit

- [ ] fil de match relayé dans les deux sens (staff → équipe, équipe → staff) ;
      un fil qui ne notifie personne oblige les deux camps à camper sur une page
- [ ] qualifié / éliminé en fin de poules ou d'étape
- [ ] podium et classement final dans le salon d'annonces
- [ ] liste d'attente prévenue le jour J (« tiens-toi prête » puis « c'est
      terminé ») — une réserve qu'on n'a pas prévenue n'est pas une réserve
- [ ] rappel J-1 (greffé sur le cron existant ; **le plan de phases n'a pas
      d'heure**, seul `schedule.days[].startsAt` existe → un H-1 par phase
      demanderait d'ajouter une heure au plan)
- [ ] DM de validation enrichi (dates, heure du check-in général, règlement) —
      enrichir l'existant, pas un message de plus

## Ce qu'on n'enverra pas (décidé)

Aussi important que le reste :

- **appariement de la ronde suivante (suisse)** : le lancement de phase qui suit
  ping déjà chaque équipe avec son adversaire. Deux messages à deux minutes
  d'écart, c'est le début de la fatigue de notification
- **avancement après une victoire** : le check-in du tour suivant porte déjà
  l'information
- **seeding ouvert / mélangé / réordonné** : plomberie d'organisateur,
  réversible, invisible du joueur. Un message inviterait à contester un tirage
  encore provisoire
- **évolution du classement ou du Buchholz** : donnée à consulter, pas à pousser
- **chaque capture déposée pendant un litige** : cap de 10 par camp, soit
  jusqu'à 20 pings pour un seul litige
- **accusé de check-in** au capitaine qui vient de le faire : l'écran le lui a
  déjà dit
- **arbitrage d'une égalité** : publié de fait par le message de qualification
- **nettoyage des salons de fin** : le salon est supprimé, le message ne sera
  jamais lu

Et la suppression déjà faite : l'alerte « une seule équipe a saisi » ne mentionne
plus le staff. C'est le déroulement normal (le perdant ne saisit presque jamais) ;
sur 63 matchs, cela faisait des dizaines de pings « tout va bien ».

## Banc d'essai

Serveur Discord de test de Matt, bot Aedral administrateur. L'e2e
`scripts/e2e-competition-discord.mjs` (69 vérifications) provisionne pour de
vrai, relit l'état chez Discord et nettoie derrière lui — il sert de base pour
prouver les messages.
