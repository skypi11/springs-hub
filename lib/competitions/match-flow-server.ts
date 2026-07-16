// Petites briques SERVEUR partagées par les routes du jour de match
// (participant, tick, console) : conversion doc Firestore → état pur de la
// machine d'états, et génération des identifiants de room (spec §8 : nom +
// mot de passe générés par le site).

import { randomBytes, randomInt } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { FlowMatchState, FlowConfig, FlowOutcome, GamePair } from '@/lib/competitions/match-flow';
import type { MatchOutcome } from '@/lib/tournament';
import type { MatchStatus } from '@/types/competitions';

/** FlowOutcome (machine d'états) → MatchOutcome (moteur) : mêmes données,
 *  vocabulaires différents (games ↔ scores). */
export function toEngineOutcome(o: FlowOutcome): MatchOutcome {
  return o.type === 'winner'
    ? { type: 'winner', winner: o.winner, scores: o.games }
    : { type: 'forfeit', team: o.team };
}

export function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

export function toIso(v: unknown): string | null {
  const ms = toMs(v);
  return ms === null ? null : new Date(ms).toISOString();
}

function entriesOf(v: unknown): GamePair[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((g): g is { a: number; b: number } =>
      !!g && typeof g === 'object' && typeof (g as { a?: unknown }).a === 'number' && typeof (g as { b?: unknown }).b === 'number')
    .map(g => ({ a: g.a, b: g.b }));
}

/** Doc `competition_matches` → vue pure pour match-flow. */
export function toFlowState(engineId: string, m: FirebaseFirestore.DocumentData): FlowMatchState {
  return {
    id: engineId,
    bo: (m.bo as number) ?? 5,
    teamA: (m.teamA as string) ?? null,
    teamB: (m.teamB as string) ?? null,
    voidA: m.voidA === true,
    voidB: m.voidB === true,
    status: (m.status as MatchStatus) ?? 'pending',
    checkin: m.checkin
      ? {
          deadlineMs: toMs(m.checkin.deadline) ?? 0,
          aDone: m.checkin.a?.done === true,
          bDone: m.checkin.b?.done === true,
        }
      : null,
    scores: {
      a: entriesOf(m.scores?.a),
      b: entriesOf(m.scores?.b),
      aSubmittedAtMs: toMs(m.scores?.aSubmittedAt),
      bSubmittedAtMs: toMs(m.scores?.bSubmittedAt),
      counterDeadlineMs: toMs(m.scores?.counterDeadline),
    },
    disputeOpen: !!m.dispute && m.dispute.resolvedBy == null,
  };
}

export function flowConfigOf(comp: FirebaseFirestore.DocumentData): FlowConfig {
  return {
    matchCheckinMinutes: (comp.schedule?.matchCheckinMinutes as number) ?? 5,
    scoreCounterMinutes: (comp.schedule?.scoreCounterMinutes as number) ?? 3,
  };
}

/** Identifiants de room générés par le site (spec §8) — lisibles à la dictée
 *  vocale : pas de caractères ambigus (0/O, 1/I/l). */
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomToken(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  return out;
}

export function generateRoomCredentials(matchKey: string): { name: string; password: string } {
  return {
    name: `AEDRAL-${matchKey.replace(/[^A-Z0-9]/gi, '')}-${randomToken(3)}`,
    password: `${randomToken(4)}${randomInt(10, 99)}`,
  };
}
