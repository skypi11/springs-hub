# Backlog compétitions — demandes de Matt

Demandes du 2026-07-30, notées en vrac puis évaluées. L'ordre proposé est en bas.

---

## 1. Salon général des participants

Un salon textuel où **toutes les équipes engagées** peuvent écrire.

Aujourd'hui chaque équipe a son salon privé, et le salon d'annonces est en
lecture seule : les participants n'ont aucun endroit pour se parler entre eux
(trouver un scrim d'échauffement, signaler un souci commun, ambiance d'avant
tournoi).

- **Effort** : faible. Le provisioning crée déjà quatre types de salons ; c'en
  est un cinquième, en lecture-écriture pour le rôle participant.
- **À trancher** : visible du seul rôle participant, ou de tout le serveur ?
  (par défaut : participants seuls — c'est ce qui en fait un salon de tournoi)
- **Attention** : c'est le premier salon où le bot n'est PAS seul à écrire. La
  modération revient à l'organisateur ; le bot n'y poste rien.

## 2. Salon résultats, avec une affiche par match

Un salon où chaque résultat paraît sous forme d'**image prête à partager** :
les deux équipes avec leur logo, la date, le score, l'organisateur, le nom de la
compétition, le jeu, et Aedral.

**L'INFRASTRUCTURE EXISTE DÉJÀ** — et c'est ce qui divise l'effort. Hors
compétition, quand une structure crée un événement « match officiel », le site
génère une affiche de RENCONTRE (`app/api/og/match/[eventId]/route.tsx`, via
`next/og` et les helpers partagés de `lib/og-helpers.ts`) et le bot en joint
l'URL au message du salon d'équipe. Le salon résultats reprend cette mécanique ;
il n'y a pas de plomberie à inventer, seulement un dessin à faire.

**Décidé avec Matt (30/07)** :
- **tous les matchs**, sans exception ;
- **mention des seules équipes concernées** par le résultat — pas de ping
  général du salon ;
- **les deux formats** : carré pour Instagram, 16:9 pour X ;
- **avec du texte** : le détail du BO, manche par manche.

- **Effort** : moyen désormais (le dessin, deux formats, le branchement au flux
  de résultat), et non plus élevé.
- **Bonus naturel** : la même affiche servira pour le podium en fin de tournoi.

### 2 bis. Affiche de RÉSULTAT hors compétition (plus tard)

Les événements « match officiel » d'une structure ont leur affiche de rencontre,
mais **aucune affiche de résultat**. À faire une fois celle des compétitions au
point : ce sera le même générateur, alimenté par le score de l'événement.

## 3. BO de la petite finale non réglable

La petite finale (3e place) prend le BO par défaut ; l'écran de création ne
permet pas de le régler à part.

- **Effort** : faible. C'est un manque de la page de création refaite le 25/07.
- Pas de question : un champ de plus, au même endroit que les autres BO.

## 4. Jour unique **ou** période de jeu

Certaines ligues laissent une semaine aux équipes pour jouer leur match.

- **Effort** : moyen à élevé, et **c'est la demande qui mérite le plus de
  discussion** (voir question ci-dessous).
- **À trancher** : s'agit-il seulement d'afficher « du 6 au 13 octobre » à la
  place d'une date, ou d'un vrai **mode asynchrone** où les équipes conviennent
  elles-mêmes de leur horaire ? Dans le second cas, tout le jour-de-match change
  de nature : pas de check-in général à 14h30, pas de phases lancées ensemble,
  et les équipes doivent pouvoir se mettre d'accord entre elles (le fil de match
  y servirait enfin à plein).

## 5. Noms cliquables vers les pages publiques

Sur les écrans publics **et** admin, cliquer une structure ou un joueur doit
mener à sa page publique / son profil.

**FAIT le 30/07** :
- fiche publique d'un tournoi : joueurs du roster → profil, équipe → structure
- Dossier d'inscription (admin) : l'était déjà (`getProfileHref` /
  `getStructureHref`)

**RESTE À FAIRE — à ne pas oublier** (ces écrans tirent leurs données d'autres
routes, qui ne servent aujourd'hui **ni `structureId` ni `slug`** ; il faut donc
étendre la charge utile avant de pouvoir lier) :

| Écran | Ce qui doit devenir cliquable | Route à étendre |
|---|---|---|
| Console admin | noms d'équipes des rangées de match, panneau d'inspection | `/api/admin/competitions/[id]/console` |
| Page de match (publique et joueur) | les deux équipes du match | `/api/competitions/[id]/matches/[matchId]` |
| Classements (poules, rondes, final) | chaque équipe du tableau | `/api/competitions/[id]/standings` |
| Bracket | les équipes des cases | l'adaptateur `brackets-viewer` (contrainte du composant tiers — à étudier, peut-être impossible sans surcouche) |
| Page de circuit | équipes du classement de circuit | `/api/competitions/circuit/[id]` |

Ces cinq écrans seront repris dans la **passe UI/UX du module compétition** :
autant les traiter là plutôt que d'étendre cinq routes pour un seul lien.

---

## Ordre proposé

1. **Finir le Lot 3 du bot** (en cours) — liste d'attente prévenue, rappel J-1
2. **BO de la petite finale** (3) — petit manque, vite corrigé
3. **Noms cliquables** (5) — utile partout, prépare la passe UI/UX
4. **Salon général** (1) — complète le provisioning, faible risque
5. **Salon résultats + affiches** (2) — le plus visible, à faire posément
6. **Période de jeu** (4) — après décision sur la nature du mode

Le 4 est volontairement en dernier : mal tranché, il ferait doubler la
complexité du jour de match pour un besoin qui n'est peut-être qu'un affichage.
