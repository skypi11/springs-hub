# Chantier UX site — juillet 2026

Déclencheur : passe de retours de Matt (16/07) sur le site lui-même (hors module
compétition), après remontées de dirigeants/coachs. Ce document est la **source de
vérité du chantier** : tout ce qui a été repéré y est listé, y compris les bugs
« bonus » trouvés en chemin que Matt n'avait pas signalés.

Méthode : investigation multi-agents (12 agents, chaque conclusion contre-vérifiée par
un sceptique relisant le code). Les causes racines ci-dessous sont **prouvées**, pas
supposées, sauf mention explicite.

Règle de ce chantier : **rien ne se perd**. Un item non fait est REPORTÉ explicitement
avec sa destination, jamais abandonné en silence.

---

## Décisions de Matt (16/07) — ne pas re-débattre

| Sujet | Décision |
|---|---|
| Sauvegarde des dispos | **Auto-save** (fini les boutons « Enregistrer ») |
| Cap templates partagés | **Refermer à 15** (le chemin de promotion doit respecter le plan) |
| Bouton de partage de template | **Le rendre visible** (bouton texte, pas une icône nue) |
| Onglet Replays du capitaine | **Oui**, à lui donner |
| Stats des replays pour les joueurs | **Oui**, mais **jamais** de déclenchement de parsing par un joueur (quota) |
| Recherche/tri Membres | **Go** |
| Sélection de plage (dispos mobile) | Intéressé, **à condition que ce soit intuitif** : changement de couleur entre le tap d'ancrage et le tap de confirmation |

---

## Lot 1 — Bugs de perte de données (priorité absolue)

### 1.1 Les dispos de la 2e semaine sont effacées au save — **PROUVÉ**

**Symptôme (Matt)** : « quand on rentre ses dispos puis on sauvegarde, ça ne sauvegarde
pas les dispos de la semaine d'après et ça la reset même ».

**Cause racine** : `AvailabilityGrid.tsx` — le `onSuccess` du save (:124-129) réécrit le
cache React Query en y réinjectant l'**ancienne valeur serveur** de l'autre semaine
(`const nextW = which === 'next' ? {...} : prev.next`). L'objet racine étant neuf,
`replaceEqualDeep` publie une nouvelle référence → l'effet de resync global (:100-107)
part → `setNextSet(new Set(data.next.slots))` **écrase la saisie non sauvegardée** et
`setNextDirty(false)`.

**Ce qui verrouille la perte** : `nextDirty=false` ⇒ bouton `disabled` (:366) + libellé
« À jour » (:377) + disparition du badge « NON SAUVEGARDÉ » (:335-344).
**L'UI affirme que la semaine qu'elle vient d'effacer est sauvegardée, et interdit de la
ré-enregistrer.**

Bug **symétrique** (sauver « suivante » écrase « courante ») et ne mord que si l'autre
semaine est dirty → ressenti intermittent. Cas où il ne mord pas : slots identiques
(toggle on/off) → `replaceEqualDeep` renvoie la même référence.

