// Registre unifié des sanctions de compétition (warn / exclusion / ban) —
// helpers serveur. Remplace l'ancien lib/competitions/bans.ts (collection
// `competition_bans`, 0 doc en prod → aucune migration). Jamais de delete :
// une sanction levée est révoquée (horodatée), l'historique fait foi.
//
// IMPORTANT (perf) : les queries ne portent QUE 2 contraintes (targetType +
// targetId) → servies par les index simples auto, AUCUN index composite. Le
// `type` et le `scope` sont filtrés EN MÉMOIRE (volumes minuscules : un roster
// = 3-5 uids). Ne jamais ajouter `where('type',...)` à la query.

import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { SanctionType, SanctionTargetType, SanctionScope } from '@/types/competitions';

const COLLECTION = 'competition_sanctions';

// Motifs types (liste fermée) : accélèrent la sanction le jour J et permettent
// des stats. Toujours complétés par un motif libre. Partagés client (chips) /
// serveur (validation reasonCode ∈ liste OU null).
export const SANCTION_REASON_CODES: { code: string; label: string }[] = [
  { code: 'no_show', label: 'Absence / no-show' },
  { code: 'late_checkin', label: 'Retard au check-in' },
  { code: 'cheat_smurf', label: 'Triche / smurf' },
  { code: 'toxic', label: 'Comportement toxique' },
  { code: 'roster_invalid', label: 'Roster non conforme' },
  { code: 'other', label: 'Autre' },
];
export const SANCTION_REASON_CODE_SET = new Set(SANCTION_REASON_CODES.map(r => r.code));

export interface SanctionRecord {
  id: string;
  type: SanctionType;
  targetType: SanctionTargetType;
  targetId: string;
  targetLabel: string;
  scope: SanctionScope;
  reasonCode: string | null;
  reason: string;
  competitionId: string | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  notified: boolean;
  active: boolean;
}

export function isActive(data: FirebaseFirestore.DocumentData, now: Date): boolean {
  if (data.revokedAt) return false;
  const expiresAt = (data.expiresAt as Timestamp | null)?.toDate?.() ?? null;
  if (expiresAt && expiresAt <= now) return false;
  return true;
}

export function serializeSanction(id: string, data: FirebaseFirestore.DocumentData): SanctionRecord {
  return {
    id,
    type: (data.type as SanctionType) ?? 'warn',
    targetType: (data.targetType as SanctionTargetType) ?? 'user',
    targetId: data.targetId ?? '',
    targetLabel: data.targetLabel ?? '',
    scope: (data.scope as SanctionScope) ?? { kind: 'global' },
    reasonCode: data.reasonCode ?? null,
    reason: data.reason ?? '',
    competitionId: data.competitionId ?? null,
    expiresAt: (data.expiresAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
    createdBy: data.createdBy ?? '',
    createdAt: (data.createdAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
    revokedAt: (data.revokedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
    revokedBy: data.revokedBy ?? null,
    notified: data.notified === true,
    active: isActive(data, new Date()),
  };
}

interface TargetQuery {
  uids?: string[];
  structureIds?: string[];
  teamIds?: string[];
}

// Documents visant l'une des cibles (joueurs / structures / équipes), dédupliqués.
async function queryByTargets(db: Firestore, { uids = [], structureIds = [], teamIds = [] }: TargetQuery) {
  const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
  const chunked = (ids: string[], targetType: string) => {
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      if (chunk.length) queries.push(db.collection(COLLECTION).where('targetType', '==', targetType).where('targetId', 'in', chunk).get());
    }
  };
  chunked(uids, 'user');
  chunked(structureIds, 'structure');
  chunked(teamIds, 'team');
  const snaps = await Promise.all(queries);
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const seen = new Set<string>();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      docs.push(d);
    }
  }
  return docs;
}

/** Historique COMPLET (actives + révoquées/expirées) visant ces cibles — pour
 *  l'affichage à la validation et côté équipe. Trié récent d'abord. */
export async function getSanctionsFor(db: Firestore, args: TargetQuery): Promise<SanctionRecord[]> {
  const docs = await queryByTargets(db, args);
  return docs
    .map(d => serializeSanction(d.id, d.data()))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Sanctions ACTIVES qui BLOQUENT une inscription : `ban` (global) OU `exclusion`
 *  dont le scope matche la compétition/le circuit courant. Le `warn` ne bloque
 *  JAMAIS. Utilisé par le refus auto à l'inscription (spec §5). */
export async function getBlockingSanctions(
  db: Firestore,
  { uids, structureId, teamId, competitionId, circuitId }:
    { uids: string[]; structureId?: string | null; teamId?: string | null; competitionId: string; circuitId?: string | null },
): Promise<SanctionRecord[]> {
  const now = new Date();
  const docs = await queryByTargets(db, { uids, structureIds: structureId ? [structureId] : [], teamIds: teamId ? [teamId] : [] });
  const out: SanctionRecord[] = [];
  for (const d of docs) {
    const data = d.data();
    if (!isActive(data, now)) continue;
    if (data.type === 'ban') {
      out.push(serializeSanction(d.id, data));
      continue;
    }
    if (data.type === 'exclusion') {
      const sc = data.scope as SanctionScope | undefined;
      const match =
        (sc?.kind === 'competition' && sc.competitionId === competitionId)
        || (sc?.kind === 'circuit' && !!circuitId && sc.circuitId === circuitId);
      if (match) out.push(serializeSanction(d.id, data));
    }
    // 'warn' : jamais bloquant.
  }
  return out;
}
