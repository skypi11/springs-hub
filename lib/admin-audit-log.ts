// Helper d'audit pour les actions admin Springs sur les structures et les utilisateurs.
// Distinct de lib/audit-log.ts (structure_audit_logs) qui trace les actions internes
// à une structure. Ici on trace ce que FONT les admins Springs sur la plateforme.
//
// Collection : admin_audit_logs
// Lecture    : admins Springs uniquement (voir firestore.rules)
// Écriture   : API serveur uniquement (Admin SDK)

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { sanitizeMetadata } from './audit-log';

export type AdminAuditAction =
  // Actions sur structures
  | 'structure_approved'
  | 'structure_rejected'
  | 'structure_suspended'
  | 'structure_unsuspended'
  | 'structure_deletion_scheduled'
  | 'structure_deletion_cancelled'
  | 'structure_deleted'
  | 'structure_edited'
  // Actions sur équipes
  | 'team_edited'
  // Actions sur événements
  | 'event_edited'
  | 'event_cancelled'
  | 'event_deleted'
  // Actions sur utilisateurs
  | 'user_banned'
  | 'user_unbanned'
  | 'user_force_disconnected'
  | 'user_admin_granted'
  | 'user_admin_revoked'
  | 'user_edited'
  | 'user_removed_from_structure'
  | 'user_deleted'
  | 'user_impersonation_started'
  | 'user_impersonation_stopped'
  // RGPD, actions initiées par l'utilisateur lui-même
  | 'self_delete_account'
  // Broadcasts / notifs
  | 'notification_broadcast'
  // Signalements de rang (Lot 5, anti-mensonge RL)
  | 'rank_report_resolved'
  // Demandes de changement de compte Epic (Lot 6)
  | 'rl_epic_link_change_approved'
  | 'rl_epic_link_change_rejected'
  // Demandes de changement de compte Riot (Valorant)
  | 'valorant_link_change_approved'
  | 'valorant_link_change_rejected'
  // Moteur de compétitions (Legends Cup & suivantes) — Lot 0
  | 'competition_created'
  | 'competition_edited'
  | 'competition_deleted'
  | 'circuit_created'
  | 'circuit_edited'
  | 'circuit_deleted'
  | 'competition_admin_added'
  | 'competition_admin_removed'
  // Moteur de compétitions — Lot 1 (registre des bans, règlement)
  | 'competition_ban_added'
  | 'competition_ban_revoked'
  | 'rulebook_published'
  // Sanctions graduées (warn / exclusion / ban unifiés — competition_sanctions)
  | 'competition_sanction_added'
  | 'competition_sanction_revoked'
  // Moteur de compétitions — Lot 1 (file de validation, provisioning Discord)
  | 'competition_registration_approved'
  | 'competition_registration_rejected'
  | 'competition_registration_unapproved'
  | 'competition_discord_provisioned'
  // Bac à sable de test compétitions (données fictives isDev)
  | 'competition_sandbox_seeded'
  | 'competition_sandbox_cleaned'
  // Moteur de compétitions — Lot 2 (seeding + matérialisation du bracket)
  | 'competition_seeding_opened'
  | 'competition_seeding_shuffled'
  | 'competition_seeding_reordered'
  | 'competition_bracket_published'
  // Moteur de compétitions — Lot 3 (jour de match : console live)
  | 'competition_phase_launched'
  | 'competition_forfeit_validated'
  | 'competition_score_forced'
  | 'competition_cast_set'
  | 'competition_checkin_reopened'
  | 'competition_general_checkin_opened'
  | 'competition_team_withdrawn'
  | 'competition_team_replaced'
  // Moteur de compétitions — Lot 4 (clôture)
  | 'competition_tiebreak_resolved'
  | 'competition_closed'
  // Formats à génération incrémentale (suisse) : ronde suivante appariée
  | 'competition_round_generated';

export type AdminAuditTargetType = 'structure' | 'user' | 'team' | 'event' | 'competition' | 'circuit';

export interface AdminAuditLogEntry {
  action: AdminAuditAction;
  adminUid: string;
  targetType: AdminAuditTargetType;
  targetId: string;
  // Snapshot du nom/label de la cible au moment de l'action (utile car la cible
  // peut être supprimée ensuite, on garde le nom lisible dans le flux d'audit).
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
      // targetLabel snapshot tronqué pour cohérence avec sanitizeMetadata
      // (cap 500 chars, suffit pour un nom de structure/user/equipe).
      targetLabel: typeof entry.targetLabel === 'string' ? entry.targetLabel.slice(0, 500) : null,
      metadata: sanitizeMetadata(entry.metadata),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // L'audit ne doit JAMAIS faire échouer l'action elle-même, on log l'erreur
    // et on continue. Si un audit échoue c'est embêtant mais pas critique.
    console.error('[admin-audit-log] Failed to write entry:', entry.action, err);
  }
}
