import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

export type NotificationType =
  | 'join_request_received'
  | 'join_request_accepted'
  | 'join_request_declined'
  | 'direct_invite_received'
  | 'direct_invite_accepted'
  | 'direct_invite_declined'
  | 'invitation_expired'
  | 'invitation'
  | 'new_event'
  | 'new_competition'
  | 'team_captain_assigned'
  | 'team_archived'
  | 'transfer_pending'
  | 'transfer_cancelled'
  | 'transfer_confirmed'
  | 'todo_deadline_changed'
  | 'todo_assigned'
  | 'todo_reminder'
  | 'todo_overdue'
  | 'generic';

export type NotificationPayload = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
};

export async function createNotification(
  db: Firestore,
  payload: NotificationPayload,
): Promise<void> {
  await db.collection('notifications').add({
    userId: payload.userId,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    link: payload.link || '',
    metadata: payload.metadata || {},
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function createNotifications(
  db: Firestore,
  payloads: NotificationPayload[],
): Promise<void> {
  if (payloads.length === 0) return;
  const batch = db.batch();
  for (const p of payloads) {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      userId: p.userId,
      type: p.type,
      title: p.title,
      message: p.message,
      link: p.link || '',
      metadata: p.metadata || {},
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}
