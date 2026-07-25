// CHANGEMENT DE ROSTER post-validation — fonctions PURES (aucun I/O).
//
// La spec Legends (§4) pose un ROSTER LOCK TOTAL côté structure : les équipes
// ne modifient jamais elles-mêmes une inscription. Ce module outille la
// DÉROGATION ADMIN (même philosophie que les dérogations d'âge : jamais
// d'automatisme, toujours un regard humain, tout journalisé) — cas type : un
// titulaire malade la veille ou en cours de tournoi.
//
// Trois opérations, une par appel (auditable) :
// - replace     : un joueur sort, un membre de l'équipe entre — le RÔLE est
//                 HÉRITÉ du sortant (les compteurs titulaires/remplaçants ne
//                 bougent jamais par cette voie).
// - swap_roles  : échange titulaire ↔ remplaçant entre deux joueurs du roster.
// - set_captain : transfert du pilotage check-in/scores (uid du roster).
//
// La route serveur reconstruit le snapshot du joueur entrant (même forme que
// le wizard d'inscription) et rejoue TOUS les checks du wizard — l'approve ne
// les rejoue pas, c'est donc ici que la barrière vit : comptes vérifiés,
// sanctions, anti-doublon, âge/dérogation, MMR déclarés.

import type { RegistrationFlag, RegistrationRosterEntry } from '@/types/competitions';
import { analyzeLineups, computeMmrFlags, type MmrRules } from './mmr';

export type RosterChangeOp =
  | { op: 'replace'; outUid: string; entry: RegistrationRosterEntry }
  | { op: 'swap_roles'; uidA: string; uidB: string }
  | { op: 'set_captain'; uid: string };

export type RosterChangeResult =
  | { ok: true; roster: RegistrationRosterEntry[] }
  | { ok: false; error: string };

/**
 * Applique une opération au snapshot du roster. `entry` (replace) arrive SANS
 * rôle fiable : le rôle du SORTANT est imposé — l'effectif titulaires/subs est
 * un invariant de cette voie.
 */
export function applyRosterChange(
  roster: RegistrationRosterEntry[],
  change: RosterChangeOp,
): RosterChangeResult {
  if (change.op === 'replace') {
    const out = roster.find(r => r.uid === change.outUid);
    if (!out) return { ok: false, error: 'Le joueur sortant ne figure pas dans le roster.' };
    if (roster.some(r => r.uid === change.entry.uid)) {
      return { ok: false, error: 'Le joueur entrant figure déjà dans le roster.' };
    }
    if (!change.entry.uid) return { ok: false, error: 'Joueur entrant invalide.' };
    return {
      ok: true,
      roster: roster.map(r => (r.uid === change.outUid ? { ...change.entry, role: out.role } : r)),
    };
  }

  if (change.op === 'swap_roles') {
    const a = roster.find(r => r.uid === change.uidA);
    const b = roster.find(r => r.uid === change.uidB);
    if (!a || !b) return { ok: false, error: 'Les deux joueurs doivent figurer dans le roster.' };
    if (a.role === b.role) {
      return { ok: false, error: 'Les deux joueurs ont le même rôle — rien à échanger.' };
    }
    return {
      ok: true,
      roster: roster.map(r => {
        if (r.uid === change.uidA) return { ...r, role: b.role };
        if (r.uid === change.uidB) return { ...r, role: a.role };
        return r;
      }),
    };
  }

  // set_captain : le roster ne change pas — la validation d'appartenance
  // suffit (le champ captainUid est réécrit par la route).
  if (!roster.some(r => r.uid === change.uid)) {
    return { ok: false, error: 'Le nouveau capitaine doit figurer dans le roster.' };
  }
  return { ok: true, roster };
}

/**
 * GARDE DU NOYAU (anti-abus, demande Matt 25/07) : des remplacements
 * successifs ne doivent JAMAIS aboutir à une équipe différente de celle qui a
 * été validée — miroir de la règle noyau du circuit (spec §4 : « 2 de ses 3
 * titulaires »). La référence est le roster VALIDÉ (titulaires à l'approve,
 * figés au premier changement) ; le roster courant doit toujours en conserver
 * au moins ⌈2×starters/3⌉ (3 → 2, 5 → 4), titulaires OU remplaçants.
 * Au-delà : refus net — le chemin est le retrait + repêchage waitlist.
 */
export function coreGuardViolation(
  initialStarterUids: string[],
  newRoster: RegistrationRosterEntry[],
  starters: number,
): string | null {
  if (initialStarterUids.length === 0) return null;
  const required = Math.ceil((2 * starters) / 3);
  const present = new Set(newRoster.map(r => r.uid));
  const kept = initialStarterUids.filter(u => present.has(u)).length;
  if (kept >= required) return null;
  return `Le noyau de l'équipe validée doit être conservé (au moins ${required} des ${initialStarterUids.length} titulaires d'origine, il en resterait ${kept}). Au-delà, c'est une autre équipe : passe par un retrait et un repêchage de la liste d'attente.`;
}

/**
 * Recalcule le bloc `computed` d'une inscription après changement — MÊMES
 * règles que le wizard (source : register/route.ts) : drapeaux MMR sur toutes
 * les compos alignables, mineurs/âge inconnu, absence du serveur Discord.
 * Jamais de refus ici : les drapeaux orientent l'œil de l'admin.
 */
export function recomputeRegistrationComputed(input: {
  roster: RegistrationRosterEntry[];
  mmrRules: MmrRules | null;
  minAge: number | null;
  /** Taille de compo (roster.starters de la compétition — 3 en RL). */
  starters: number;
  /** true si l'INSCRIPTEUR est absent du serveur Discord (snapshot existant,
   *  non recalculable ici — repris du doc). */
  createdByOffGuild: boolean;
}): { worstLineupAvg: number | null; worstLineupGap: number | null; flags: RegistrationFlag[] } {
  const flags = new Set<RegistrationFlag>();

  for (const p of input.roster) {
    if (input.minAge !== null && (p.age === null || p.age < input.minAge)) flags.add('underage');
    if (p.onDiscordGuild === false) flags.add('discord_guild_missing');
  }
  if (input.createdByOffGuild) flags.add('discord_guild_missing');

  let worstLineupAvg: number | null = null;
  let worstLineupGap: number | null = null;
  if (input.mmrRules) {
    const refMmrs = input.roster.map(p => p.refMmr);
    for (const f of computeMmrFlags(refMmrs, input.mmrRules, input.starters)) flags.add(f);
    const analysis = analyzeLineups(refMmrs, input.starters);
    worstLineupAvg = analysis.worstLineupAvg;
    worstLineupGap = analysis.worstLineupGap;
  }

  return { worstLineupAvg, worstLineupGap, flags: [...flags] };
}
