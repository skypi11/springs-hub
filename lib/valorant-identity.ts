// Identité Valorant OFFICIELLE d'un joueur (anti-mensonge), miroir simplifié de
// lib/rl-identity.ts. Contrairement à RL (Epic vs Steam), Valorant n'a qu'UN
// compte Riot : la source de vérité est le PUUID (`valorantPuuid`), posé au 1er
// sync HenrikDev depuis la connexion Discord riotgames (preuve de possession).
//
// Le PUUID est "sticky" : une fois posé, le sync refuse de basculer sur un autre
// compte (voir lib/valorant-sync.ts). Un changement légitime passe par une
// demande validée par un admin (/admin/valorant-link-changes), exactement comme
// rl_link_change_requests pour RL.

// Le PUUID Riot est une chaîne chiffrée opaque (pas de format fixe documenté,
// ~70-80 caractères selon la région). On valide juste qu'il s'agit d'une chaîne
// non vide de longueur plausible, sans imposer de regex fragile.
export function isValidPuuid(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length >= 10;
}

// Formate un RiotID "Name#TAG" lisible à partir d'un name + tag. Retourne le
// name seul si le tag manque (Discord renvoie parfois le name sans #TAG tant
// que HenrikDev ne l'a pas résolu), ou '' si rien.
export function formatRiotId(name?: string | null, tag?: string | null): string {
  const n = (name ?? '').trim();
  const t = (tag ?? '').trim();
  if (n && t) return `${n}#${t}`;
  return n;
}

// URL du profil tracker.gg pour un RiotID "Name#TAG". '' si RiotID incomplet
// (un name seul produirait une URL cassée).
export function buildValorantTrackerUrl(riotId: string | null | undefined): string {
  const id = (riotId ?? '').trim();
  if (!id || !id.includes('#')) return '';
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(id)}/overview`;
}
