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

## 2. Les cinq tarifs

Créez-les avec **exactement ces noms**. Le webhook les reconnaîtra par leur
libellé : un tarif renommé plus tard cesserait d'être reconnu, et les
inscriptions ne se valideraient plus — **silencieusement**, c'est le pire cas.

| Nom du tarif | Prix | Quota | Code d'inscription demandé |
|---|---|---|---|
| `Joueur` | 30 € | 64 | **Oui, obligatoire** |
| `Accompagnant` | 20 € | — | **Oui, obligatoire** (celui du joueur accompagné) |
| `Spectateur 1 jour` | 10 € | capacité salle | Non |
| `Spectateur 2 jours` | 15 € | capacité salle | Non |
| `Location PC` | **à définir** | nb de postes | **Oui, obligatoire** |

**Deux prix manquent encore** : celui de la location de poste, et la façon de
gérer la gratuité des moins de 12 ans — soit un tarif à 0 €, soit rien du tout
et on les compte à l'entrée. À trancher entre vous.

## 3. Le champ « code d'inscription » — le point critique

Sur HelloAsso, une information personnalisée s'attache **à un tarif**, pas au
formulaire entier. C'est ce qui permet de ne la demander qu'à ceux qui en ont un.

Pour chacun des trois tarifs concernés :

- **Joueur** et **Location PC** — libellé : `Code d'inscription`
  Texte d'aide : *Le code affiché sur ton espace d'inscription, au format LAN-XXXX.*
- **Accompagnant** — libellé : `Code d'inscription du joueur accompagné`
  Texte d'aide : *Le joueur que tu accompagnes te le communique depuis son espace.*

Cochez **« information obligatoire »** dans les trois cas. Sans ça, on recevra
des paiements impossibles à rattacher, et il faudra les traiter à la main.

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

1. Copier les **quatre liens** (joueur, spectateurs, accompagnant, location de
   poste) et les coller dans `aedral.com/admin/mania-cup` → onglet
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