**Hypothèses écartées, preuve à l'appui** : payload (mono-semaine), `merge:false`
(doc scopé par semaine), weekId (`getIsoWeekId` correct, vérifié aux bascules d'année),
state partagé (non), refetch réseau (la mutation ne fait aucun `invalidateQueries`).

**Fix retenu** (Matt = auto-save) : voir 1.2 — l'auto-save remplace les boutons, et le
garde `if (dirty) return;` sur l'effet de resync devient obligatoire dans tous les cas.

### 1.2 Auto-save des dispos (décision Matt)

Remplace le débat « 1 ou 2 boutons ». Précédent interne : Settings (débounce 2 s).

À traiter :
- Débounce ~2 s après la dernière modification, sur **les deux semaines**.
- Le contrat serveur est **mono-semaine** aujourd'hui (`PUT /api/availability/me`).
  Deux PUT = 2 hits sur `limiters.write` (route.ts:72-73) → **un endpoint
  multi-semaines** (`{weeks: [{mondayYmd, slots}]}`, transaction, rétrocompat
  mono-semaine) est préférable : atomique + 1 seul hit de rate-limit. Vérifier le
  débit d'écriture engendré par l'auto-save.
- Garde sur l'effet :100-107 : ne jamais resynchroniser une semaine dirty.
- Indicateur d'état (« Enregistré » / « Enregistrement… ») — l'auto-save silencieux
  inquiète sur une donnée que le joueur vient de saisir.
- `AvailabilityGrid` est monté à **2 endroits** : `app/calendar/page.tsx:241` ET
  `components/structure/PlayerStructureView.tsx:375` → vérifier les 2 écrans.

### 1.3 Replier « MES DISPOS » détruit la saisie — **PROUVÉ** (bonus, non signalé par Matt)

`AvailabilityCollapsible.tsx:91` → `{expanded && <AvailabilityGrid />}` : replier
**démonte** le composant et jette tout le state local non sauvegardé, sans un mot.
L'auto-save (1.2) neutralise ce chemin de perte. Sinon : garder monté (masquage CSS).

### 1.4 Le formulaire d'événement recoche tout le monde — **PROUVÉ**

**Symptôme (Matt)** : « après une dizaine de secondes ça fait comme un refresh et ça
resélectionne tout le monde ».

**Cause racine** :
1. `my-structure/page.tsx:153-157` → `setInterval(() => setNow(Date.now()), 60_000)`.
2. Le re-render ré-exécute `page.tsx:1120-1133` (`teams.map(...)` **sans `useMemo`**)
   → identité neuve. Idem `structureRoles` (:1908-1913, littéral inline).
3. `EventFormModal.tsx:213-227` → `singleTeamRoster` recalcule → objet neuf.
4. `EventFormModal.tsx:230-239` → `useEffect([singleTeamRoster])` part →
   **tout le monde recoché** (:236-238).

**C'est 60 s, pas 10 s** : l'interval démarre au montage de la PAGE, à phase fixe. Ouvrir
la modale 50 s après le chargement → écrasement 10 s plus tard. Délai perçu aléatoire
dans [0, 60 s] — cohérent avec « une dizaine de secondes ».

**Condition** : le reset des joueurs n'arrive **que si exactement 1 équipe est
sélectionnée** (`EventFormModal.tsx:214` : `if (scope !== 'teams' || selectedTeamIds.length !== 1) return null`).
Le miroir **staff n'a pas ce garde-fou** : il part à chaque re-render, quel que soit le
scope (`staffAudienceGroups` rend toujours un objet neuf).

**Fix retenu** : dep de l'effet = **clé primitive stable** dérivée du choix user + du
roster réel (`${team.id}:${entries.map(e=>e.uid).join(',')}`), pas l'identité mémoire.
+ complément d'hygiène : `useMemo` sur `calendarTeams`, `structureRoles`, `userContext`
(à noter : `page.tsx` n'a **aucun** `useMemo` aujourd'hui — ce serait le premier).
**Rejeté** : poser une `key` (remonterait la modale = détruirait horaires + titre, soit
exactement le symptôme 1.5) ; geler le refetch (traite le symptôme).

### 1.5 Les horaires se réinitialisent (mobile) — **RÉSOLU : c'est le DateTimePicker**

**Info décisive (Matt, 16/07)** : symptôme rapporté par un **coach, sur téléphone**.

**L'hypothèse « remontage par le clavier » est RÉFUTÉE**, preuve à l'appui (et c'est
important : partir la corriger aurait été du temps perdu) :
- La modale est un **frère** du switch de vues (`CalendarSection.tsx:453-472` vs body
  `:386-451`) → un changement d'état d'une vue ne peut pas la remonter.
- Les **5 `matchMedia` du repo sont tous en LARGEUR** (`min-width:1024px` /
  `max-width:639px`). Le clavier virtuel change la **hauteur**. Il ne peut rien déclencher.
- `Portal.tsx:6-12` est stable (conteneur constant, pas de key). Aucun `key` sur la chaîne.
- Les portes de démontage de la page (`page.tsx:991`, `:999`) **ne peuvent pas se
  re-fermer** : `setLoading` n'est jamais rappelé avec `true` (`page.tsx:280`),
  `AuthContext` ne fait que `true → false`.

**VRAIE CAUSE — `DateTimePicker` jette le choix, et sur mobile « Valider » est
inatteignable :**
1. Le choix n'est commité au parent **que** par `apply()` (bouton « Valider »,
   `DateTimePicker.tsx:191-195`, :366-380) ou `selectPreset()` (:162-165).
2. Le click-outside (`:99-109`) fait `setOpen(false)` **sans rien commiter** →
   `onChange` n'est jamais appelé → le choix est **jeté**.
3. À la ré-ouverture, `:70-79` re-synchronise depuis `value` → **l'ancienne valeur
   revient**. C'est littéralement « les horaires se réinitialisent ».
4. **Pourquoi seulement sur mobile** : `:87` pose `top: r.bottom+4, left: r.left`
   **sans aucun clamp viewport** (alors que `MonthView.tsx:279-280` clampe
   correctement — le bon pattern existe déjà dans le repo). `EventFormModal.tsx:460-481`
   met les 2 pickers en `grid grid-cols-2` non responsive → à 390px, colonnes ≈155px, le
   bouton « Fin » a `r.left ≈ 200` → popup sur x ∈ [200, 500] → **~110px hors écran**, et
   `position: fixed` donc non rattrapable au scroll. En hauteur, le popup fait ~420px →
   « Valider » passe sous le pli, et clavier ouvert il est hors champ.
5. **Corroboration décisive** : `CalendarSection.tsx:398` (`onDayCreate`, le chemin mobile
   principal via MonthView `isNarrow`) préremplit **T20:00/T22:00**. Le coach choisit
   21:00, ne peut pas atteindre « Valider », tape à côté → **le champ retombe sur 20:00**.
   Symptôme reproduit à l'identique.

**Fix** :
- `DateTimePicker` : **commit en direct** (`onChange` dans les setters `:303/:336/:351`)
  → « Valider » devient une simple fermeture et le click-outside n'a plus rien à perdre.
  Garder la garde `Number.isNaN` (:41).
- **Clamper le popup au viewport** dans `update()` (:84-88) en copiant `MonthView.tsx:279-280`
  + `maxHeight` / `overflowY:auto` pour que « Valider » soit toujours atteignable.
- Sur écran étroit : **bottom-sheet**. ⚠️ Calculer la largeur **dans `update()` au moment
  de l'ouverture**, jamais en branche de rendu — sinon on crée pour de vrai le remontage
  qu'on vient de réfuter.
- `pointerdown` au lieu de `mousedown` (:107).
- **Complétude vérifiée par grep** : `DateTimePicker` n'a **qu'un** consommateur
  (`EventFormModal:463,472`), et `app/calendar/page.tsx` (calendrier joueur) n'en a
  aucun → **un seul fix, pas de route oubliée**.

