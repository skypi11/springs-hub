---
name: aedral-style
description: Voix éditoriale et règles anti-AI-slop d'Aedral. À appliquer dès qu'on écrit ou modifie du texte UI (labels, helpers, placeholders, empty states, toasts, notifications, embeds Discord, annonces) ou qu'on crée/refond un composant ou une page. Objectif — un produit qui sonne humain et pro, pas généré.
---

# Style Aedral — voix & anti-AI-slop

Aedral doit sonner comme un outil fait PAR un mec de l'esport POUR des joueurs,
pas comme un SaaS généré. Chaque texte et chaque écran passent ce filtre.

## Voix éditoriale

- **Ton sec, direct, factuel.** On informe, on ne vend pas. Une phrase courte
  vaut mieux que deux moyennes.
- **Tutoiement**, comme sur un Discord d'équipe. Jamais de « veuillez ».
- **Vocabulaire esport FR authentique** : scrim, roster, tryout, mercato, BO5/BO7,
  seed, bracket, LAN, IGL. Pas de traduction corporate (« session d'entraînement
  amicale » → « scrim »).
- **Parler joueur, pas plateforme** : « Ton rang est synchronisé » et non
  « La plateforme synchronise automatiquement votre rang ».

## Interdits copy (les tics qui « puent l'IA »)

1. **Emojis dans l'UI produit** : aucun emoji dans les labels, titres de panels,
   boutons, helpers, toasts, notifications système. (Le CONTENU utilisateur et
   les annonces Discord rédigées par un humain peuvent en avoir, avec parcimonie.)
2. **Points d'exclamation** : zéro, sauf citation d'un utilisateur. « Sauvegardé »
   suffit, pas « Sauvegardé ! ».
3. **Triades marketing** (« Crée, gère et développe ta structure ») : choisir LE
   verbe qui compte.
4. **Formules creuses** : « passe au niveau supérieur », « rejoins l'aventure »,
   « découvre », « booste », « libère ton potentiel » → poubelle.
5. **Sur-explication** : pas de phrase qui paraphrase ce que l'UI montre déjà.
   Un helper text n'existe que s'il apporte une info NON évidente (conséquence
   cachée, contrainte, irréversibilité). Sinon : le supprimer.
6. **Em-dashes décoratifs et « : » en cascade** dans les phrases courtes.
7. **Questions rhétoriques** (« Prêt à dominer le classement ? »).

## Règles design anti-template

Issues de l'audit du 2026-06-12 ([docs/audits/2026-06-12-design-audit.md](../../docs/audits/2026-06-12-design-audit.md)) :

1. **Hiérarchie 3 niveaux, non négociable.**
   - Niveau 1 « héros » (chrome complet : accent bar, glow, image) : **1-2 éléments
     MAX par écran**.
   - Niveau 2 « card » : `.panel` nu (surface + border neutre + bevel), identité
     couleur portée par UN seul élément (GameTag, dot statut, chiffre coloré).
   - Niveau 3 « ligne » : toute donnée répétitive (membres, demandes, annuaire)
     = rangée avec divider 1px, **pas de card**.
   La card plate est le DÉFAUT, la décoration est l'exception qui signale l'importance.
2. **Accent bar 3px = 1 par écran max**, sur le héros uniquement. Jamais sur un
   formulaire, une nav, une save bar, une modale, un bloc sidebar. Idem glow
   radial et icône-dans-un-carré-teinté.
3. **Or = 1 occurrence décorative par écran** (CTA principal ou récompense).
   Tout accent « par défaut » passe en neutre. Si tu hésites sur la couleur d'un
   accent, c'est qu'il ne doit pas exister.
4. **Une info = un seul endroit.** Jamais un titre, une stat ou un statut répété
   dans le même viewport (pas de titre en t-label + h3, pas de banner qui
   paraphrase les widgets, pas de panel qui ré-affiche le header).
5. **Uppercase rationné** : Bebas pour les titres + 1 eyebrow `t-label` max par
   bloc. Les autres labels de données en sentence case, poids 500, sans tracking.
6. **Hover = affordance** : `.pillar-card` et tout effet de survol réservés aux
   éléments réellement cliquables. Un formulaire qui s'allume au hover est un bug.
7. **Zéro vaporware** : aucun bloc « à venir », aucune feature annoncée non
   shippée, aucun screenshot montrant des zéros. Un empty state = phrase factuelle
   + bouton d'action.
8. **Une nouvelle section = une suppression.** Avant d'ajouter un bloc à une page
   dense, identifier ce qu'on replie ou supprime en échange.
9. **Préférer la donnée brute à la déco** : un tableau/liste dense et lisible
   (style Faceit/Linear) fait plus « pro » qu'une grille de cards décorées.

## Rappels DA (détail complet dans CLAUDE.md)

Jamais de fontSize < 12px · coins biseautés, jamais arrondis · bordures de cards
neutres · violet réservé au partenaire Springs E-Sport · couleur par jeu
(RL bleu, TM vert, Valorant rouge) · jamais « sous-équipe », toujours « équipe ».

## Test final avant de shipper un texte ou un écran

Lis-le à voix haute : est-ce qu'un joueur de 20 ans qui gère son équipe le
dirait comme ça sur Discord ? Est-ce qu'un écran de Linear/Faceit afficherait
autant de blocs ? Si non, simplifie.
