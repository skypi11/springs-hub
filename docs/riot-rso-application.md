# Dossier de demande d'accès Riot (clé de production + RSO) — Aedral

> But : obtenir sur le [Riot Developer Portal](https://developer.riotgames.com) (1) une **clé de production**, puis (2) l'accès **RSO** (« Sign in with Riot »), pour restaurer la vérification des comptes Valorant (et, plus tard, League of Legends) après la suppression des connexions Riot de l'API Discord (effective 10/07/2026, « no replacement »).
>
> Les blocs ci-dessous sont en **anglais** (Riot review en anglais) et **directement copiables** dans les champs du formulaire. La guidance et les risques sont en français, pour Matt.

---

## 1. Texte de la demande (à copier dans le portail Riot)

### Product name
Aedral

### Tagline
A live community platform for amateur esports — verified player identities, teams, and free grassroots competitions.

### Product URL
https://aedral.com

### Product description
Aedral (https://aedral.com) is a live, fully functional community platform for amateur esports. Players create a profile, join community organizations and teams (rosters, shared calendars, recruitment), and take part in natively hosted community competitions — qualifier circuits leading to a LAN final. Our partner association, Springs E-Sport, organizes competitions on the platform.

Aedral is a personal project operated and published by a named individual, Matt Molines, as a sole proprietor (a natural person, not a company). The site's legal notices identify the publisher by name, so there is a clear, accountable operator. Aedral is not affiliated with, nor endorsed by, Riot Games.

The platform is free for players. Scale is small but genuinely growing: roughly 170 registered users across about 11 organizations. Supported games today are Rocket League and Trackmania, with Valorant supported and League of Legends planned in the near term.

This is a working product in active use, not a prototype, mockup, or landing page. A reviewer can verify it in about two minutes: open https://aedral.com, sign in with Discord, and browse a real player profile, an organization page, and the competitions section.

### Target audience
Amateur / grassroots esports players and small community organizations (teams) in Europe. These are hobbyist and semi-serious competitors who lack the tooling that larger scenes take for granted — verified profiles, roster management, calendars, recruitment, and fair, natively hosted community tournaments. The service is free for players.

### Access requested (and why — keep it minimal)
- **Riot Sign-On (RSO) — "Sign in with Riot", scope: `openid` only** — To let a player authenticate directly with Riot and confirm they genuinely own the Riot account they display on their Aedral profile. This is the core of the request: our amateur tournaments require fair, verified identities (anti-smurf, anti-rank-misrepresentation), and RSO is the only reliable, first-party way to prove account ownership. It directly replaces the Riot connection we previously obtained through Discord, which Discord removed from its OAuth API (effective 10 July 2026, announced with "no replacement"). We request the `openid` scope only — no additional scopes.
- **Account v1 (`/riot/account/v1/accounts/me`)** — To read the authenticated player's verified identity — PUUID and RiotID (gameName + tagLine). The openid sign-in confirms the account is theirs; account-v1 returns the RiotID we display on the player's own profile and the immutable PUUID we use as the verification anchor. We read only the currently authenticated player's own record. We do not request, need, or use match data or any restricted Valorant endpoint.
- **League of Legends API (summoner-v4 / league-v4) — near-future** — When Aedral adds League of Legends as a supported game, we intend to display a player's own LoL rank on their own profile using these official endpoints. Because one Riot account represents the same player across Valorant and League of Legends, the same RSO sign-in covers both titles — so this is a genuine multi-game Riot integration, not a separate access path. We would use these endpoints only for the authenticated player's own account, never for bulk lookups or other players' data. Mentioned here for transparency; the immediate need is RSO + Account v1.

### RSO & data flow
Request: production access to Riot Sign-On (RSO) for Aedral, scope `openid` only. The flow mirrors our existing Steam OpenID account-linking, which is already live in production, and runs entirely server-side.

1. On their own Aedral settings/onboarding page, an already-signed-in player clicks "Sign in with Riot".
2. They are redirected to Riot's authorization page and authenticate directly with Riot. Aedral never sees their Riot credentials.
3. Riot redirects back to our server callback with an authorization code.
4. Our server exchanges the code for tokens (server-side only — tokens are never exposed to the browser) and calls Account v1 `/accounts/me`.
5. We store the returned PUUID (immutable) and RiotID (gameName#tagLine) against that player's Aedral profile, marking the Riot account as "verified".

What we retrieve: the PUUID and the RiotID — nothing else. Strict use, exactly two purposes: (a) displaying the player's own verified Riot identity on their profile, and (b) establishing eligibility and anti-smurf checks for the community tournaments they choose to enter. We never act on behalf of the player, we post nothing, and we read no data about any other player.

The PUUID is treated as the immutable anchor of the link: a later username change cannot break or spoof the verification. To further prevent fraud, changing the linked Riot account requires manual review by an administrator. This is the same integrity model we already apply to our Epic/Steam-based verification.

### Data storage & privacy
Data stored: only the player's PUUID (immutable identifier) and RiotID (gameName#tagLine), linked to that same player's Aedral profile. Nothing else is retrieved or stored from Riot.

Strict, limited usage: the data is used solely to display the player's own verified identity on their profile and to determine their eligibility in the community tournaments they choose to enter. It is never sold, never shared with third parties, and never used for advertising or profiling. There is no scraping or bulk collection — data is only ever obtained via the individual player's own authenticated RSO login, never by looking up players who have not signed in themselves.

GDPR posture (already implemented in production today): hosting and product analytics are EU-based; analytics are cookieless (PostHog EU — no advertising cookies, no consent banner needed). Users already have working data-export and account-deletion controls that cover their Riot identity data; a user can also unlink their Riot account at any time. Retention: the Riot identifiers persist only while the player keeps the link active and are removed on unlink or account deletion. Token exchange is server-side only and the PUUID is treated as a private identifier.

Accountable controller: the service is published by a named natural person (Matt Molines) with public legal notices identifying the editor, so there is an identifiable, reachable data controller and a clear point of contact for data requests. Data minimization by design: the smallest scope (openid) and storage limited to the two identifiers strictly needed for verification.

### Community competition compliance
Aedral's competitions are amateur, community-run, and free to enter (no entry fees). The format is qualifier circuits leading to a LAN final, organized by our partner association Springs E-Sport, and run in line with Riot's Community Competition Guidelines for grassroots events — community scale, modest prizing, no official or professional event.

The Riot integration exists specifically to strengthen competitive integrity: verified Riot identity lets us enforce anti-smurf and accurate-rank rules, so brackets are fair and results are trustworthy. This directly benefits the Riot players competing on the platform and supports the reputation of grassroots Riot events. There is no paywall on any Riot-derived information — verified identity and rank display are free for players — and no prize mechanism is built on Riot data.

We commit to Riot's API Terms of Service, rate limits, and data-handling requirements: minimal scope, no restricted data, no redistribution or resale of Riot data. There is no gambling or betting, no game automation or botting, and no interaction with the game client. Aedral never presents itself as affiliated with or endorsed by Riot Games, and "Sign in with Riot" will be implemented per the RSO and Riot brand guidelines. We will adjust scope, endpoints, or data handling promptly to whatever Riot Developer Relations prefers before access is granted.

### How to verify the product (à coller dans le champ description/instructions)
> How to verify the product (≈2 min): go to https://aedral.com and click "Sign in with Discord". Once signed in you can browse real player profiles, organization pages, and the Competitions section — all live, working features in active use by ~170 users across ~11 organizations. The RSO "Sign in with Riot" button is the feature this request would enable; today the equivalent verification runs on Epic/Steam. Happy to give a guided walkthrough or a screen recording on request.

---

## 2. Champs à renseigner par Matt (crédibilité)
- **Éditeur / operator** : « Matt Molines, sole proprietor (personne physique) ». Ne pas inventer de société — un opérateur nommé et joignable rassure plus qu'une coquille.
- **Legal notices / mentions légales** : coller l'URL publique `https://aedral.com/legal/mentions` (accessible sans login, doit nommer Matt Molines + contact).
- **Privacy policy** : lier `https://aedral.com/legal/confidentialite`. ⚠️ À vérifier/compléter AVANT de soumettre : elle doit mentionner les identifiants Riot (PUUID + RiotID) stockés, l'usage strict, la non-vente, l'export/suppression, le contact. (Claude vérifie/complète la page côté code.)
- **Contact email** : une adresse réelle et surveillée (le reviewer répond DANS le portail, mais l'email sert de point de contact data/RGPD).

---

## 3. Ordre de soumission (important)
1. **Compte dev Riot** : se connecter sur https://developer.riotgames.com avec ton compte Riot perso. La clé de dev (24h) générée auto est temporaire, juste pour tester — ce n'est PAS ce qu'on demande.
2. **Clé de production** : « Register Product » / « Apply for Production ». Remplir avec les blocs du §1 (description, cas d'usage = intégrité des tournois, URL live, instructions de test). Donne la clé prod générale + account-v1.
3. **Accès RSO** (séparé, plus verrouillé) : APRÈS la prod, formulaire RSO dédié (ou contacter Riot Developer Relations), en réutilisant le même cas d'usage + le bloc RSO/data flow + le bloc vie privée. Insister : scope `openid` uniquement, 2 identifiants stockés, remplacement officiel de la connexion Discord supprimée le 10/07/2026.

**Ne jamais demander plus que `openid` + account-v1 (+ league-v4 mentionné comme futur).** Le sur-scope est le motif de refus n°1.

**Délai** : review hebdo, jusqu'à ~3 semaines par demande (prévoir 2 fenêtres : prod puis RSO). Surveiller les **messages dans le portail** (pas l'email), répondre vite et factuellement. Si refus : lire le motif, corriger LE point (souvent privacy policy / scope / cas d'usage flou), resoumettre sans réargumenter défensivement.

**À ne pas faire** : inventer une société, gonfler les chiffres (170/11 = honnête et suffisant), demander des endpoints match Valorant, se présenter comme affilié Riot.

---

## 4. Risques de refus (auto-critique « reviewer Riot »)
La plupart des objections sont neutralisées par le dossier (produit live testable, scope minimal, vie privée stricte, opérateur nommé, besoin daté et légitime, aucune monétisation de la donnée Riot, pas de gambling/bot, pas d'affiliation revendiquée).

**Risque résiduel réel n°1 = le gating RSO pour un petit acteur.** Riot réserve historiquement RSO à des partenaires établis. On maximise en étant irréprochable sur le scope (`openid`) et la vie privée, et en s'appuyant sur le besoin daté (retrait Discord). Non éliminable côté rédaction — si refus sur ce motif : insister sur le caractère non commercial + volume d'appels très faible, et rester réactif.

**Pré-requis avant envoi** : publier/compléter la Privacy Policy publique (sinon motif de refus classique).

**À ne JAMAIS aborder** : la source du rang Valorant (hors périmètre, ouvrirait une question inutile).

---

## 5. Côté code (Claude, en parallèle)
- Vérifier/compléter la page Privacy Policy (`/legal/confidentialite`) pour couvrir les identifiants Riot AVANT soumission.
- Intégration RSO calquée sur le flow Steam OpenID déjà en prod : bouton « Se connecter avec Riot » → route `start` (state anti-CSRF) → callback serveur (échange code → account-v1/me) → stockage PUUID+RiotID verrouillé (mêmes garde-fous que Epic/Steam : premier lien libre, changement via demande admin, dé-dup anti-usurpation). Générique Riot (sert Valorant + LoL). Testable avec réponses simulées, prête à activer dès réception des identifiants Riot.
