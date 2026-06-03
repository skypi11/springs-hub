// Résolution serveur d'un segment d'utilisateurs (cf. lib/admin-segments.ts),
// partagée par /api/admin/messages/preview (count) et /send (envoi).
//
// Scanne la collection users et applique le matcher du segment + les exclusions
// transverses : comptes de test (isDev en prod) et bannis. À l'échelle actuelle
// (centaines d'users) un scan complet est acceptable ; au-delà de quelques
// milliers il faudra paginer / pré-calculer les segments.

import type { Firestore } from 'firebase-admin/firestore';
import { userMatchesSegment, type SegmentId } from '@/lib/admin-segments';

export interface SegmentUser {
  uid: string;
  discordId: string;
  displayName: string;
  /** true si l'user a refusé les DM d'annonces (dmAnnouncementsOptOut). */
  optedOutDM: boolean;
}

export async function querySegmentUsers(
  db: Firestore,
  segment: SegmentId,
  gameFilter: string | null,
): Promise<SegmentUser[]> {
  const snap = await db.collection('users').get();
  const isDevEnv = process.env.NODE_ENV === 'development';
  const out: SegmentUser[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.isDev === true && !isDevEnv) continue; // pas de comptes test en prod
    if (data.isBanned === true) continue;           // jamais aux bannis
    if (!userMatchesSegment(data, segment, gameFilter)) continue;
    // Snowflake Discord valide requise pour un DM ; sinon on laisse discordId
    // vide (l'envoi DM le skippera proprement plutôt que de gonfler dmFailed).
    const rawId = (data.discordId as string) || d.id.replace(/^discord_/, '');
    const discordId = /^\d{5,32}$/.test(rawId) ? rawId : '';
    out.push({
      uid: d.id,
      discordId,
      displayName: (data.displayName as string) || (data.discordUsername as string) || d.id,
      optedOutDM: data.dmAnnouncementsOptOut === true,
    });
  }
  return out;
}
