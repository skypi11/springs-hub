# Springs Hub — Plateforme communautaire esport (projet personnel)

## Contexte général
Plateforme communautaire esport **propriété personnelle de l'utilisateur** (Matt). Pas une émanation d'une asso. Le site est ouvert à toute structure / joueur de l'écosystème esport amateur, indépendamment de Springs E-Sport.

**Springs E-Sport = partenaire privilégié.** L'utilisateur est Directeur Général de Springs E-Sport (asso événementielle esport), et Springs reste le partenaire de référence du site (premier seed d'utilisateurs, événements officiels Springs hébergés sur la plateforme, branding partagé). Mais le site n'appartient pas à l'asso et sa roadmap est pilotée par l'utilisateur seul.

**Rebrand AEDRAL — appliqué côté user-facing (2026-04-25/26)** : domaine `aedral.com` live, logo Æ ligature, DA refresh (violet → or, violet réservé aux activités Springs E-Sport partenaires), migration textuelle Springs Hub → Aedral, mentions légales en nom propre Matt Molines, auth Discord/Firebase/Google Cloud configurée pour `aedral.com`. **Le nommage technique reste "springs-hub"** (repo GitHub, variables CSS `--s-*`, projet Vercel, env vars) — la migration technique est différée pour éviter le risque sans bénéfice utilisateur. Ne pas renommer le code sans demande explicite. Voir mémoire `project_ownership_and_business_model.md` pour le plan complet.

### Vision long terme — modèle économique
À horizon 2-3 ans (an 1 = adoption gratuite, an 2+ = intro premium si traction), le site est destiné à devenir **freemium par abonnement** :
- **Couche gratuite préservée** : profil joueur, rejoindre une structure, calendrier basique, recrutement de base, annuaire public, dispos. Tout ce qui est nécessaire au network effect reste gratuit pour toujours.
- **Couche premium par abonnement** : ciblera les structures (pas les joueurs individuels) — branding custom, boutons interactifs Discord, analytics avancées, automations, hosting tournois white-label, multi-admins granulaires, stockage R2 boosté.
- **Pas de monétisation immédiate.** Toute proposition de paywall maintenant est prématurée et tue l'adoption. Ne shipper aucun mécanisme Stripe / paywall sans que l'utilisateur le demande explicitement et que la traction utilisateur le justifie.

**L'utilisateur n'est pas développeur.** Claude fait tout le code et les pushs. Il vérifie uniquement sur Vercel.

### Relation avec le site actuel Springs E-Sport
- Le site actuel (`C:\Users\mattm\site cup monthly` / `springs-esport.vercel.app`) reste intact, c'est l'ancien site de Springs E-Sport. Le Hub le remplace progressivement comme point d'entrée principal pour la communauté Springs.
- Les pages RL et TM actuelles deviennent des archives accessibles en lien.
- **Ne jamais modifier le repo `site cup monthly`** depuis ce projet — **seule exception automatique** : sync de `firestore.rules` (voir "Règles Firestore" plus bas), car le fichier est partagé avec le Hub sur le même projet Firebase. Toute autre modification du vieux site nécessite une autorisation explicite de l'utilisateur au cas par cas.

---

## Stack technique

- **Framework** : Next.js (App Router)
- **Styling** : Tailwind CSS
- **Base de données** : Firebase Firestore (projet existant `monthly-cup`)
- **Auth** : Firebase Auth — Discord OAuth pour **tout le monde** (joueurs, fans ET admins ; scope `identify connections`) + Steam OpenID (liaison RL optionnelle). Pas de connexion Google sur Aedral — un admin est un utilisateur Discord normal dont l'UID figure dans `aedral_admins`.
- **Hébergement** : Vercel — domaine prod `aedral.com`, fallback `springs-hub.vercel.app`
- **Repo GitHub** : `skypi11/springs-hub` (nommage technique conservé malgré le rebrand)
- **Domaine** : `aedral.com` (acquis via Vercel, $11/an, live depuis 2026-04-26)
- **Polices** : Outfit (corps) + Bebas Neue (titres display, via `font-display` CSS)

### Firebase config (projet existant `monthly-cup`)
- UID Discord : `discord_SNOWFLAKE`
- UID Admin : compte Discord (`discord_SNOWFLAKE`) dont l'UID est listé dans `aedral_admins` (voir plus bas)
- `experimentalAutoDetectLongPolling: true` sur Firestore (WebSocket + fallback long-polling)

### Règles Firestore — workflow important
Les deux repos (`springs-hub` et `site cup monthly`) partagent **le même projet Firebase** `monthly-cup`. Il n'y a donc **qu'un seul fichier `firestore.rules` réellement déployé** sur Firebase, même si chaque repo en contient une copie.

- **Source de vérité** : `c:\Users\mattm\springs-hub\firestore.rules` — toute modification commence ici.
- **Copie synchronisée** : `c:\Users\mattm\site cup monthly\firestore.rules` — doit être identique.
- **Déploiement** : `firebase deploy --only firestore:rules` depuis le Hub (`firebase.json` + `.firebaserc` y sont présents).
- **Ne jamais déployer depuis le vieux site** pour éviter d'écraser avec une copie désynchronisée.

**Workflow automatique à suivre quand on touche aux règles :**
1. Modifier `firestore.rules` dans le Hub.
2. Copier le fichier dans le vieux site (`cp` du même contenu).
3. Committer les deux repos séparément.
4. Lancer `firebase deploy --only firestore:rules` depuis le Hub.
5. Confirmer à l'utilisateur que les règles sont live sur Firebase.

Cette exception est la **seule** raison légitime de toucher au repo vieux site depuis ce projet.

