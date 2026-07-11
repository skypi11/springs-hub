// Fonction d'autorité UNIQUE du jour de match (archi §8) : le camp d'un
// utilisateur sur un match est TOUJOURS dérivé serveur de son identité —
// jamais un paramètre client (sinon le capitaine A saisit aussi pour B et des
// scores « concordants » frauduleux s'auto-valident).
//
// Règles (spec §8-§9) :
// - check-in : CAPITAINE du roster figé uniquement (registration.captainUid) ;
// - scores / litige : capitaine OU staff. Le roster joueur est verrouillé au
//   snapshot ; le STAFF est résolu LIVE (choix archi documenté : un staff
//   ajouté pendant l'event peut aider) — dirigeants/responsables de la
//   structure + manager/coach de l'équipe (sub_team) d'origine.
// - Anti double-camp : une même structure peut inscrire deux équipes (pas de
//   limite par structure). Un uid rattaché aux DEUX camps en tant que staff
//   n'a AUCUN camp (ambigu → refus, un admin tranche) ; un joueur du roster
//   garde son camp de jeu, ses droits staff sur le camp adverse sont ignorés.

import type { Firestore } from 'firebase-admin/firestore';

export interface MatchAccess {
  side: 'a' | 'b' | null;
  isCaptain: boolean;
  isStaff: boolean;
  /** Capitaine seul (spec §8). */
  canCheckin: boolean;
  /** Capitaine OU staff (spec §9) — vaut aussi pour ouvrir un litige. */
  canSubmitScores: boolean;
}

const NO_ACCESS: MatchAccess = {
  side: null, isCaptain: false, isStaff: false, canCheckin: false, canSubmitScores: false,
};

interface SideInvolvement {
  rostered: boolean;
  captain: boolean;
  staff: boolean;
}

async function involvementFor(
  db: Firestore,
  registrationId: string | null,
  uid: string,
): Promise<SideInvolvement> {
  const none: SideInvolvement = { rostered: false, captain: false, staff: false };
  if (!registrationId) return none;
  const regSnap = await db.collection('competition_registrations').doc(registrationId).get();
  if (!regSnap.exists) return none;
  const reg = regSnap.data()!;

  const rostered = Array.isArray(reg.rosterUids) && (reg.rosterUids as string[]).includes(uid);
  const captain = reg.captainUid === uid;
  if (rostered) return { rostered, captain, staff: false };

  // Staff LIVE : dirigeant/responsable de la structure, ou manager/coach de
  // l'équipe d'origine du snapshot.
  const [structureSnap, teamSnap] = await Promise.all([
    reg.structureId ? db.collection('structures').doc(reg.structureId as string).get() : null,
    reg.teamId ? db.collection('sub_teams').doc(reg.teamId as string).get() : null,
  ]);
  let staff = false;
  if (structureSnap?.exists) {
    const s = structureSnap.data()!;
    const dirigeant = s.founderId === uid
      || (Array.isArray(s.coFounderIds) && (s.coFounderIds as string[]).includes(uid));
    const responsable = Array.isArray(s.managerIds) && (s.managerIds as string[]).includes(uid);
    staff = dirigeant || responsable;
  }
  if (!staff && teamSnap?.exists) {
    const t = teamSnap.data()!;
    staff = Array.isArray(t.staffIds) && (t.staffIds as string[]).includes(uid);
  }
  return { rostered: false, captain, staff };
}

export async function getMatchSideForUser(
  db: Firestore,
  match: { teamA: string | null; teamB: string | null },
  uid: string,
): Promise<MatchAccess> {
  const [a, b] = await Promise.all([
    involvementFor(db, match.teamA, uid),
    involvementFor(db, match.teamB, uid),
  ]);

  // Joueur du roster : son camp de jeu prime, les droits adverses sont ignorés.
  let side: 'a' | 'b' | null = null;
  if (a.rostered) side = 'a';
  else if (b.rostered) side = 'b';
  else if (a.staff && b.staff) return NO_ACCESS;      // staff des deux camps → ambigu
  else if (a.staff || a.captain) side = 'a';
  else if (b.staff || b.captain) side = 'b';

  if (!side) return NO_ACCESS;
  const inv = side === 'a' ? a : b;
  const isCaptain = inv.captain;
  const isStaff = inv.staff;
  return {
    side,
    isCaptain,
    isStaff,
    canCheckin: isCaptain,
    canSubmitScores: isCaptain || isStaff,
  };
}
