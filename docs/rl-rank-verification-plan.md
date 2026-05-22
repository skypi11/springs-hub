# Identité RL vérifiée & rang anti-mensonge — plan

> Dernière mise à jour : 2026-05-22

Plan de référence pour la feature « rang Rocket League vérifiable » sur Aedral.
Lu et validé avec Matt avant démarrage.

## Pourquoi (à lire avant de toucher au code)

Aucune source automatique de rang RL ne fonctionne :

- **tracker.gg** — API fermée, plus de clés délivrées.
- **ballchasing auto-rang** — tué par l'EAC (le plugin BakkesMod ne s'injecte
  plus en partie en ligne, donc plus de rang attaché aux uploads). Vérifié sur
  des replays de 2026-05 : 0/8 joueurs avec un `rank` sur des matchs récents.
- **Toute API tierce (RapidAPI, etc.)** — reverse-engineering fragile,
  contre les CGU Psyonix, casse aux patches. L'API d'AngaBlue testée le
  2026-05-22 renvoie 502 sur tous les endpoints — abandonnée.
- **Sign in with Epic Games (OAuth)** — soumis à une « Brand Review » d'Epic,
  inutilisable hors de notre organisation tant que la revue n'est pas passée.
  → on ne le construit pas.

→ **La voie retenue** : utiliser ce qu'on a déjà gratuitement — la connexion
Epic Discord (déjà vérifiée par Discord, ID 32-hex permanent, déjà fetchée et
stockée dans `user.discordConnections[]`). Combiné à un système « rang déclaré
+ lien tracker auto-généré + collant + signalement » qui couvre le reste.

Voir aussi la mémoire `project_rl_rank_strategy.md`.

## Le smurf : ce qu'on fait, ce qu'on ne fait pas

**Ne pas confondre deux problèmes** :