### 1.6 Le backdrop ferme la modale et détruit TOUT — **bonus grave, mobile surtout**

`EventFormModal.tsx:419-423` : backdrop englobant + `stopPropagation` sur le contenu.
**Le `stopPropagation` ne protège PAS** : quand `mousedown` et `mouseup` ont des cibles
différentes, le `click` est dispatché sur **l'ancêtre commun** (le backdrop) → `onClose`
→ démontage → **titre, description, horaires perdus**.
Geste déclencheur, très fréquent au doigt sur une modale longue : presser sur le
formulaire, relâcher sur la zone sombre. Idem en refermant le clavier en tapant à côté.

**Fix** : ne fermer que si le geste a **commencé** sur le backdrop
(`onPointerDown` mémorise `e.target === e.currentTarget`). + confirmation si le
formulaire est sale (le `ConfirmProvider` est déjà monté, `app/layout.tsx:129`).
+ fermeture par `Escape`.

**Le pattern nu est dupliqué dans ~11 modales** (`EventDetailModal:224`,
`TodoDetailDrawer:185`, `TeamDetailDrawer:106`, `PlayerEventDrawer:167`,
`ReplayStatsDrawer:140`, `StaffGamesScopeModal:156`, `DocumentsExplorer:784` et `:891`,
`RoleInfoPanel:147`, `TodoTemplatesManager:63`, `CrossTeamTodosPanel:937`,
console compét `:1087`) → **extraire `components/ui/ModalBackdrop.tsx`** (garde
pointerdown + Escape), sinon on re-signale le même bug ailleurs dans 15 jours.
Contre-exemple immunisé par construction : `community/structure/[id]/page.tsx:288-292`
(overlay **frère**, contenu non descendant).

⚠️ **Correction du vérificateur** : le plan initial disait « verrouiller le scroll du
body en copiant `TodoDetailDrawer.tsx:128-130` » → **INOPÉRANT ici**. Le vrai scroller
n'est **pas** le body (`layout.tsx:114` + `LayoutShell.tsx:46 flex-1 overflow`,
`window.scrollY` reste à 0 — cf. mémoire `project_scroll_container`). Le pattern copié
est probablement **déjà inopérant** partout où il est utilisé. À traiter séparément, sans
le copier aveuglément.

`overscroll-behavior` est **absent du repo entier** (0 hit) → `html, body {
overscroll-behavior-y: contain }` tuerait le pull-to-refresh Android (risque quasi nul,
gain mobile réel). Le lien pull-to-refresh → perte du formulaire reste **plausible mais
non prouvé** (la justification initiale était fausse).

---

## Lot 2 — Bugs bonus repérés (Matt : « tout ce que tu as repéré, il faut le régler »)

