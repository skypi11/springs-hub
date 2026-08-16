import { CONNECTION_META, type DiscordConnection } from '@/lib/discord-connections';
import type { SanctionScope } from '@/types/competitions';

// Reconnaître quelqu'un qui revient sous un autre compte Discord.
//
// Un compte Discord se refait en trente secondes : bannir un `uid` ne coûte
// donc rien à qui veut revenir. Un compte de JEU, lui, porte un rang, des
// achats, un historique — c'est ce que la personne ne veut pas perdre, et
// c'est pour ça qu'elle le relie à nouveau. C'est notre prise.
//
// Deux forces d'empreinte, et la distinction n'est pas cosmétique :
//
//   FORTE  — un identifiant immuable délivré par l'éditeur ET vérifié
//            (Discord atteste la possession du compte, ou l'OAuth de l'éditeur
//            le fait lui-même). Seules celles-ci peuvent BLOQUER.
//   FAIBLE — un pseudo, ou un identifiant dont personne n'a prouvé la
//            possession. Ça alerte un humain, ça ne ferme jamais une porte :
//            deux personnes peuvent porter le même pseudo.
//
// Ce module est PUR : aucun accès Firestore, aucune écriture. Il dit seulement
// « voici les empreintes de ce compte ». Le registre et les décisions vivent
// dans `lib/ban-evasion-server.ts`.

export interface GameIdentity {
  /** Plateforme, telle que nommée dans le registre. */
  type: string;
  /** Identifiant chez l'éditeur. */
  id: string;
  /** Pseudo au moment de la capture — pour l'affichage, jamais pour comparer. */
  label: string;
  /** Voir le commentaire d'en-tête : seules les fortes bloquent. */
  strong: boolean;
}

/** La forme d'un profil utile ici. Volontairement minimale : ce module ne doit
 *  rien savoir du reste du profil. */
export interface BanEvasionUser {
  uid?: string;
  discordConnections?: DiscordConnection[] | null;
  rlSteamId?: string | null;
  steamLinked?: { steamId64?: string | null } | null;
  valorantPuuid?: string | null;
  tmAccountId?: string | null;
  tmVerifiedAt?: unknown;
  epicAccountId?: string | null;
}

/** Libellés lisibles par un humain, pour les bandeaux d'alerte. */
export const IDENTITY_LABELS: Record<string, string> = {
  epicgames: 'compte Epic Games',
  steam: 'compte Steam',
  playstation: 'compte PlayStation',
  xbox: 'compte Xbox',
  battlenet: 'compte Battle.net',
  riotgames: 'compte Riot',
  leagueoflegends: 'compte League of Legends',
  riot_puuid: 'compte Riot (Valorant)',
  trackmania: 'compte Trackmania',
  epic_legacy: 'pseudo Epic',
};

export function identityLabel(type: string): string {
  return IDENTITY_LABELS[type] ?? `compte ${type}`;
}

function push(out: GameIdentity[], vu: Set<string>, i: GameIdentity): void {
  const id = i.id?.trim();
  if (!id) return;
  const cle = `${i.type}:${id}`;
  if (vu.has(cle)) return;
  vu.add(cle);
  out.push({ ...i, id });
}

/**
 * Les empreintes de jeu d'un compte.
 *
 * On ne retient QUE des comptes de jeu. Une connexion Spotify ou Twitter
 * partagée ne prouve rien d'utile ici — et l'audit du 16/08 a justement trouvé
 * deux comptes Discord partageant un Spotify, ce qui est très probablement
 * quelqu'un qui a simplement changé de Discord. Confondre les deux ferait crier
 * au tricheur sur un usage parfaitement normal.
 */
