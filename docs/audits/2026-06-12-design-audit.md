# Audit design anti-AI-slop — 2026-06-12

> Déclencheur : retours utilisateurs « le site pue l'IA » (construction des écrans,
> densité, cards uniformes, peu aéré). Audit multi-agent : 5 dimensions (densité,
> uniformité, copy, benchmark Faceit/Battlefy/Linear/Vercel, inspection visuelle
> du site en prod via navigateur). 55 findings bruts, synthèse dédoublonnée.
> La DA (noir+or, bevels, hex, Bebas) n'est PAS remise en cause.

## Diagnostic

Le site ne "pue l'IA" pas à cause de la DA (noir+or, bevels, hex — tout ça tient) mais parce qu'un SEUL template de conteneur est appliqué à tous les niveaux : barre d'accent 3px + glow radial + icône encadrée teintée + tag + titre Bebas, sur 97 occurrences dans 42 fichiers, du header de page à la modale de suppression en passant par chaque section de formulaire. Cause racine n°1 : cette uniformité est CODIFIÉE — le CLAUDE.md exige le chrome complet pour toute card et classe "card plate" en anti-pattern, donc chaque nouveau composant ressort mécaniquement identique, c'est littéralement un générateur de template. Cause racine n°2 : hiérarchie inversée — l'or est devenu l'accent par défaut (8+ fois par écran sur settings), tout est en uppercase tracké, les layouts sont des grilles symétriques de cards égales : quand tout crie au volume max, rien ne recule, donc rien n'avance, et l'œil lit "généré". Cause racine n°3 : l'UI ne fait pas confiance à sa propre clarté — chaque info est dite 2-3 fois (banner + widgets, header + panel INFORMATIONS), chaque champ porte un paragraphe pédagogique permanent, et des blocs entiers annoncent des features inexistantes ("Stats agrégées · à venir", changelog vide avec filtre fantôme). Cause racine n°4 : la copy est en mode marketing LLM — triades parfaites, exclamations, punchlines or en fin de section, "tout-en-un", emojis ⚠️🎮🏆 dans le chrome, vocabulaire RH ("vivier") au lieu du jargon scène (LFT, mercato). S'y ajoutent des casseurs de crédibilité en prod (pages structures mortes pour les visiteurs déconnectés, compteurs "—" sur la landing, screenshots d'états vides) qui confirment l'impression "démo générée" plus vite que n'importe quel glow. Le remède n'est pas un restyling mais une politique de soustraction : une grammaire à 3 niveaux où la card plate redevient le défaut et la décoration l'exception qui signale l'importance.

## Principes à graver (repris dans `.claude/skills/aedral-style`)

- HIÉRARCHIE 3 NIVEAUX, NON NÉGOCIABLE — Niveau 1 'héros' (chrome complet : barre accent, glow, image) : 1 à 2 éléments MAX par écran. Niveau 2 'card' : .panel nu (surface + border neutre + bevel), identité couleur portée par UN seul élément (GameTag, dot statut, chiffre coloré). Niveau 3 'ligne' : toute donnée répétitive (membres, demandes, annuaire) = rangée avec divider 1px, pas de card. La card plate est le DÉFAUT, la décoration est l'exception.
- BARRE D'ACCENT 3PX = 1 PAR ÉCRAN MAX, sur le héros uniquement. Jamais sur un formulaire, une nav, une save bar, une modale, un bloc sidebar. Idem glow radial et icône-dans-un-carré-teinté.
- OR = 1 OCCURRENCE DÉCORATIVE PAR ÉCRAN (le CTA principal ou la récompense). Tout accent 'par défaut' passe en neutre rgba(255,255,255,0.15) ou disparaît. Si tu hésites sur la couleur d'un accent, c'est qu'il ne doit pas exister.
- UNE INFO = UN SEUL ENDROIT. Interdiction de répéter un titre, une stat ou un statut dans le même viewport (pas de titre en t-label + h3, pas de banner qui paraphrase les widgets, pas de panel qui ré-affiche le header).
- HELPER TEXT : 1 LIGNE MAX, et seulement si l'info n'est pas évidente (conséquence cachée, sécurité). Zéro paraphrase du label. Les instructions multi-étapes vivent dans un tooltip '?' ou dans /guide, jamais inline en permanence.
- ZÉRO EMOJI DANS LE CHROME UI (⚠️ 🎮 🏆 ✓ 🌍 interdits) — icônes lucide uniquement, et seulement porteuses d'état (statut, vérifié, jeu, live). Test : si l'icône disparaît et que rien n'est perdu, elle dégage. Le picker emoji du contenu utilisateur reste.
- COPY DÉCLARATIVE ET SÈCHE : zéro point d'exclamation dans les chaînes système, zéro triade marketing ('X, Y, Z.'), zéro 'tout-en-un'/'Découvre'/'intelligent'/'passion'. Titre = la fonctionnalité, description = le fait. Une seule phrase de positionnement autorisée sur tout le site : le H1 du hero landing.
- UPPERCASE RATIONNÉ : Bebas pour les titres (identité, on garde) + 1 eyebrow t-label MAX par bloc. Tous les autres labels de données (compteurs, footers, méta) en sentence case poids 500 sans tracking.
- HOVER = AFFORDANCE : .pillar-card et tout effet de survol réservés aux éléments réellement cliquables. Un formulaire qui s'allume au hover est un bug, pas un style.
- ZÉRO VAPORWARE : aucun bloc 'à venir', aucune feature annoncée non shippée, aucune entrée de nav vers une page vide, aucun screenshot montrant des zéros. Un empty state = phrase factuelle + bouton d'action, pas d'enthousiasme.

## Quick wins (12) — < 1h chacun, fort impact

### Réécrire la règle 'Cards pilier/section' du CLAUDE.md en grammaire 3 niveaux

C'est la cause racine : tant que le doc exige barre+glow+icône pour toute card et interdit la 'card plate', chaque futur composant régénérera le template. Remplacer par la grammaire héros/card/ligne (principe 1) + déplacer 'card plate sans accent' de la liste anti-patterns vers le défaut recommandé. 30 min, stoppe l'hémorragie avant tous les sweeps.

Emplacements : `C:\Users\mattm\springs-hub\CLAUDE.md (section 'Cards pilier/section (sans image)' + 'Anti-patterns')` · `C:\Users\mattm\springs-hub\app\design-system.css`

### Dashboard connecté : supprimer tous les doublons du premier écran

Banner : virer la phrase buildStatus (paraphrase les 3 widgets dessous) et les 2 CTA (doublons des widgets) → avatar + 'SALUT NOXX' sur une ligne. Pillar cards : supprimer l'écho de titre (t-label l.218 OU h3 l.241, pas les deux), les 4 chips features marketing (l.243-247), le footer 'Aedral'. Comp-cards : supprimer la ligne URL 'springs-esport.vercel.app' + le divider. Le premier écran connecté est là où l'impression 'généré' se forme.

Emplacements : `C:\Users\mattm\springs-hub\components\home\ConnectedDashboard.tsx:149-185, 363-370` · `C:\Users\mattm\springs-hub\app\page.tsx:183-185, 197-262`

### Purge emoji du chrome UI → icônes lucide

⚔/🎮/🏆 des chips de type d'event → Swords/Gamepad2/Trophy 12px même accent ; ⚠️ en préfixe de warning → pattern bandeau AlertCircle déjà existant (settings:768-776) ; 🌍 fallback pays → Globe ou rien ; '✓ propre' admin → texte sec. Un grep, une passe, signature 'rédigé par un LLM' éliminée de l'écran le plus utilisé au quotidien (création de scrims).

Emplacements : `C:\Users\mattm\springs-hub\components\calendar\EventFormModal.tsx:830, 885, 985` · `C:\Users\mattm\springs-hub\components\calendar\EventDetailModal.tsx:238, 352` · `C:\Users\mattm\springs-hub\app\settings\page.tsx:1070, 1400, 2287, 2294` · `C:\Users\mattm\springs-hub\app\profile\[id]\page.tsx:57` · `C:\Users\mattm\springs-hub\app\admin\rank-reports\page.tsx:144` · `C:\Users\mattm\springs-hub\app\admin\valorant-link-changes\page.tsx:137` · `C:\Users\mattm\springs-hub\app\admin\rl-link-changes\page.tsx:139`

### Sweep copy système : exclamations, 'Découvre', empty states sur-enthousiastes

Supprimer tous les '!' des toasts/boutons ('SAUVEGARDÉ !', 'Copié !', 'BIENVENUE !'). Textes de partage : 'Découvre X sur Aedral' → '${name} sur Aedral'. Empty states : 'Sois le premier à donner vie à la scène !' → 'Aucune structure validée pour l'instant.' + bouton d'action. WelcomeModal : remplacer les triades ('structurer, planifier, progresser ensemble') par les faits ('Roster, calendrier, scrims, recrutement : au même endroit.').

Emplacements : `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\general-tab.tsx:529` · `C:\Users\mattm\springs-hub\components\ui\ShareStoryButton.tsx:102` · `C:\Users\mattm\springs-hub\components\ui\ShareBannerButton.tsx:92` · `C:\Users\mattm\springs-hub\app\community\join\[token]\page.tsx:141` · `C:\Users\mattm\springs-hub\app\community\structures\page.tsx:354` · `C:\Users\mattm\springs-hub\app\community\players\page.tsx:897, 1219, 1251` · `C:\Users\mattm\springs-hub\app\profile\[id]\page.tsx:438` · `C:\Users\mattm\springs-hub\app\community\structure\[id]\page.tsx:568` · `C:\Users\mattm\springs-hub\components\onboarding\WelcomeModal.tsx:34, 38, 55` · `C:\Users\mattm\springs-hub\components\onboarding\OnboardingWizard.tsx:161`

### Supprimer le teaser 'STATS AGRÉGÉES · À VENIR' du profil

Bloc entier qui annonce une feature inexistante — le remplissage qui crie 'site IA' le plus littéral du site. Appliquer la logique hasHistory déjà présente dans le même fichier (l.235-239) : masquer tant que pas shippé. Zéro bloc promesse dans l'UI produit.

Emplacements : `C:\Users\mattm\springs-hub\app\profile\[id]\page.tsx:659-684`

### Onglet Général my-structure : -5 blocs visibles

Supprimer le panel INFORMATIONS (statut/jeux/équipes déjà dans le header de page et les quick-stats — les jeux sont affichés 3 fois à l'écran). Livrer BOT DISCORD, RÉSEAUX SOCIAUX et PALMARÈS repliés par défaut (le mécanisme collapsed/toggle existe, simple changement d'état initial). L'onglet passe de 11 blocs à ~6.

Emplacements : `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\general-tab.tsx:611-653 (panel INFORMATIONS)` · `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\general-tab.tsx (état collapsed initial des 3 panels)`

### Sweep des tags de header décoratifs + un seul indicateur de save

Supprimer les pastilles 'OBLIGATOIRE' (l'astérisque le dit), 'MIN. 1' (l'erreur de validation le dit), '✓ FIGÉ' ×3, tags catégorie des piliers ('Gestion', 'Recrutement'). Ne garder que les statuts actionnables (EN ATTENTE, RECRUTE). Settings : supprimer le bouton flottant bottom + son méta-texte '· auto dans 2s' — la top bar sticky est le seul point de vérité, l'auto-save n'a pas à s'expliquer.

