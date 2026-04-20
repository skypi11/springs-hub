// Helper d'audit pour les actions admin Springs sur les structures et les utilisateurs.
// Distinct de lib/audit-log.ts (structure_audit_logs) qui trace les actions internes
// à une structure. Ici on trace ce que FONT les admins Springs sur la plateforme.
//
// Collection : admin_audit_logs
// Lecture    : admins Springs uniquement (voir firestore.rules)
// Écriture   : API serveur uniquement (Admin SDK)

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

export type AdminAuditAction =
  // Actions sur structures
  | 'structure_approved'
  | 'structure_rejected'
  | 'structure_suspended'
  | 'structure_unsuspended'
  | 'structure_deletion_scheduled'
  | 'structure_deletion_cancelled'
  | 'structure_deleted'
  // Actions sur utilisateurs
  | 'user_banned'
  | 'user_unbanned'
  | 'user_force_disconnected'
  | 'user_admin_granted'
  | 'user_admin_revoked'
  | 'user_edited'
  | 'user_removed_from_structure'
  | 'user_deleted'
  // Broadcasts / notifs
  | 'notification_broadcast';

export type AdminAuditTargetType = 'structure' | 'user';

export interface AdminAuditLogEntry {
  action: AdminAuditAction;
  adminUid: string;
  targetType: AdminAuditTargetType;
  targetId: string;
  // Snapshot du nom/label de la cible au moment de l'action (utile car la cible
  // peut être supprimée ensuite — on garde le nom lisible dans le flux d'audit).
  targetLabel?: string | null;
  // Métadonnées libres : raison, champs modifiés, structures impactées, etc.
  metadata?: Record<string, unknown>;
}

export async function writeAdminAuditLog(db: Firestore, entry: AdminAuditLogEntry): Promise<void> {
  try {
    await db.collection('admin_audit_logs').add({
      action: entry.action,
      adminUid: entry.adminUid,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetLabel: entry.targetLabel ?? null,
      metadata: entry.metadata ?? {},
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // L'audit ne doit JAMAIS faire échouer l'action elle-même — on log l'erreur
    // et on continue. Si un audit échoue c'est embêtant mais pas critique.
    console.error('[admin-audit-log] Failed to write entry:', entry.action, err);
  }
}