export function collectGameIdentities(user: BanEvasionUser | null | undefined): GameIdentity[] {
  if (!user) return [];
  const out: GameIdentity[] = [];
  const vu = new Set<string>();

  // Connexions Discord. `category: 'gaming'` vient de la table centrale des
  // connexions : ajouter une plateforme là-bas étend cette détection sans
  // toucher à ce fichier.
  for (const c of user.discordConnections ?? []) {
    if (!c?.type || !c?.id) continue;
    if (CONNECTION_META[c.type]?.category !== 'gaming') continue;
    push(out, vu, {
      type: c.type,
      id: String(c.id),
      label: c.name ?? '',
      // `verified` = Discord atteste la possession. Une connexion révoquée
      // reste une preuve : l'autorisation a été coupée APRÈS coup, l'identifiant
      // capturé était bien le sien.
      strong: c.verified === true,
    });
  }

  // SteamID64 — immuable, obtenu par OpenID Steam ou par la connexion Discord.
  push(out, vu, { type: 'steam', id: String(user.rlSteamId ?? ''), label: '', strong: true });
  push(out, vu, { type: 'steam', id: String(user.steamLinked?.steamId64 ?? ''), label: '', strong: true });

  // PUUID Riot — immuable côté éditeur, capturé au premier rattachement.
  push(out, vu, { type: 'riot_puuid', id: String(user.valorantPuuid ?? ''), label: '', strong: true });

  // Trackmania : `tmAccountId` est aussi écrit par la simple synchronisation des
  // trophées, qui ne lit qu'une API publique et ne prouve donc RIEN. Seul
  // `tmVerifiedAt` atteste de l'OAuth Nadeo.
  push(out, vu, {
    type: 'trackmania',
    id: String(user.tmAccountId ?? ''),
    label: '',
    strong: Boolean(user.tmVerifiedAt),
  });

  // Champ historique : il contient souvent un PSEUDO Epic, pas un identifiant
  // (constaté en base : « haloufman7 »). Gardé comme signal faible — il peut
  // rattraper un compte sans connexion Discord — mais il ne bloquera jamais
  // personne : deux joueurs peuvent porter le même pseudo.
  push(out, vu, { type: 'epic_legacy', id: String(user.epicAccountId ?? ''), label: '', strong: false });

  return out;
}

/**
 * L'identifiant de document du registre pour une empreinte.
 *
 * Déterministe, donc la question « ce compte de jeu est-il banni ? » se répond
 * par un accès direct, sans requête ni index — au prix d'une lecture par
 * empreinte, sur un chemin (la connexion) qui doit rester rapide.
 */
export function identityDocId(identity: { type: string; id: string }): string {
  const brut = `${identity.type}:${identity.id.trim()}`;
  // Firestore refuse « / » dans un identifiant de document, réserve le motif
  // `__…__`, et interdit « . » et « .. » seuls. On neutralise le reste par
  // précaution : ces valeurs viennent d'API tierces.
  const propre = brut.replace(/[^A-Za-z0-9:._-]/g, '-').slice(0, 300);
  return /^__.*__$/.test(propre) ? `id-${propre}` : propre;
}

