# Springs Hub — Plateforme communautaire esport (projet personnel)

## Contexte général
Plateforme communautaire esport **propriété personnelle de l'utilisateur** (Matt). Pas une émanation d'une asso. Le site est ouvert à toute structure / joueur de l'écosystème esport amateur, indépendamment de Springs E-Sport.

**Springs E-Sport = partenaire privilégié.** L'utilisateur est Directeur Général de Springs E-Sport (asso événementielle esport), et Springs reste le partenaire de référence du site (premier seed d'utilisateurs, événements officiels Springs hébergés sur la plateforme, branding partagé). Mais le site n'appartient pas à l'asso et sa roadmap est pilotée par l'utilisateur seul.

Le nom actuel "Springs Hub" reflète l'origine historique du projet — un rebrand en nom plus neutre est envisagé à terme (pas de nom retenu pour l'instant).

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
- **Auth** : Firebase Auth — Discord OAuth (joueurs/fans) + Google OAuth (admins plateforme)
- **Hébergement** : Vercel → `springs-hub.vercel.app` (URL dev)
- **Repo GitHub** : `skypi11/springs-hub`
- **Domaine final** : custom à venir (~10-15€/an sur Namecheap ou Porkbun)
- **Polices** : Outfit (corps) + Bebas Neue (titres display, via `font-display` CSS)

### Firebase config (projet existant `monthly-cup`)
- UID Discord : `discord_SNOWFLAKE`
- UID Admin : Google UID (collection `admins`)
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

### Auth Discord — flow déployé et fonctionnel
1. Client → `signInWithDiscord()` → redirect Discord OAuth
2. Discord → `/api/auth/discord/callback` (serveur)
3. Serveur : échange code → token Discord → infos utilisateur
4. Serveur : `createUser`/`updateUser` Firebase Auth (displayName + photoURL)
5. Serveur : `set`/`update` Firestore collection `users` (Admin SDK, bypass rules)
6. Serveur : `createCustomToken` → redirect `/?ft=TOKEN&did=...&du=...&da=...`
7. Client : `signInWithCustomToken` → `onAuthStateChanged` → affichage immédiat depuis `fbUser`
8. Client : Firestore enrichit le profil en arrière-plan (bio, games, etc.)
- **Refresh** : fonctionne — `fbUser.displayName`/`photoURL` disponibles depuis localStorage sans Firestore

---

## Design system — Direction artistique Springs

### Identité visuelle — origine
L'identité visuelle Springs vient des **overlays de stream** de l'association :
- **Texture hexagonale** en fond (pas décorative, en TEXTURE subtile sur tout le contenu)
- **Biseaux/coins coupés** (clip-path polygon) — signature Springs, pas de coins arrondis
- Dark gaming premium, professionnel — "le soin du détail qui fait la différence entre un pro et un amateur"

### Références visuelles
Faceit, Battlefy, Elite Gamers Arena — mais avec l'identité propre Springs (hex + biseaux)

### Fichier central : `app/design-system.css`
Tout le système de design est centralisé ici. **Toujours utiliser les classes et tokens existants** avant de créer du CSS custom.

### Palette — tokens CSS (dans `:root`)
```css
/* Surfaces — du plus sombre au plus clair */
--s-bg:         #08080f     /* fond page */
--s-surface:    #0e0e1a     /* cards, panels, sidebar */
--s-elevated:   #151525     /* éléments surélevés, hover states */
--s-hover:      #1c1c30     /* hover intense */

/* Brand — 4 couleurs */
--s-violet:       #7B2FBE   /* accent système/navigation UNIQUEMENT */
--s-violet-light: #a364d9   /* variante claire */
--s-gold:         #FFB800   /* rare et précieux — CTA principal, récompenses */
--s-blue:         #0081FF   /* Rocket League */
--s-green:        #00D936   /* Trackmania */

/* Texte */
--s-text:       #eaeaf0     /* principal */
--s-text-dim:   #7a7a95     /* secondaire */
--s-text-muted: #4a4a60     /* tertiaire, labels discrets */

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

#### Cards pilier/section (sans image)
Quand une card n'a pas d'image de fond, elle doit quand même avoir de la présence :
- **Accent bar colorée** en haut (3px, gradient de la couleur du pilier)
- **Glow subtil** dans un coin (radial-gradient de la couleur, opacity 0.07 → 0.12 au hover)
- **Icône encadrée** avec fond teinté de la couleur (`${accent}10` bg, `${accent}25` border)
- **Stat counter** en Bebas Neue si pertinent
- **Hover** : border passe à `rgba(255,255,255,0.18)`, bg passe à `--s-elevated`

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
- **Cards plates sans aucun accent** → chaque card doit avoir une identité couleur
- **Inline border + Tailwind hover** → Tailwind ne peut pas override un inline style, utiliser une classe CSS dédiée avec `!important`
- **Images en hotlink** depuis des sites de jeux (ils bloquent) → toujours `/public/`
- **Doublons d'information** → ne pas afficher la même stat à deux endroits

### Animations
- `animate-fade-in` : apparition douce (0.4s ease)
- `animate-fade-in-d1/d2/d3` : décalées de 0.1/0.2/0.3s pour effet cascade
- Transitions hover : `duration-150` à `duration-200`, jamais plus

### Logo
Fichier : `public/springs-logo.png`
- Blanc + or + violet sur fond noir
- Affiché en haut de la sidebar (120×36px)

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
  → Hub Springs, prochains événements, stats globales, actualités

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
| **Admin Springs** | Google OAuth + UID dans collection `admins` | Tout : valider structures, créer comps, override tout |

### Règles fondateur
- Doit faire une **demande** → Springs fait un entretien → admin valide
- Maximum **2 structures** par fondateur
- Ne peut pas quitter une structure sans transférer la propriété
- Ne peut pas supprimer son compte s'il est encore fondateur

---

## Collections Firestore

### Collections existantes (à réutiliser/étendre)
- `admins` — `{uid: true}` admins plateforme (Google UIDs) — anciennement nommé "admins Springs", la collection garde son nom legacy
- `participants` — profils joueurs TM (ne pas modifier)
- `editions` — éditions TM cup (ne pas modifier)
- `results` — résultats TM (ne pas modifier)

### Nouvelles collections Springs Hub

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
  type: "training",         // training | scrim | match | springs
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
- **Phase 2 bis** — Roadmap UX globale : en cours, voir mémoire [project_ux_roadmap.md](../.claude/projects/c--Users-mattm-springs-hub/memory/project_ux_roadmap.md) (14 items, cocher au fil de l'eau)
- **Phase 3** — Compétitions : liste, pages individuelles, rebuild TM Monthly Cup, classements RL/TM, inscription équipe/solo, panel admin comps
- **Phase 4** — Finitions : notifications in-app, Discord webhooks, fan zone, mobile, migration liens

Durcissement déjà en place : Sentry, rate limiting Upstash, Toast/Modal DA Springs, suite Vitest, sécurité (CSRF OAuth, validation, rules, batch writes, hard caps).

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
- **Site dev** : `https://springs-hub.vercel.app`
- **Site actuel (archive)** : `https://springs-esport.vercel.app`
- **GitHub** : `https://github.com/skypi11/springs-hub`
- **Firebase console** : projet `monthly-cup`
- Discord OAuth redirect à configurer : `https://springs-hub.vercel.app/api/auth/discord/callback`
