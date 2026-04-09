# Springs Hub — Plateforme principale Springs E-Sport

## Contexte général
Site principal de Springs E-Sport, association événementielle esport (Directeur Général : utilisateur).
Remplace progressivement le site actuel (`site cup monthly` / `springs-esport.vercel.app`).

**L'utilisateur n'est pas développeur.** Claude fait tout le code et les pushs. Il vérifie uniquement sur Vercel.

### Relation avec le site actuel
- Le site actuel (`C:\Users\mattm\site cup monthly`) reste intact pendant tout le développement
- Une fois Springs Hub prêt, il devient le point d'entrée principal
- Les pages RL et TM actuelles deviennent des archives accessibles en lien
- **Ne jamais modifier le repo `site cup monthly`** depuis ce projet

---

## Stack technique

- **Framework** : Next.js (App Router)
- **Styling** : Tailwind CSS
- **Base de données** : Firebase Firestore (projet existant `monthly-cup`)
- **Auth** : Firebase Auth — Discord OAuth (joueurs/fans) + Google OAuth (admins Springs)
- **Hébergement** : Vercel → `springs-hub.vercel.app` (URL dev)
- **Repo GitHub** : `skypi11/springs-hub`
- **Domaine final** : custom à venir (~10-15€/an sur Namecheap ou Porkbun)
- **Polices** : Outfit (corps) + Bebas Neue (titres display, via `font-display` CSS)

### Firebase config (projet existant `monthly-cup`)
- UID Discord : `discord_SNOWFLAKE`
- UID Admin : Google UID (collection `admins`)
- `experimentalAutoDetectLongPolling: true` sur Firestore (WebSocket + fallback long-polling)

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

## Design system

### Palette
```css
--bg-base: #080810          /* fond principal très sombre */
--bg-surface: #0f0f1a       /* cartes, sidebar */
--bg-elevated: #16162a      /* éléments surélevés */
--springs-violet: #7B2FBE   /* accent principal */
--springs-gold: #FFB800     /* accent secondaire */
--springs-white: #FFFFFF
--text-primary: #F0F0F0
--text-secondary: #8888AA
--border: rgba(123,47,190,0.2)  /* bordures subtiles violet */
```

### Style visuel
- Dark gaming premium (références : Faceit, Battlefy, Elite Gamers Arena)
- **Layout sidebar fixe** (260px) à gauche + contenu principal **pleine largeur** à droite (pas de max-w contrainte)
- Violet utilisé avec **parcimonie** : uniquement pour CTAs actifs, bordures d'accent, glows sur éléments interactifs
- Borders des cards : `rgba(255,255,255,0.07)` neutre (pas violet)
- Glows de fond : opacité max 0.09–0.10 (très subtils)
- Bebas Neue pour tous les titres (`font-display`), Outfit pour le texte courant
- Animations subtiles, transitions fluides

### Logo
Fichier : `public/springs-logo.png`
- Blanc + or + violet sur fond noir
- Affiché en haut de la sidebar (120×36px)

### Fichiers clés
- `lib/firebase.ts` — init Firebase client (Firestore + Auth)
- `context/AuthContext.tsx` — auth global (Discord OAuth + état utilisateur)
- `app/api/auth/discord/callback/route.ts` — callback OAuth serveur (Admin SDK)
- `components/layout/Sidebar.tsx` — sidebar fixe avec nav + profil
- `firestore.rules` — règles Firestore complètes (copier-coller dans Firebase Console)

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
- `admins` — `{uid: true}` admins Springs (Google UIDs)
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

### Phase 1 — Fondations (3 semaines)
- [x] Setup Next.js + Tailwind + Firebase
- [x] Layout global : sidebar fixe, navigation, design système Springs (Bebas Neue)
- [x] Auth Discord fonctionnelle (login + persistance refresh + photo profil)
- [x] Pages : Accueil, Communauté (placeholder), Compétitions (liens vers ancien site)
- [x] Deploy Vercel — `springs-hub.vercel.app`
- [x] Règles Firestore complètes — fichier `firestore.rules` à la racine du repo
- [ ] Page profil utilisateur (création/édition) ← PROCHAINE ÉTAPE

### Phase 2 — Communauté (4 semaines)
- [ ] Demande de création de structure + validation admin
- [ ] Dashboard fondateur : infos structure, membres, roster
- [ ] Gestion membres : invitations, demandes rejoindre
- [ ] Sous-équipes RL
- [ ] Annuaire public structures
- [ ] Annuaire joueurs libres / recrutement

### Phase 3 — Compétitions (4 semaines)
- [ ] Section compétitions : liste, pages individuelles
- [ ] Rebuild TM Monthly Cup (lecture données Firestore existantes)
- [ ] Classements RL et TM
- [ ] Inscription équipe/solo à une comp
- [ ] Panel admin : créer/gérer compétitions

### Phase 4 — Finitions (3 semaines)
- [ ] Calendrier des structures (événements + présences)
- [ ] Notifications in-app
- [ ] Discord webhooks
- [ ] Fan zone (prédictions, suivre équipes)
- [ ] Optimisation mobile
- [ ] Migration liens depuis ancien site

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