- **Mentir sur son rang** (« je suis Champion » alors qu'on est GC). → réglé
  par le lien tracker public : la vérité est à un clic, pour tout le monde, en
  permanence.
- **Smurfer** (un bon joueur sur un *vrai* compte bas). → **aucun outil
  technique ne le bloque à 100 %**. Le smurf a un rang authentiquement bas que
  n'importe quelle API confirmerait. On le **décourage** et on le **détecte
  humainement** (signalement + jugement staff + le fait que le compte lié est
  cloué publiquement à son profil pour toujours).

À ne **jamais** annoncer comme « anti-smurf garanti ». C'est de la dissuasion +
de la transparence, pas un mur.

## Architecture

### Source de l'identité Epic

Discord a déjà fait le travail : à chaque login Discord, Aedral fetch
`/users/@me/connections` et stocke chaque connexion avec `{type, id, name,
verified}`. Pour le type `epicgames` :

- `id` = **ID de compte Epic permanent** (32 caractères hex, ex. `ec1ab5d08131431794f74a98c891b86d`).
- `verified` = `true` quand Discord a vérifié la liaison.

Au 2026-05-22 : 20/47 joueurs Aedral ont déjà un `epicgames` lié à Discord,
tous `verified=true`, tous au format 32-hex valide. Donc on a **déjà** la
matière première pour ~43 % des profils, sans rien construire.

### Snapshot dans un champ à nous (le « collant »)

On ne s'appuie pas sur la connexion Discord en *live*, parce que le joueur peut
la changer côté Discord quand il veut. On **recopie** l'ID Epic dans un champ
Aedral à nous au moment de la confirmation. Cette copie devient la **référence
officielle**. Elle ne bouge plus toute seule.

→ Si le joueur change ensuite sa connexion Epic sur Discord : notre référence
ne bouge pas (informatif uniquement, ça peut générer un signal divergence pour
l'admin).
→ Pour la changer officiellement : **demande admin**.

### Le rang

- **Déclaré** par le joueur (sélecteur des rangs RL officiels).
- Affiché à côté du **lien tracker auto-généré** depuis l'ID officiel.
- Anyone clique le lien → voit le rang réel actuel du compte. Vérification
  continue, publique, par yeux humains. Pas d'appel API automatique.
- **Modifier son rang → revalidation** (badge éventuel retiré, re-signalable).

### Règle stricte d'affichage

**Pas de rang sans compte RL lié.** Un rang sans preuve ne vaut rien. Donc le
champ « rang » n'est exposable que si un compte officiel est posé.

**Affichage contextuel** (revu 2026-05-23 — Matt veut un signal de confiance
public, mais sans stigmatiser les joueurs Trackmania-only) :

| Contexte | Affichage public |
|---|---|
| Joue à RL (jeu coché ou présent dans une équipe RL) **+ compte lié** | ✓ Compte de jeu vérifié *(badge discret, doré)* + pseudo Epic + rang + lien tracker cliquable |
| Joue à RL **+ aucun compte lié** | ⚠️ **Compte de jeu non lié** *(visible — gage de méfiance pour les recruteurs)*, rang non affichable |
| Ne joue pas à RL | Pas de section RL du tout — c'est légitime |

Détecter « joue à RL » = `games` contient `rocket_league` OU le user est dans
une équipe RL (membre d'une `sub_team` `game=rocket_league`). À implémenter en
Lot 4.

## Synchronisation automatique nocturne

Le `rlEpicName` (pseudo Epic affiché + utilisé pour construire l'URL tracker —
vérifié : tracker.gg n'accepte PAS l'ID 32-hex pour Epic, seul le pseudo
fonctionne) peut vieillir si le joueur renomme son compte Epic. Comme la
plupart des joueurs restent « connectés en permanence » via Firebase et ne
re-passent jamais par l'OAuth Discord de leur propre initiative, on doit
rafraîchir nous-mêmes, automatiquement.

**Mécanisme** : on stocke le **`discordRefreshToken`** au moment du callback
OAuth (aujourd'hui jeté à la ligne 48 de `/api/auth/discord/callback`). Avec
lui, le serveur peut redemander à Discord un nouvel `access_token` à tout
moment, sans intervention du joueur, puis re-fetcher ses connexions.

**Passe nocturne** : greffée sur le cron existant `/api/cron/expire-invitations`
(3 h du matin) — pas de nouveau cron car Vercel Hobby plafonne à 2 et on est
au max. Pour chaque user :

1. `syncDiscordMember(db, uid)` — met à jour le pseudo serveur `[TAG] Pseudo`
   et les 7 rôles fonction. **Tourne pour TOUT LE MONDE**, utilise le token du
   bot (pas de refresh_token nécessaire). Règle au passage le souci historique
   de rôles/pseudos serveur qui ne se mettaient à jour qu'à la reconnexion.
2. Si `discordRefreshToken` présent : refresh de l'access_token → re-fetch des
   connexions Discord → si la connexion `epicgames` a un nouveau pseudo, on
   met à jour `rlEpicName` (jamais `rlEpicId`, qui reste figé).

**Coût** : zéro. Firestore + API Discord + Vercel functions dans les quotas
gratuits, pas de nouveau cron.

**Cas où la connexion Epic a disparu** du Discord du joueur : on log, on
n'écrase pas `rlEpicId` (l'identité officielle reste figée), et on affiche une
**bannière** sur son profil + ses réglages :
*« On ne retrouve plus ton compte Epic sur ton Discord — relie-le pour qu'on
puisse rafraîchir ton pseudo. »* + lien direct vers Paramètres Discord →
Connexions. Signal discret aussi côté admin.

## Migration des users existants

Les 47 joueurs actuels n'ont **pas** de `discordRefreshToken` stocké (le
callback OAuth les jetait). Pour que la passe nocturne refresh leur pseudo
Epic, il faut qu'ils repassent une fois par l'OAuth Discord.

**Solution retenue** : nouveau bouton admin **« Forcer la déco de tout le
monde »** (`/admin/users`) — appelle `revokeRefreshTokens` Firebase pour tous
les users en batch. À leur prochaine visite, ils sont déloggés et doivent
recliquer « Connecter avec Discord » → on capture leur refresh_token au
passage. Aucune donnée perdue (juste leur session Firebase invalidée). Le clic
fait ~10 secondes côté joueur.

Précautions du bouton :
- Double confirmation type *« tape FORCER pour confirmer »*.
- L'admin sera aussi délogé — pas un drame, mais à signaler.
- Action journalisée pour chaque user touché (`admin_audit_logs`).

Bonus de la même page : un bouton **« Sync Discord (tous) »** — déclenche
`syncDiscordMember` pour tous les users à la demande, en complément du cron
nocturne. Outil admin réutilisable.

## Modèle de données

Champs à ajouter / clarifier sur `users/{uid}` :

```
rlEpicId:           string    // ID Epic permanent — la RÉFÉRENCE officielle figée
rlEpicName:         string    // pseudo Epic — rafraîchi par la passe nocturne
rlEpicLinkedAt:     Timestamp
rlEpicLinkSource:   'discord' | 'admin'   // d'où vient le snapshot
discordRefreshToken:string    // SERVER-ONLY (allow read: false) — sert au cron
                              // pour rafraîchir les connexions Discord sans
                              // intervention du joueur
```

Legacy à déprécier (rester compat le temps de migrer) :
- `epicAccountId` / `epicDisplayName` — ex-résolu via tracker.gg, jamais
  rempli pour les vrais joueurs (clé tracker absente).
- `rlPlatform` / `rlPlatformId` — utilisés par `lib/rl-platform.ts` pour
  construire les URLs tracker/ballchasing. À évaluer en Lot 1 : soit on bascule
  ces deux champs sur la sémantique « officielle figée », soit on les laisse
  comme champs auto-dérivés (informatifs) et `rlEpicId` est la nouvelle
  référence officielle. Décision finale dans le commit du Lot 1.

Steam — la liaison Steam OpenID existe déjà (`steamLinked.steamId64`) et reste
inchangée. Elle peut aussi servir d'identité officielle pour le tracker, mais
côté RL post-F2P, le compte Epic est la vraie carte d'identité ; Steam est plus
une commodité.

## Flows utilisateurs

### 1. Premier lien (création de profil / section RL)

- Si une connexion Epic `verified=true` est vue sur Discord :
  → *« On voit ce compte Epic sur ton Discord : `<pseudo>`. C'est ton compte
  Rocket League principal ? »*
  → [Confirmer] : snapshot, `rlEpicId` posé.
  → [Ce n'est pas mon compte principal] : consigne d'aller lier le bon
  compte sur Discord + bouton « Resynchroniser mon Discord » (existe déjà).
- Si pas d'`epicgames` sur Discord : même consigne (« Connecte ton compte Epic
  à Discord pour pouvoir afficher ton rang »).

### 2. Changement plus tard

- **Premier lien : libre.**
- **Tout changement ensuite : demande admin** (collection `rl_link_change_requests` ou similaire).
- Optionnel : **fenêtre 48 h** juste après le premier snapshot où l'auto-correction reste libre, pour gérer une erreur honnête. À confirmer en Lot 2.

### 3. Demande de changement (Lot 6)

Le joueur clique « Demander un changement de compte ». Form : nouveau compte
Epic (via une nouvelle connexion Discord vérifiée) + raison.
L'admin voit :
- Ancien compte + rang affiché côté tracker.
- Nouveau compte + rang.
- Raison.
- → approuve / refuse, tout journalisé (`admin_audit_logs`).

Un swap d'un compte haut vers un compte bas = drapeau rouge immédiat.

### 4. Signalement (Lot 5)

Bouton « Signaler ce rang » sur la fiche d'un joueur → notif admin → l'admin
clique le tracker → tranche.

### 5. Détection de divergence (Lot 6, bonus)

Si la connexion Epic actuelle sur Discord ≠ `rlEpicId` officiel → petit signal
côté admin. Pas accusatoire (raisons légitimes existent) — juste « à regarder ».
Limité : ne se déclenche que quand le joueur re-sync Discord, donc radar
faible. Assumé.

## Découpage en lots

| Lot | Contenu | Taille |
|---|---|---|
| **1** | Socle données : nouveaux champs, helpers, décision finale legacy `rlPlatform`. | Petit |
| **2** | UI : section « Compte RL » du profil — flow de confirmation, règle collante (+ fenêtre 48 h ou pas) + stockage `discordRefreshToken` au callback OAuth + cron nocturne de refresh greffé sur `expire-invitations` + bouton admin **« Forcer la déco de tous »** (migration des 47 users existants) + bouton admin **« Sync Discord (tous) »** + bannière « Epic disparu de Discord » sur les profils concernés. | Moyen-gros |
| **3** | Rang via sélecteur propre + lien tracker auto-généré côté affichage. Réutiliser `lib/rl-platform.ts`. | Petit-moyen |
| **4** | Fiche joueur : afficher pseudo Epic + rang + lien tracker. Règle d'affichage contextuel : ✓ doré si lié, ⚠️ visible si joueur RL sans compte, rien si non-RL. | Petit-moyen |
| **5** | Bouton signaler + collection + vue admin des signalements. | Moyen |
| **6** | Demande de changement de compte Epic : flow joueur, vue admin, journalisation, détection divergence. | Moyen |
| **7** | Règles Firestore pour les nouvelles collections + finitions. | Petit |

**Lots 1→4 = le cœur** (rang vérifiable, ça sert direct au recrutement).
**Lots 5→6 = la couche de police.**
Modulaire : on shippe lot par lot, chacun observable sur prod par Matt.

## Hors périmètre (différé)

- **Blocage à l'inscription en compétition** sur la base du rang vérifié : ça
  vit avec la Phase 3 (compétitions natives Aedral, pas commencée).
- **Badge `✓ vérifié staff`** : non nécessaire au départ — le lien tracker
  public assure une « vérification continue ». Peut s'ajouter plus tard si
  besoin de polish.
- **Radar comportemental via stats de replay** (croisement rang déclaré vs
  performance en scrim) : nécessiterait une intégration ballchasing stats à
  grande échelle + une baseline de stats par rang. Ni l'un ni l'autre n'est
  réaliste aujourd'hui (quota ballchasing free à 10 uploads/jour, et zéro
  baseline). Pas avant que ça ait du sens.
- **Sign in with Epic Games** (OAuth Epic) : non requis tant que la voie
  Discord-connection couvre les besoins. À ressortir uniquement si on rencontre
  un cas réel où elle ne suffit pas, ET qu'on accepte le coût de la Brand
  Review Epic.
