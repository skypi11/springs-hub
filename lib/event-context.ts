// Helper serveur : résout le UserContext d'un utilisateur dans une structure donnée.
// À utiliser dans les API routes du calendrier avant d'appeler les helpers purs
// de lib/event-permissions.ts.

import { Firestore, DocumentData } from 'firebase-admin/firestore';
import type { UserContext, StaffAudience } from './event-permissions';

export interface ResolvedContext {
  structure: DocumentData;
  context: UserContext;
  membership: DocumentData | null;
  teams: (DocumentData & { id: string })[];
  staffAudience: StaffAudience;
}

// Charge la structure, les sub_teams et le structure_members du user,
// puis construit le UserContext prêt à être passé aux helpers purs.
// Renvoie null si la structure n'existe pas ou est suspended/pending/rejected.
export async function resolveUserContext(
  db: Firestore,
  uid: string,
  structureId: string
): Promise<ResolvedContext | null> {
  const structSnap = await db.collection('structures').doc(structureId).get();
  if (!structSnap.exists) return null;
  const structure = structSnap.data()!;

  if (
    structure.status === 'suspended' ||
    structure.status === 'pending_validation' ||
    structure.status === 'rejected'
  ) {
    return null;
  }

  // Membership (role dans la structure)
  const memberSnap = await db.collection('structure_members')
    .where('structureId', '==', structureId)
    .where('userId', '==', uid)
    .limit(1)
    .get();
  const membership = memberSnap.empty ? null : memberSnap.docs[0].data();

  // Toutes les équipes de la structure (sub_teams)
  const teamsSnap = await db.collection('sub_teams')
    .where('structureId', '==', structureId)
    .get();
  const teams: (DocumentData & { id: string })[] = teamsSnap.docs.map(d => ({
    ...d.data(),
    id: d.id,
  }));

  const isFounder = structure.founderId === uid;
  const isCoFounder = Array.isArray(structure.coFounderIds) && structure.coFounderIds.includes(uid);

  // Un user est manager/coach au niveau structure si :
  //   - structure.managerIds/coachIds le liste (champs historiques)
  //   - OU son structure_members.role vaut 'manager'/'coach'
  //   - OU il apparaît dans le staffIds d'au moins une équipe
  const inStructureManagerIds = Array.isArray(structure.managerIds) && structure.managerIds.includes(uid);
  const inStructureCoachIds = Array.isArray(structure.coachIds) && structure.coachIds.includes(uid);
  const memberRole = membership?.role as string | undefined;

  const staffedTeamIds: string[] = [];
  const captainOfTeamIds: string[] = [];
  for (const t of teams) {
    const staffIds = Array.isArray(t.staffIds) ? t.staffIds : [];
    if (staffIds.includes(uid)) staffedTeamIds.push(t.id);
    if (t.captainId && t.captainId === uid) captainOfTeamIds.push(t.id);
  }

  const isManager = inStructureManagerIds || memberRole === 'manager';
  const isCoach = inStructureCoachIds || memberRole === 'coach';

  const context: UserContext = {
    uid,
    isFounder,
    isCoFounder,
    isManager,
    isCoach,
    staffedTeamIds,
    captainOfTeamIds,
  };

  // Audience staff = pool autorisé pour scope='staff'. On fusionne les rôles
  // structure avec les staff d'équipe (sub_teams.staffRoles) pour que les
  // managers/coachs d'équipe soient invitables aux réunions staff.
  const dirigeantSet = new Set<string>();
  if (typeof structure.founderId === 'string' && structure.founderId) dirigeantSet.add(structure.founderId);
  if (Array.isArray(structure.coFounderIds)) {
    for (const id of structure.coFounderIds) if (typeof id === 'string' && id) dirigeantSet.add(id);
  }

  const managerSet = new Set<string>();
  if (Array.isArray(structure.managerIds)) {
    for (const id of structure.managerIds) if (typeof id === 'string' && id) managerSet.add(id);
  }
  const coachSet = new Set<string>();
  if (Array.isArray(structure.coachIds)) {
    for (const id of structure.coachIds) if (typeof id === 'string' && id) coachSet.add(id);
  }

  for (const t of teams) {
    const staffIds = Array.isArray(t.staffIds) ? (t.staffIds as string[]) : [];
    const staffRoles = (t.staffRoles ?? {}) as Record<string, 'coach' | 'manager'>;
    for (const uid of staffIds) {
      if (!uid) continue;
      // Fallback 'coach' si rôle non renseigné (équipes créées avant l'ajout du sous-rôle).
      const role = staffRoles[uid] ?? 'coach';
      if (role === 'manager') managerSet.add(uid);
      else coachSet.add(uid);
    }
  }

  const staffAudience: StaffAudience = {
    dirigeantIds: Array.from(dirigeantSet),
    managerIds: Array.from(managerSet),
    coachIds: Array.from(coachSet),
  };

  return { structure, context, membership, teams, staffAudience };
}
