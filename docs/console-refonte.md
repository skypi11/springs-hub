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
1. **Saisie / imposition de score cassée** (modale « Imposer le score » / `ForceScoreModal`,
   et probablement le `ScoreEntryForm` partagé de la page match) :
   - on peut **ajouter des manches alors que le match est déjà plié** (ex. 3-0 en BO5) ;
   - un **2-1 n'ajoute pas automatiquement la rangée suivante** (alors qu'il faut une 3e manche) ;
   - un **4-0 en BO5** (score impossible, max 3 manches gagnées) est **accepté au clic**
     sur « Imposer le score » mais **échoue en SILENCE** (aucun message d'erreur).
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

- **Lot 1 — bugs** (correctness, rapide) : saisie de score (rangées auto + validation
  BO + fin de l'échec muet), séparation/simplification code salon vs mot de passe,
  compte à rebours visible, fil instantané + pseudos colorés, fix chevauchement,
  clarté du delta au classement.
- **Lot 2 — bracket dans la console** + sélection de match → panneau de détail.
- **Lot 3 — inspection des équipes** depuis la console (clic → compo/roster/staff).
- **Lot 4 — cohésion control-room** (mise en page finale, agréable).

Toujours lire `docs/legends-springs-cup-spec.md` + `docs/legends-cup-architecture.md`
avant de toucher au module. La console est `app/admin/competitions/[id]/console/page.tsx`,
les actions POSTent vers `app/api/admin/competitions/[id]/console/route.ts`.
