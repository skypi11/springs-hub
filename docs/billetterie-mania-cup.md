# Créer la billetterie HelloAsso — Springs Mania Cup

> À suivre au moment de créer la billetterie. Ce que vous configurez ici décide
> si le rattachement automatique des paiements fonctionnera : le site relie un
> règlement à une inscription **par le code d'inscription**, pas par l'e-mail
> (un joueur paie souvent avec l'adresse de ses parents).

## 1. Le formulaire

- Type : **Billetterie** (pas « Adhésion », pas « Don »)
- Nom : `Springs Mania Cup`
- Dates de l'événement : **3 et 4 octobre 2026**
- Lieu : `19 rue des Charrons, 58180 Marzy`
- Clôture des ventes : à décider — au minimum quelques jours avant, pour avoir
  le temps de préparer les postes et les badges.
- Horaires : **portes ouvertes à 9 h le samedi, installations terminées à
  midi**, une heure d'essais, puis le **Springs Show** ouvre l'événement à 13 h
  et annonce les épreuves.

## 2. Les trois tarifs, un par un

Vue d'ensemble :

| Nom du tarif | Prix | Stock | Code d'inscription demandé |
|---|---|---|---|
| `Joueur` | 30 € | 64 | **Oui, obligatoire** |
| `Accompagnant` | 20 € | 64 | **Oui, obligatoire** (celui du joueur accompagné) |
| `Spectateur` | 10 € | capacité salle | Non |

La **location de PC ne passe pas par la billetterie** : elle se fait dans une
*boutique* HelloAsso à part, comme lors de la précédente LAN. Voir §2 bis.

Le détail de chaque tarif suit. Les champs sont ceux du formulaire HelloAsso,
dans l'ordre où il les demande. Ce qui n'est pas mentionné se laisse par défaut.

---

### Tarif 1 — `Joueur`

| Champ HelloAsso | Ce qu'on met |
|---|---|
| Nom du tarif | `Joueur` |
| Type de tarif | Tarif payant, montant fixe |
| Montant | `30` € |
| Nombre de places | `64` |
| Nombre maximum par commande | `1` |
| Description (238 car.) | *Ta place à la LAN, samedi et dimanche. Inscris-toi d'abord sur aedral.com/mania-cup : ton code d'inscription t'y attend, à reporter ci-dessous. Viens avec ton PC, ton écran, ton casque et un câble ethernet de 5 m. Portes ouvertes samedi dès 9 h.* |
| Information complémentaire | **Oui** — voir §3 |

> **Le « nombre maximum par commande » à 1 n'est pas cosmétique** : un joueur qui
> achèterait deux places d'un coup produirait deux règlements portant le même
> code, dont un à rembourser.

### Tarif 2 — `Accompagnant`

| Champ HelloAsso | Ce qu'on met |
|---|---|
| Nom du tarif | `Accompagnant` |
| Type de tarif | Tarif payant, montant fixe |
| Montant | `20` € |
| Nombre de places | `64` |
| Nombre maximum par commande | `1` |
| Description (249 car.) | *Accès à la zone joueurs pour une personne qui accompagne un joueur inscrit : parent, coach, ami. Reporte le code d'inscription du joueur, qu'il trouve sur aedral.com/mania-cup. Un accompagnant par joueur. Un billet spectateur ne donne pas cet accès.* |
| Information complémentaire | **Oui** — voir §3 |

### Tarif 3 — `Spectateur`

Un seul billet public, valable les deux jours. La formule à la journée a été
abandonnée : elle compliquait le contrôle à l'entrée (deux couleurs de bracelet,
un billet d'un jour qui devient un pass week-end) pour cinq euros d'écart.

| Champ HelloAsso | Ce qu'on met |
|---|---|
| Nom du tarif | `Spectateur` |
| Type de tarif | Tarif payant, montant fixe |
| Montant | `10` € |
| Nombre de places | La capacité que la salle autorise — **demandez le chiffre à la mairie avant d'ouvrir la vente** |
| Description (237 car.) | *Accès aux zones ouvertes au public, samedi et dimanche. Aucun compte à créer, aucun code à saisir : tu viens, tu regardes. Ne donne pas accès à la zone joueurs. Gratuit pour les moins de 12 ans accompagnés d'un adulte muni de son billet.* |
| Information complémentaire | Non |

---

**Reste à trancher : la gratuité des moins de 12 ans.** Soit un tarif à 0 € (ils
apparaissent alors dans les effectifs, ce qui compte pour la capacité de la
salle), soit rien du tout et on les laisse entrer à l'accueil. Le site annonce
déjà la gratuité sur la page spectateurs : les deux tiennent, mais il faut en
choisir une.

## 2 bis. La location de PC — une boutique, pas un tarif

La précédente LAN a vendu les locations dans une **boutique** HelloAsso
(« Location PC Joueur Springs League Séries #2 », 9 locations, 735 €), avec un
produit par matériel : PC fixe, PC portable, écran seul. C'est le bon outil —
une boutique gère des produits avec photo, description détaillée et stock par
référence, ce qu'un tarif de billetterie ne sait pas faire.

On repart donc sur une boutique, à créer quand Page 404 aura confirmé le parc.
Prix de la LAN précédente, à titre de repère : PC fixe 90 €, PC portable 60 €,
écran 15 €, pour le week-end.

**Ajoutez-y le champ `Code d'inscription`, obligatoire**, exactement comme sur
les tarifs de la billetterie : c'est ce qui permet de savoir quel joueur a
réservé quelle machine, et de le faire figurer sur sa fiche.

Descriptions des produits, sous la limite des 250 caractères :

**Location PC fixe** (220 car.)
> Poste complet pour le week-end : tour, écran 24 pouces 144 Hz, clavier,
> souris, câble RJ45 de 10 m et multiprise. Casque non fourni. Reporte ton code
> d'inscription, disponible sur aedral.com/mania-cup. Stock très limité.

**Location PC portable** (222 car.)
> Ordinateur portable 15,6 pouces 144 Hz pour le week-end, avec câble RJ45 de
> 10 m et multiprise. Casque, clavier et souris non fournis. Reporte ton code
> d'inscription, disponible sur aedral.com/mania-cup. Stock très limité.

**Location écran** (154 car.)
> Écran 24 pouces 144 Hz pour le week-end, si tu viens avec ta tour. Reporte ton
> code d'inscription, disponible sur aedral.com/mania-cup. Stock très limité.

> **Une location n'est jamais une inscription.** Le site la note sur le dossier
> du joueur sans toucher à son statut : quelqu'un peut réserver un poste et ne
> jamais régler ses 30 €.

> **Fermez la boutique plus tôt que la billetterie** — une à deux semaines
> avant — le temps de réunir les machines.

## 3. Le champ « code d'inscription » — le point critique

C'est **la** chose à ne pas rater : sans ce champ, aucun paiement ne se rattache
tout seul, et il faut retrouver chaque joueur à la main.

Sur HelloAsso, une information personnalisée s'attache **à un tarif**, pas au
formulaire entier. C'est ce qui permet de ne la demander qu'à ceux qui en ont un
— un spectateur ne doit jamais se voir réclamer un code qu'il n'a pas.

**Où c'est dans l'interface** : à la création ou à l'édition d'un tarif, section
*Informations complémentaires* (parfois *Questions personnalisées* selon la
version) → **Ajouter une information**.

Pour chacun des trois tarifs concernés :

| Tarif | Libellé du champ | Type | Obligatoire |
|---|---|---|---|
| `Joueur` | `Code d'inscription` | Texte court | **Oui** |
| `Accompagnant` | `Code d'inscription du joueur accompagné` | Texte court | **Oui** |

Et, dans la **boutique** de location, le même champ `Code d'inscription` sur
chaque produit.

Textes d'aide à mettre sous le champ :

- Joueur et produits de location : *Le code affiché sur ton espace
  d'inscription, au format LAN-XXXX.*
- Accompagnant : *Le joueur que tu accompagnes te le communique depuis son
  espace d'inscription. Format LAN-XXXX.*

**Cochez « obligatoire » dans les trois cas.** Sans ça, on recevra des paiements
impossibles à rattacher.

Le site est tolérant sur la saisie : `lan 4b2c`, `LAN4B2C` ou `4b2c` sont tous
compris comme `LAN-4B2C`. En revanche il refuse de deviner quand le code est
vraiment faux — le paiement part alors dans une file de rattachement où vous
tranchez en un clic, avec les dossiers voisins proposés.

## 4. Pourquoi c'est important

- **Un billet spectateur ne doit jamais valider une inscription joueur.** Le
  webhook regardera quel tarif a été acheté, pas seulement qu'un paiement est
  arrivé. D'où des noms de tarifs distincts et stables.
- **La location de poste ne vaut pas paiement de l'inscription.** Un joueur peut
  la réserver plus tard, séparément : elle se rattache à son dossier sans
  toucher à son statut.
- **L'accompagnant a accès à la zone de jeu**, contrairement à un spectateur.
  C'est pour ça qu'il doit être rattaché à un joueur identifié.

## 5. Politique de remboursement

Le règlement publié sur le site annonce : remboursement intégral jusqu'à **14
jours avant** l'événement (soit le 19 septembre 2026 inclus), puis plus rien.
Alignez le texte HelloAsso dessus, sinon les deux se contrediront.

## 6. Une fois la billetterie créée

1. Copier les **liens** (billetterie, et la boutique de location quand elle
   existera) et les coller dans `aedral.com/admin/mania-cup` → onglet
   **Configuration** → *Tarifs et billetterie*. Les boutons de paiement du site
   s'activent aussitôt.
2. Créer les **clés d'API** : *Mon Compte → Intégrations et API*. Elles donnent
   un `clientId` et un `clientSecret`, à mettre dans Vercel (voir §7).
3. Déclarer l'**URL de notification** au même endroit. Sans elle, les paiements
   n'arrivent pas tout seuls sur le site.

## 7. Ce que le serveur attend (variables Vercel)

Tant que ces variables manquent, la console affiche « billetterie non
connectée » et les règlements se confirment à la main. Rien ne casse, mais rien
n'est automatique.

| Variable | Où la trouver |
|---|---|
| `HELLOASSO_CLIENT_ID` | Mon Compte → Intégrations et API |
| `HELLOASSO_CLIENT_SECRET` | idem — à marquer **Sensitive** dans Vercel |
| `HELLOASSO_ORG_SLUG` | dans l'URL de l'association : `helloasso.com/associations/⟨ici⟩` |
| `HELLOASSO_FORM_SLUG` | dans l'URL du formulaire : `…/evenements/⟨ici⟩` |
| `HELLOASSO_WEBHOOK_SECRET` | **à inventer** : une longue chaîne au hasard, connue de vous seul |
| `HELLOASSO_ALLOWED_IPS` | *facultatif* — `51.138.206.200` en production |

**L'adresse à déclarer chez HelloAsso** est alors :

```
https://aedral.com/api/mania-cup/webhook/⟨HELLOASSO_WEBHOOK_SECRET⟩
```

Ce secret dans l'adresse n'est pas une coquetterie. HelloAsso ne signe pas les
notifications envoyées aux comptes associatifs — c'est réservé à ses partenaires
commerciaux. Sans ce segment, n'importe qui connaissant l'adresse pourrait nous
annoncer un faux paiement. Le site ne croit d'ailleurs jamais ce qu'il reçoit :
il rappelle HelloAsso avec les clés pour lire la vraie commande. Le secret
évite simplement qu'on nous fasse faire ce travail à tort.

## 8. La correspondance des tarifs

Une fois les tarifs créés, allez dans la console → **Configuration** → *Tarifs et
billetterie*. Le bouton **« Lire les tarifs depuis HelloAsso »** affiche les
tarifs réels du formulaire ; associez chacun à sa catégorie :

`player` · `companion` · `spectator_day` · `spectator_2days` · `pc_rental`

C'est ce qui permet au site de savoir qu'un billet à 30 € confirme une place,
alors qu'un billet à 20 € rattache un accompagnant et qu'une location de poste
ne vaut **jamais** règlement de l'inscription.

La correspondance se fait sur l'**identifiant** du tarif, pas sur son nom :
renommer un tarif après coup ne casse donc rien.

## 9. Ce qui reste après

- La bascule **`MANIA_CUP_PUBLIC=true`** sur Vercel, qui rend l'événement public
  et ouvre les inscriptions. Tant qu'elle est absente, la page est masquée des
  moteurs de recherche et personne d'autre que les admins ne peut s'inscrire.
- **Un vrai paiement de test à 30 €**, une fois tout branché : c'est le seul
  moyen de vérifier que le code d'inscription remonte bien, et de relever au
  passage le montant de contribution volontaire proposé par défaut.
- Le **règlement** à publier : texte prêt dans
  [reglement-mania-cup.md](reglement-mania-cup.md), trois blancs à combler.

## 10. Le jour J

Dans la console, onglet **Inscriptions** :

- **Liste d'émargement** — export à imprimer, trié par nom, avec ce qu'il faut
  savoir même si le réseau tombe : réglé ou non, mineur, autorisation parentale,
  accompagnant, poste loué, emplacement, refus de droit à l'image, contact
  d'urgence.
- **Badges** — planche à imprimer, 9 par page A4, une couleur par catégorie.
  Un badge n'est édité que pour un billet réglé. Attribuez les emplacements
  avant d'imprimer : ils y figurent.

Le contrôle des billets à l'entrée se fait avec l'application **HelloAsso Scan**,
qui lit les QR codes hors ligne. À installer et **synchroniser la veille au
soir**, pas sur le parking le samedi matin.