Emplacements : `C:\Users\mattm\springs-hub\app\settings\page.tsx:882, 948, 1057, 1259, 2277 (tags)` · `C:\Users\mattm\springs-hub\app\settings\page.tsx:2179-2210 (bouton flottant)` · `C:\Users\mattm\springs-hub\app\page.tsx:221-222`

### Landing : bande stats cassée + 5 fixes copy

Supprimer la bande '— Structures / — Joueurs / 2 Compétitions' (compteurs cassés + chiffre embarrassant ; la remplacer plus tard par les logos des 11 structures actives). Hero : couper 'faire vivre ta passion'. CTA final : 'REJOINS L'ÉCOSYSTÈME' → 'TROUVE TON ÉQUIPE OU MONTE LA TIENNE.' + 'Connexion Discord en 30 secondes. Gratuit.'. 'Stockage R2 / Hosted sur Cloudflare' → 'Stockage d'équipe'. 'Roster + sous-équipes' → 'Roster + équipes' (mot banni, grep global).

Emplacements : `C:\Users\mattm\springs-hub\components\landing\VisitorLanding.tsx:124, 142-144, 304, 406-407, 683-687`

### Crédibilité : changelog vide, breadcrumb bègue, page /competitions qui s'excuse 3 fois

/changelog : masquer l'entrée de nav tant que vide + supprimer la phrase sur un filtre qui n'existe pas. /guide : retirer le doublon 'Accueil > Accueil'. /competitions : garder les 2 cards, supprimer le hero-excuse 'en cours de construction' ET le panel 'bientôt' qui liste du vaporware — un seul signal de statut (la ligne discrète sur les cards).

Emplacements : `C:\Users\mattm\springs-hub\app\changelog\page.tsx` · `C:\Users\mattm\springs-hub\app\guide\page.tsx:209` · `C:\Users\mattm\springs-hub\app\competitions\page.tsx` · `C:\Users\mattm\springs-hub\components\layout\Sidebar.tsx (entrée Nouveautés)`

### Jargon scène : MERCATO et LFT + meta SEO factuelle

'VIVIER JOUEURS' → 'MERCATO', 'Dispo au recrutement'/'Disponible' → 'LFT' — le signal le plus fort que le site est fait par quelqu'un de la scène, pas généré. Meta descriptions : remplacer les 4 occurrences de 'La plateforme tout-en-un...' par une source unique factuelle : 'Gestion de structure esport amateur : roster, scrims, dispos, recrutement, replays. Rocket League, Trackmania, Valorant.'

Emplacements : `C:\Users\mattm\springs-hub\app\page.tsx:85` · `C:\Users\mattm\springs-hub\app\community\players\page.tsx:414` · `C:\Users\mattm\springs-hub\app\profile\[id]\page.tsx:354` · `C:\Users\mattm\springs-hub\app\layout.tsx:44, 67, 74, 99`

### Annuaire structures : noms tronqués + logo hotlink cassé

6 cards sur 11 affichent 'ARAN ESPO…' alors que la moitié droite de la ligne est vide : laisser le nom prendre toute la largeur (tag chip sous le nom ou en coin), truncate seulement en vrai overflow. Logo Alphoria (i.postimg.cc) en erreur → fallback monogramme propre au lieu de l'alt text brut. La vitrine de l'annuaire ne doit pas paraître négligée.

Emplacements : `C:\Users\mattm\springs-hub\app\community\structures\page.tsx:281`

### Retirer .pillar-card des conteneurs non-interactifs

Sections de formulaire (PROFIL settings) et blocs statiques (BIO profil) s'allument au survol comme des liens : fausse affordance + sensation 'tout est la même card'. Pure suppression de classes (pillar-card + group transition-all → panel seul), zéro risque, réserve le hover-lift aux vrais liens.

Emplacements : `C:\Users\mattm\springs-hub\app\settings\page.tsx:872, 940, 1465, 1622, 1703, 1753` · `C:\Users\mattm\springs-hub\app\profile\[id]\page.tsx:471, 1024, 1064, 1135`

## Chantiers moyens (10) — demi-journée

### PRIORITÉ ABSOLUE — Réparer les pages publiques mortes pour les visiteurs déconnectés