/** Une entrée du registre : qui a été banni, pourquoi, et par quelle voie. */
export interface BannedIdentityEntry {
  uid: string;
  label: string;
  reason: string;
  /** `site` ferme tout le site ; `competition` ne ferme QUE les compétitions.
   *  Les deux systèmes sont étanches : une sanction de compétition n'a jamais
   *  fermé le site, et ce registre ne change rien à ça. */
  source: 'site' | 'competition';
  /** Pour une sanction de compétition : un `ban` vaut partout, une `exclusion`
   *  ne vaut que dans sa portée. Sans cette distinction, le registre ferait
   *  d'une exclusion d'un tournoi un bannissement de tous. */
  sanctionType?: 'ban' | 'exclusion' | null;
  scope?: SanctionScope | null;
  competitionId: string | null;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface BanEvasionMatch {
  identity: GameIdentity;
  entry: BannedIdentityEntry;
}

/** Une entrée encore en vigueur. */
export function isEntryActive(e: BannedIdentityEntry): boolean {
  return !e.revokedAt;
}

/**
 * Ce qu'on affiche à l'administrateur. Une phrase, pas un tableau : elle doit
 * se lire dans un bandeau au-dessus d'une demande de structure.
 */
export function describeMatches(matches: BanEvasionMatch[]): string {
  if (matches.length === 0) return '';
  const m = matches[0];
  const quoi = identityLabel(m.identity.type);
  const qui = m.entry.label || m.entry.uid;
  const ou = m.entry.source === 'site' ? 'banni du site' : 'banni des compétitions';
  const reste = matches.length > 1 ? ` (et ${matches.length - 1} autre${matches.length > 2 ? 's' : ''} correspondance${matches.length > 2 ? 's' : ''})` : '';
  return `Partage le ${quoi} de « ${qui} », ${ou}${m.entry.reason ? ` — ${m.entry.reason}` : ''}${reste}.`;
}

/** Les correspondances qui peuvent BLOQUER : empreinte forte uniquement. */
export function blockingMatches(matches: BanEvasionMatch[]): BanEvasionMatch[] {
  return matches.filter((m) => m.identity.strong);
}

/**
 * Le rapprochement fait de mémoire, sans lire le registre.
 *
 * Le tableau de bord de la modération lit déjà TOUS les comptes : croiser leurs
 * empreintes sur place ne coûte donc pas une seule lecture de plus, et surtout
 * ça couvre les comptes créés AVANT que le registre n'existe — ceux qui, sinon,
 * n'apparaîtraient qu'à leur prochaine connexion.
 *
 * Le registre reste indispensable pour ce que cette fonction ne peut pas voir :
 * les bannis dont le compte a été supprimé.
 */
export function crossMatchBannedIdentities(
  users: (BanEvasionUser & {
    uid: string;
    label: string;
    isBanned?: boolean;
    banReason?: string;
    bannedAt?: string | null;
  })[],
): { uid: string; label: string; matches: BanEvasionMatch[] }[] {
  const parEmpreinte = new Map<string, { user: (typeof users)[number]; identity: GameIdentity }[]>();
  for (const u of users) {
    if (u.isBanned !== true) continue;
    for (const identity of collectGameIdentities(u)) {
      const cle = `${identity.type}:${identity.id}`;
      if (!parEmpreinte.has(cle)) parEmpreinte.set(cle, []);
      parEmpreinte.get(cle)!.push({ user: u, identity });
    }
  }
  if (parEmpreinte.size === 0) return [];

  const out: { uid: string; label: string; matches: BanEvasionMatch[] }[] = [];
  for (const u of users) {
    if (u.isBanned === true) continue;
    const matches: BanEvasionMatch[] = [];
    for (const identity of collectGameIdentities(u)) {
      for (const porteur of parEmpreinte.get(`${identity.type}:${identity.id}`) ?? []) {
        matches.push({
          identity,
          entry: {
            uid: porteur.user.uid,
            label: porteur.user.label,
            reason: porteur.user.banReason ?? '',
            source: 'site',
            competitionId: null,
            createdAt: porteur.user.bannedAt ?? '',
            createdBy: '',
            revokedAt: null,
            revokedBy: null,
          },
        });
      }
    }
    if (matches.length > 0) {
      out.push({
        uid: u.uid,
        label: u.label,
        matches: matches.sort((a, b) => Number(b.identity.strong) - Number(a.identity.strong)),
      });
    }
  }
  return out;
}

/**
 * Cette correspondance interdit-elle CETTE inscription ?
 *
 * Trois refus possibles, et un seul cas qui laisse passer :
 *   · empreinte faible (un pseudo) → jamais de blocage, on alerte ;
 *   · bannissement du SITE → la personne ne devrait pas être là du tout ;
 *   · sanction de compétition → un `ban` vaut partout, une `exclusion`
 *     seulement dans sa portée.
 */
export function matchBlocksRegistration(
  match: BanEvasionMatch,
  target: { competitionId: string; circuitId?: string | null },
): boolean {
  if (!match.identity.strong) return false;
  const e = match.entry;
  if (!isEntryActive(e)) return false;
  if (e.source === 'site') return true;
  // Par défaut — entrées écrites avant l'ajout du champ — on retient le cas le
  // plus large : une sanction de compétition sans type connu est un ban.
  if (!e.sanctionType || e.sanctionType === 'ban') return true;
  const sc = e.scope;
  if (sc?.kind === 'competition') return sc.competitionId === target.competitionId;
  if (sc?.kind === 'circuit') return !!target.circuitId && sc.circuitId === target.circuitId;
  return sc?.kind === 'global';
}