| # | Bug | Preuve | Gravité |
|---|---|---|---|
| 2.1 | **Trou freemium** : la promotion perso→partagé ne consulte **jamais** le plan (cap 50 codé en dur) alors que la création dérive 15 du plan. Contournable **en 2 clics via l'UI normale** : créer en perso → Partager → monter à 50. | `[templateId]/route.ts:76-78` + `TEMPLATE_MAX_PER_SCOPE=50` vs `todo-templates/route.ts:148-152` ; `getStructurePlan`/`getLimit` **jamais importés** dans le fichier de promotion | **Élevée** (limite freemium inopérante) |
| 2.2 | **Fuite du snowflake Discord** : les liens profil de l'onglet Membres retombent sur `/profile/discord_SNOWFLAKE` car le champ `slug` n'est **jamais** renvoyé par l'API. Exactement ce que le chantier slugs voulait éviter. | `members-tab.tsx:105` et `:221` lisent `.slug` ; `api/structures/my/route.ts:208-217` ne le renvoie pas ; idem `api/structures/[id]/history/route.ts:80-81` → **2 routes** | **Sécu** (moyenne) |
| 2.3 | **« Staff dispos pré-cochés » morte à la naissance** : créer un event depuis la heatmap STAFF passe bien les staff dispos du créneau (`CalendarSection.tsx:419-427`, init :152-159), mais l'effet :242-253 part et **recoche tout le staff**. | même cause racine que 1.4 | Moyenne (feature inopérante) |
| 2.4 | **Compteur staff faux à l'ouverture** : les capitaines comptent dans le total (`:709-714`) mais ne sont jamais pré-cochés (`:248-251`) → ratio du type « 3/4 » dès l'ouverture. | `EventFormModal.tsx` | Faible |
| 2.5 | **Responsable pur privé du bouton « Nouvel événement »** : l'UI teste `isDirigeant \|\| staffedTeamIds.length>0 \|\| captain` et **oublie `isManager`**, alors que le serveur l'autorise (modèle A). Fix = **2 fichiers** : le gate ET le filtre d'équipes du formulaire (sinon le formulaire s'ouvre vide et bloque au submit). | `CalendarSection.tsx:290-292` + `EventFormModal.tsx:258-263` (qui connaît pourtant déjà `isManager` en :162) | Moyenne |
| 2.6 | **Copy mensongère** : « Clique ou **glisse** pour sélectionner plusieurs créneaux » — glisser ne fait que scroller sur mobile. | `AvailabilityGrid.tsx:196` | Faible (mais c'est un mensonge à l'utilisateur) |
| 2.7 | **Bouton Supprimer de template proposé à qui ne peut pas** : rendu hors du bloc `isOwner`, donc affiché à tout staff ; le serveur 403 systématiquement. Un non-owner ne voit QUE la poubelle. | `TodoTemplatesManager.tsx:445-450` vs `[templateId]/route.ts:147-150` | Faible |
| 2.8 | **Capitaine invité à une réunion staff qu'il ne verra jamais** : `event-permissions.ts:351-353` + `getAllStaffAudienceIds:362` incluent les capitaines, mais `events/route.ts:71-73` construit `staffAudienceSet` **sans** `captainIds` → l'event n'apparaît jamais dans sa liste. Feature « brief capitaines » à moitié morte. | idem | Moyenne |
| 2.9 | **Coach : refus après coup** : le formulaire lui propose les 5 types d'event alors que le serveur refuse match/tournoi/autre. Vrai coût = enrichir le `userContext` client (il n'a ni `managedTeamIds` ni `coachedTeamIds` ni `teamGames`, donc **le client ne peut pas** rejouer la permission fidèlement aujourd'hui). | `EventFormModal.tsx:447-451` vs `event-permissions.ts:255-258` ; `page.tsx:1111-1119` | Faible |
| 2.10 | **Template multi-steps affiché sous une seule étiquette** : la ligne n'affiche que le type du **1er step** (proxy legacy) → un template de 5 steps paraît en avoir 1. | `TodoTemplatesManager.tsx:405` ; `todo-templates.ts:28` et `:227` | Faible (cosmétique/trompeur) |
| 2.11 | **TOCTOU sur le cap templates** : check du cap et `update` non transactionnels (2 partages concurrents peuvent dépasser). Même famille que le cooldown TOCTOU corrigé sur les rappels dispos. | `[templateId]/route.ts:73-84` ; `todo-templates/route.ts:153-163` | Faible — **REPORTÉ** (une transaction imposerait un compteur dénormalisé sur 3 chemins : risque de désync > risque de course sur des templates) |
| 2.12 | **Commentaire périmé** : `members-tab.tsx:414-415` affirme que « le parent refetch via React Query grâce à l'invalidation » — `page.tsx` n'utilise **aucun** React Query (refresh manuel via `loadStructures()`). Piège pour la prochaine session. | grep : seuls `replays-tab.tsx:42` et `inscriptions-tab.tsx:71` utilisent React Query dans ce dossier | Faible |
| 2.13 | **« Parser tous les replays » : bouton visible → 403 garanti. BUG LIVE EN PROD** (et non latent, comme cru d'abord) : l'UI l'affiche sur `canEditAny` (= droit d'upload) mais le serveur est **dirigeant-only**. Touche **coach + responsable** (qui ont déjà l'onglet Replays, `constants.ts:23,25`) **et le capitaine** via le calendrier → `EventDetailModal:661-673` → `ReplaysPanel` (aucun gate de rôle). | `ReplayList.tsx:165` (`canEditAny`) vs `batch-forward/route.ts:55` (`isDirigeant`) | **Moyenne, à corriger indépendamment du 3.3** |
| 2.14 | **Fuite inter-jeux sur les stats agrégées** : `replay-stats-agg` fait `if (isStaff(ctx)) → TOUTES les teams`, **non scopé par jeu** — un coach Valorant (`coachGames:['valorant']`) voit les stats des équipes RL. Les 2 autres surfaces scopent pourtant (`stats:72-81`, `replays:62-79`). | `replay-stats-agg/route.ts:54-59` vs `event-permissions.ts:100-102` | **Sécu (moyenne)** |
| 2.15 | **État `quota_exceeded` affiché « pending »** : jamais mappé côté client, tombe dans le `else` → le staff croit que ça analyse alors que le quota est épuisé. | `ReplayStatsDrawer.tsx:103-104` | Faible |
| 2.16 | **Filtre d'équipes non scopé dans l'onglet Replays** : `teams={teams}` = TOUTES les équipes → un capitaine verrait « Toutes les équipes (12) » alors que la liste ne contient que la sienne. Bloquant pour 3.3. | `page.tsx:1946` ; `replays-tab.tsx:171-183` | Faible (mais à faire avec 3.3) |
| 2.17 | **Doc périmée** : `docs/responsive-mobile-plan.md:73` affirme que la vue Semaine est masquée `< lg` via matchMedia — faux, `CalendarSection.tsx:214` fait `const effectiveViewMode = viewMode;`, aucune media query. | — | Faible (piège doc) |

---

## Lot 3 — Features demandées

### 3.1 Recherche + tri dans l'onglet Membres — **GO**

Client-side, sans hésitation : ~100-150 membres max pour une grosse structure
(rosters RL 3+2, VAL 5+2, TM 1 — `games-registry.ts`), payload déjà chargé entier
(`/api/structures/my`, non paginée).
**Ne pas copier** la pagination curseur de `players/page.tsx` (annuaire GLOBAL, milliers
d'users — et même là, filtres/tris sont client-side).

- Précédent le plus proche à copier : `teams-tab.tsx:796-846` (toolbar recherche +
  chips), même famille d'onglets. Filtres composés :150-163.
- Analogue exact du besoin côté admin : `admin/users/page.tsx:261-297` (recherche +
  chips sur **rôles dérivés** :200-215).
- Tri **sur le rôle dérivé** (`computeMemberRole`), jamais sur `structure_members.role`
  (champ stocké, non fiable pour l'affichage — `lib/member-role.ts:4-6`).
  Note : le tri par rôle **existe déjà** comme ordre par défaut en dur
  (`members-tab.tsx:192-194`, `PRIMARY_ROLE_ORDER`) → c'est le défaut à **conserver**,
  les autres tris sont des alternatives.
- Champ de saisie : `.settings-input has-icon-sm` — **jamais de `pl-*` Tailwind** (ne
  prend pas, cf. `design-system.css:439-441`).
- **PIÈGE BLOQUANT** : le panel est `.bevel` → son `clip-path` **clippe tout dropdown
  enfant**. `MemberActionsMenu` contourne déjà via Portal + position fixe. → chips
  inline (pas de clipping) ou Portal obligatoire.
- Enrichir le payload (coût **0 lecture**, `usersById` déjà en mémoire, `route.ts:199`) :
  `slug` (cf. 2.2), et éventuellement `rlAccountVerified`, `isAvailableForRecruitment`.

**Question ouverte (Matt)** : granularité des chips de rôle — 9 (un par rôle dérivé) ou
3 groupes (Direction / Staff / Joueurs) ? À ~150 membres, 9 chips saturent la toolbar.

### 3.2 Template d'exercice partageable — **la feature EXISTE déjà**

Un coach propriétaire peut promouvoir son template perso : onglet exercices → bouton
« Templates » → icône Share2 sur sa ligne → `PATCH .../todo-templates/[templateId]`
`{action:'share', scope:'structure'}` (`route.ts:62-86`).

**Le besoin remonté est donc un problème de DÉCOUVRABILITÉ**, pas de fonctionnalité :
icône nue de 12px, sans libellé, collée à une poubelle ; et la copy de l'état vide
(:122) ne parle du partage qu'**à la création**.

À faire (décision Matt) :
- **Refermer le cap à 15** (2.1) : importer `getStructurePlan`/`getLimit`, aligner sur
  le message + `upgradeHint` du POST, et **extraire le check dans un helper partagé**
  importé par les DEUX routes — la duplication du check EST la cause du bug.
- Bouton **texte** « Partager à la structure » / « Rendre perso » sur les lignes owner.
- Copy de l'état vide corrigée + badge de scope par ligne + nb de steps (cf. 2.10).
- Optionnel : compteur « 12/15 partagés » pour rendre la limite lisible **avant** de
  buter dessus.

**Permissions actuelles (à ne pas changer)** : seul le **créateur** partage son template
(`ownerId !== uid → 403`, l.55-57 ; décision UX consignée : « le coach connaît mieux son
template »). Ça correspond exactement à la demande du coach. Seule exception owner-only :
DELETE, où un dirigeant peut faire le ménage (l.147-150, motif : coach parti).

**Sécurité du partage : OK.** Un template ne porte que la recette (`{id, type, label?, config}`) —
ni screenshot, ni lock, ni `completed` exploitable (`lockedAt`/`lockedBy` sont sur
l'INSTANCE, `lib/todos.ts:363-367` ; les screenshots sont des réponses de joueur).
Partager ne peut pas fuiter le screenshot d'un joueur.

**À vérifier en base avant de shipper** : existe-t-il des structures free avec >15
templates partagés ? Elles gardent leurs templates (aucune suppression) mais toute
nouvelle promotion sera refusée — comportement déjà en vigueur au POST.

**Question à relayer au coach (Matt)** : savait-il que le bouton existe ? Si oui, sa vraie
demande est probablement l'une de ces trois, **qui n'existent pas** : (a) **copier chez
lui** le template partagé d'un autre coach pour l'adapter (aucun « dupliquer » dans le
code) ; (b) partager à **une seule équipe** (le scope n'a que 2 valeurs → vrai chantier
de modèle) ; (c) partager **entre structures**.

### 3.3 Onglet Replays pour le capitaine — **GO**

`computeVisibleTabs` (`constants.ts:26-27`) → ajouter `'replays'` à la branche
captainOnly. Le serveur **filtre déjà** par équipe pour lui (`replays/route.ts:65-73`),
aucune modification backend. À vérifier : `replays-tab.tsx` avec un contexte capitaine
(`canEdit` par ligne, filtres, actions proposées).

### 3.4 Stats des replays visibles par les joueurs, **sans déclencher de parsing** — GO

Décision Matt : le joueur voit les stats **si elles ont été parsées** par le capitaine ou
le staff ; il ne doit **jamais** pouvoir lancer un parsing (quota ballchasing : 20/semaine
/structure).

État actuel : le joueur peut **télécharger le fichier** mais les **stats lui sont
refusées** (403). Verrouillé par un test (`lib/replay-permissions.test.ts:107-109`).

**Piège structurant** (attrapé par un vérificateur) : `canDownloadReplay` garde **TROIS**
routes, pas deux — `stats/route.ts:63`, `replay-stats-agg/route.ts:41`, **et
`app/api/events/[eventId]/meta/route.ts:37`**, qui avait été oubliée. La page
`/community/event/[id]/stats` 403 **d'abord** sur `meta` (`statsQuery` est
`enabled: !!metaQuery.data?.structureId`) → n'ouvrir que les deux autres **ne changerait
rien** pour le joueur.

**Où le joueur voit les replays aujourd'hui (réponse à Matt)** : Sidebar → **Calendrier**
→ clic sur un scrim/match où il est invité → panneau de droite → section **« REPLAYS DU
SCRIM »** → bouton **Télécharger** (`PlayerEventDrawer.tsx:339-379`, monté par
`app/calendar/page.tsx:365`). Le serveur l'autorise déjà (`replays/route.ts:75-77`).
⚠️ Un event de scope `structure`/`game` n'affiche **aucune** section replay
(`PlayerEventDrawer.tsx:113` exige `scope === 'teams'`).

**Découpage retenu** — deux droits distincts, là où il n'y en a qu'un :
- `canViewReplayStats(ctx, teamId, team)` → **lecture de stats déjà parsées**, coûte
  **zéro quota**. Périmètre : dirigeant, staff/coach **scopé par jeu**, capitaine, **+
  player/sub de l'équipe** (le nouveau).
- `canTriggerParse(ctx, teamId)` = `canUploadReplay` → **déclenche un parsing, consomme le
  quota**. Staff + capitaine. **Jamais un joueur.**
- `canViewEventReplayStats(ctx, target, teams)` pour la page d'event.
- `canDownloadReplay` **supprimé** (nom mensonger : il ne garde pas le download) — ses 3
  call sites sont réécrits.

**Faits vérifiés qui rendent le plan sûr** :
- **Le quota n'est consommé QUE par le forward** (`bcUploadReplay` écrit
  `ballchasingStatus:'uploaded'` + `ballchasingUploadedAt`, seuls champs comptés par
  `ballchasing-quota.ts:52-56`). `getReplay(bcId)` **ne coûte rien** →
  **`replay-stats-agg` est un chemin 100 % lecture, il ne peut pas déclencher de parsing.**
- L'ordre de `stats/route.ts` est **déjà bon** : le cache `ballchasingStats` v2 est servi
  **avant** tout appel externe (`:94-97`) → un joueur dont le replay est parsé reçoit les
  stats immédiatement, zéro quota. Il suffit de fermer le chemin `needsLazyForward`
  (`:118`) quand `!mayTrigger` → renvoyer `{state: 'pending' | 'not_parsed'}`.
- État exploitable : `ballchasingStatus` ∈ `pending | uploaded | failed | disabled |
  manual | quota_exceeded | null`. **Défaut = `manual`** (auto-parse OFF,
  `replays/[replayId]/route.ts:86`) → c'est ce cas qui déclenche le forward payant.
- `firestore.rules:158-161` : replays **deny-all** → **aucune modif de rules**.

**Ordre imposé** : traiter `meta/route.ts:37` **en premier** — sinon 3.4 est sans effet.

**Tests** : `lib/replay-permissions.test.ts:96-110` casse (tout le `describe`
`canDownloadReplay`, dont `:107-109` qui verrouille « joueur simple → KO »). L'import
`:2` casse aussi → **échec typecheck = filet utile**. À ajouter : player/sub → OK sur sa
team, **KO sur une autre** (anti-fuite) ; coach scopé RL → **KO sur une team Valorant**
(verrouille 2.14) ; `canTriggerParse(joueur)` → **false** (le test central de la décision).

**Incohérence à assumer explicitement** : `download/route.ts:80-96` a un fallback todo
`replay_review` → un joueur d'une **autre** équipe ayant un exercice de review pourra
toujours **télécharger** le replay mais se verra refuser ses **stats**. À porter dans le
helper ou à documenter — ne pas écrire un commentaire qui ment (le péché de
`canDownloadReplay` que ce lot corrige).

**Vérification** : sur `preview.aedral.com`, compte joueur → stats d'un scrim de SON
équipe (200 si `uploaded`) ; sur un replay `manual` → « pas encore analysé » **et vérifier
en base que `ballchasingUploadedAt` n'a PAS bougé** (preuve que le quota est intact) ;
puis joueur d'une AUTRE équipe → 403.

---

## Lot 4 — Saisie des dispos sur mobile (le sujet de fond)

**Symptôme (Matt)** : « c'est vraiment une galère à remplir, il faut cliquer 30 min par
30 min, le cliquer-glisser ne fonctionne pas sur téléphone ».

**Cause racine n°1 — le drag n'a jamais existé sur mobile** : la sélection multiple
repose **uniquement** sur `onMouseEnter` (`AvailabilityGrid.tsx:464-471`, armé par
`onMouseDown:456`). `mouseenter` est un événement de **survol** : il n'a aucun équivalent
tactile et n'est jamais dispatché sur les éléments traversés par un doigt. Le tap unitaire
marche parce que le navigateur **synthétise** un `mousedown` après le `touchend` — d'où
« cliquer 30 min par 30 min ». Le `e.preventDefault()` (:458) est impuissant : il
s'exécute sur le mousedown synthétisé, **après** le touchend.

**Cause racine n°2 — les cibles sont trop petites** : ~**33 × 22 px** à 390px de large
(chaîne : `LayoutShell.tsx:46` → `calendar/page.tsx:214` px-4 → `AvailabilityCollapsible.tsx:92`
px-5 → `AvailabilityGrid.tsx:329` p-5 → ~278px de table − 44px de colonne d'heures
= 234/7 ≈ 33px ; `ROW_HEIGHT=22` :415). Recommandations : 44×44 (Apple HIG) / 48dp
(Android) → env. **1/3 de la surface**. Grille de 36 lignes × 22px ≈ **790px de haut**,
**× 2 panneaux empilés** (jusqu'à 1700px, :204).

**Coût actuel** : une soirée 20h-23h = **6 taps** ; une semaine à 5 soirées = **~30 taps**,
puis on recommence sur le panneau de la semaine suivante.

**Aucun raccourci n'existe** hormis 2 boutons de **copie de semaine**
(`copyFromPrevious:144-159`, `copyFromCurrent:161-166`) — qui ne servent qu'**après** un
premier remplissage, donc pas là où ça bloque. Aucun preset, aucun « toute la soirée »,
aucun tap sur en-tête de jour/ligne d'heure (les `<th>` :398-407 et la colonne d'heures
:422-444 n'ont **aucun** `onClick`).

**Le contrat serveur est agnostique de l'UI** (`/api/availability/me` valide des slots de
30 min) → **toute refonte de la saisie est purement front**, aucun risque de migration.

**Précédents internes utiles** :
- `components/calendar/ExerciseStepsEditor.tsx:63-66` + `:209` — **@dnd-kit déjà en
  dépendance**, avec `PointerSensor` + `activationConstraint {distance:4}` et
  `touchAction:'none'` **scopé à une poignée** (pas au conteneur) : preuve interne qu'on
  peut avoir du drag tactile **sans confisquer le scroll de page**.
- `components/structure/BannerFocusEditor.tsx:35-69` — pointer events + `setPointerCapture`
  + `touchAction:'none'` sur conteneur plein (le **pire** cas, à ne pas copier tel quel).
- `TeamAvailabilityView.tsx:555-579` — le module **assume déjà** une vue mobile dédiée
  (`isNarrow` → `ConsensusHeatmapTransposed`), précédent pour une vue mobile de saisie.

### Recherche marché — FAITE (événements réels créés + inspectés à 390px en Playwright)

**Résultat n°1, contre-intuitif : personne n'a résolu « 7 colonnes × 30 min » avec de
grosses cibles tactiles.** Mesures au viewport 390px :

| Outil | cellule 30 min @390px, 7 jours | viewport meta |
|---|---|---|
| **Aedral** | **33 × 22** | présent |
| When2meet | **44 × 9** | **ABSENT** (→ fallback ~980px + dézoom) |
| Crab Fit | **57 × 12** (5 jours/7 visibles, scroll H) | présent |
| LettuceMeet | **38 × 20** (7 j) / 89×20 (3 j) | présent |

390px − gouttières ≈ 350/7 ≈ **50px max par colonne** : c'est de l'arithmétique, pas un
défaut d'Aedral. **« Agrandir les cases » n'est PAS ce que les leaders ont fait — ils ont
réparé l'INTERACTION.** Le levier est **le nombre de colonnes affichées**, pas la taille.

**Résultat n°2 : le marché s'est séparé selon un seul critère — le créneau est-il DÉJÀ
CONNU, ou faut-il le TROUVER ?**
- Sport amateur (créneaux imposés) → **RSVP par événement**, unanimement : Spond
  (Participating/Decline, **pas de « Maybe », choix assumé**), Heja (GOING/NOT GOING),
  TeamSnap, SportEasy, MonClubSportif.
- Esport (créneau à trouver) → **grille**. Guilded : grille horaire + click-and-drag.
- **⇒ Aedral est structurellement dans le camp esport : la grille n'est PAS l'erreur.**

**Résultat n°3 : c'est le VOLUME qui est hors norme.** Aedral demande **~252 cases**
(36 × 7). Le seul outil esport comparable, **Supatimer** (bot Discord), en demande **28**
(**4 blocs/jour** : matin/aprèm/soir/nuit) — « one tap », « 5 seconds ». **Facteur 9.**
Personne sur le marché n'exige 252 cases d'un joueur non motivé sur téléphone.

**Résultat n°4 — le marché DONNE RAISON à Matt sur la dispo récurrente** : aucun outil ne
vend « règle ta dispo une fois ». Ils rendent **récurrente la QUESTION, jamais la
RÉPONSE**. Gestion de l'obsolescence, 3 façons : expiration par construction (bot
gavinquach : reset de l'embed **tous les lundis 00:00** ; Supatimer : calendrier neuf
chaque semaine), présomption **bornée à un événement daté** (Spond/SportEasy « présent par
défaut » + présence réelle enregistrée après), résolution par **deadline** (FACEIT :
silence → valeur par défaut à échéance annoncée).

**Résultat n°5 — répondre SANS quitter le canal est systématique** : TeamSnap (« click
Yes/No in the reminder email », **no login**), SportEasy (répondre depuis la push),
Supatimer (**boutons sur le message Discord**). Diagnostic de When2meet par Supatimer —
c'est **littéralement le symptôme de Matt** : « requires everyone to leave Discord, open a
browser, and fill in a grid every week. Teams often send When2Meet links that **half the
group ignores** » (source vendeur, mais corroborée par le code).

**Patterns à voler (vérifiés dans le code, pas supposés)** :
1. **`releasePointerCapture(e.pointerId)` au `pointerdown`** (Crab Fit) — **LE** fix du
   « drag ne marche pas ». Au touch, le navigateur capture **implicitement** le pointeur
   sur l'élément du touchdown → `pointerenter` ne part jamais sur les voisines. Le
   relâcher réactive le hit-testing. WebKit bug 199803 **RESOLVED FIXED depuis iOS 13.2**
   (oct. 2019) → sûr. Précédent interne : `ExerciseStepsEditor.tsx:63-66` (@dnd-kit déjà
   en dépendance, `PointerSensor` + `activationConstraint distance:4` + `touchAction:none`
   **scopé à une poignée**).
2. **Figer le mode add/remove au `pointerdown`** (Crab Fit) — tue le bug rageant de
   When2meet (sémantique toggle : « le drag efface ce que je viens de sélectionner »).
3. **Mode édition EXPLICITE** (LettuceMeet) : lecture seule par défaut → « Ajouter mes
   dispos » → barre collante. Rend l'édition accidentelle **impossible par construction**.
4. **Pagination des jours par flèches** (LettuceMeet) au lieu du scroll horizontal :
   supprime le conflit à la racine. 2-3 jours/fenêtre → colonnes de **~100-150px** au lieu
   de 33. (Leurs flèches font 25×25px : **bon pattern, exécution à corriger** → ≥44px.)
5. **Confiner le débordement horizontal dans le conteneur** (LettuceMeet : body jamais
   scrollé latéralement) = exactement `feedback_no_horizontal_scroll`.
6. **Borner la fenêtre horaire** (Crab Fit 9h-17h ; LettuceMeet le demande à la création)
   — **le gisement le plus sous-estimé** : 8h→2h = 36 lignes, or **personne ne scrime à
   9h du matin**. Une fenêtre réglable **par équipe** (18h→2h = 16 lignes) coupe la grille
   de plus de moitié et débloque tout le reste. Gate-friendly (cf. `minPlayersForStaffMatch`).
7. **Raccourcis scopés au JOUR** (« toute la soirée », « copier ce jour vers mar/mer/jeu »,
   façon Calendly « use same hours for all days ») : **trou béant du marché** — aucune
   grille testée n'en a. ~30 taps → 3-4. Le joueur reste acteur chaque semaine (≠ dispo
   récurrente rejetée), on lui épargne la répétition mécanique.