Testé en prod : chaque page structure publique affiche 'STRUCTURE INTROUVABLE' déconnecté (le <title> serveur résout, c'est la lecture Firestore client qui échoue pour les non-authentifiés) et l'annuaire joueurs reste à '0 joueur' avec un empty state mensonger. Un visiteur qui tombe sur 3 culs-de-sac conclut 'site fake' plus vite qu'à cause de n'importe quel glow. Server-render des données publiques via Admin SDK (ou ouvrir les rules en lecture sur les champs publics — attention à la baseline sécu de l'audit 9.1-9.7) + smoke test e2e logged-out sur ces routes. À faire AVANT tout polish visuel.

Emplacements : `C:\Users\mattm\springs-hub\app\community\structure\[id]\page.tsx:452` · `C:\Users\mattm\springs-hub\app\community\players\page.tsx:1247` · `C:\Users\mattm\springs-hub\firestore.rules`

### SectionPanel chromeless par défaut + prop emphasis opt-in

Le levier au meilleur ratio : 1 fichier modifié, 26 sections assainies. Défaut = titre t-label + border-bottom, sans barre 3px (l.62), sans glow (l.63-64), sans icône encadrée (l.69-71 → icône nue 13px max). Prop `emphasis` opt-in qui réactive la barre, réservée aux sections avec compteur d'actions en attente > 0 (DEMANDES REÇUES (3)). DESCRIPTION ne doit plus peser autant que DEMANDES REÇUES.

Emplacements : `C:\Users\mattm\springs-hub\app\community\my-structure\components.tsx:48-90` · `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\general-tab.tsx` · `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\recruitment-tab.tsx`

### Passe éditoriale helpers : 1 ligne max, divulgation progressive

~19 micro-helpers settings + paragraphes permanents de general-tab : règle 1 helper/panel, 1 ligne max, ne garder que les conséquences cachées ('Modifier ton rang le rend à nouveau signalable.'). Les instructions multi-étapes ('Discord → Paramètres → Connexions → …') et les cas d'erreur passent derrière un tooltip '?' ou un disclosure 'Un problème ?'. Supprimer les helpers qui paraphrasent le label (chips MATCH/TOURNOI de EventFormModal, toggle recrutement). Appliquer le skill aedral-style comme référentiel.

Emplacements : `C:\Users\mattm\springs-hub\app\settings\page.tsx:1396, 1636, 1713, 2287-2294, 2348-2356` · `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\general-tab.tsx:160-165, 333-338, 388-405` · `C:\Users\mattm\springs-hub\components\calendar\EventFormModal.tsx:832-834, 853-855, 987-989`

### Settings Config RL : 7 sous-blocs → 3, un seul état visible

L'écran le plus étouffant du site : 4 niveaux de boîtes bordées imbriquées + cas d'erreur affichés en permanence. Si compte vérifié → 1 ligne badge 'Epic NoxX vérifié · tracker.gg' (fusionner l'encart liens auto-générés dedans) ; sinon → 1 seul CTA de liaison. Chemins d'erreur et instructions Discord derrière un disclosure 'Un problème ?'.

Emplacements : `C:\Users\mattm\springs-hub\app\settings\page.tsx:1006-1408`

### Headers de pages aplatis (+ sticky réduit)

Chaque page ouvre sur une card-header complète (icon-box + barre + glow + sous-titre-définition) puis la re-duplique en CompactStickyHeader au scroll : 2× le même bloc décoratif avant la première donnée. Aplatir : h1 Bebas nu + meta inline ('11 actives · 7 recrutent' — ce sous-titre-là est bon, les définitions de page dégagent). Sticky conservé mais réduit à titre + actions sur fond blur, sans barre ni icon-box. Gain immédiat là où se forme la première impression.

Emplacements : `C:\Users\mattm\springs-hub\app\community\structures\page.tsx:125-188` · `C:\Users\mattm\springs-hub\components\ui\CompactStickyHeader.tsx:51-61` · `C:\Users\mattm\springs-hub\app\community\players\page.tsx` · `C:\Users\mattm\springs-hub\app\guide\page.tsx` · `C:\Users\mattm\springs-hub\app\changelog\page.tsx`

### Profil joueur : hiérarchie 3 niveaux + dégraisser la card Trackmania

9 barres 3px sur une page : hero = seul Niveau 1 (garde sa barre or). Cards de jeu = Niveau 2 (le watermark de rang + chiffre coloré suffisent, supprimer barre + glow ×3). Sidebar = Niveau 3 (blocs plats t-label + dividers ; seul 'Recrutement' garde un marqueur). Card TM : trophées + échelon + meilleur COTD sur une ligne, 'par zone' et 'par tier' repliés derrière 'Voir le détail' (le lien trackmania.io donne déjà tout).

Emplacements : `C:\Users\mattm\springs-hub\app\profile\[id]\page.tsx:294, 471-473, 527, 725, 746-869, 904, 1024-1026, 1064-1066, 1135-1137`

### Dashboard : layout asymétrique 2/3-1/3

Casser la grille 3 widgets égaux : 'Prochain event' devient le bloc dominant pleine largeur gauche (heure, équipe, présences — l'info n°1 d'un joueur), exercices + structure en rangées compactes à droite. Bannière Discord rétrogradée en une ligne fine (icône + texte + lien) : c'est de la pub interne, elle doit être l'élément le plus discret de l'écran. Le chrome complet ne reste que sur le welcome banner (hero légitime).

Emplacements : `C:\Users\mattm\springs-hub\app\page.tsx:188` · `C:\Users\mattm\springs-hub\components\home\ConnectedDashboard.tsx:188-340, 396-400`

### Variante .t-label-soft : baisser le volume sonore typographique

Le t-label uppercase 800 tracké est l'étiquette universelle (6 éléments en capitales sur une seule pillar-card) : créer .t-label-soft (sentence case, weight 500, sans tracking) pour les labels de données (compteurs, footers, méta) et réserver le t-label uppercase à 1 eyebrow par bloc. Bebas intouché (identité). Le changement au plus fort ratio respiration/effort : la baisse de volume se voit immédiatement.

Emplacements : `C:\Users\mattm\springs-hub\app\design-system.css:97-103` · `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\general-tab.tsx` · `C:\Users\mattm\springs-hub\app\page.tsx:215-254`

### Purge des icônes décoratives

Supprimer les icônes préfixes des métadonnées (Gamepad2/Users/Calendar 11px qui ne disent rien que le texte ne dit) et les icon-box des headers. Critère mécanique : si l'icône disparaît et que rien n'est perdu, elle dégage. Conserver uniquement les icônes d'état : pastille live, vérifié, logos de jeux, couronne capitaine. Chez Linear/Vercel l'icône est rare et exclusivement porteuse d'état — c'est ce qui rend leur densité respirable.

Emplacements : `C:\Users\mattm\springs-hub\app\page.tsx:166-178` · `C:\Users\mattm\springs-hub\components\ui\CompactStickyHeader.tsx:56-60` · `C:\Users\mattm\springs-hub\app\community\structures\page.tsx:135-137`

### Guide : couper 50% des bullets + 1 screenshot par section

Mur de 5000px, ~60 bullets que personne ne lit — signature de doc générée par exhaustivité. Max 3-4 bullets par section (garder le bénéfice, virer la spec), supprimer les bullets de renvoi méta (:41, :116), 'consensus intelligent' → 'heatmap de consensus des dispos'. Ajouter 1 capture réelle par section (le pattern showcase existe déjà) pour aérer et prouver.

Emplacements : `C:\Users\mattm\springs-hub\app\guide\page.tsx:33-158`

## Gros chantiers (3)

### Sweep hiérarchie visuelle site entier : 97 barres → ~10

Le chantier de fond, écran par écran avec la grammaire 3 niveaux comme critère d'acceptation : settings (11 barres dont save bar, sous-nav ET modale de suppression — la modale danger doit devenir le SEUL élément fort de son écran), profil (9), structure publique (8), my-structure, annuaires, calendrier. Pour chaque barre/glow/icon-box hand-rollé : est-ce LE héros de l'écran ? Sinon suppression pure (.panel + bevel suffisent, c'est EUX la signature DA). Inclut la diète d'or : tous les accents or 'par défaut' passent en neutre, l'or retrouve sa rareté. À séquencer APRÈS le changement SectionPanel (qui traite 26 sections d'un coup) pour ne traiter que le reste à la main. Ordre : settings → profil → my-structure → annuaires → calendrier.

Emplacements : `C:\Users\mattm\springs-hub\app\settings\page.tsx:711, 787, 818, 873, 941, 1466, 1623, 1704, 1754, 2081` · `C:\Users\mattm\springs-hub\app\profile\[id]\page.tsx` · `C:\Users\mattm\springs-hub\app\community\structure\[id]\page.tsx` · `C:\Users\mattm\springs-hub\components\structure\PlayerStructureView.tsx` · `C:\Users\mattm\springs-hub\app\community\my-structure\page.tsx`

### Le répétitif en rangées : vue liste pour annuaires et listes internes

Le levier n°1 de la densité maîtrisée chez Faceit/Vercel : la card est réservée aux objets héros, le répétitif est en rangées denses. Annuaire structures : vue liste par défaut (logo 24px · nom non tronqué · tag · GameTags · membres · chip RECRUTE à droite, séparées par 1px --s-border, hover --s-elevated), grille de cards en toggle. Appliquer le même principe aux listes internes de my-structure (membres, demandes, équipes). NE PAS toucher aux trading cards joueurs (choix produit validé : c'est l'objet héros de cette page-là).

Emplacements : `C:\Users\mattm\springs-hub\app\community\structures\page.tsx:204-319` · `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\members-tab.tsx` · `C:\Users\mattm\springs-hub\app\community\my-structure\tabs\teams-tab.tsx`

### Landing v2 : 11 écrans → 6, asymétrie, preuves réelles

9740px de scroll avec 6 sections au moule identique (pill-label centré + Bebas blanc+or + punchline 'C'EST TOUT.') : l'œil détecte la formule au 3e écran. Restructurer : formule white+gold réservée au hero et au CTA final ; sections intermédiaires en titres alignés à gauche, moitié des pill-labels supprimés, cadence ponctuation cassée ; grille features → bento à cellules de tailles variées ; section 3-steps fusionnée dans le CTA final ; showcase réduit de 6 à 3 captures fortes RE-CAPTURÉES avec données réelles (l'actuelle montre un event à 0 présents/0 replays sous la promesse 'Pas de slides marketing') ; bande stats remplacée par la rangée de logos des structures actives. Le Showcase alterné existant prouve que l'asymétrie marche déjà dans cette DA — c'est la meilleure section du site, la généraliser.

Emplacements : `C:\Users\mattm\springs-hub\components\landing\VisitorLanding.tsx:114-144, 267-330, 417-530, 643-687`

---

## Annexe — les 55 findings bruts (triés par impact)

### [HIGH/S] Le bandeau de bienvenue duplique mot pour mot l'information des 3 widgets juste en dessous : tout est dit deux fois sur le premier écran.

- **Zone** : densité (dimension density)
- **Où** : Dashboard connecté — components/home/ConnectedDashboard.tsx:149-185 + 188-325
- **Preuve** : buildStatus() (ConnectedDashboard.tsx:363-370) écrit dans le sous-titre du banner « prochain event dans 2h · 3 exercices à faire · aucune structure » alors que les widgets PROCHAIN EVENT, MES EXERCICES et MA STRUCTURE (lignes 190-324) affichent exactement ces trois infos. Les CTA du banner (Calendrier / Ma structure, lignes 175-182) doublonnent aussi les liens des widgets. C'est l'anti-pattern « doublons d'information » déjà interdit par le CLAUDE.md.
- **Reco** : Réduire le banner à l'essentiel : avatar + « SALUT NOXX » sur une ligne, sans phrase de statut ni boutons (les widgets sont cliquables et portent déjà ces destinations). On gagne ~40px de hauteur et surtout une passe de lecture entière.

### [HIGH/S] Chaque pillar card affiche son titre DEUX fois et empile ~10 éléments (tag, chips features, footer attribution) pour ce qui est en réalité un simple lien de navigation — pour un utilisateur déjà connecté qui connaît le produit.

- **Zone** : densité (dimension density)
- **Où** : Dashboard connecté — app/page.tsx:197-262 (section « Explorer l'écosystème »)
- **Preuve** : Ligne 218 : <span className="t-label">{title}</span> dans le panel-header, puis ligne 241 : <h3 className="font-display text-xl">{title}</h3> répète « STRUCTURES » dans le corps de la même card. S'ajoutent : tag de catégorie (« Gestion », « Recrutement »), 4 chips marketing (« Roster », « Équipes », « Planning », « Inscriptions », lignes 243-247), divider, footer « Aedral » + « Explorer ». 3 cards × 10 éléments = un bloc entier de remplissage en bas du dashboard quotidien.
- **Reco** : Supprimer l'écho de titre (garder soit le header soit le h3), supprimer les chips features (vocabulaire de landing, pas de dashboard), supprimer le footer attribution. Mieux : compresser la section en une rangée de 3 liens compacts (icône + label + stat). Garder la version riche pour la landing visiteur uniquement.

### [HIGH/S] 11 blocs cartés sur un seul onglet, avec les mêmes infos affichées 2 à 3 fois : la vue ne hiérarchise rien, tout est ouvert en permanence.

- **Zone** : densité (dimension density)
- **Où** : Onglet Général my-structure — app/community/my-structure/tabs/general-tab.tsx (toute la grille) + page.tsx:1556-1617
- **Preuve** : Colonne gauche : 6 SectionPanels (DESCRIPTION, JEUX PRATIQUÉS, CONFIGURATION, BOT DISCORD, RÉSEAUX SOCIAUX, PALMARÈS) + bouton save. Colonne droite : APERÇU PUBLIC, INFORMATIONS, quick-stats équipes, quota stockage, bouton RÔLES & PERMISSIONS (5 blocs). Doublons : le header de page (page.tsx:1577-1590) affiche déjà statut + GameTags + nb membres ; le panel INFORMATIONS (general-tab.tsx:611-653) ré-affiche Statut + Jeux + nb d'équipes ; les quick-stats (657-681) ré-affichent le nb d'équipes par jeu. Les jeux apparaissent donc 3 fois à l'écran, le statut 2 fois, le compte d'équipes 2 fois.
- **Reco** : Supprimer le panel INFORMATIONS (tout est dans le header + quick-stats). Livrer BOT DISCORD, RÉSEAUX SOCIAUX et PALMARÈS repliés par défaut — le mécanisme `collapsed`/`toggle` existe déjà dans SectionPanel, c'est un changement d'état initial. L'onglet passe de 11 blocs visibles à ~6.

### [HIGH/M] Chaque section ouvre par un paragraphe d'explication, souvent multi-phrases avec instructions pas-à-pas affichées en permanence — la signature « tutoriel généré » la plus visible du site. Un produit pro assume que le toggle/label se comprend seul.

- **Zone** : copy (dimension density)
- **Où** : general-tab.tsx:160-165, 333-338, 388-405, 249-251 + app/settings/page.tsx (19 micro-helpers text-xs, 30 occurrences --s-text-muted)
- **Preuve** : JEUX PRATIQUÉS : 4 lignes d'explication avant les boutons (« Active les jeux où ta structure est active. Cocher un jeu débloque… Décocher un jeu est bloqué tant que… »). BOT DISCORD : paragraphe + encart warning « Le bot demande la permission Administrator » de 4 lignes, visibles même quand on ne connecte rien. Settings : RECRUTEMENT (1636) paraphrase le toggle qui dit déjà « Je suis disponible pour une équipe » ; NOTIFICATIONS (1713) 3 lignes avec exemple entre parenthèses ; le bloc ValorantSyncBlock (2348-2356) accumule 3 phrases conditionnelles dans un seul helper.
- **Reco** : Règle éditoriale : 1 helper max par panel, 1 ligne max. Les instructions multi-étapes (« Discord → Paramètres → Connexions → … reconnecte-toi ») partent derrière un tooltip « ? » ou un lien « Comment ça marche » qui ouvre la modal/guide. Supprimer purement les helpers qui paraphrasent le label.

### [HIGH/M] Jusqu'à 7 sous-blocs bordés empilés dans le même panneau, avec 4 niveaux de boîtes imbriquées et des cas d'erreur affichés en permanence : c'est l'écran le plus étouffant du site.

- **Zone** : densité (dimension density)
- **Où** : Settings → Mes jeux → Config Rocket League — app/settings/page.tsx:1006-1408
- **Preuve** : Empilement : bloc RL bordé bleu > question plateforme (p-3 bordé) > bloc Epic (vérifié / à confirmer / absent, p-3 bordé avec sous-encart warning p-2 bordé = 4 bordures imbriquées) > bloc « Lier ton compte Steam » > bloc « Compte Steam RL officiel » > encart « Liens auto-générés » (1348-1378) > select rang + warning rouge ⚠️ 2 lignes (1399-1401). Le bloc « Confirme ton compte » (1092-1123) affiche en permanence le paragraphe du cas d'échec (« Pas mon compte principal ? Sur Discord → … »).
- **Reco** : Un seul état visible à la fois : si compte vérifié → 1 ligne badge « ✓ Epic NoxX · tracker.gg » (fusionner l'encart « liens auto-générés » dedans) ; sinon → 1 seul CTA de liaison. Les chemins d'erreur et instructions Discord passent derrière un disclosure « Un problème ? ». Viser 3 blocs max au lieu de 7.

### [HIGH/S] Un encart entier (icône encadrée + label + phrase) annonce une feature qui n'existe pas — du remplissage d'espace qui crie « site IA » et affaiblit la card RL réelle au-dessus.

- **Zone** : densité (dimension density)
- **Où** : Profil joueur — app/profile/[id]/page.tsx:659-684 (bloc « STATS AGRÉGÉES · À VENIR »)
- **Preuve** : Le commentaire du code l'assume : « Pour l'instant on affiche un teaser "à venir" pour montrer le slot futur ». Le même fichier applique pourtant la bonne logique ailleurs : la card Historique est masquée tant qu'elle est vide (hasHistory, lignes 235-239, avec commentaire « éviter le panel qui fait vide »).
- **Reco** : Supprimer le teaser jusqu'au ship réel des stats agrégées, comme pour l'historique. Zéro bloc promesse dans l'UI produit.

### [HIGH/M] Le chrome décoratif par card (accent bar 3px + glow radial + icône encadrée + border) est appliqué d'office à TOUTES les sections, y compris de simples formulaires — la respiration manque autant à cause de ce bruit par card que du nombre de cards.

- **Zone** : uniformité (dimension density)
- **Où** : SectionPanel — app/community/my-structure/components.tsx:48-90 (et le même motif dans pillar-card, WidgetCard, tous les panels)
- **Preuve** : SectionPanel impose accent gradient + radial-gradient 48×48 + icon-box teintée à RÉSEAUX SOCIAUX (6 inputs URL) comme à DESCRIPTION. Sur le dashboard connecté : 10 blocs cartés × 4 couches décoratives = ~40 éléments décoratifs sur un écran. Quand chaque card a la même cérémonie, resserrer les marges devient impossible sans étouffer.
- **Reco** : Créer une variante « quiet » de SectionPanel (titre t-label + divider, sans accent bar/glow/icon-box) pour les sections secondaires (formulaires, config). Réserver le traitement complet à 1-2 panels « héros » par vue. La DA reste (bevel, surface, Bebas), mais le volume décoratif chute.

### [HIGH/S] La cause racine de l'uniformité est documentée : le design system EXIGE le template complet (accent bar + glow + icône encadrée + stat Bebas) pour toute card sans image, et classe "Cards plates sans aucun accent" en anti-pattern — donc chaque nouveau composant ressort identique.

- **Zone** : uniformité (dimension uniformity)
- **Où** : CLAUDE.md (section "Cards pilier/section (sans image)") + app/design-system.css
- **Preuve** : CLAUDE.md liste comme obligatoire : "Accent bar colorée en haut (3px)", "Glow subtil dans un coin", "Icône encadrée avec fond teinté". Résultat mesuré : 97× h-[3px] + 15× h-[2px] (112 barres / 48 fichiers), ~39 glows radiaux, 29 .pillar-card, 26 SectionPanel — le même squelette partout, c'est mécaniquement un rendu "généré".
- **Reco** : Réécrire la règle en grammaire à 3 niveaux : Niveau 1 HERO (max 1-2/écran : comp-card image, header de page, CTA principal) = chrome complet autorisé ; Niveau 2 CARD = .panel nu (surface + border neutre + bevel), identité couleur via UN seul élément (GameTag, dot statut ou chiffre coloré), ZÉRO barre/glow/icône encadrée ; Niveau 3 LIGNE = row de liste avec divider, pas de card du tout. "Card plate" devient le défaut, la décoration devient l'exception qui signale l'importance.

### [HIGH/L] La barre d'accent 3px est sur TOUT : sections de formulaire, sous-nav, save bar sticky, modales, headers, widgets, cards annuaire. Quand 100% des conteneurs ont la même décoration, elle ne hiérarchise plus rien — c'est le tic visuel n°1 qui fait "template IA".

- **Zone** : uniformité (dimension uniformity)
- **Où** : Tout le site — 42 fichiers (grep h-[3px])
- **Preuve** : app/settings/page.tsx seul en contient 11 : save bar (l.711), sous-nav mobile (l.787), nav latérale (l.818), chaque section de formulaire (l.873, 941, 1466, 1623, 1704, 1754) et même la modale de confirmation (l.2081). Toutes avec le même gradient `linear-gradient(90deg, accent, …30, transparent 70%)`.
- **Reco** : Sweep de suppression : ne garder la barre que sur les éléments Niveau 1 (1 par écran max — ex. le header hero d'une page, la card compétition). Partout ailleurs, la retirer purement : le .panel avec sa border neutre + bevel suffit, c'est déjà la signature DA. Faire le sweep écran par écran en commençant par settings, profil, my-structure.

### [HIGH/M] SectionPanel est le template incarné (barre 3px + glow 48px + icône encadrée teintée + titre Bebas) instancié 26 fois : la section DESCRIPTION (statique, rarement touchée) a exactement le même poids visuel que DEMANDES REÇUES (actionnable, urgente). Rien ne ressort dans le dashboard structure, l'écran le plus dense du site.

- **Zone** : uniformité (dimension uniformity)
- **Où** : app/community/my-structure/components.tsx:48-90 (SectionPanel) + tabs general/recruitment/teams
- **Preuve** : components.tsx l.62 (barre), l.63-64 (glow), l.69-71 (icône encadrée ${accent}10/${accent}25). general-tab.tsx : 6 panels identiques (l.138, 157, 257, 311, 418, 433) ; recruitment-tab.tsx : 6 de plus (l.88, 185, 246, 324, 393, 470).
- **Reco** : Rendre SectionPanel chromeless par défaut : titre en t-label + border-bottom, pas de barre, pas de glow, pas de boîte d'icône (icône nue 13px à la rigueur). Ajouter une prop `emphasis` opt-in qui réactive la barre — à n'utiliser que sur les sections avec compteur d'actions en attente > 0 (DEMANDES REÇUES (3)). Un seul fichier à modifier, 26 sections assainies d'un coup.

### [HIGH/M] L'or est devenu l'accent PAR DÉFAUT, en contradiction directe avec la règle DA "or = rare et précieux". Quand l'or est sur la nav de settings, la description de structure ET le palmarès, il ne signale plus rien.

- **Zone** : hiérarchie (dimension uniformity)
- **Où** : Partout où accent="var(--s-gold)" — settings, my-structure/general-tab, ConnectedDashboard, profil
- **Preuve** : general-tab.tsx : 4 SectionPanel sur 6 en or (DESCRIPTION, JEUX, CONFIGURATION, PALMARÈS) ; ConnectedDashboard.tsx : welcome banner (l.153) + 2 widgets sur 3 (l.191, 281) en or ; settings : nav latérale, sous-nav mobile, save bar et 5 sections en barre or — sur un même écran l'or apparaît 8+ fois.
- **Reco** : Règle d'application stricte : or = 1 occurrence décorative max par écran (le CTA principal ou la récompense). Tous les accents "par défaut" passent en neutre (rgba(255,255,255,0.15)) ou disparaissent avec le sweep des barres. L'or retrouve sa valeur sans toucher à la palette.

### [HIGH/S] Une card de navigation vers un annuaire empile 9 ornements : barre 3px + glow + panel-header + tag(s) + icône encadrée + stat Bebas + titre + 4 feature-tags + divider + lien Explorer. Pire : le titre y figure DEUX fois (t-label du header l.218 et h3 Bebas l.241). C'est l'archétype de la card sur-générée.

- **Zone** : hiérarchie (dimension uniformity)
- **Où** : app/page.tsx:207-258 (pillar cards "Explorer l'écosystème")
- **Preuve** : l.210-211 (barre), l.212-213 (glow), l.215-224 (panel-header avec titre n°1 + jusqu'à 2 tags), l.227-229 (icône encadrée), l.236 (stat), l.241 (titre n°2), l.243-247 (4 tags "Roster/Équipes/Planning/Inscriptions" purement décoratifs), l.248 (divider), l.250-254 (footer label + Explorer).
- **Reco** : Dégraisser à : icône nue + titre Bebas (une seule fois) + stat + desc une ligne. Les feature-tags deviennent du texte t-mono séparé par des "·" ("Roster · Équipes · Planning"), le panel-header saute, le footer "Aedral" saute (info nulle). Garder le tag-violet Springs uniquement sur la card Compétitions (vraie info partenaire).

### [HIGH/S] Les chips de type d'événement utilisent des emojis (⚔ MATCH OFFICIEL, 🎮 PARTIE, 🏆 TOURNOI) dans le chrome produit, alors que toute la DA repose sur des icônes lucide.

- **Zone** : copy (dimension copy)
- **Où** : Formulaire et détail d'événement calendrier — components/calendar/EventFormModal.tsx:830, 885, 985 + components/calendar/EventDetailModal.tsx:238, 352
- **Preuve** : EventFormModal.tsx:885 : `🎮 PARTIE` dans un `.tag` bleu ; :830 `⚔ MATCH OFFICIEL` ; :985 `🏆 TOURNOI`. C'est l'écran le plus utilisé au quotidien (création de scrims/matchs) et le seul endroit du produit où des emojis remplacent les icônes lucide — signature « généré » immédiate, et rendu incohérent selon l'OS.
- **Reco** : Remplacer chaque emoji par l'icône lucide correspondante déjà dans le projet (Swords, Gamepad2, Trophy) à 12px dans le tag, même couleur d'accent. Zéro changement de layout, cohérence DA retrouvée.

### [HIGH/S] Le hero se termine sur une formule creuse et le CTA final cumule slogan vide + triade marketing parfaite — exactement le pattern « site IA ».

- **Zone** : copy (dimension copy)
- **Où** : Landing visiteur, hero + CTA final — components/landing/VisitorLanding.tsx:124, 683, 686-687
- **Preuve** : Ligne 124 : « Tout ce qu'il faut pour faire vivre ta passion. » ; ligne 683 : « REJOINS L'ÉCOSYSTÈME. » ; lignes 686-687 : « Pas de carte bancaire, pas d'engagement, juste l'esport. » (triade en trois temps, structure générée type). À l'inverse, le reste de la landing est bon (« fini les Doodle », « sans passer 3h sur Discord »).
- **Reco** : Hero : couper la phrase passion, la phrase précédente (recrutement, gestion d'équipe, calendrier, tournois) porte déjà tout. CTA : titre concret du type « TROUVE TON ÉQUIPE OU MONTE LA TIENNE. » + sous-titre factuel « Connexion Discord en 30 secondes. Gratuit. » — les deux boutons font le reste.

### [HIGH/L] Le même template de conteneur (accent bar 3px en gradient + glow radial dans le coin + icône encadrée fond teinté + titre Bebas) est appliqué à TOUS les niveaux : page header, panel de section, widget, card d'annuaire, toolbar sticky — alors que chez Linear/Vercel le chrome décoratif n'existe qu'à un seul niveau (le héros) et tout le reste est plat.

- **Zone** : uniformité (dimension benchmark)
- **Où** : Tout le site — components.tsx:59-90 (SectionPanel), app/page.tsx:210-229, ConnectedDashboard.tsx:396-400, structures/page.tsx:265-267, VisitorLanding.tsx:211-224, CompactStickyHeader.tsx:51-60
- **Preuve** : 113 occurrences de h-[3px]/h-[2px] (accent bars) dans 46 fichiers. SectionPanel impose bar+glow+icon-box à chaque section du dashboard structure (components.tsx:62-71). Même la barre d'outils sticky de Settings a sa bar 3px or (settings/page.tsx:711). Chez Vercel, une card projet = nom + domaine + commit sur fond plat ; chez Linear, une section = un label texte. Quand tout a le volume maximal, rien n'a de hiérarchie → effet « template généré ».
- **Reco** : Faire de la bar/glow/icon-box des props opt-in de SectionPanel, désactivées par défaut. Règle DS à écrire : 1 seul élément accentué par page (le héros : bannière structure, comp-card avec image). Les sections internes passent en panel plat (--s-surface + --s-border + label texte). Les biseaux et la texture hex restent — c'est eux la signature, pas la bar 3px.

### [HIGH/L] Toute donnée répétitive est rendue en grille de cards uniformes avec chrome complet, là où Faceit/Linear/Vercel rendent le répétitif en rangées denses (table/liste) et réservent la card aux objets héros — c'est le levier n°1 de leur impression de densité maîtrisée.

- **Zone** : densité (dimension benchmark)
- **Où** : app/community/structures/page.tsx:204-319 (annuaire structures), app/page.tsx:203-261 (piliers), my-structure (rosters/membres en cards)
- **Preuve** : Une structure dans l'annuaire = card avec accent bar + glow hover + logo encadré + tag du tag + GameTags + divider pointillé + footer compteur + chips MATCH/RECRUTE (structures/page.tsx:257-318) : ~8 éléments de chrome pour 4 données utiles (nom, tag, jeux, membres). Le leaderboard Faceit affiche 10x plus de données avec zéro chrome par rangée. La grille de deployments Vercel = une ligne par item.
- **Reco** : Offrir la vue liste comme défaut de l'annuaire structures : rangées d'une ligne (logo 24px · nom · tag · GameTags · membres · chip RECRUTE à droite), séparées par 1px --s-border, hover --s-elevated. Garder la grille de cards en toggle. Ne PAS toucher aux trading cards joueurs (choix produit validé, c'est l'objet héros de cette page). Appliquer le même principe rangées aux listes internes (membres, demandes, équipes).

### [HIGH/M] Tous les layouts sont des grilles symétriques à colonnes égales (3-3-3, 2x2), sans zone dominante — le pattern « grid de N cards identiques » + « 3 étapes avec icône carrée numérotée » est LE trope du site généré par IA, et c'est exactement ce que Linear/Vercel évitent (héros pleine largeur, splits 2/3-1/3, bento à cellules de tailles variées).

- **Zone** : hiérarchie (dimension benchmark)
- **Où** : app/page.tsx:188-261 (3 widgets égaux + 3 piliers égaux), VisitorLanding.tsx:278-284 (3 features égales), 510-530 (3 steps numérotés 01/02/03)
- **Preuve** : Dashboard connecté : grid md:grid-cols-3 de WidgetCards interchangeables (page.tsx:188) alors que « prochain event » est l'info dominante d'un joueur. Landing : grid-cols-3 auto-rows-fr de FeatureCards de hauteur uniforme (VisitorLanding.tsx:278) + section HowItWorks en 3 colonnes centrées avec badges 01/02/03 dans des carrés (517-524). Seul le Showcase alterné L/R (430) échappe au pattern — et c'est la meilleure section du site.
- **Reco** : Dashboard : « Prochain event » en bloc dominant pleine largeur avec contenu riche (heure, équipe, présences), exercices + structure relégués en rangées compactes à droite (split ~2/3-1/3). Landing : transformer la grille features en bento à tailles variées (1 grande cellule + petites), supprimer ou aplatir la section 3-steps en une ligne de texte sobre. S'inspirer du Showcase existant qui prouve que l'asymétrie marche déjà dans cette DA.

### [HIGH/M] Icônes décoratives systématiques : chaque métadonnée a son préfixe icône 11px, chaque titre de section/page a son icône dans une boîte encadrée teintée — alors que chez Linear/Vercel l'icône est rare et exclusivement porteuse d'état (statut, priorité, logo framework), jamais un ornement de label.

- **Zone** : autre (dimension benchmark)
- **Où** : 113 fichiers importent lucide-react — app/page.tsx:166-178 (icônes 11px préfixant chaque métadonnée), SectionPanel components.tsx:69-71, CompactStickyHeader.tsx:56-60, structures/page.tsx:135-137 (icon-box de header)
- **Preuve** : Sur une comp-card, format/équipes/date ont chacun leur icône Gamepad2/Users/Calendar size 11 (page.tsx:166-178) qui ne disent rien que le texte ne dit déjà. Le pattern « icône dans un carré fond ${accent}10 border ${accent}25 » est répété sur SectionPanel, CompactStickyHeader, headers d'annuaire, FeatureCard landing, widgets dashboard. Une page Vercel n'a souvent AUCUNE icône hors le logo du framework — fonctionnel.
- **Reco** : Purge ciblée : supprimer les icônes préfixes des lignes de métadonnées (le t-label suffit), supprimer l'icon-box des headers de page et de SectionPanel (titre Bebas nu). Conserver uniquement les icônes d'état : pastille live, ✓ vérifié (en ShieldCheck, pas en glyphe), logos de jeux, couronne capitaine. Critère : si l'icône disparaît et que rien n'est perdu, elle dégage.

### [HIGH/S] La copy est en mode marketing enthousiaste (chutes exclamatives, promesses émotionnelles, auto-congratulation) là où les références sont déclaratives et factuelles — c'est un marqueur très fort de texte généré par IA, indépendamment du visuel.

- **Zone** : copy (dimension benchmark)
- **Où** : VisitorLanding.tsx:118 («ENFIN ORGANISÉ.»), 124 («faire vivre ta passion»), 333 («SANS T'ARRACHER LES CHEVEUX.»), 419 («VOILÀ À QUOI ÇA RESSEMBLE.»), 505 («TROIS ÉTAPES, C'EST TOUT.»), 686-687 («Pas de carte bancaire, pas d'engagement, juste l'esport.»), ConnectedDashboard.tsx:166 («SALUT MATT»)
- **Preuve** : Chaque section de la landing se termine par une punchline en or («C'EST TOUT.», «ÇA RESSEMBLE.»). Comparer à Linear : «Purpose-built for product development» — zéro exclamation, zéro promesse de bonheur. Vercel : «Develop. Preview. Ship.» Le dashboard accueille par «SALUT MATT» en Bebas doré — Faceit/Linear n'accueillent jamais, ils affichent l'état (prochains matchs, issues assignées).
- **Reco** : Réécrire en copy sèche : titres = la fonctionnalité («Recrutement par poste», «Heatmap des disponibilités»), descriptions = le fait («Les rangs sont synchronisés depuis le compte de jeu vérifié.»). Supprimer toutes les punchlines de fin de section. Dashboard : remplacer «SALUT MATT» par l'info utile en premier (le prochain event), le prénom peut rester en petit. Une seule phrase de positionnement autorisée : le H1 du hero.

### [HIGH/M] Le t-label (12px, 800, uppercase, tracking 0.12em) est utilisé comme étiquette universelle au même volume partout — combiné aux titres Bebas uppercase, l'écran entier est en capitales criardes sans modulation, là où Linear/Vercel réservent l'uppercase tracké aux rares eyebrows et laissent les labels courants en sentence case discret.

- **Zone** : hiérarchie (dimension benchmark)
- **Où** : app/design-system.css:97-103 (.t-label) + usage massif — 8 occurrences rien que dans general-tab.tsx, présent sur quasi chaque card/section
- **Preuve** : Sur une seule pillar-card : t-label dans le panel-header + t-label sous le compteur + t-label du footer + titre Bebas uppercase + tags uppercase + bouton «EXPLORER» uppercase (page.tsx:215-254) — six éléments en capitales sur une card de ~200px. Faceit, pourtant gaming, garde ses labels de données en sentence case ; l'uppercase y est réservé aux titres de tournois.
- **Reco** : Sans toucher à Bebas (titres = identité) : créer une variante .t-label-soft (sentence case, font-weight 500, sans tracking) pour les labels de données (compteurs, footers, méta) et réserver le t-label uppercase à un seul eyebrow par bloc maximum. C'est le changement à plus fort ratio respiration/effort : la baisse de « volume sonore » se voit immédiatement.

### [HIGH/M] Toute la surface publique est morte pour un visiteur déconnecté : chaque page structure affiche « STRUCTURE INTROUVABLE » et l'annuaire joueurs affiche « PERSONNE N'EST ENCORE INSCRIT · 0 joueur chargé ».

- **Zone** : autre (dimension visual)
- **Où** : Pages publiques visiteur : /community/structure/[slug] (app/community/structure/[id]/page.tsx:452) et /community/players (app/community/players/page.tsx:1247)
- **Preuve** : Testé en prod, déconnecté : timetoshine ET alphoria-esport → « Cette structure n'existe pas ou n'est pas accessible » après 5s d'attente (alors que le <title> serveur résout bien « ALPHORIA ESPORT [ALP] · Aedral » — c'est donc la lecture Firestore client qui échoue pour les non-authentifiés). L'annuaire reste à zéro alors que /community/structures affiche « 11 actives » et des structures de 26 membres une page plus tôt.
- **Reco** : Priorité absolue avant tout polish : rendre ces pages lisibles déconnecté (server-render des données publiques via Admin SDK, ou ouvrir les rules en lecture sur les champs publics) + corriger le copy mensonger de l'empty state (« Sois le premier joueur Aedral » est faux). Ajouter un smoke test e2e logged-out sur ces 3 routes. Un visiteur qui clique 3 liens et tombe sur 3 culs-de-sac conclut « site fake/généré » bien plus vite qu'à cause d'un glow.

### [HIGH/S] La bande de social proof affiche « — Structures / — Joueurs / 2 Compétitions » : deux compteurs cassés (tirets) et un chiffre embarrassant.

- **Zone** : copy (dimension visual)
- **Où** : Landing, bande de stats sous le hero — components/landing/VisitorLanding.tsx:142-144
- **Preuve** : Screenshot prod : les StatBlock structures/joueurs rendent un em-dash (stats?.structures ?? null), seul « 2 Compétitions » s'affiche. Une bande de compteurs animés est déjà en soi le trope n°1 des landings générées ; cassée, c'est double peine.
- **Reco** : Supprimer la bande tant que les chiffres ne sont pas un argument (11 structures, c'est trop tôt pour des compteurs). La remplacer par une preuve concrète : rangée de logos des structures actives (« Ils sont déjà sur Aedral ») — plus crédible, plus humain, et ça valorise les early adopters.

### [HIGH/M] Six sections d'affilée suivent exactement le même moule : pill-label centré + titre Bebas en 2 segments dont le second en or + sous-titre centré sur 2 lignes.

- **Zone** : uniformité (dimension visual)
- **Où** : Landing complète — components/landing/VisitorLanding.tsx (sections Joueurs, Structures, Showcase, How-it-works, Compétitions, FAQ)
- **Preuve** : Vu à l'écran en séquence : « ENFIN ORGANISÉ. », « JOUE, PROGRESSE, REJOINS. », « SANS T'ARRACHER LES CHEVEUX. », « ÇA RESSEMBLE. », « C'EST TOUT. », « EN DIRECT », « SAVOIR PLUS ? ». La répétition mécanique du même header est LE signal « template IA » — l'œil détecte la formule au 3e écran.
- **Reco** : Garder la formule white+gold pour le hero et le CTA final uniquement. Pour les sections intermédiaires : titres alignés à gauche (le showcase alterne déjà gauche/droite, autant aligner les titres avec), supprimer la moitié des pill-labels (ils paraphrasent le titre), et casser la cadence ponctuation (« X, Y. ») qui revient 5 fois.

### [HIGH/M] Le guide est un mur de puces de 5 000px : 9 panels identiques (icône encadrée + titre Bebas + phrase d'intro + 6 à 9 bullets pleine-phrase à chevron orange), zéro visuel jusqu'aux cards jeux tout en bas.

- **Zone** : densité (dimension visual)
- **Où** : /guide — app/guide/page.tsx (9 SectionPanel)
- **Preuve** : Screenshots prod : « ÉQUIPES & ROSTER » = 6 bullets, « CALENDRIER & DISPONIBILITÉS » = 8 bullets dont « système de consensus intelligent » (marketing-speak), chaque section répète le même squelette. C'est la signature d'une doc générée par exhaustivité — personne ne lit 60 bullets.
- **Reco** : Couper 50% : max 3-4 bullets par section (garder le bénéfice, virer la spec — « le manager configure le minimum de joueurs requis » est de la doc, pas du guide). Ajouter 1 screenshot réel par section (le pattern showcase de la landing existe déjà) pour aérer et prouver. Les détails par jeu restent dans les cards « Spécificités » qui, elles, fonctionnent bien.

### [MEDIUM/S] Presque chaque panel-header porte une pastille tag, souvent purement décorative ou redondante — le bruit uniforme de pastilles est un marqueur template fort.

- **Zone** : densité (dimension density)
- **Où** : Headers de panels partout — settings/page.tsx:882 (« OBLIGATOIRE »), 948 (« MIN. 1 »), 1057/1259/2277 (« ✓ FIGÉ »), profile/[id]/page.tsx:1034 (« OUVERT »), app/page.tsx:221-222 (tags pilier)
- **Preuve** : « OBLIGATOIRE » sur le panel IDENTITÉ alors que les champs requis sont déjà marqués d'un astérisque ; « MIN. 1 » sur JEUX PRATIQUÉS (l'erreur de validation le dit déjà) ; « ✓ FIGÉ » répété sur 3 blocs de comptes vérifiés ; chaque pilier du dashboard a un tag de catégorie (« Gestion », « Événements ») qui n'apprend rien.
- **Reco** : Supprimer les tags de header sauf statut réellement informatif et actionnable (EN ATTENTE, RECRUTE, En cours). Un header = icône + titre, point. Les contraintes de validation vivent dans les messages d'erreur, pas en pastille permanente.

### [MEDIUM/S] Trois éléments simultanés racontent le même état « modifs non sauvées », et le bouton flottant explique son propre mécanisme interne (« · auto dans 2s »).

- **Zone** : densité (dimension density)
- **Où** : Settings — triple indicateur d'état de sauvegarde (page.tsx:729-735, 2179-2210)
- **Preuve** : La sticky top bar affiche « • Modifications non sauvegardées » + un bouton Sauvegarder (729-765) ; un second bouton sticky bottom-right apparaît en parallèle avec le méta-texte « Sauvegarder maintenant · auto dans 2s » (2205). L'utilisateur voit 2 boutons Save et 2 indicateurs pour une seule action.
- **Reco** : Garder un seul point de vérité : la top bar (déjà sticky) avec son bouton. Supprimer le bouton flottant bottom, ou au minimum son « · auto dans 2s » — l'auto-save n'a pas à être expliqué, il doit juste marcher (le « ✓ Profil sauvegardé » suffit comme feedback).

### [MEDIUM/M] La card TM déverse l'inventaire complet de tm.io en 4 sous-sections labellisées, chacune avec ses mini-boxes bordées — l'info de niche est montrée d'office au même volume que l'essentiel.

- **Zone** : densité (dimension density)
- **Où** : Profil joueur — card Trackmania, app/profile/[id]/page.tsx:746-869
- **Preuve** : 4 blocs empilés dans une seule card : Trophées+Échelon, CLASSEMENT PAR ZONE (n lignes bordées), TROPHÉES PAR TIER (jusqu'à 9 chips bordées T1-T9 avec code couleur bronze/argent/or), CUP OF THE DAY (3 boxes MEILLEUR/MOYENNE/JOUÉES). Des tooltips title= compensent l'absence de hiérarchie (« Les trophées sont classés en 9 tiers… »).
- **Reco** : Garder visible le tier 1 d'info : trophées + échelon + meilleur COTD sur une ligne. Replier « par zone » et « par tier » derrière un « Voir le détail » (ou les retirer — le lien Trackmania.io en bas donne déjà tout). Une stat montrée = une stat que quelqu'un compare.

### [MEDIUM/S] Une stat mineure et une action critique pèsent pareil : la modale de suppression de compte (destructive, irréversible) a exactement le même traitement (barre 3px gradient + bevel + surface) que la sous-nav mobile et la save bar. L'écran ne dit jamais "ATTENTION ici" parce que tout est déjà au volume max.

- **Zone** : hiérarchie (dimension uniformity)
- **Où** : app/settings/page.tsx:711 vs :787 vs :2081
- **Preuve** : l.2081 modale danger : `h-[3px]` gradient rouge `#ef4444` — structurellement identique à l.787 (sous-nav, gradient or) et l.711 (save bar, gradient or). Seule la teinte change, pas le langage visuel.
- **Reco** : Inverser le contraste : navs et save bar deviennent plats (fond surface + border, zéro barre) ; la modale danger garde SEULE sa barre + border rouge. Le rouge devient alors le seul élément "fort" de l'écran, ce qui est son rôle.

### [MEDIUM/S] La classe .pillar-card (hover : border blanche 0.18 + bg elevated, conçue pour des cards CLIQUABLES) est appliquée à des sections de formulaire et des blocs d'info statiques : tout s'allume au survol comme un lien, fausse affordance + sensation "tout est la même card".

- **Zone** : uniformité (dimension uniformity)
- **Où** : app/settings/page.tsx:872, 940, 1465, 1622, 1703, 1753 + app/profile/[id]/page.tsx:471, 1024, 1064, 1135
- **Preuve** : design-system.css l.402-406 définit .pillar-card:hover ; settings l.872 `pillar-card panel relative group` sur la section PROFIL (un formulaire), profil l.471 sur la BIO (du texte). Aucun de ces blocs n'est un lien.
- **Reco** : Retirer .pillar-card (et les `group transition-all`) de tout conteneur non-interactif — remplacer par .panel seul. Réserver le hover-lift aux vrais liens/boutons (annuaires, widgets dashboard). Pure suppression de classes, zéro risque.

### [MEDIUM/M] Triple empilement du même chrome sur un seul écran : CompactStickyHeader (barre 2px + icône encadrée), header de page (barre 3px + glow + icône encadrée + même titre STRUCTURES), puis chaque card de l'annuaire (barre 3px + glow hover). Le même motif à 3 niveaux de z-index, c'est la répétition qui "pue le template".

- **Zone** : uniformité (dimension uniformity)
- **Où** : app/community/structures/page.tsx:114-118 + 125-188 + 265-267
- **Preuve** : CompactStickyHeader.tsx l.51-61 (barre + boîte icône ${accent}40) ; structures/page.tsx l.129-137 (barre or + glow + boîte Shield + titre STRUCTURES, déjà dans le sticky) ; l.265-267 (barre + glow sur chacune des N cards, jusqu'à 4 colonnes).
- **Reco** : Header de page : titre t-heading nu + compteur t-mono, sans card du tout (la barre de recherche/filtres peut rester dans un panel plat). Cards annuaire : .panel + bevel nus, l'identité couleur vient du GameTag déjà présent ; ne garder un traitement fort (border verte) que sur "Match ton rôle" — c'est la seule info qui mérite de crier.

### [MEDIUM/S] Sur le premier écran connecté, 5 surfaces sur 5 portent barre + glow (welcome banner, 3 widgets, bannière Discord). Rien ne recule, donc rien n'avance : le "prochain event" (l'info la plus utile du dashboard) a le même poids qu'une invitation Discord permanente.

- **Zone** : hiérarchie (dimension uniformity)
- **Où** : components/home/ConnectedDashboard.tsx:153-155, 335-337, 396-400
- **Preuve** : l.153 barre or + l.154 glow 500px (welcome) ; WidgetCard l.398 barre + l.399-400 glow hover (×3) ; l.335 barre blurple + l.336-337 glow (Discord). 5 barres visibles simultanément au-dessus du fold.
- **Reco** : Garder le chrome complet sur le welcome banner uniquement (c'est le hero légitime). Widgets : .panel + bevel-sm avec icône colorée nue comme seul marqueur. Bannière Discord : une ligne fine (icône + texte + lien), pas une card — c'est de la pub interne, elle doit être l'élément le plus discret de l'écran, pas un égal.

### [MEDIUM/M] Sur le profil joueur (9 barres h-[3px]), la bio, la liste des structures et les chips de comptes liés — informations secondaires — reçoivent le même squelette barre+glow que le hero et les cards de stats par jeu. La colonne latérale concurrence visuellement le contenu principal au lieu de le servir.

- **Zone** : uniformité (dimension uniformity)
- **Où** : app/profile/[id]/page.tsx:471-473, 1024-1026, 1064-1066, 1135-1137
- **Preuve** : l.1136 : "Comptes & liens" porte une barre OR identique à celle du hero (l.294) ; l.472 : la bio a sa barre ; les 3 cards de jeu (l.527, 725, 904) ont chacune barre + glow 200px — soit 7+ panneaux décorés sur une seule page.
- **Reco** : Hero = seul Niveau 1 de la page (garde barre or). Cards de jeu = Niveau 2 : le watermark de rang + la couleur du chiffre suffisent comme identité (déjà présents), supprimer barre + glow. Sidebar = Niveau 3 : blocs plats titrés en t-label avec dividers ; seul "Recrutement" (si dispo) mérite un marqueur — c'est l'info actionnable pour un recruteur.

### [MEDIUM/S] Les warnings et confirmations système commencent par des emojis ⚠️ / ✓ collés dans le texte au lieu de passer par un composant d'alerte avec icône.

- **Zone** : copy (dimension copy)
- **Où** : Settings + modals staff + pages admin — app/settings/page.tsx:1070, 1400, 2287, 2294 ; components/structure/StaffGamesScopeModal.tsx:176, 240 ; app/admin/rank-reports/page.tsx:144 ; app/admin/valorant-link-changes/page.tsx:137 ; app/admin/rl-link-changes/page.tsx:139
- **Preuve** : settings/page.tsx:1400 : « ⚠️ Lie d'abord ton compte Rocket League… » ; :2287 « ⚠️ La connexion Riot… » ; admin : « Aucun signalement à traiter, ✓ propre. » Le ⚠️ en préfixe de paragraphe est un tic ChatGPT reconnaissable ; le reste du site signale les états par couleur + icône lucide.
- **Reco** : Créer (ou réutiliser) un petit composant d'alerte : icône lucide AlertTriangle/Check + bordure teintée, texte sans emoji. Pour les admin : « Aucun signalement à traiter. » suffit — l'absence de liste dit déjà que c'est propre.

### [MEDIUM/S] « La plateforme tout-en-un pour structures esport amateur » répété 4 fois — « tout-en-un » est le cliché SaaS généré par excellence, et c'est le premier texte vu dans Google et les embeds Discord.

- **Zone** : copy (dimension copy)
- **Où** : Meta descriptions SEO/OG — app/layout.tsx:44, 67, 74, 99
- **Preuve** : layout.tsx:44 : "La plateforme tout-en-un pour structures esport amateur : gestion d'équipes, calendrier collaboratif avec consensus automatique des dispos…" — dupliqué dans description, openGraph et twitter.
- **Reco** : Réécrire factuel et jargon : « Gestion de structure esport amateur : roster, scrims, dispos, recrutement, replays. Rocket League, Trackmania, Valorant. » Une seule source, réutilisée dans les 4 champs.

### [MEDIUM/S] Empty states sur-enthousiastes avec exclamation et formules creuses (« donne vie à la scène ! », triade « crée ton profil et rejoins la communauté »).

- **Zone** : copy (dimension copy)
- **Où** : Empty states annuaires — app/community/structures/page.tsx:354 ; app/community/players/page.tsx:1251 ; app/community/page.tsx:158
- **Preuve** : structures/page.tsx:354 : « Sois le premier à créer une structure sur Aedral et donne vie à la scène ! » ; players/page.tsx:1251 : « Sois le premier joueur Aedral, crée ton profil et rejoins la communauté. »
- **Reco** : Ton sec + l'action en bouton : « Aucune structure validée pour l'instant. » + bouton « Créer la mienne » ; « Aucun joueur dispo pour l'instant. » + bouton « Activer mon profil recrutement ». Le CTA porte le message, pas la phrase.

### [MEDIUM/S] Les intros des slides empilent triades marketing et verbes creux (« progresser ensemble », « progresse en continu ») — première chose lue par chaque nouvel inscrit.

- **Zone** : copy (dimension copy)
- **Où** : Modal Welcome premier login — components/onboarding/WelcomeModal.tsx:34, 38, 55
- **Preuve** : Ligne 34 : « …pour structurer ton équipe, planifier tes matchs et progresser ensemble. » (triade parfaite) ; ligne 55 : « Garde une trace de chaque match et progresse en continu. » ; ligne 38 : « Tout en un seul endroit : roster, calendrier, recrutement, replays, coaching ».
- **Reco** : Slide 1 : « Roster, calendrier, scrims, recrutement : l'organisation de ton équipe, au même endroit. » Slide 3 : « Replays, stats et exercices après chaque match. » Supprimer tout verbe de progression abstraite — les bullets concrets en dessous sont déjà bons.

### [MEDIUM/S] Une dizaine de points d'exclamation dans les feedbacks système (« SAUVEGARDÉ ! », « Copié ! », « Bienvenue sur Aedral ! », « upload-la en story ! ») — ton sur-enthousiaste sur des micro-confirmations.

- **Zone** : copy (dimension copy)
- **Où** : Toasts et boutons d'état — components/onboarding/OnboardingWizard.tsx:161 ; app/community/my-structure/tabs/general-tab.tsx:529 ; tabs/recruitment-tab.tsx:169 ; components/ui/ShareStoryButton.tsx:102 ; ShareBannerButton.tsx:92 ; ShareButton.tsx:451 ; app/community/players/page.tsx:897, 1219 ; app/community/join/[token]/page.tsx:141 ; components/calendar/MyTodosSection.tsx:274
- **Preuve** : general-tab.tsx:529 : bouton « SAUVEGARDÉ ! » ; ShareStoryButton.tsx:102 : toast.success('Image prête, upload-la en story !') ; join/[token]/page.tsx:141 : « BIENVENUE ! » en titre display. Le reste des toasts est exemplaire (« Replay supprimé », « Dispos enregistrées »).
- **Reco** : Sweep global : supprimer tous les « ! » des chaînes système. « Sauvegardé », « Copié », « Bienvenue », « Image prête, partage-la en story ». Règle skill aedral-style : zéro exclamation hors contenu utilisateur.

### [MEDIUM/M] Des helper texts de 1-2 phrases répètent ce que l'UI montre déjà au lieu de n'apporter que l'info non évidente.

- **Zone** : copy (dimension copy)
- **Où** : Helpers qui paraphrasent — app/settings/page.tsx:1396 ; components/calendar/EventFormModal.tsx:832-834, 853-855, 987-989
- **Preuve** : settings:1396 sous le select de rang : « Affiché à côté de ton lien tracker, n'importe qui peut vérifier en un clic. Modifier ton rang permet à nouveau aux autres de le signaler… » ; EventFormModal:833 à côté du chip MATCH : « Affiché avec mise en avant côté site et Discord. » ; :988 à côté de TOURNOI : « Compétition externe ou interne, détails optionnels. » (les champs en dessous sont déjà marqués optionnels).
- **Reco** : Ne garder que les conséquences cachées : settings → « Modifier ton rang le rend à nouveau signalable. » ; supprimer les helpers des chips MATCH et TOURNOI ; sur le logo adversaire garder seulement « HTTPS uniquement. ». Garder celui de PARTIE (visibilité du mot de passe = info de sécurité non évidente).

### [MEDIUM/S] Vocabulaire RH/corporate (« vivier », « disponible au recrutement ») là où le jargon esport FR authentique existe et crédibilise.

- **Zone** : copy (dimension copy)
- **Où** : Pilier accueil + filtre annuaire — app/page.tsx:85 (« VIVIER JOUEURS ») ; app/community/players/page.tsx:414 (« Dispo au recrutement ») ; app/profile/[id]/page.tsx:354 (« Disponible »)
- **Preuve** : app/page.tsx:85 : titre de card « VIVIER JOUEURS » — terme de DRH, aucun joueur de 20 ans ne dit « vivier ». La scène FR dit LFT (looking for team), free agent, mercato.
- **Reco** : Pilier : « VIVIER JOUEURS » → « MERCATO » (tag « Recrutement » conservé en sous-titre). Chip filtre et badge profil : « Dispo au recrutement » / « Disponible » → « LFT ». C'est le signal le plus fort que le site est fait par quelqu'un de la scène.

### [MEDIUM/S] Fuite de jargon technique + franglais dans une card grand public : « Stockage R2 par structure » et « Hosted sur Cloudflare R2, jamais perdu » — viole la règle interne « pas de mentions techno » appliquée au guide.

- **Zone** : copy (dimension copy)
- **Où** : Landing, card stockage — components/landing/VisitorLanding.tsx:406-407
- **Preuve** : Ligne 406 : title « Stockage R2 par structure » ; ligne 407 : « …Hosted sur Cloudflare R2, jamais perdu. » Un visiteur ne sait pas ce qu'est R2 ; « Hosted » en anglais au milieu d'une phrase FR fait texte généré non relu.
- **Reco** : Titre : « Stockage d'équipe » ; desc : « Stratégies, replays, charte interne. Organisés en dossiers, accessibles à toute l'équipe. » Point final — la promesse « jamais perdu » n'engage que des ennuis.

### [MEDIUM/S] Emojis et glyphes Unicode (⚠️ 🎮 🏆 🌍 ✓ ✗ ★) utilisés comme éléments d'UI produit — aucune des quatre références n'a un seul emoji dans son interface ; ils encodent l'état via le système de design (couleur, pastille, icône système).

- **Zone** : copy (dimension benchmark)
- **Où** : app/settings/page.tsx:1070,1400,2287,2294 (⚠️ inline), components/calendar/EventFormModal.tsx:830,885,985 (⚔/🎮/🏆 dans des labels), app/profile/[id]/page.tsx:57 (🌍 fallback drapeau), guide/page.tsx:38,96 (badge ✓ dans le texte)
- **Preuve** : Les warnings de Settings commencent par le caractère ⚠️ collé au texte (page.tsx:1070, 1400), les types d'event affichent «🎮 PARTIE» et «🏆 TOURNOI» (EventFormModal.tsx:885, 985), le fallback pays est l'emoji 🌍 (profile/[id]/page.tsx:57). L'emoji a un rendu OS-dépendant qui casse la DA mono noir+or et crie « rédigé par un LLM ».
- **Reco** : Remplacer chaque glyphe par l'équivalent design-system déjà existant : ⚠️ → bandeau avec AlertCircle lucide + border rgba(239,68,68,…) (pattern déjà présent settings/page.tsx:768-776) ; 🎮/🏆 → le système TYPE_COLOR + tag déjà en place dans ConnectedDashboard ; 🌍 → icône Globe lucide ou rien ; ✓ texte → ShieldCheck/Check. Garder le picker emoji du MarkdownEditor (contenu utilisateur, pas UI). Grep ciblé, une passe.

### [MEDIUM/M] Chaque page ouvre sur la même card-header (icon encadrée + titre Bebas + compteur t-mono + accent bar + glow) puis la re-duplique en sticky header — chez Linear/Vercel le titre de page est du texte nu sans conteneur, et le budget de chrome part dans les données, pas dans le chapeau.

- **Zone** : uniformité (dimension benchmark)
- **Où** : Headers de pages — structures/page.tsx:125-188 (header-card avec icon-box + bar + glow), CompactStickyHeader.tsx (le même template dupliqué en sticky), settings/page.tsx:703-711, players, guide
- **Preuve** : Le header de l'annuaire structures est une card bevel complète avec bar 3px or, glow radial 160px, icon-box 40px (structures/page.tsx:126-137), et CompactStickyHeader rejoue exactement le même motif (bar 2px + icon-box + Bebas) au scroll. Une page settings Vercel commence par « Settings » en texte, point. Résultat : avant la première donnée, l'utilisateur a déjà vu 2x le même bloc décoratif.
- **Reco** : Aplatir les headers : h1 Bebas nu + meta inline (compteur, filtres) sur la même ligne, sans panel, sans icon-box, sans bar. Le sticky header peut rester (utile) mais réduit à titre + actions sur fond blur, sans la bar accent ni la boîte d'icône. Gain immédiat de respiration en haut de chaque page — là où se forme la première impression.

### [MEDIUM/S] Les chips .tag sont utilisées en remplissage décoratif — listes de mots-clés («Roster», «Équipes», «Planning», «Inscriptions») et eyebrow-tags systématiques au-dessus de chaque h2 — alors que chez Faceit/Linear une chip encode toujours un état filtrable ou un statut, jamais une énumération SEO.

- **Zone** : densité (dimension benchmark)
- **Où** : app/page.tsx:243-247 (rangée de 4 tags neutres par pilier), 230-239 (stat counter Bebas par card), VisitorLanding.tsx:114,267,330,417,437,503,545,643 (un tag chapeau au-dessus de CHAQUE titre de section)
- **Preuve** : Chaque pillar-card du dashboard porte 4 tags neutres listant ses features (page.tsx:244-246) + un tag catégorie dans le header + un gros compteur Bebas — 3 systèmes de méta pour une card de navigation. Sur la landing, les 7 sections ont toutes leur tag chapeau («Pour les joueurs», «Le produit en images», «Questions fréquentes») : motif eyebrow-tag répété = signature template IA.
- **Reco** : Supprimer les rangées de tags-features des pillar-cards (la description suffit) et les stat counters par card (info dupliquée du hero). Sur la landing, supprimer les eyebrow-tags des sections — le t-display Bebas hiérarchise déjà ; garder les tags uniquement quand ils portent un état réel (RECRUTE, MATCH, jeu, statut live).

### [MEDIUM/M] Sur-explication systématique : chaque champ/état est accompagné d'un paragraphe pédagogique affiché en permanence, là où Linear/Vercel pratiquent la divulgation progressive (une ligne max inline, le reste en tooltip ou lien docs) — l'UI qui sur-explique paraît générée car elle ne fait pas confiance à sa propre clarté.

- **Zone** : copy (dimension benchmark)
- **Où** : app/settings/page.tsx (paragraphes d'aide multi-lignes inline : 1070, 1400, 2287-2294), app/guide/page.tsx:33-158 (bullets de 2-3 lignes), ConnectedDashboard.tsx:363-370 (buildStatus phrase d'état verbalisée)
- **Preuve** : Settings affiche en dur des avertissements de 3 lignes («⚠️ La connexion Riot sur ton Discord pointe vers un autre compte que celui vérifié. Tant que ce n'est pas résolu… fais une demande de changement (validée par un admin).», page.tsx:2287). Le banner du dashboard verbalise l'état en phrase («prochain event dans 2h · 3 exercices à faire · …», ConnectedDashboard.tsx:363-370) au lieu de laisser les widgets parler. Un champ Vercel : label + une ligne de hint grise, le détail vit dans la doc.
- **Reco** : Règle : 1 ligne de helper max sous un champ ; tout warning conditionnel = bandeau compact 1 ligne + action («Compte Riot désynchronisé — Faire une demande»), le pourquoi en tooltip ou lien /guide. Supprimer la phrase buildStatus du banner (redondante avec les 3 widgets juste dessous). Le /guide reste le réceptacle légitime des explications longues.

### [MEDIUM/S] La promesse « Pas de slides marketing. Des captures du vrai site, en production. » est contredite par la capture elle-même : un event entièrement vide.

- **Zone** : copy (dimension visual)
- **Où** : Landing, section Showcase « CHAQUE MATCH, SON HISTOIRE » — components/landing/VisitorLanding.tsx
- **Preuve** : Screenshot prod : Présent (0), Peut-être (0), Absent (0), compte rendu vide, à travailler vide, « Aucun replay attaché à cet event ». Une capture d'écran d'états vides donne exactement l'impression d'un produit démo fraîchement généré.
- **Reco** : Recapturer cet écran avec un vrai match rempli (présences, score, compte rendu, 2 replays) — 30 min de mise en scène avec des données réelles d'une structure partenaire. Vérifier les 5 autres captures du showcase avec le même critère : aucune ne doit montrer un zéro.

### [MEDIUM/S] Une entrée de navigation top-level mène à une page vide : « AUCUNE NOUVEAUTÉ POUR L'INSTANT — Reviens plus tard », alors que le produit ship des features chaque semaine.

- **Zone** : navigation (dimension visual)
- **Où** : /changelog (« Nouveautés », entrée de nav sidebar)
- **Preuve** : Screenshot prod : page vide. Pire, le header promet « Filtre par catégorie pour zoomer sur un type de changement » — un filtre qui n'existe nulle part à l'écran. Helper text qui décrit une UI absente = tell classique de copy générée déconnectée de la réalité.
- **Reco** : Soit peupler immédiatement (le pipeline existe : les templates d'annonces Discord de fin de session peuvent alimenter la même collection), soit masquer l'entrée de nav tant que la collection est vide. Supprimer la phrase sur le filtre tant qu'il n'y a pas de filtre.

### [MEDIUM/S] Quasi tous les noms de structures sont tronqués (« ARAN ESPO… », « ALPHORIA ES… », « LIONERA ESP… », « THE CUIZINE… ») alors que la moitié droite de la ligne titre est vide ; et un logo hotlinké cassé affiche son texte alt brut.

- **Zone** : uniformité (dimension visual)
- **Où** : /community/structures — app/community/structures/page.tsx:281
- **Preuve** : Screenshot prod : 6 cards sur 11 ont un nom ellipsé à ~10 caractères avec de l'espace disponible à droite du tag chip. Le logo Alphoria (i.postimg.cc) échoue en ERR_HTTP2_PROTOCOL_ERROR et rend « ALPHO… » en texte brut dans le cadre. Des titres coupés partout + une image cassée = l'annuaire vitrine paraît négligé/auto-généré.
- **Reco** : Laisser le nom prendre toute la largeur (tag chip passé sous le nom ou en coin), truncate seulement en vrai overflow. Pour les logos : proxifier/re-uploader les URLs externes vers R2 à la sauvegarde (l'anti-pattern hotlink est déjà documenté dans CLAUDE.md) + fallback monogramme propre au lieu de l'alt text.

### [MEDIUM/S] La page s'excuse trois fois d'être en chantier : hero « En attendant l'hébergement natif… (en cours de construction) », 2 cards « HÉBERGÉE SUR SPRINGS-ESPORT.VERCEL.APP », et un panel final « Compétitions natives Aedral, bientôt » qui re-paraphrase le hero.

- **Zone** : copy (dimension visual)
- **Où** : /competitions (page entière)
- **Preuve** : Screenshots prod : le panel « bientôt » liste même les features à venir (« Inscription d'équipe en 2 clics, classements live, brackets RL… ») — du vaporware listé à un visiteur. Trois aveux de chantier sur une page de nav principale = perception site démo inachevé.
- **Reco** : Un seul signal de statut suffit : garder les 2 cards compétitions (elles sont belles et concrètes), réduire la mention d'hébergement à la ligne discrète déjà présente sur les cards, supprimer le hero excuse ET le panel « bientôt ». On n'annonce pas une roadmap dans une page de nav.

### [MEDIUM/M] 11 écrans de scroll pour un produit pré-traction : hero + bande stats (vide) + 2 sections features (6 cards) + 6 blocs showcase + 3 étapes + compétitions + FAQ + CTA. La longueur elle-même est un marqueur « landing générée » : tout y est parce que rien n'a été arbitré.

- **Zone** : densité (dimension visual)
- **Où** : Landing complète (.landing-root, ~9 740px)
- **Preuve** : Mesuré en prod : scrollHeight 9 740px pour un viewport de 900px. En comparaison, les références assumées (Linear, Vercel) tiennent leur pitch en 4-6 écrans avec une vraie respiration entre les blocs.
- **Reco** : Viser ~6 écrans : supprimer la bande stats (cf. finding dédié), réduire le showcase de 6 à 3 captures fortes (structure publique, calendrier, annuaire), fusionner « Trois étapes » dans le bloc CTA final (les 3 steps sont déjà le parcours du CTA). Moins de sections mieux espacées > tout montrer.

### [MEDIUM/S] Chaque page ouvre sur le même rituel : icône dans un carré encadré or + titre Bebas + sous-titre qui explique ce que la page fait — y compris quand c'est évident (un annuaire, un changelog).

- **Zone** : sur-explication (dimension visual)
- **Où** : Headers de pages app : /guide, /changelog, /community/players, /community/structures (pattern SectionPanel/header partagé)
- **Preuve** : Vu sur 4 pages d'affilée : « NOUVEAUTÉS — Tout ce qui a changé sur Aedral, dans l'ordre du plus récent… », « DÉCOUVRIR AEDRAL — Tout ce que tu peux faire sur Aedral : … » (énumération de 8 features), « JOUEURS — 0 joueur chargé ». Le sous-titre-notice systématique est un pattern de génération (chaque écran se justifie) ; un humain n'explique pas un annuaire.
- **Reco** : Règle simple : sous-titre seulement s'il apporte une info d'état utile (« 11 actives · 7 recrutent » est parfait — garder), jamais une définition de la page. Supprimer les sous-titres descriptifs de /guide et /changelog, et envisager de réserver l'icône encadrée aux panels de contenu plutôt qu'à chaque header de page.

### [LOW/S] 9 items d'information pour une card qui est un simple lien externe vers le vieux site, dont l'URL technique affichée en clair dans le footer.

- **Zone** : densité (dimension density)
- **Où** : Dashboard connecté — comp-cards, app/page.tsx:148-192
- **Preuve** : Tag RL + label jeu + status « En cours » + titre + 4 métas (format/équipes/date/prize) + divider + « springs-esport.vercel.app » (lignes 183-185) + bouton « Ouvrir ». La ligne d'URL est du bruit développeur : aucun utilisateur n'a besoin de lire le domaine de destination, l'icône ExternalLink du bouton le signale déjà.
- **Reco** : Supprimer la ligne URL + le divider du footer ; garder titre, 2-3 métas max (format + prize) et le bouton. La card respire et l'image de fond reprend son rôle.

### [LOW/S] Bullets méta qui parlent de la page au lieu du produit (3 renvois « voir Spécificités par jeu » dans la même page) + adjectif marketing « intelligent ».

- **Zone** : copy (dimension copy)
- **Où** : Page guide — app/guide/page.tsx:41, 116 (renvois) et :76 (« consensus intelligent »)
- **Preuve** : guide:41 : « Pour la liste précise des comptes vérifiables par jeu, voir la section Spécificités par jeu plus bas » — c'est un item de feature list qui ne décrit aucune feature ; même renvoi en :37 et :116. :76 : « un système de consensus intelligent ».
- **Reco** : Supprimer les bullets de renvoi :41 et :116 (le renvoi inline de :37 suffit, ou un lien d'ancre discret). « système de consensus intelligent » → « heatmap de consensus des dispos » : décrire le mécanisme, pas le qualifier.

### [LOW/S] Le texte de partage généré commence par « Découvre … sur Aedral » — verbe banni de la voix éditoriale (formule pub creuse).

- **Zone** : copy (dimension copy)
- **Où** : Textes de partage — app/profile/[id]/page.tsx:438 ; app/community/structure/[id]/page.tsx:568
- **Preuve** : profile/[id]/page.tsx:438 : text={`Découvre ${profile.displayName || 'ce joueur'} sur Aedral`} ; même pattern pour les structures :568.
- **Reco** : Texte neutre : `${displayName} sur Aedral` (ou `${name} — profil joueur, rang vérifié` pour les profils). L'embed OG custom fait déjà le travail de séduction, pas besoin d'impératif publicitaire.

### [LOW/S] Le breadcrumb affiche « Accueil > Accueil > Guide » : la page passe un item Accueil alors que le composant Breadcrumbs en préfixe déjà un.

- **Zone** : copy (dimension visual)
- **Où** : /guide, fil d'Ariane — app/guide/page.tsx:209 + components/ui/Breadcrumbs.tsx:26
- **Preuve** : Screenshot prod du /guide : doublon visible en haut de page. Les autres pages (ex. /community/structures → « Accueil > Communauté > Structures ») sont correctes, c'est bien le call site du guide qui duplique.
- **Reco** : Retirer { label: 'Accueil', href: '/' } de l'appel dans app/guide/page.tsx:209 — ou mieux, faire que Breadcrumbs dédoublonne. Un breadcrumb bègue est petit mais c'est exactement le genre de détail qui fait dire « généré sans relecture ».

### [LOW/S] Le titre de card « Roster + sous-équipes » viole la règle éditoriale du projet : jamais « sous-équipe » dans l'UI (terme péjoratif banni).

- **Zone** : copy (dimension visual)
- **Où** : Landing, card features structures — components/landing/VisitorLanding.tsx:304
- **Preuve** : Visible en prod dans la section « GÈRE TA STRUCTURE » ; la mémoire projet feedback_no_sous_equipe interdit explicitement ce mot, et le reste du site dit bien « équipes ».
- **Reco** : Renommer en « Roster + équipes » (et grep « sous-équipe » sur tout le user-facing pour purger les survivants).
