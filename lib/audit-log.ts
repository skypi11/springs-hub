// Helper d'audit pour les actions sensibles sur une structure.
// Permet de garder une trace horodatée de qui a fait quoi (transfert de propriété,
// promotion/rétrogradation, retrait de membre, invitations, etc.) afin de pouvoir
// trancher les litiges et donner du contexte au support Springs.
//
// Collection : structure_audit_logs
// Lecture    : dirigeants + admins Springs (voir firestore.rules)
// Écriture   : API serveur uniquement (Admin SDK)

import type { Firestore, WriteBatch, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

// Accepte WriteBatch ou Transaction. TS ne peut pas inférer d'intersection valide entre
// leurs .set()/.update() (overloads incompatibles), donc on définit une interface structurelle
// minimale qu'on utilise en interne ; on cast à l'entrée des helpers.
interface Writer {
  set(ref: DocumentReference, data: unknown): unknown;
  update(ref: DocumentReference, data: Record<string, unknown>): unknown;
}
export type BatchOrTx = WriteBatch | Transaction;

export type AuditAction =
  // Propriété
  | 'transfer_initiated'
  | 'transfer_confirmed'
  | 'transfer_cancelled'
  | 'transfer_expired'
  // Co-fondateurs
  | 'cofounder_promoted'
  | 'cofounder_demoted'
  | 'cofounder_departure_requested'
  | 'cofounder_departure_finalized'
  // Staff structure
  | 'manager_added'
  | 'manager_removed'
  | 'coach_added'
  | 'coach_removed'
  // Membres
  | 'member_joined'
  | 'member_removed'
  | 'member_left'
  // Invitations
  | 'invite_link_created'
  | 'invite_link_revoked'
  | 'direct_invite_sent'
  | 'direct_invite_cancelled'
  | 'join_request_accepted'
  | 'join_request_declined'
  // Équipes
  | 'team_created'
  | 'team_archived'
  | 'team_unarchived'
  | 'team_deleted'
  // Paramètres structure
  | 'structure_updated'
  | 'structure_suspended'
  | 'structure_deletion_scheduled'
  | 'structure_deletion_cancelled'
  // Intégration Discord
  | 'discord_connected'
  | 'discord_disconnected'
  | 'discord_config_updated'
  // Documents staff
  | 'document_uploaded'
  | 'document_updated'
  | 'document_deleted'
  | 'document_downloaded'
  | 'folder_created'
  | 'folder_updated'
  | 'folder_deleted';

export interface AuditLogEntry {
  structureId: string;
  action: AuditAction;
  actorUid: string;
  // Cible de l'action (uid d'un user, id d'une équipe, etc.), optionnel.
  targetUid?: string | null;
  targetId?: string | null;
  // Métadonnées libres (game, role, reason, etc.). Doit rester sérialisable JSON.
  metadata?: Record<string, unknown>;
}

// Limite individuelle d'une string dans metadata (caractères).
// Couvre les champs user-fournis : cancelReason, note, message, etc.
const METADATA_STRING_MAX = 500;
// Cap nombre de clés top-level pour éviter blow-up Firestore (1 MiB doc max).
const METADATA_KEYS_MAX = 30;

/**
 * Sanitize un objet metadata avant écriture Firestore : tronque les strings
 * longues, cap le nombre de clés, refuse les objets profondément imbriqués.
 *
 * Pourquoi (audit 30/05 🟡 3) : certains call sites passent du body user-fourni
 * dans metadata (cancelReason, note…). Sans cap, un attaquant pourrait stuff
 * un audit avec ~1 MiB de texte → blow-up Firestore (limit 1 MiB par doc).
 * Exporté pour réutilisation dans admin-audit-log.
 */
export function sanitizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, val] of Object.entries(input)) {
    if (count >= METADATA_KEYS_MAX) break;
    if (typeof key !== 'string' || key.length > 64) continue;
    out[key] = sanitizeMetadataValue(val);
    count++;
  }
  return out;
}

function sanitizeMetadataValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val.slice(0, METADATA_STRING_MAX);
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    // Cap les arrays à 20 éléments, chaque élément capé aux types primitifs.
    return val.slice(0, 20).map(v => {
      if (typeof v === 'string') return v.slice(0, METADATA_STRING_MAX);
      if (typeof v === 'number' || typeof v === 'boolean') return v;
      return null; // refuse les sous-objets imbriqués
    });
  }
  if (typeof val === 'object') {
    // 1 niveau d'imbrication accepté, tronqué via récursion contrôlée.
    const sub: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (count >= 10) break;
      if (typeof k !== 'string' || k.length > 64) continue;
      if (v === null || v === undefined) sub[k] = null;
      else if (typeof v === 'string') sub[k] = v.slice(0, METADATA_STRING_MAX);
      else if (typeof v === 'number' || typeof v === 'boolean') sub[k] = v;
      else sub[k] = null; // pas de récursion profonde
      count++;
    }
    return sub;
  }
  return null;
}

// Ajoute une entrée d'audit au batch OU à la transaction. L'appelant est
// responsable du commit. On préfère cette forme pour garantir l'atomicité avec
// l'action elle-même (si l'action échoue, l'audit n'est pas écrit).
export function addAuditLog(db: Firestore, writer: BatchOrTx, entry: AuditLogEntry): void {
  const ref = db.collection('structure_audit_logs').doc();
  const payload: Record<string, unknown> = {
    structureId: entry.structureId,
    action: entry.action,
    actorUid: entry.actorUid,
    targetUid: entry.targetUid ?? null,
    targetId: entry.targetId ?? null,
    metadata: sanitizeMetadata(entry.metadata),
    createdAt: FieldValue.serverTimestamp(),
  };
  (writer as Writer).set(ref, payload);
}

// Écrit une entrée d'audit en standalone (pas de batch). Utile quand l'action
// n'est pas dans un batch (ex: update simple via ref.update).
export async function writeAuditLog(db: Firestore, entry: AuditLogEntry): Promise<void> {
  await db.collection('structure_audit_logs').add({
    structureId: entry.structureId,
    action: entry.action,
    actorUid: entry.actorUid,
    targetUid: entry.targetUid ?? null,
    targetId: entry.targetId ?? null,
    metadata: sanitizeMetadata(entry.metadata),
    createdAt: FieldValue.serverTimestamp(),
  });
}
