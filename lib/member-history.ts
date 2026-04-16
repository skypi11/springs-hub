import { FieldValue } from 'firebase-admin/firestore';

// Journal d'appartenance (Phase 3 item N).
// Une entrée = un passage d'un joueur dans une structure pour un jeu donné.
// Écrit uniquement via Admin SDK — les rules interdisent l'écriture client.

export type MemberJoinReason =
  | 'founder'          // fondateur au moment de la création / validation
  | 'direct_invite'    // direct_invite accepté par le joueur
  | 'join_request'     // join_request accepté par un dirigeant
  | 'invite_link'      // lien générique
  | 'targeted_link'    // lien ciblé single-use (item M)
  | 'other';

export type MemberLeftReason =
  | 'removed'          // retiré par un dirigeant
  | 'left'             // a quitté volontairement
  | 'structure_deleted'
  | 'other';

type Db = FirebaseFirestore.Firestore;
type Batch = FirebaseFirestore.WriteBatch;

// Ajoute une entrée ouverte dans l'historique via un batch existant.
// À appeler en même temps que batch.set sur structure_members.
export function addJoinHistory(
  db: Db,
  batch: Batch,
  params: {
    structureId: string;
    userId: string;
    game: string;
    role: string;
    reason: MemberJoinReason;
  },
) {
  const ref = db.collection('structure_member_history').doc();
  batch.set(ref, {
    structureId: params.structureId,
    userId: params.userId,
    game: params.game,
    role: params.role,
    joinReason: params.reason,
    joinedAt: FieldValue.serverTimestamp(),
    leftAt: null,
    leftReason: null,
  });
  return ref;
}

// Ferme la dernière entrée ouverte (leftAt null) pour (structureId, userId, game).
// Lecture hors batch (query limit 1), écriture via le batch fourni.
// Si aucune entrée ouverte n'existe (membre créé avant l'introduction du journal), on
// enregistre une entrée "retrofit" déjà close pour garder une trace.
export async function closeOpenHistory(
  db: Db,
  batch: Batch,
  params: {
    structureId: string;
    userId: string;
    game: string;
    reason: MemberLeftReason;
  },
) {
  const snap = await db.collection('structure_member_history')
    .where('structureId', '==', params.structureId)
    .where('userId', '==', params.userId)
    .where('game', '==', params.game)
    .where('leftAt', '==', null)
    .limit(1)
    .get();

  if (!snap.empty) {
    batch.update(snap.docs[0].ref, {
      leftAt: FieldValue.serverTimestamp(),
      leftReason: params.reason,
    });
    return;
  }

  // Retrofit : on n'a pas de joinedAt réel, on met serverTimestamp pour les deux
  // (≈ mieux que rien pour afficher "est parti aujourd'hui").
  const ref = db.collection('structure_member_history').doc();
  batch.set(ref, {
    structureId: params.structureId,
    userId: params.userId,
    game: params.game,
    role: 'joueur',
    joinReason: 'other' as MemberJoinReason,
    joinedAt: FieldValue.serverTimestamp(),
    leftAt: FieldValue.serverTimestamp(),
    leftReason: params.reason,
    retrofit: true,
  });
}
