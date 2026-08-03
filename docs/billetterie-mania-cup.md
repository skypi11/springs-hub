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

1. Copier les **trois liens** (joueur, spectateurs, accompagnant) et les coller
   dans `aedral.com/admin/mania-cup` → onglet **Configuration** → *Tarifs et
   billetterie*. Tous les boutons de paiement du site s'activent aussitôt.
2. Envoyer à Claude une **capture des tarifs créés**, pour écrire la
   correspondance exacte du webhook plutôt que de la deviner.
3. Vérifier que les **notifications webhook** sont activables :
   *Mon Compte → Intégrations et API*. C'est là que se déclarera l'URL qui
   validera les inscriptions automatiquement.

## 7. Ce qui reste après

- Le **webhook** (`/api/mania-cup/webhook`, à écrire) : il validera les
  inscriptions dès réception du paiement, en distinguant les tarifs.
- La bascule **`MANIA_CUP_PUBLIC=true`** sur Vercel, qui rend l'événement public
  et ouvre les inscriptions. Tant qu'elle est absente, la page est masquée des
  moteurs de recherche et personne d'autre que les admins ne peut s'inscrire.