**Anti-patterns à ne pas copier** : `touch-action:none` sur toute la grille (Crab Fit ne
s'en sort que grâce à ses 16 lignes ; sur nos 36 lignes ≈720px ça **piège** l'utilisateur
sans scroll) ; engager la sélection au `touchstart` (When2meet : tout pinch commence à
1 doigt → **le zoom édite la grille**) ; copy desktop sur mobile (« cliquez et faites
glisser », hints Ctrl+A sur un écran sans clavier).

### ⚠️ ALERTE STRATÉGIQUE (issue de la recherche) — ne pas gater la dispo

**TeamSnap réserve le suivi de dispo/RSVP aux plans payants → c'est son pain point n°1**
(avis G2 0.5/5 : « For basic player availability the team manager needs to pay a yearly
fee… »). Or Aedral a `plan-limits.autoAvailabilityReminder` **gate-ready** (`free→false`
= levier Pro futur) **et** « boutons interactifs Discord » listé dans la couche premium
envisagée. Si les boutons Discord deviennent le mécanisme qui fait enfin remplir les
dispos, **les gater = faire payer la seule chose qui rend le calendrier utilisable** —
exactement le grief anti-TeamSnap. Gater le branding / les analytics / le white-label :
oui. Gater ce qui fait marcher le calendrier : piège documenté.