### Variables d'environnement OAuth/API
- `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` : OAuth app Discord (login user via "Se connecter avec Discord"), scope `identify connections`
- `DISCORD_BOT_CLIENT_ID` + `DISCORD_BOT_CLIENT_SECRET` + `DISCORD_BOT_TOKEN` : bot Aedral (install dans Discord des structures + envoi des messages events/todos/recrutement)
- `STEAM_WEB_API_KEY` (optionnel) : enrichissement pseudo/avatar pour les users qui lient Steam via OpenID. Gratuit à demander sur `https://steamcommunity.com/dev/apikey` (1 min). Sans cette clé, le linkage Steam fonctionne quand même mais on stocke uniquement le SteamID64 (pas le pseudo ni l'avatar Steam).

### Discord Developer Portal — 2 apps distinctes
Matt a **2 apps** dans son compte Discord Developer Portal :
1. **Aedral** (id `1495127667203113072`) — **app utilisée par aedral.com** (OAuth login + bot). Les 4 vars Vercel (`DISCORD_CLIENT_ID/SECRET` ET `DISCORD_BOT_CLIENT_ID/SECRET`) pointent toutes sur cette app depuis la migration 31/05.
2. **SPRINGS MONTHLY** — ancienne app, utilisée par le vieux site `springs-esport.vercel.app` (TM Monthly Cup / RL Cup archivé). À **ne pas supprimer** : continue de gérer l'OAuth du vieux site qui partage le projet Firebase `monthly-cup`.

**Important si tu reset le Client Secret de l'app Aedral** : il faut update les 2 vars secrets Vercel ensemble (`DISCORD_CLIENT_SECRET` ET `DISCORD_BOT_CLIENT_SECRET`), sinon soit l'OAuth login casse, soit le bot casse. Le `DISCORD_BOT_TOKEN` est distinct (token bot, pas client secret) → pas affecté par un reset secret.

### Comptes liés (Discord connections + Steam OpenID)
Voir [lib/discord-connections.ts](lib/discord-connections.ts) et [lib/steam-openid.ts](lib/steam-openid.ts).

- **Discord connections** : récupéré au login via le scope `connections`. Pull 15+ types (Epic, Steam, PSN, Xbox, Nintendo, Twitch, YouTube, Spotify, X, TikTok, Instagram, GitHub, Reddit, Battle.net, Riot, etc.). Stocké dans `user.discordConnections[]` avec toggle `visibleOnProfile` par compte. Settings → Comptes liés.
- **Steam OpenID** : flow direct (POST `/api/auth/steam/start` → redirect Steam → `/api/auth/steam/callback`). Récupère le SteamID64 immuable → blinde le lien tracker.gg contre les changements de pseudo. Stocké dans `user.steamLinked`. Bouton dans Settings → Jeux → Config Rocket League.

### Auth Discord — flow déployé et fonctionnel
1. Client → `signInWithDiscord()` → redirect Discord OAuth
2. Discord → `/api/auth/discord/callback` (serveur)
3. Serveur : échange code → token Discord → infos utilisateur
4. Serveur : `createUser`/`updateUser` Firebase Auth (displayName + photoURL)
5. Serveur : `set`/`update` Firestore collection `users` (Admin SDK, bypass rules)
6. Serveur : `createCustomToken` → posé dans un cookie httpOnly `aedral_auth` → redirect `/?auth=1` (le token ne transite plus par l'URL)
7. Client : `GET /api/auth/discord/session` consomme le cookie (usage unique) → `signInWithCustomToken` → `onAuthStateChanged` → affichage immédiat depuis `fbUser`
8. Client : Firestore enrichit le profil en arrière-plan (bio, games, etc.)
- **Refresh** : fonctionne — `fbUser.displayName`/`photoURL` disponibles depuis localStorage sans Firestore

---

## Design system — Direction artistique Aedral

### Identité visuelle — origine
L'identité visuelle vient des **overlays de stream** Springs E-Sport (héritage historique) :
- **Texture hexagonale** en fond (pas décorative, en TEXTURE subtile sur tout le contenu via `.hex-bg`)
- **Biseaux/coins coupés** (clip-path polygon) — signature, pas de coins arrondis
- Dark gaming premium mono noir+or — "le soin du détail qui fait la différence entre un pro et un amateur"

### Références visuelles
Faceit, Battlefy, Linear, Vercel — dark premium avec hex + biseaux propre à Aedral.

### Fichier central : `app/design-system.css`
Tout le système de design est centralisé ici. **Toujours utiliser les classes et tokens existants** avant de créer du CSS custom.

### Palette — tokens CSS (dans `:root`)
**Refresh 2026-04-26 : palette neutre noir** (les anciennes valeurs avaient un cast bleu/violet sur certains écrans, déplacé vers du noir pur pour cohérence avec la marque mono).
```css
/* Surfaces — noir neutre (R=G=B, pas de cast) */
--s-bg:         #0a0a0a     /* fond page */
--s-surface:    #111111     /* cards, panels, sidebar */
--s-elevated:   #1a1a1a     /* éléments surélevés, hover states */
--s-hover:      #1f1f1f     /* hover intense */

/* Brand — 4 couleurs */
--s-violet:       #7B2FBE   /* RÉSERVÉ aux contextes Springs E-Sport (partenaire) */
--s-violet-light: #a364d9   /* variante claire */
--s-gold:         #FFB800   /* rare et précieux — CTA principal, récompenses */
--s-blue:         #0081FF   /* Rocket League */
--s-green:        #00D936   /* Trackmania */

/* Texte */
--s-text:       #eaeaf0     /* principal */
--s-text-dim:   #7a7a95     /* secondaire */
--s-text-muted: #6a6a8a     /* tertiaire, labels discrets */

/* Bordures */
--s-border:     rgba(255,255,255,0.08)   /* NEUTRE — pas violet ! */
```

### Règles couleur STRICTES
- **Violet = système/navigation uniquement** : sidebar active, accent-top sur panels système, glows très subtils. PAS sur les cards de contenu, PAS partout
- **Or = rare et précieux** : bouton CTA principal, prix/récompenses, structures. Si l'or est partout il perd sa valeur
- **Bleu = Rocket League**, **Vert = Trackmania** : chaque jeu a sa couleur propre
- **Bordures des cards = toujours neutres** (`--s-border`, blanc 8% opacity), JAMAIS violet
- **Glows** : opacité max 0.07–0.12, TRÈS subtils. Au hover on peut monter à 0.12 max

### Typographie
- **Bebas Neue** (`font-display`, `t-display`, `t-heading`) : tous les titres, en uppercase
- **Outfit** (`font-sans`) : tout le texte courant
- Classes : `t-display` (hero), `t-heading` (28px), `t-sub` (14px bold), `t-body` (14px), `t-label` (10px uppercase tracking), `t-mono` (12px tabular)

### Composants clés (classes CSS)

#### Layout
- **Sidebar fixe** 260px à gauche, contenu `ml-[260px]` pleine largeur
- **Fond hex** : classe `hex-bg` sur le wrapper contenu (SVG pattern fixe, opacity 0.045)
- **Espacement pages** : `px-8 py-8 space-y-10` sur le conteneur principal

#### Cards & panels
- `.panel` : card de base (surface + border neutre + radius 4px)
- `.bevel` / `.bevel-sm` : coins biseautés via clip-path (--bevel: 14px, --bevel-sm: 8px)
- `.pillar-card` : card enrichie avec hover (border blanche + bg elevated)
- `.comp-card` : card compétition avec image de fond (voir ci-dessous)
- `.panel-header` / `.panel-body` : structure interne des panels

#### Cards compétition (avec image)
Pattern validé — structure obligatoire :
1. `.comp-card` container (position relative, overflow hidden, bevel)
2. `.comp-card-bg` : image de fond (opacity 0.35, hover → 0.5 + scale 1.04)
3. `.comp-card-overlay` : gradient sombre (0.85 → 0.55)
4. Accent bar colorée en haut (3px, gradient de la couleur du jeu)
5. `.comp-card-content` : contenu par-dessus (z-index 1)
- **Les images de jeux sont dans `/public/`** (rocket-league.webp, tm.webp)

#### Grammaire des conteneurs — 3 niveaux (révisée 2026-06-12, audit anti-AI-slop)
L'ancienne règle « chaque card doit avoir accent bar + glow + icône encadrée »
a produit 97 cards identiques dans 42 fichiers — c'est elle qui faisait « site
généré ». La déco signale désormais l'IMPORTANCE, elle n'est plus un défaut :
- **Niveau 1 « héros »** (1-2 par écran MAX) : chrome complet — accent bar 3px,
  glow subtil (opacity 0.07-0.12), icône encadrée teintée, stat Bebas. Réservé à
  L'élément principal de la page (hero, card de mise en avant).
- **Niveau 2 « card »** (le défaut) : `.panel` nu — surface + border neutre +
  bevel. L'identité couleur passe par UN seul élément interne (GameTag, dot de
  statut, chiffre coloré). Pas d'accent bar, pas de glow, pas d'icon-box.
- **Niveau 3 « ligne »** : toute donnée répétitive (membres, demandes, résultats,
  annuaires) = rangée avec divider 1px, pas de card du tout.
- **Hover** (`border rgba(255,255,255,0.18)` + bg `--s-elevated`) : uniquement
  sur les éléments cliquables — jamais sur un formulaire ou un bloc statique.
Voir `.claude/skills/aedral-style/SKILL.md` pour les règles complètes (copy incluse).

#### Tags
`.tag` + variantes : `.tag-violet`, `.tag-gold`, `.tag-blue`, `.tag-green`, `.tag-neutral`
- 10px, uppercase, bold, avec border colorée

#### Boutons
`.btn-springs` + `.btn-primary` (or, texte noir) | `.btn-secondary` (transparent, border blanche) | `.btn-ghost`
- Toujours avec `.bevel-sm` pour les coins coupés

#### Séparateurs
`.divider` (1px, couleur --s-border)
`.section-label` : label de section avec barre violet à gauche + ligne horizontale

### Anti-patterns — NE PAS FAIRE
- **Violet partout** → "on dirait une grosse myrtille" — violet = navigation/système uniquement
- **Coins arrondis** (`rounded-lg`, `rounded-xl`) → utiliser les biseaux clip-path
- **Hexagones flottants / néons / formes décoratives** → la texture hex suffit, pas de déco
- **Fond trop uni sans texture** → toujours la texture hex via `.hex-bg`
- **Chrome décoratif systématique** → la card plate `.panel` est le DÉFAUT ; accent bar/glow/icon-box réservés au niveau « héros » (1-2 par écran). Voir « Grammaire des conteneurs » ci-dessus
- **Inline border + Tailwind hover** → Tailwind ne peut pas override un inline style, utiliser une classe CSS dédiée avec `!important`
- **Images en hotlink** depuis des sites de jeux (ils bloquent) → toujours `/public/`
- **Doublons d'information** → ne pas afficher la même stat à deux endroits

### Animations
- `animate-fade-in` : apparition douce (0.4s ease)
- `animate-fade-in-d1/d2/d3` : décalées de 0.1/0.2/0.3s pour effet cascade
- Transitions hover : `duration-150` à `duration-200`, jamais plus

### Logo
**Composant React** : `components/brand/AedralLogo.tsx` — **source de vérité unique** pour le logo sur le site.
- 2 variants : `horizontal` (mark + AEDRAL wordmark) | `mark` (symbole carré seul)
- 4 thèmes : `dark` | `light` | `mono-dark` | `mono-light`
- Usage : `<AedralLogo variant="horizontal" theme="dark" height={48} />`
- Affiché dans la sidebar via `components/layout/Sidebar.tsx`

**Fichiers SVG/WebP standalone** : `public/aedral/` — pour partages externes, Discord avatars, signatures email, presse.
- 4 marks (`mark.svg`, `mark-light.svg`, `mark-mono-dark.svg`, `mark-mono-light.svg`)
- 2 lockups horizontaux (`logo-horizontal.svg`, `logo-horizontal-light.svg`)
- 2 wordmarks (`wordmark.svg`, `wordmark-light.svg`)
- WebP générés automatiquement via `node scripts/svg-to-webp.mjs`
- Le wordmark "AEDRAL" est en paths Bebas Neue embedded (aucune dépendance font) — généré via `node scripts/bebas-to-svg-paths.mjs`

**Favicon + OG + Apple touch + PWA icons** :
- `app/icon.svg` — favicon principal (mark sur fond noir avec coins arrondis)
- `app/apple-icon.png` (180×180), `app/opengraph-image.png` (1200×630) — auto-routés par Next.js
- `public/icon-192.png`, `public/icon-512.png` — PWA, référencés dans `app/manifest.ts`
- Tous générés via `node scripts/generate-png-derivatives.mjs`

**Palette** : A en `#EAEAF0` (clair) ou `#08080F` (ink), E en `#FFB800` (or chaud) ou `#C8941D` (or foncé). Voir `public/aedral/README.md` pour la doc complète + anti-patterns.

### Fichiers clés
- `app/design-system.css` — **système de design complet** (tokens, composants, classes)
- `app/globals.css` — imports + theme Tailwind + animations
- `lib/firebase.ts` — init Firebase client (Firestore + Auth)
- `context/AuthContext.tsx` — auth global (Discord OAuth + état utilisateur)
- `app/api/auth/discord/callback/route.ts` — callback OAuth serveur (Admin SDK)
- `components/layout/Sidebar.tsx` — sidebar fixe avec nav + profil
- `firestore.rules` — règles Firestore complètes. Voir section "Règles Firestore" ci-dessous pour le workflow.

---

## Architecture des pages

```
/ (Accueil)
  → Visiteur (non-connecté) : LANDING full-bleed sans sidebar
    (composants/landing/VisitorLanding.tsx — Hero, sections Joueurs/Structures
    avec mockups CSS, Showcase 6 screenshots tiltés 3D, How-it-works, FAQ, CTA)
  → Connecté : Dashboard perso + compétitions + écosystème (sidebar standard)
  → Toggle géré par components/layout/LayoutShell.tsx selon path + auth

/community
  → /community/structures    Annuaire public des structures
  → /community/structure/[id] Page publique d'une structure
  → /community/players       Joueurs libres / recrutement
  → /community/my-structure  Dashboard fondateur (protégé)

/competitions
  → /competitions             Liste toutes les compétitions
  → /competitions/rl/[id]     Page d'une compétition RL
  → /competitions/tm/[id]     Page d'une compétition TM

/profile/[id]               Profil public d'un joueur
/settings                   Paramètres du compte (protégé)
/admin                      Panel admin Springs (protégé, admins only)
/guide                      Page publique de découverte des features (9 sections par pilier)
```

---

## Rôles utilisateurs

| Rôle | Comment l'obtenir | Ce qu'il peut faire |
|------|-------------------|---------------------|
| **Visiteur** | Aucune connexion | Voir comps, classements, profils publics structures |
| **Joueur** | Connexion Discord | Profil perso, rejoindre une structure, s'inscrire solo à une comp |
| **Fan** | Connexion Discord + activer mode fan | + prédictions, suivre équipes, notifications |
| **Coach** | Ajouté par fondateur | Créer événements calendrier, voir infos équipe |
| **Manager** | Ajouté par fondateur | Gérer roster, calendrier, invitations (si droits délégués) |
| **Fondateur** | Demande → entretien Springs → validation admin | Gérer sa structure complète, créer sous-équipes, inscrire aux comps |
| **Admin Aedral** | Connexion Discord + UID ajouté dans collection `aedral_admins` | Tout : valider structures, créer comps, override tout |

### Règles fondateur
- Doit faire une **demande** → Springs fait un entretien → admin valide
- Maximum **2 structures** par fondateur
- Ne peut pas quitter une structure sans transférer la propriété
- Ne peut pas supprimer son compte s'il est encore fondateur

---

## Collections Firestore

### Collections existantes (à réutiliser/étendre)
- `admins` — admins du **vieux site** Springs (TM cup / RL). Collection partagée avec `site cup monthly`. **Ne PAS l'utiliser pour Aedral.**
- `participants` — profils joueurs TM (ne pas modifier)
- `editions` — éditions TM cup (ne pas modifier)
- `results` — résultats TM (ne pas modifier)

### Nouvelles collections Springs Hub

**`aedral_admins`** — admins de la plateforme Aedral. Collection **dédiée**, distincte de `admins` (vieux site) : les deux repos partagent le projet Firebase `monthly-cup`, donc un admin du vieux site N'EST PAS admin Aedral et inversement.
- Côté serveur : `isAdmin()` dans [lib/firebase-admin.ts](lib/firebase-admin.ts) lit cette collection. CRUD admins via `/api/admin/users`.
- Côté `firestore.rules` : fonction `isAedralAdmin()` (collections du Hub) — distincte de `isAdmin()` qui reste branché sur `admins` (collections legacy TM/RL du vieux site).
- Doc = `{addedBy, addedAt, lastDashboardSeenAt?}`. Seed initial via `scripts/migrate-aedral-admins.mjs`.

**Collections du chantier anti-mensonge rang RL (server-only)** — voir [docs/rl-rank-verification-plan.md](docs/rl-rank-verification-plan.md) et la mémoire `project_rl_rank_strategy`. Toutes en `allow read, write: if false` (Admin SDK uniquement) :
- `rank_reports` — signalements de rang RL (motif `rank_lie` ou `smurf`).
- `rl_link_change_requests` — demandes de changement de compte Epic officiel, validées par admin.
- `user_secrets/{uid}` — `discordRefreshToken` (capturé au callback OAuth, utilisé par la passe nocturne de sync greffée sur le cron `expire-invitations`).
- `user_admin_flags/{uid}` — flags admin-only sur un user (ex. `suspectedSmurf`) ; jamais visible par le joueur ni les autres visiteurs.

**`users`** — profil global Springs (lié au Discord)
```javascript
{
  uid: "discord_SNOWFLAKE",
  discordId: "...",
  discordUsername: "...",
  discordAvatar: "...",
  displayName: "...",       // pseudo affiché sur le site
  bio: "",
  country: "",
  games: ["rl", "tm"],      // jeux pratiqués
  isFan: false,
  structurePerGame: {       // une seule structure par jeu
    rocket_league: "structureId",
    trackmania: "structureId"
  },
  // Rocket League
  epicAccountId: "",        // ID Epic permanent (ne change pas quand pseudo change)
  rlTrackerUrl: "",
  rlRank: "",
  isAvailableForRecruitment: false,
  availableRole: "",
  // Trackmania
  pseudoTM: "",             // pseudo affiché en course
  loginTM: "",              // identifiant Ubisoft/Nadeo
  createdAt: Timestamp
}
```

**`structures`** — orgas/associations
```javascript
{
  name: "",
  tag: "",                  // ex: "EXA"
  logoUrl: "",
  description: "",
  games: ["rl", "tm"],
  founderId: "discord_...",
  coFounderIds: [],
  managerIds: [],
  coachIds: [],
  status: "active",         // pending_validation | active | suspended | deletion_scheduled
  requestedAt: Timestamp,   // date de la demande de création
  validatedAt: Timestamp,
  validatedBy: "adminUid",
  deletionScheduledAt: null,
  createdAt: Timestamp
}
```

**`structure_members`** — membres d'une structure
```javascript
{
  structureId: "",
  userId: "discord_...",
  game: "rocket_league",    // jeu concerné
  role: "joueur",           // joueur | coach | manager | fondateur
  subTeamId: null,
  joinedAt: Timestamp
}
```

**`sub_teams`** — sous-équipes dans une structure
```javascript
{
  structureId: "",
  game: "rocket_league",
  name: "Équipe principale",
  titulaires: [],           // max 3 pour RL
  remplacants: [],          // max 2 pour RL
  createdAt: Timestamp
}
```

**`competitions`** — toutes les compétitions Springs
```javascript
{
  name: "",
  game: "rocket_league",    // rocket_league | trackmania
  type: "league",           // league | cup | tournament
  status: "upcoming",       // upcoming | registration | active | finished | archived
  format: {},               // config spécifique au jeu
  registrationOpen: Timestamp,
  registrationClose: Timestamp,
  startDate: Timestamp,
  endDate: Timestamp,
  prizePool: {},
  maxTeams: null,
  allowSolo: false,         // true pour TM monthly
  createdBy: "adminUid",
  createdAt: Timestamp
}
```

**`competition_registrations`** — inscriptions aux comps
```javascript
{
  competitionId: "",
  structureId: null,        // null si solo
  userId: "discord_...",    // joueur solo ou représentant de structure
  type: "team",             // team | solo
  status: "pending",        // pending | accepted | rejected
  createdAt: Timestamp
}
```

**`structure_invitations`** — invitations & demandes
```javascript
{
  type: "invite_link",      // invite_link | join_request
  structureId: "",
  createdBy: "discord_...",
  applicantId: null,        // pour join_request
  token: "uuid",            // pour invite_link
  status: "active",         // active | expired | accepted | declined
  createdAt: Timestamp
}
```

**`structure_events`** — calendrier des structures
```javascript
{
  structureId: "",
  subTeamId: null,
  createdBy: "discord_...",
  title: "",
  type: "training",         // training | scrim | match | tournoi | autre
  startsAt: Timestamp,
  endsAt: Timestamp,
  description: "",
  createdAt: Timestamp
}
```

**`notifications`** — notifs in-app
```javascript
{
  userId: "discord_...",
  type: "invitation",       // invitation | recruitment | new_event | new_competition
  content: "",
  read: false,
  createdAt: Timestamp
}
```

---

## Compétitions — logique métier

### Rocket League
- Format ligue : round-robin par poule, BO7, 3v3
- Inscription par structure (une équipe par structure)
- Classement : victoires, différence de buts
- Top N → LAN finale

### Trackmania
- Données existantes dans Firestore (`editions`, `results`, `participants`) à lire
- Monthly Cup : inscription solo (joueurs individuels)
- Certaines comps TM = équipes (structures)
- Système de points F1 : `[25, 18, 15, 12, 10, 8, 6, 4, 2, 1]`
- `pName(p)` : `p?.pseudoTM || p?.pseudo || p?.name || '?'`

---

## Phases de développement

- **Phase 1** — Fondations : ✅ terminée
- **Phase 2** — Communauté (structures, roster, calendrier MVP1/MVP2a/MVP2b, co-fondateurs, drawer ÉQUIPES) : ✅ terminée
- **Phase 2 bis** — Polish UX continu : items shippés au fil de l'eau (rebrand Aedral, landing visiteur, profil RL cross-platform, Steam OpenID, Discord connections sync, /admin/announce dynamique, icônes officielles RL, upload direct du logo d'équipe, refonte de l'onglet Calendrier avec vues Mois/Semaine/Liste + dispos/consensus intégrés, **système anti-mensonge rang RL** — compte Epic vérifié + lien tracker partout + signalements motif faux/smurf + sync auto Discord nocturne — voir [docs/rl-rank-verification-plan.md](docs/rl-rank-verification-plan.md) et la mémoire `project_rl_rank_strategy` ; **intégration ballchasing replays** — quota stockage unifié structure 500 MB free / 5 GB premium, parsing stats RL via ballchasing.com avec toggle auto-parse par structure + quota hebdo 20/structure et 320 global Aedral + page admin `/admin/ballchasing`, voir mémoire `project_ballchasing_replays_system` ; **refonte settings** — nav 3 sections au lieu de 5, bloc RL unifié contextuel, auto-save 2s + bouton Save bottom sticky, onboarding wizard 4 étapes pour nouveaux users ; **debrief scrim post-match** — compte rendu commun reste sur l'event, points à travailler migrés en `structure_todos` ciblés par joueur avec liaison event↔exercices↔replays multi, voir mémoire `project_debrief_scrim_architecture` ; **refonte annuaire joueurs scalable** — pagination cursor + UI trading card portrait, voir mémoire `project_players_page_redesign` ; **modèle A permissions validé + refactor centralisé** — Responsable = bras droit (admin équipes complet), Coach = staff mobile training/scrim+todos+replays toute équipe, helpers d'autorisation centralisés dans `lib/structure-permissions.ts`, voir [docs/permissions-checklist.md](docs/permissions-checklist.md) et mémoire `project_permissions_model_a` ; **cap 2 structures par jeu + roster cross-structure 1 équipe/jeu** — `lib/structure-membership.ts` (helpers `canJoinStructure`, `addStructureToGame`…) + backfill prod 25/05, voir mémoire `project_two_structures_cap` ; **refonte calendrier dispos v2** — palette heatmap 3 paliers (gris/vert/or), overlay staff multi-select avec pastilles colorées dans la WeekView, consensus inline (manager d'équipe inclus), nouvel onglet STAFF (responsable+) avec heatmap pool large + réglage `minPlayersForStaffMatch`, voir mémoire `project_calendar_dispos_v2` ; **page /guide + modal Welcome** — 9 sections par pilier + modal 3 slides au premier login, discoverability sans tour interactif, voir mémoire `project_guide_and_welcome` ; **refonte page profil joueur + slugs publics** — layout 2 cols + hero bannière auto + avatar XL + rang en watermark + slot stats agrégées (placeholder), URLs publiques en slugs `/profile/noxx` au lieu de l'uid Discord (sécu snowflake), voir mémoire `project_profile_slugs` ; **refonte exercices en multi-steps v3** — 1 exo = N steps composables (drag&drop @dnd-kit, max 10), screenshot upload, lock/unlock global, types refondus (workshop_map + free_play ajoutés, scouting + watch_party deprecated), Discord embed avec steps[], voir mémoire `project_exercises_multi_steps_v3` ; **refonte onglet exercices structure** — À relancer groupé par joueur avec ping DM bot Discord + leaderboard performance 7j + Templates manager + Nouvel exercice + bouton supprimer, voir mémoire `project_structure_exercises_redesign` ; **nouvel onglet REPLAYS + WeekView multi-sélection** — bibliothèque cross-équipes (pills équipe/event + filtres + auto-refresh parsing) avec canEdit fine-grained, WeekView avec checkboxes par joueur recalculant le consensus en intersection + palette refondue (or strictement réservé aux blocs consensus encadrés), voir mémoire `project_replays_tab` ; **freemium backend prep** — `lib/plan-limits.ts` centralise les limites par plan (free vs pro), `Structure.plan: 'free' \| 'pro'` ajouté + default `'free'` à la création, limite 15 templates partagés free / 50 pro enforced, voir mémoire `project_freemium_prep` — **PAS de paywall shippé**, juste le terrain prêt ; **multi-jeux scalable + Valorant 100% fonctionnel** — Game Registry centrale `lib/games-registry.ts` (source de vérité unique : label/couleur/logo/roster/features/availableTodoTypes par jeu) + composant `<GameTag gameId>` qui consomme la registry partout dans l'UI (40+ fichiers migrés depuis les hardcodes `if game === 'rocket_league'`), Valorant supporté end-to-end (roster 5+2 enforced, types d'exo dédiés aim_trainer/lineups/custom_game/warmup_routine, rang déclaratif OR sync auto via HenrikDev API — cron nocturne 25 users/run tier Standard 30 req/min + bouton "Sync mon rang maintenant" à la demande, icons Riot Iron 1 → Radiant + support Unranked, capture RiotID via Discord connections riotgames avec résolution name+tag auto via HenrikDev PUUID, stockage PUUID immuable comme compte vérifié anti-mensonge style RL, Discord embed recrutement enrichi 🎯 Rang Val + 🆔 RiotID, onglet Replays masqué via flag replayParsing, card profil Valorant avec watermark + lien tracker.gg, picker JEUX éditable dirigeants dans general-tab my-structure avec garde-fou anti-orphelinage, filtre par jeu chips RL/TM/VAL dans onglet équipes), rôles staff scopés par jeu (étape 2 UI + étape 3 events enforced) : `structure.managerGames/coachGames` + helpers `is*ForGame(ctx, gameId)` + modal `StaffGamesScopeModal` accessible depuis `MemberActionsMenu` (action "Configurer jeux du rôle") — rétrocompat absolue, todos/replays migration ForGame restante en TODO. Requires : `HENRIKDEV_API_KEY` env Vercel (clé gratuite tier Standard). Voir mémoires `project_games_registry`, `project_valorant_added`, `project_staff_roles_by_game`) ; **customisation OG end-to-end (29-30/05)** — Settings -> Carte de partage permet de choisir 0/1/2 rangs a afficher, toggle struct + equipe, picker jeu principal. Live preview story + banniere. 2 boutons (Story + Banniere) sur pages profil + structure. Drapeaux FR/BE CSS pur. Gate-friendly via canUserCustomizeOgDisplay() (lib/plan-limits.ts) pret pour flip Pro Joueur futur. Voir memoire `project_og_customization` ; **Valorant rank verification — PIVOT vers rang 100% auto (03/06)** — le rang Valorant ne vient QUE du sync auto HenrikDev (`source: henrikdev`), saisie manuelle SUPPRIMÉE (Settings + onboarding) → impossible de mentir. Compte Riot VERROUILLÉ sur le PUUID : le sync (cron + bouton) refuse la bascule auto ; changement de compte = demande validée admin (`valorant_link_change_requests` + `/admin/valorant-link-changes`, miroir RL `rl_link_change_requests`). Signalement Valorant = motif smurf uniquement. Affichage gaté sur la source partout (profil/annuaire/embed Discord/OG/signalement) + script cleanup `scripts/cleanup-valorant-declared-ranks.mjs`. **RL garde le déclaratif** (`rankAutoSync=false`, pas d'API rang fiable). Voir mémoire `project_valorant_verification_plan` ; **messages ciblés admin (03/06)** — page `/admin/messages` : envoi par SEGMENT (compte non lié, Valorant sans rang sync, pas de rang RL, sans structure, profil incomplet, tous + filtre jeu) via notif in-app (garanti) + DM bot (throttlé/cappé `DM_CAP`, backoff 429, deadline anti-timeout, trace `admin_messages`). Opt-out DM dédié (`user.dmAnnouncementsOptOut` + toggle Settings) qui coupe SEULEMENT les annonces, jamais les DM fonctionnels (exos/invitations). Liste dépliable des destinataires. Lien restreint à un path interne strict (anti open-redirect). `lib/admin-segments.ts` (segments + matchers) + `lib/admin-segment-query.ts`. Voir mémoire `project_admin_targeted_messages` ; **chantier design anti-AI-slop — palier 1 shippé (12-13/06)** — déclenché par des retours « le site pue l'IA ». Audit multi-agent 55 findings ([docs/audits/2026-06-12-design-audit.md](docs/audits/2026-06-12-design-audit.md)) → 12 quick wins exécutés (−200 lignes nettes) : dashboard dédoublonné, piliers dégraissés, MERCATO/LFT (jargon scène, badge « LFT JOUEUR » explicite), zéro vaporware (« stats à venir », panel « bientôt », pseudo-filtres morts supprimés), zéro exclamation système, emojis chrome → lucide, panels my-structure 11→6 blocs, meta SEO factuelle, annuaire noms pleine largeur + fallback logo. Le référentiel permanent est le skill versionné `.claude/skills/aedral-style` (voix + grammaire 3 niveaux — voir section Design). Palier 2 QUASI TERMINÉ (18/06) — les 10 items shippés sauf #10b : #1 pages publiques (7161bf4, `apiPublic()`), #2 SectionPanel chromeless (82be9c4), #5 en-têtes + `CompactStickyHeader` dé-chromé (49ea24c/f2f2203), #6 profil 8 barres→1 + card TM (473650a), **#4 Settings RL 7 sous-blocs imbriqués → 1 seul état visible** (4b9002a — badge compact si vérifié / 1 CTA contextuel sinon, saisie ID manuelle retirée pour epic/steam, instructions derrière disclosure ; review adversariale 4 lentilles → corrigé un BLOCKER `validate()` qui bloquait le save + restauré le funnel Epic 1-clic + sync tracker post-confirm), **#7 dashboard asymétrique 2/3-1/3** (f5b30d4 — event dominant + exercices/structure en colonne compacte + bannière Discord en ligne fine, composant WidgetCard supprimé ; à eyeball responsive sur Vercel), **#8 `.t-label-soft`** (96736fc — data-labels en sentence case, rollout site-wide → palier 3), #3 helpers dégraissés (0186adb), #9 purge icônes déco comp-cards + header annuaire (67a73de). Reste **#10 Guide** : #10a −50% bullets shippé (6991af5) + #10b 3 captures publiques (profil/structures/recrutement) capturées via Playwright et intégrées en layout side-by-side texte/image (9e7962a→63eb451) ; **restent 6 captures derrière login que MATT doit fournir** → déposer dans `public/guide/<id>.webp` (`equipes`, `calendrier`, `replays`, `exercices`, `roles`, `bot-discord`), le rendu les câble automatiquement. **Palier 3 en cours (23/06)** : sweep hiérarchie ~90 accent bars/glows/icon-box terminé (6 clusters : structure publique, vue joueur, calendrier, my-structure, settings, pages communauté) ; vues liste clear wins user-facing shippées (`my-applications` + `recruitment-tab` 5 listes + `DocumentsExplorer` docs en rangées à dividers, dossiers gardés cards) ; **captures Guide cliquables → lightbox + tilt 3D au survol** (nouveau composant `components/guide/GuideImage.tsx`, section `roles` laissée en texte seul = modale scrollable). Débatables laissés exprès (home/changelog/admin). Reste landing v2. **Lint projet ramené à 0** (58 erreurs + 82 warnings → 0 via workflow 1-agent-par-fichier ; piège : `next build` ne lance PAS eslint, seul `tsc` tourne au build → la dette lint s'accumule en silence ; les règles React 19 strictes laissées sont neutralisées par des `eslint-disable` justifiés, jamais en silence). Voir mémoire `project_design_antislop`. **Système anti-friction vérification de compte (14/06)** — diagnostic data (16 % des joueurs vérifiés ; 31 ont déjà la connexion Discord mais n'ont jamais cliqué le bouton enterré dans Settings) → paliers A+B+C : `VerifyAccountNudge` « Vérifier en 1 clic » sur dashboard + own profile (helper `lib/account-verification.ts`), endpoint `/api/profile/refresh-discord-connections` (re-fetch connexions à la demande via refresh token → 1-clic sans relogin) + auto-détection au retour, onboarding qui vend le badge, funnel PostHog (`account_verify_*`). PAS de hard-gate ; gate compét = V2 soft (roster/scrim, pas l'adhésion structure). Relance DM via `/admin/messages` (DM_CAP 40→120 : le bot DM les joueurs via le Discord de LEUR STRUCTURE = guilde mutuelle, throttle 250ms conservé). Voir mémoire `project_verification_friction`. **Chantier appartenance / LFT / self-leave (18/06)** — déclenché par des bugs signalés par Matt. (A) bug `remove_member` : la comparaison `structurePerGame[jeu] === structureId` sur un ARRAY (depuis le cap-2) était toujours fausse → structures orphelines au retrait d'un membre, fix = `removeStructureFromGame()` + réparation prod (backfill + cleanup chirurgical, 7 fantômes + 3 manquants → 0 sur 135 users). (B) **règle LFT** : un titulaire/remplaçant d'une équipe ne peut pas être « disponible au recrutement » — coupé à l'ajout au roster (teams create/update), garde-fou serveur `/api/profile` + `/api/admin/users`, toggle Settings grisé, helper centralisé `lib/recruitment.isUserRostered` (équipes non archivées only), 18 joueurs alignés ; + corrigé le jumeau serveur du blocker #4 (POST exigeait encore rlPlatformId pour epic/steam). (C) **self-leave** : action API `leave_team` (capitaine inclus → équipe sans capitaine, pas de transfert) + boutons « Quitter » équipe/structure dans `PlayerStructureView`, **tout départ notifie le staff** (`notifyStaffOfDeparture`). Profil joueur « RECRUTEMENT » → « LFT » (vert). 2 reviews adversariales multi-agents (qui avaient déjà chopé le blocker #4) ont validé + durci. **Fix images** : R2 (`pub-*.r2.dev`) absent de `next.config` `images.remotePatterns` → `next/image` cassait TOUS les uploads (logos/bannières/avatars custom) ; ajout du host R2. Voir mémoire `project_membership_lft_selfleave`. **Bug Valorant « Riot lié sur Discord mais non détecté » (18-19/06) — CAUSE EXTERNE** : Discord a migré la liaison Riot en bidirectionnel (« two-way ») en 2026, les anciens liens « legacy » restent visibles dans Discord mais ne sont plus exposés par l'API OAuth tant qu'ils ne sont pas re-liés (Steam/Twitch one-way = non affectés). Pas un bug Aedral (prod `DISCORD_CLIENT_ID`=app Aedral OK, capture marche pour 15 users). Solution = joueur supprime+relie Riot dans Discord puis se reconnecte. Fix shippé : messaging explicite dans `VerifyAccountNudge` + capture `revoked`/`two_way_link` (commit 2a15056) + bouton « Se reconnecter avec Discord » (7024443). Scripts diag `diagnose-discord-connections.mjs`/`scan-riot-connections.mjs` (⚠️ `.env.local` a un vieux `DISCORD_CLIENT_ID` 1483… ≠ Aedral 1495… → refresh inutilisable en local). Voir mémoire `project_riot_connection_relink`. **Patch note du 18/06 publié sur `/changelog`** + au passage fix `/changelog` qui était vide pour les visiteurs déconnectés (`api()`→`apiPublic()`, commit ef158d4). Sentry coupé en dev local (`enabled: production`). À ce stade, plutôt traité comme un backlog continu que comme une "Phase" fermable.
- **Phase 3** — Compétitions natives Aedral : **BUILD LANCÉ le 02/07** pour la **Legends Springs Cup** (circuit RL : 4 Qualifs 26-27/09, 10-11/10, 24-25/10, 7-8/11 + LAN 21-22/11 ; inscriptions Qualif 1 le 12/09 = deadline dure). **Sources de vérité : [docs/legends-springs-cup-spec.md](docs/legends-springs-cup-spec.md) (spec fonctionnelle complète, validée par Matt) + [docs/legends-cup-architecture.md](docs/legends-cup-architecture.md) (plan d'archi v2 post-review adversariale, phasage Lots 0→5 + jalons)** — TOUJOURS lire ces deux docs avant de toucher au module compétitions. Points structurants : moteur générique (Legends Cup = une instance), birthDate → `user_secrets`, admins compétition scopés (`competition_admins`), règlement versionné avec acceptation à l'inscription (organisateur légal : SPRINGS E-SPORT, orthographe exacte). **Stratégie de dev (archi §11bis)** : branches courtes `legends/*` + Vercel Previews pour les tests de Matt + feature gating (module invisible en prod jusqu'à publication) ; la DB Firebase est partagée entre preview/local/prod → données de test en compétitions `draft` nommées TEST, prudence absolue sur firestore.rules (global). **Les tests de Matt passent par `https://preview.aedral.com`** (domaine stable assigné à la branche de test courante, enregistré dans Discord/Firebase/GCP — voir mémoire `project_preview_domain` : réassigner le domaine à chaque nouvelle branche legends/* via l'API Vercel + push pour matérialiser l'alias ; mur SSO Vercel contourné par le lien secret Protection Bypass, cookie par navigateur). Page scénarios barème pour le président : `https://aedral.com/legends/bareme-scenarios.html`. Le rebuild TM Monthly Cup et la page `/competitions` native suivront (la page actuelle pointe encore sur le vieux site).
  - **Lot 0 — Socle : ✅ BUILT les 02-03/07 sur la branche `legends/lot-0`** (commits 00d4091 + b0fba37, review adversariale 4 lentilles → 10 findings corrigés). Livré : `types/competitions.ts` (schéma archi §2 complet, SANS `createdBy` sur les docs publics — invariant §8, audit log fait foi), `lib/competitions/` (préréglages Legends : barème v2 + BO R5-3 + phase plan spec + MMR §3 ; validation payloads partagée client/serveur, 18 tests Vitest), `isCompetitionAdmin()` (lib/firebase-admin + rules), **rules déployées sur Firebase le 03/07** (`competition_registrations` deny-all — audit legacy : 0 doc —, nouvelles collections additives, sync vieux site fait), CRUD admin `/admin/competitions` (circuits + compétitions + admins compét ; préréglages 1-clic, bouton J-14→J-3 ; verrous : édition/suppression draft-only, mutations = admins Aedral, lectures = admins compét), `profile/history` requête `rosterUids`, **migration dateOfBirth → user_secrets** (users ne garde que le flag `hasDateOfBirth` ; **backfill EXÉCUTÉ en prod le 03/07 post-merge** — 137 users migrés, 0 copie legacy restante, vérifié via l'API prod) + RGPD export/delete étendus (user_secrets, user_admin_flags, competition_admins). **Plan Blaze confirmé par Matt le 03/07**. **MERGÉ sur main + déployé le 03/07 — Lot 0 CLOS.** Voir mémoire `project_legends_lot0`.
  - **Lot 1 — Inscription : ✅ CLOS — MERGÉ sur main le 03/07** (commit 45009d8, testé par Matt sur preview.aedral.com via le bac à sable, retours intégrés : gate comptes vérifiés DUR, rôles explicites au wizard, copy factuelle, console enrichie cliquable, check Discord à l inscription, boucliers âge). Vérifié par e2e synthétiques (`scripts/e2e-legends-lot1-ef.mjs` 22/22 checks, rejouable) + review adversariale multi-agents 5 lentilles (1 blocker + 7 majors corrigés). Livré : **A — lib MMR** (`lib/competitions/mmr.ts` — refMmr 70/30, worst-lineup toutes compos, drapeaux, 12 tests) ; **B — registre des bans** (refus auto à l'inscription avec motif, révocation horodatée) + accès console du rôle scopé ; **C — règlement versionné** (éditeur + page publique + acceptation tracée) ; **D — wizard d'inscription** (snapshot complet, unicité atomique `${compId}_${teamId}`, garde anti-joueur-en-double) + fiche publique (draft = 404 public) ; **E — file de validation admin compét** (`RegistrationsPanel` + `/api/admin/competitions/[id]/registrations` : détail roster/flags + signalements smurf en agrégat ANONYMISÉ, approve/reject/unapprove en transaction — cap→waitlist via compteur dénormalisé `approvedCount`, garde `createdAt` anti-TOCTOU sur doc réécrit, re-check chevauchement joueurs, dérogations mineurs note par note journalisées dans l'audit log, identité circuit via lib pure `lib/competitions/identity.ts` : noyau 2/3 sur la précédente participation APPROUVÉE — jamais de roster fantôme waitlist —, claim atomique `circuit_teams/{id}/private/state`, arbitrage explicite name_mismatch/identity_conflict, jamais d'homonyme silencieuse ; notifs in-app roster + DM capitaine/dirigeant borné 10 s avec motif de refus) ; **F — provisioning Discord découplé** (`lib/discord-competition.ts` : backoff 429 générique, reprise idempotente IDs au fil de l'eau, rôle Participant commun au CIRCUIT stocké sur `circuits/{id}.discord`, catégorie + salons privés par équipe, adhésion manquante = warning non bloquant, 404 désambiguïsé Unknown Member/Unknown Role ; route `/provision` avec verrou transactionnel à bail + deadline dure + re-lecture du statut par équipe ; deprovision best-effort au reject). Restes notés pour les lots suivants : cleanup Discord post-Qualif en masse (spec §7), purge des claims waitlisted jamais promues à la clôture (Lot 4). **+ Bac à sable de test** (panel dans /admin/competitions, admins Aedral) : 2 structures fictives complètes (17 comptes `discord_dev_lgd_*` isDev, cas limites mineur/âge inconnu/non-vérifié/smurf) + impersonation admin existante pour dérouler wizard→validation en conditions réelles sur une compétition draft (bypass `users.isDev`), cleanup 1 clic avec recalage des compteurs — e2e `scripts/e2e-legends-sandbox.mjs` 10/10. Voir mémoire `project_legends_lot1`.
  - **Lot 2 — Bracket + machine d'états : EN COURS sur `legends/lot-2`** (lancé 03/07, deadline 8 août). ✅ **`lib/tournament/` BUILT** (03/07, commits 252a46d+d7865ff — 54 tests dont property tests seedés sur TOUTES les tailles 4→32 : generateDoubleElim avec byes/void + reset pré-créé, advanceMatch winner/forfait §11/double-forfait R5-1/walkover, withdrawTeam cascade R5-4 délta figé, replaceTeam waitlist §8, placements COMPRESSÉS 1→N, délta normalisé par match compté, face-à-face, needs_admin_tiebreak). **Review adversariale intégrée** (49 agents, blocker champion-fantôme R5-1 corrigé + 7 autres — 64 tests moteur). ✅ **Seeding + matérialisation BUILT** (03-04/07, commits a4990d5 + review 0f83514) : pont pur↔Firestore `lib/competitions/bracket-store.ts` (round-trip fidèle testé, reconstruction auto-suffisante depuis les docs), API `/api/admin/competitions/[id]/bracket` (open_seeding/shuffle/reorder/publish, publish → 63 matchs + ACL en batch), review adversariale du pont faite (verrou §8 : jamais d'uid dans le doc public). Repo 765 tests, e2e `scripts/e2e-legends-bracket.mjs` 13/13. ✅ **Fiche v2 + bracket public + gating visibilité FAITS** (04/07, commits 5a277f6 + review 68a9b3a) : BracketView vertical temps-réel (API gatée + polling — le SDK Firestore client est bloqué sur ce projet), hero enrichi,  (compét de test invisible du public même publiée, helper  sur fiche/matches/rulebook/register), review adversariale 27 agents → 8 correctifs (2 fuites de gate colmatées). ✅ **Page circuit + refonte archi d'info FAITE** (04/07, commit 600ff56) : retour Matt (« la fiche jure avec le site, largeur bridée ; on croit participer à un simple tournoi, le format du circuit n'est nulle part ; faudrait s'inscrire depuis une page du circuit »). Décision : le CIRCUIT est l'entité produit (4 Qualifs + LAN), les Qualifs des étapes, l'inscription part de la page circuit. Nouveau `/competitions/circuit/[id]` PLEINE LARGEUR (hero + dotation, « Le parcours », « Comment se qualifier » + barème, Format, Classement avec cutline LAN) ; fiche Qualif recâblée pleine largeur + lien retour circuit ; `/competitions` liste les circuits Aedral natifs (gatée) ; `prizePool` devenu attribut du CIRCUIT ; `lib/competitions/standings.ts` pur (best-N + tiebreakers §11 + cutline, 12 tests) ; API `/circuit/[id]` + `/circuits` gatées (`isCircuitHidden`, Qualifs masquées filtrées partout). Review adversariale 21 agents (17→12 survivants, 0 blocker) → 8 correctifs (gates formatSample+classement, or rationné, garde CircuitForm, tieBreakers défaut, tests). e2e circuit 13/13. ✅ **Parcours inscription bouclé** (07/07, commit 9b628d4) : retour Matt (« après acceptation, on ne voit nulle part le statut, ni les équipes inscrites, ni le bracket ; pense au parcours entier »). (1) **le MANAGER D'ÉQUIPE peut inscrire SON équipe** (avant : dirigeant/responsable only ; coach/capitaine exclus) ; (2) **onglet « Inscriptions » dans Ma structure** (suivi par équipe + statut, PAS de CTA inscrire = zéro doublon sidebar, consultation seule + `canWithdraw` prêt pour retrait Lot 3, endpoint `/api/structures/[id]/registrations` filtré par rôle) ; (3) **fiche Qualif** : bandeau « ton inscription est {statut} » + équipes listées + bracket état ; (4) bannière dashboard → page circuit. Review adversariale 12 agents (9 findings, 0 blocker) → 5 correctifs (union des portées registrations, `computeVisibleTabs` source unique de visibilité onglets, or rationné pending, Promise.all, titre onglet). e2e permissions 10/10. **+ Finitions parcours (d6f2c66 + bcb9294)** : ligne de Qualif du circuit cliquable vers sa fiche (voir les équipes) ; onglet Inscriptions enrichi (roster figé titulaires/remplaçants/capitaine + dates + lien Compétitions) ; **heure de fin par jour** (`schedule.days.endsAt`) ; **inscription validée → créneaux au calendrier de l'équipe** (`lib/competitions/calendar-sync.ts`, 1 event tournoi/jour + présences, idempotent, greffé approve→sync/reject+unapprove→cleanup, fuseau Paris→UTC géré). e2e planning 9/9. ✅ **Sanctions graduées + refonte panel admin** (c4e359d backend + ce8f81a front, 07-08/07) : retour Matt sur le panel de validation + demande d'un système de modération. Modèle UNIFIÉ `competition_sanctions` (`warn | exclusion | ban` × `user | structure | team`) — l'ancienne `competition_bans` avait 0 doc → zéro migration (bans.ts/BansPanel démontés). Ban = ban COMPÉTITION (pas du site) ; warn informatif (notif in-app + DM best-effort, cumulable, escalade MANUELLE) ; ban/exclusion = 1 actif/cible ; **bannir une équipe bloque l'entité équipe, pas ses joueurs**. Refus auto à l'inscription (`getBlockingSanctions` : ban global OU exclusion scope-matchée ; warn jamais bloquant). **RegistrationsPanel refondu** (roster en table alignée titulaires/remplaçants + Discord/Epic lisibles, bloc Staff & direction live, notes admin internes `set_notes`, historique sanctions, Sanctionner joueur/équipe/structure inline, export CSV durci anti-injection de formules). **SanctionsPanel** = registre unifié (remplace BansPanel) ; onglet Inscriptions (Ma structure) affiche les sanctions actives scopées par rôle. Effet de l'EXCLUSION + retrait d'inscription = Lot 3. e2e sanctions 9/9. Review adversariale front (5 lentilles) : safe-to-ship 0 blocker/major (scoping + fuites vérifiés par trace) → 2 correctifs. ⏳ Reste : console live admin = gros du Lot 3 (machine d états match) + retrait d'inscription dans l'onglet + effet exclusion. **Lot 2 mergeable sur main.** ✅ **Refonte craft panel admin « Le Dossier »** (766df1f, 08/07) validée avec enthousiasme par Matt (« ah voilà un vrai truc ! ») : vue dépliée d'inscription en 4 zones (verdict-héros avec logo d'équipe + scorecard MMR + décision accolée / roster dense / contacts|contexte / modération quiet). ⏳ **PASSE UI/UX MODULE COMPÉTITION EN COURS (09/07)** — Matt : « je veux ce niveau partout ». Kit réutilisable (`components/competitions/TeamCrest|GlanceStat|RegistrationStatusPill`, `lib/competitions/circuit-timeline`). Faits : page circuit (040a120, parcours en roadmap à nœuds), liste /competitions (ad2f493, circuit flagship vs legacy démoté), **champ `organizer` sur circuits** (6efe18a, Aedral=hébergeur, la compét appartient à l'orga=Springs E-Sport, scalable/éditable), **centralisation legacy** (43fbafd, `lib/legacy-competitions.ts` source unique — SLS était hardcodée « en cours » à 3 endroits, fix racine + section « passées » + bug PATCH organizer). **⚠️ TODO prioritaire : attribution organisateur trop petite (« il me faut une loupe ») → à mettre CLAIREMENT en valeur.** Reste écrans #3→#7 (fiche Qualif, wizard, bracket, inscriptions-tab, règlement). **LEÇON (Matt agacé « t'es un dev junior, je passe derrière toi ») : anticiper les répercussions / centraliser le dupliqué / vérifier end-to-end / penser IA complète.** preview.aedral.com pointe sur cette branche. Voir mémoire `project_legends_lot2`.
- **Phase 4** — Finitions : notifications in-app, Discord webhooks, fan zone, mobile, migration liens

Durcissement déjà en place : Sentry, rate limiting Upstash, Toast/Modal DA Aedral, suite Vitest, sécurité (CSRF OAuth, validation, rules, batch writes, hard caps), PostHog analytics (EU Cloud, cookieless, identified-only).

### Analytics PostHog (Cloud EU, cookieless)
- **Lib centrale** : [lib/analytics.ts](lib/analytics.ts) expose `track(eventName, props?)`, `identify()`, `reset()`. **Tous les events sont déclarés dans le type `EventName`** — typecheck empêche les fautes de frappe. Ajouter ici AVANT le call site.
- **Provider** : [components/analytics/PostHogProvider.tsx](components/analytics/PostHogProvider.tsx) monté dans `app/layout.tsx` (DANS AuthProvider pour pouvoir `useAuth()`). Config : `person_profiles='identified_only'`, `persistence='memory'` (pas de cookie, pas de bandeau RGPD), `api_host=eu.i.posthog.com`.
- **Identify** : automatique sur login Discord (`onAuthStateChanged`), traits = `displayName`, `isAdmin`, `games`, `hasStructure`. Reset sur logout.
- **Events trackés** :
  - Auth : `user_signed_up` (premier login), `user_signed_in` (returning)
  - Structure : `structure_requested`, `structure_joined`, `structure_created`
  - Calendar : `event_created`, `event_presence_updated`
  - Exercices : `todo_created`, `todo_completed`
  - Recrutement : `recruitment_opened` (transition off→on uniquement)
  - Partage social : `og_share_clicked` (canal copy_link / copy_discord / etc.)
  - Onboarding : `onboarding_completed`, `onboarding_reminder_sent` (cron)
- **Env vars** : `NEXT_PUBLIC_POSTHOG_KEY` (Project API Key `phc_...`) + `NEXT_PUBLIC_POSTHOG_HOST` (default `https://eu.i.posthog.com`). À configurer dans Vercel pour prod.
- **Pas de tracking serveur** : l'audit-log Firestore couvre l'audit critique côté serveur. PostHog = data produit comportementale uniquement.

### Reviews régulières
- **Slash command `/review`** (défini dans `.claude/commands/review.md`) : lance 3 agents parallèles (sécu/code, UX/DA, features/roadmap) et sauvegarde le rapport dans `docs/audits/YYYY-MM-DD-review.md` pour comparaison historique.
- **Dernière review** : 2026-05-19 — 3 critiques fixés (commit 562f584), ~14 importants restent (voir [docs/audits/2026-05-19-review.md](docs/audits/2026-05-19-review.md) et memory [project_audit_review_20260519](../.claude/projects/c--Users-mattm-springs-hub/memory/project_audit_review_20260519.md)).
- Refaire `/review` ~ tous les 1-2 mois pour suivre la dette technique.

### Annonces Discord (admin)
- Page `/admin/announce` : éditeur d'annonces (titre + description markdown + couleur + preview live)
- Templates stockées dans Firestore collection `announce_templates` (CRUD via `/api/admin/announce-templates`)
- Diffusion via le bot Discord (channel auto-listé, sélectionné dans dropdown)
- Script `scripts/add-announce-template.mjs` : insertion programmatique de templates (utilisé par Claude en fin de session pour préparer des patch notes — voir memory `feedback_auto_patch_notes_template`)
- Pas besoin de redéploy pour ajouter/éditer/supprimer des templates

**Audit sécurité structure/équipes/membres (clos 2026-04-18, Lots 9.1→9.7)** :
- Invariant "1 structure par jeu" atomique via `db.runTransaction()` sur les 3 chemins d'acceptation (`users.structurePerGame` comme source de vérité)
- Transfert de propriété en 2 étapes avec fenêtre 24h (actions `initiate`/`cancel`/`confirm` sur `/api/structures/transfer`, champ `transferPending`)
- Rules durcies : `structure_members` lecture admin OR self uniquement ; `structure_audit_logs` admin-only
- Collection `structure_audit_logs` + helper `lib/audit-log.ts` sur toutes les actions critiques (transfert, promotion/rétrogradation, retrait, invitations…)
- Invitations : expiration 30j des tokens, historique d'appartenance via `structure_member_history` + `lib/member-history.ts`
- `firestore.indexes.json` déclare tous les composites utilisés (13 indexes déployés)
- Confirm remove member contextuel (équipes impactées + rôles perdus), pagination douce des groupes d'équipes (cap 12)

Pièges à éviter lors des futurs refactors : **pas de `.where` dans une transaction Firestore** (uniquement des lookups doc — pattern ID déterministe `${structureId}_${userId}`), et les helpers `addAuditLog`/`addJoinHistory`/`closeOpenHistory` acceptent `BatchOrTx = WriteBatch | Transaction` mais cast en interne vers une `interface Writer` structurelle (les overloads TS sont incompatibles en union).

---

## Bonnes pratiques Firebase — lectures Firestore

### Règle principale : ne jamais poller
**Interdit** : `setInterval(() => getDocs(...), N)` — lit toute la collection N fois par heure pour rien.

### Chargement initial
`getDocs` ou `onSnapshot` une seule fois par session utilisateur.

### Mises à jour en temps réel
Utiliser `onSnapshot` sur les collections qui changent en cours d'usage :
```typescript
let first = true;
onSnapshot(query(collection(db, 'ma_collection'), where(...)), snap => {
  if (first) { first = false; return; } // skip initial fire (déjà chargé)
  // mettre à jour le state et re-rendre
});
```
- Le premier fire est ignoré (correspond au chargement initial déjà fait)
- Les fires suivants = changements réels → coût = seulement les documents modifiés

### Après une écriture (action utilisateur ou admin)
Appeler `reloadData()` immédiatement après le `addDoc`/`updateDoc`/`deleteDoc` :
- La personne qui fait l'action voit le résultat de suite (sans attendre onSnapshot)
- Les autres visiteurs le voient via onSnapshot quelques secondes après

### Debounce si plusieurs collections
Si plusieurs onSnapshot peuvent se déclencher en même temps :
```typescript
let _timer: ReturnType<typeof setTimeout> | null = null;
function scheduleReload() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(loadData, 500);
}
```

### Coût réel
- `onSnapshot` initial : même coût qu'un `getDocs` (1 lecture par document)
- `onSnapshot` update : seulement les documents modifiés
- `getDocs` après écriture : 1 lecture par document (inévitable, justifié)

---

## Conventions de code

- **Next.js App Router** — pas de `pages/`, tout dans `app/`
- **Composants** : `PascalCase.tsx` dans `components/`
- **Server Components** par défaut, `'use client'` uniquement si nécessaire
- **Tailwind** : classes utilitaires, pas de CSS custom sauf cas exceptionnels
- **Firebase** : initialisation dans `lib/firebase.ts`, hooks dans `hooks/`
- **Auth** : contexte global `AuthContext`, hook `useAuth()`
- **Typage** : TypeScript strict, interfaces dans `types/`
- Pas de `console.log` en production

## Déploiement
- Push sur `main` → Vercel redéploie automatiquement
- Toujours push après chaque modification (sans demander confirmation)

---

## URLs importantes
- **Site prod** : `https://aedral.com`
- **Fallback Vercel** : `https://springs-hub.vercel.app`
- **Site Springs E-Sport (archive)** : `https://springs-esport.vercel.app`
- **GitHub** : `https://github.com/skypi11/springs-hub`
- **Firebase console** : projet `monthly-cup`
- **Discord communauté Aedral** : invite permanent dans `components/icons/DiscordIcon.tsx` (constante `AEDRAL_DISCORD_INVITE_URL`). Serveur officiel pour support/communauté, distinct des Discord des structures où le bot est installé pour les notifs events/todos/recrutement. Le bot Aedral y est aussi présent (perm Admin) mais pas d'automation tied à ce serveur pour l'instant.
- Discord OAuth redirect configuré : `https://aedral.com/api/auth/discord/callback` (callback handler utilise `req.nextUrl.origin` dynamique, donc compatible multi-domaines)
