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

1. **Pas de nouvelle « card riche » par défaut.** Avant de créer un panel avec
   accent bar + glow + icône encadrée, se demander : est-ce un élément MAJEUR de
   la page ? Sinon → ligne de liste, ou texte nu. La déco se mérite.
2. **Hiérarchie à 3 niveaux max par vue** : 1 zone dominante, des zones
   secondaires sobres, du détail replié (accordéon, lien, onglet). Si tout a un
   accent bar, rien n'est accentué.
3. **Une nouvelle section = une suppression.** Avant d'ajouter un bloc à une page
   déjà dense, identifier ce qu'on replie ou supprime en échange.
4. **L'or est un budget** : 1-2 éléments dorés par vue (CTA principal, donnée
   précieuse). Pareil pour les glows.
5. **Préférer la donnée brute à la déco** : un tableau dense et lisible (style
   Faceit/Linear) fait plus « pro » qu'une grille de cards décorées.
6. **L'aération est une feature** : marges généreuses entre sections, pas de
   remplissage de colonne « parce qu'il reste de la place ».

## Rappels DA (détail complet dans CLAUDE.md)

Jamais de fontSize < 12px · coins biseautés, jamais arrondis · bordures de cards
neutres · violet réservé au partenaire Springs E-Sport · couleur par jeu
(RL bleu, TM vert, Valorant rouge) · jamais « sous-équipe », toujours « équipe ».

## Test final avant de shipper un texte ou un écran

Lis-le à voix haute : est-ce qu'un joueur de 20 ans qui gère son équipe le
dirait comme ça sur Discord ? Est-ce qu'un écran de Linear/Faceit afficherait
autant de blocs ? Si non, simplifie.