À préserver aussi : ne **jamais** faire passer d'annonces produit par le canal de la
relance dispos (fatigue de notification → le joueur mute le bot → le rappel fonctionnel
meurt avec le bruit). Matt a déjà le bon réflexe (`dmAnnouncementsOptOut` ne coupe que les
annonces). Contre-mesure vue chez Heja : le nag « tu n'as pas répondu » est
**non-débrayable**, les rappels de confort le sont.

**Zéro preuve chiffrée dans tout le secteur** : aucun éditeur ne publie de taux de
réponse. Ce sont des **choix de design convergents**, pas des résultats prouvés.
→ Aedral a PostHog : instrumenter le funnel dispos (relance → ouverture → grille remplie)
donnerait à Matt ce que personne ne publie, et permettrait d'arbitrer blocs-vs-30min sur
des chiffres.

### Décisions produit en attente de Matt

1. **Borner la fenêtre horaire** (levier n°1, 36 → ~16 lignes) : réglage par équipe, ou
   simplement replier les heures creuses par défaut ?
2. **Pagination par jours sur mobile** (2-3 jours/fenêtre → colonnes 100-150px) : OK ?
3. **Granularité mobile** : 30 min ou blocs plus larges ? (Supatimer = 4 blocs/jour et
   c'est le seul qui a résolu le problème. Le stockage reste 30 min dans tous les cas.)
4. **Presets** : quels créneaux ? (la donnée existe en base — mesurer les slots les plus
   cochés avant de trancher.)
5. **IDÉE STRUCTURANTE à arbitrer** : remplir ses dispos **depuis Discord** (boutons sur
   l'embed, façon Supatimer), là où le bot poste déjà la relance. C'est le seul pattern
   qui supprime le « quitter Discord → ouvrir un navigateur » que le marché identifie
   comme la cause du non-remplissage. Gros chantier, et à croiser avec l'alerte
   stratégique ci-dessus (ne pas le mettre derrière le Pro).

**Lien avec l'adoption** : la friction de saisie mobile est probablement le facteur n°1
derrière « mes joueurs ne remplissent pas leurs dispos » — le rappel du bot
([[project_availability_reminders]], en prod depuis le 14/07) envoie les joueurs vers
**cet écran**. Le rappel traite le déclencheur ; ce lot traite la cause.

---

## Ordre d'exécution proposé

1. **Lot 1** (perte de données) — 1.1/1.2/1.3 (auto-save dispos), 1.4 (form event),
   1.5 (horaires mobile, dès diagnostic).
2. **2.1** (trou freemium) + **3.2** (bouton visible) — même fichier, même passe.
3. **2.2** (fuite snowflake) + **3.1** (recherche/tri Membres) — même fichier.
4. **3.3 + 3.4** (replays capitaine/joueurs) — même domaine.
5. **Lot 2** restant (2.3→2.10, 2.12).
6. **Lot 4** (dispos mobile) — après décision de Matt.

**Reporté explicitement** : 2.11 (TOCTOU cap templates — compteur dénormalisé jugé plus
risqué que le problème).
