// Segments d'utilisateurs pour le ciblage des messages admin (/admin/messages).
// Source de vérité unique : ajouter un segment = une entrée ici + son matcher.
//
// Un matcher reçoit le doc Firestore brut d'un user et dit s'il appartient au
// segment. Les exclusions transverses (comptes dev en prod, bannis, opt-out DM)
// sont gérées côté API d'envoi, PAS ici — un matcher ne décrit que l'audience.

import { pickValorantRiotId, type DiscordConnection } from '@/lib/discord-connections';

export type SegmentId =
  | 'all'
  | 'game_account_unlinked'
  | 'valorant_no_synced_rank'
  | 'rl_no_declared_rank'
  | 'no_structure'
  | 'incomplete_profile';

export interface SegmentDef {
  id: SegmentId;
  label: string;
  description: string;
}

// Plafond de DM par envoi (anti-spam Discord + budget timeout de la route).
// Source de vérité unique, consommée par l'API send ET l'UI /admin/messages.
// Dimensionné pour tenir sous maxDuration=300s (Fluid) : ~120 DM × (~0,6s
// open+post+throttle 250ms) ≈ 75s, bien sous le HARD_DEADLINE (270s). Le
// throttle entre chaque DM reste la vraie protection anti-rate-limit Discord
// (on n'envoie jamais en rafale), pas le cap.
export const DM_CAP = 120;

export const SEGMENTS: SegmentDef[] = [
  { id: 'all', label: 'Tous les joueurs', description: 'Toute la base (hors comptes de test et bannis).' },
  { id: 'game_account_unlinked', label: 'Compte de jeu non lié', description: 'Joue à RL ou Valorant mais n\'a vérifié aucun compte officiel pour ce jeu.' },
  { id: 'valorant_no_synced_rank', label: 'Valorant sans rang synchronisé', description: 'Joue à Valorant mais son rang n\'est pas (encore) synchronisé via HenrikDev.' },
  { id: 'rl_no_declared_rank', label: 'Pas de rang Rocket League', description: 'Joue à Rocket League mais n\'a pas renseigné son rang.' },
  { id: 'no_structure', label: 'Sans structure', description: 'N\'appartient à aucune structure.' },
  { id: 'incomplete_profile', label: 'Profil incomplet', description: 'Pays ou date de naissance manquants.' },
];

export function isSegmentId(v: unknown): v is SegmentId {
  return typeof v === 'string' && SEGMENTS.some(s => s.id === v);
}

// ── Helpers internes ───────────────────────────────────────────────────────
function games(data: Record<string, unknown>): string[] {
  return Array.isArray(data.games) ? (data.games as string[]) : [];
}
function rlVerified(data: Record<string, unknown>): boolean {
  return !!data.rlEpicId || !!data.rlSteamId;
}
function valorantVerified(data: Record<string, unknown>): boolean {
  return !!data.valorantPuuid
    || !!pickValorantRiotId(data.discordConnections as DiscordConnection[] | undefined);
}
function hasAnyStructure(data: Record<string, unknown>): boolean {
  const spg = data.structurePerGame;
  if (!spg || typeof spg !== 'object') return false;
  return Object.values(spg as Record<string, unknown>).some(v =>
    Array.isArray(v) ? v.length > 0 : !!v);
}

/**
 * Vrai si l'user (doc Firestore brut) appartient au segment. Si `gameFilter`
 * est fourni ('rocket_league' | 'trackmania' | 'valorant'), on exige EN PLUS
 * qu'il pratique ce jeu.
 */
export function userMatchesSegment(
  data: Record<string, unknown>,
  segment: SegmentId,
  gameFilter?: string | null,
): boolean {
  const g = games(data);
  if (gameFilter && !g.includes(gameFilter)) return false;

  switch (segment) {
    case 'all':
      return true;
    case 'game_account_unlinked':
      return (g.includes('rocket_league') && !rlVerified(data))
        || (g.includes('valorant') && !valorantVerified(data));
    case 'valorant_no_synced_rank':
      return g.includes('valorant') && data.valorantRankSource !== 'henrikdev';
    case 'rl_no_declared_rank':
      return g.includes('rocket_league') && !((data.rlRank as string) || '').trim();
    case 'no_structure': {
      // Avec un filtre jeu : « sans structure POUR CE JEU » (cohérent avec les
      // autres segments game-aware). Sans filtre : aucune structure tous jeux.
      if (gameFilter) {
        const spg = data.structurePerGame as Record<string, unknown> | undefined;
        const v = spg?.[gameFilter];
        return !(Array.isArray(v) ? v.length > 0 : !!v);
      }
      return !hasAnyStructure(data);
    }
    case 'incomplete_profile':
      return !data.country || !data.dateOfBirth;
    default:
      return false;
  }
}
