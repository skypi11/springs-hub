import { describe, it, expect } from 'vitest';
import {
  isDirigeant,
  isStaff,
  isStaffOfTeam,
  isStaffOfAllTeams,
  isStaffOfAnyTeam,
  isCaptainOfTeam,
  isCaptainOfAnyTeam,
  isTeamEventManager,
  canAccessCalendar,
  canCreateEvent,
  canEditEvent,
  canMarkTerminated,
  canCancelEvent,
  canDeleteEvent,
  canRespondToPresence,
  canModifyOthersPresence,
  getInvitedUserIds,
  validateEventTarget,
  type UserContext,
  type EventRef,
  type EventTarget,
  type MemberRef,
  type TeamRef,
} from './event-permissions';

// ---------- Factories ----------

const ctx = (partial: Partial<UserContext> = {}): UserContext => ({
  uid: 'u1',
  isFounder: false,
  isCoFounder: false,
  isManager: false,
  isCoach: false,
  staffedTeamIds: [],
  ...partial,
});

const founder = (uid = 'u1') => ctx({ uid, isFounder: true });
const cofounder = (uid = 'u1') => ctx({ uid, isCoFounder: true });
const managerOfTeams = (uid: string, teams: string[]) =>
  ctx({ uid, isManager: true, staffedTeamIds: teams });
const coachOfTeams = (uid: string, teams: string[]) =>
  ctx({ uid, isCoach: true, staffedTeamIds: teams });
const captainOfTeams = (uid: string, teams: string[]) =>
  ctx({ uid, captainOfTeamIds: teams });
const player = (uid = 'u1') => ctx({ uid });

const event = (partial: Partial<EventRef> = {}): EventRef => ({
  createdBy: 'u999',
  target: { scope: 'structure' },
  status: 'scheduled',
  ...partial,
});

// ---------- Rôles de base ----------

describe('isDirigeant', () => {
  it('true pour un fondateur', () => {
    expect(isDirigeant(founder())).toBe(true);
  });
  it('true pour un co-fondateur', () => {
    expect(isDirigeant(cofounder())).toBe(true);
  });
  it('false pour un manager seul', () => {
    expect(isDirigeant(ctx({ isManager: true }))).toBe(false);
  });
  it('false pour un joueur', () => {
    expect(isDirigeant(player())).toBe(false);
  });
  it('false si uid vide', () => {
    expect(isDirigeant(ctx({ uid: '', isFounder: true }))).toBe(false);
  });
});

describe('isStaff', () => {
  it('true fondateur', () => expect(isStaff(founder())).toBe(true));
  it('true co-fondateur', () => expect(isStaff(cofounder())).toBe(true));
  it('true manager', () => expect(isStaff(ctx({ isManager: true }))).toBe(true));
  it('true coach', () => expect(isStaff(ctx({ isCoach: true }))).toBe(true));
  it('false joueur simple', () => expect(isStaff(player())).toBe(false));
});

describe('isStaffOfTeam', () => {
  it('dirigeant → true pour toute équipe', () => {
    expect(isStaffOfTeam(founder(), 't1')).toBe(true);
  });
  it('manager listé dans staffedTeamIds → true', () => {
    expect(isStaffOfTeam(managerOfTeams('u1', ['t1', 't2']), 't1')).toBe(true);
  });
  it('manager non listé → false', () => {
    expect(isStaffOfTeam(managerOfTeams('u1', ['t2']), 't1')).toBe(false);
  });
  it('joueur → false', () => {
    expect(isStaffOfTeam(player(), 't1')).toBe(false);
  });
});

describe('isStaffOfAllTeams', () => {
  it('dirigeant → true peu importe la liste', () => {
    expect(isStaffOfAllTeams(founder(), ['t1', 't2', 't3'])).toBe(true);
  });
  it('false si liste vide et pas dirigeant', () => {
    expect(isStaffOfAllTeams(managerOfTeams('u1', ['t1']), [])).toBe(false);
  });
  it('true si staff de toutes les équipes', () => {
    expect(isStaffOfAllTeams(managerOfTeams('u1', ['t1', 't2', 't3']), ['t1', 't2'])).toBe(true);
  });
  it("false s'il en manque une", () => {
    expect(isStaffOfAllTeams(managerOfTeams('u1', ['t1']), ['t1', 't2'])).toBe(false);
  });
});

describe('isStaffOfAnyTeam', () => {
  it('dirigeant → true', () => {
    expect(isStaffOfAnyTeam(founder(), ['t1'])).toBe(true);
  });
  it('staff d\'au moins une équipe → true', () => {
    expect(isStaffOfAnyTeam(managerOfTeams('u1', ['t2']), ['t1', 't2'])).toBe(true);
  });
  it('aucune intersection → false', () => {
    expect(isStaffOfAnyTeam(managerOfTeams('u1', ['t3']), ['t1', 't2'])).toBe(false);
  });
});

// ---------- Capitaine ----------

describe('isCaptainOfTeam', () => {
  it('true si teamId dans captainOfTeamIds', () => {
    expect(isCaptainOfTeam(captainOfTeams('u1', ['t1']), 't1')).toBe(true);
  });
  it('false si teamId absent', () => {
    expect(isCaptainOfTeam(captainOfTeams('u1', ['t2']), 't1')).toBe(false);
  });
  it('false si captainOfTeamIds absent (ancien contexte)', () => {
    expect(isCaptainOfTeam(player(), 't1')).toBe(false);
  });
  it('false si teamId vide', () => {
    expect(isCaptainOfTeam(captainOfTeams('u1', ['t1']), '')).toBe(false);
  });
});

describe('isCaptainOfAnyTeam', () => {
  it('true si au moins une correspondance', () => {
    expect(isCaptainOfAnyTeam(captainOfTeams('u1', ['t2']), ['t1', 't2'])).toBe(true);
  });
  it('false si aucune correspondance', () => {
    expect(isCaptainOfAnyTeam(captainOfTeams('u1', ['t3']), ['t1', 't2'])).toBe(false);
  });
});

describe('isTeamEventManager', () => {
  it('true pour staff', () => {
    expect(isTeamEventManager(managerOfTeams('u1', ['t1']), 't1')).toBe(true);
  });
  it('true pour capitaine', () => {
    expect(isTeamEventManager(captainOfTeams('u1', ['t1']), 't1')).toBe(true);
  });
  it('true pour dirigeant', () => {
    expect(isTeamEventManager(founder(), 't1')).toBe(true);
  });
  it('false pour joueur sans rôle', () => {
    expect(isTeamEventManager(player(), 't1')).toBe(false);
  });
});

// ---------- Calendrier ----------

describe('canAccessCalendar', () => {
  it('dirigeant OK', () => expect(canAccessCalendar(founder())).toBe(true));
  it('co-fondateur OK', () => expect(canAccessCalendar(cofounder())).toBe(true));
  it('manager OK', () => expect(canAccessCalendar(ctx({ isManager: true }))).toBe(true));
  it('coach OK', () => expect(canAccessCalendar(ctx({ isCoach: true }))).toBe(true));
  it('joueur KO', () => expect(canAccessCalendar(player())).toBe(false));
});

// ---------- Création ----------

describe('canCreateEvent — scope=structure', () => {
  const target: EventTarget = { scope: 'structure' };
  it('dirigeant OK', () => expect(canCreateEvent(founder(), target)).toBe(true));
  it('manager KO', () => expect(canCreateEvent(managerOfTeams('u1', ['t1']), target)).toBe(false));
  it('coach KO', () => expect(canCreateEvent(coachOfTeams('u1', ['t1']), target)).toBe(false));
  it('joueur KO', () => expect(canCreateEvent(player(), target)).toBe(false));
});

describe('canCreateEvent — scope=game', () => {
  const target: EventTarget = { scope: 'game', game: 'rocket_league' };
  it('dirigeant OK', () => expect(canCreateEvent(founder(), target)).toBe(true));
  it('manager KO', () => expect(canCreateEvent(managerOfTeams('u1', ['t1']), target)).toBe(false));
  it('coach KO', () => expect(canCreateEvent(coachOfTeams('u1', ['t1']), target)).toBe(false));
});

describe('canCreateEvent — scope=teams', () => {
  it('dirigeant OK', () => {
    const target: EventTarget = { scope: 'teams', teamIds: ['t1', 't2'] };
    expect(canCreateEvent(founder(), target)).toBe(true);
  });
  it('manager staff de toutes les équipes ciblées → OK', () => {
    const target: EventTarget = { scope: 'teams', teamIds: ['t1', 't2'] };
    expect(canCreateEvent(managerOfTeams('u1', ['t1', 't2']), target)).toBe(true);
  });
  it("manager staff d'une partie seulement → KO", () => {
    const target: EventTarget = { scope: 'teams', teamIds: ['t1', 't2'] };
    expect(canCreateEvent(managerOfTeams('u1', ['t1']), target)).toBe(false);
  });
  it('coach staff de toutes → OK', () => {
    const target: EventTarget = { scope: 'teams', teamIds: ['t1'] };
    expect(canCreateEvent(coachOfTeams('u1', ['t1']), target)).toBe(true);
  });
  it('teamIds vide → KO', () => {
    const target: EventTarget = { scope: 'teams', teamIds: [] };
    expect(canCreateEvent(founder(), target)).toBe(false);
  });
  it('joueur KO', () => {
    const target: EventTarget = { scope: 'teams', teamIds: ['t1'] };
    expect(canCreateEvent(player(), target)).toBe(false);
  });
  it('capitaine de SON équipe → OK', () => {
    const target: EventTarget = { scope: 'teams', teamIds: ['t1'] };
    expect(canCreateEvent(captainOfTeams('u1', ['t1']), target)).toBe(true);
  });
  it('capitaine mais une équipe n\'est pas la sienne → KO', () => {
    const target: EventTarget = { scope: 'teams', teamIds: ['t1', 't2'] };
    expect(canCreateEvent(captainOfTeams('u1', ['t1']), target)).toBe(false);
  });
  it('capitaine ne peut pas créer scope=structure', () => {
    expect(canCreateEvent(captainOfTeams('u1', ['t1']), { scope: 'structure' })).toBe(false);
  });
  it('capitaine ne peut pas créer scope=game', () => {
    expect(canCreateEvent(captainOfTeams('u1', ['t1']), { scope: 'game', game: 'rocket_league' })).toBe(false);
  });
});

describe('canAccessCalendar — capitaine', () => {
  it('capitaine seul → OK (pour gérer le calendrier de son équipe)', () => {
    expect(canAccessCalendar(captainOfTeams('u1', ['t1']))).toBe(true);
  });
  it('joueur non capitaine → KO', () => {
    expect(canAccessCalendar(player())).toBe(false);
  });
});

describe('canEditEvent — capitaine', () => {
  it('capitaine peut éditer un event de son équipe', () => {
    const e = event({ target: { scope: 'teams', teamIds: ['t1'] } });
    expect(canEditEvent(captainOfTeams('u1', ['t1']), e)).toBe(true);
  });
  it('capitaine ne peut pas éditer un event d\'une autre équipe', () => {
    const e = event({ target: { scope: 'teams', teamIds: ['t2'] } });
    expect(canEditEvent(captainOfTeams('u1', ['t1']), e)).toBe(false);
  });
  it('capitaine ne peut pas éditer scope=structure', () => {
    const e = event({ target: { scope: 'structure' } });
    expect(canEditEvent(captainOfTeams('u1', ['t1']), e)).toBe(false);
  });
});

describe('canModifyOthersPresence — capitaine', () => {
  it('capitaine peut corriger la présence sur un event teams de son équipe', () => {
    const e = event({ target: { scope: 'teams', teamIds: ['t1'] } });
    expect(canModifyOthersPresence(captainOfTeams('u1', ['t1']), e)).toBe(true);
  });
  it('capitaine ne peut pas sur scope=structure', () => {
    const e = event({ target: { scope: 'structure' } });
    expect(canModifyOthersPresence(captainOfTeams('u1', ['t1']), e)).toBe(false);
  });
});

// ---------- Édition ----------

describe('canEditEvent', () => {
  it('créateur de l\'événement → OK', () => {
    const e = event({ createdBy: 'u1' });
    expect(canEditEvent(ctx({ uid: 'u1' }), e)).toBe(true);
  });
  it('dirigeant non créateur → OK', () => {
    const e = event({ createdBy: 'u999' });
    expect(canEditEvent(founder('u1'), e)).toBe(true);
  });
  it('event scope=teams, manager d\'une équipe ciblée → OK', () => {
    const e = event({ target: { scope: 'teams', teamIds: ['t1', 't2'] } });
    expect(canEditEvent(managerOfTeams('u1', ['t2']), e)).toBe(true);
  });
  it('event scope=teams, manager sans intersection → KO', () => {
    const e = event({ target: { scope: 'teams', teamIds: ['t1'] } });
    expect(canEditEvent(managerOfTeams('u1', ['t9']), e)).toBe(false);
  });
  it('event scope=structure, manager → KO', () => {
    const e = event({ target: { scope: 'structure' } });
    expect(canEditEvent(managerOfTeams('u1', ['t1']), e)).toBe(false);
  });
  it('event scope=game, coach → KO', () => {
    const e = event({ target: { scope: 'game', game: 'rocket_league' } });
    expect(canEditEvent(coachOfTeams('u1', ['t1']), e)).toBe(false);
  });
  it('joueur simple → KO', () => {
    expect(canEditEvent(player(), event())).toBe(false);
  });
});

describe('canMarkTerminated / canCancelEvent', () => {
  it('mêmes règles que canEditEvent (dirigeant)', () => {
    const e = event();
    expect(canMarkTerminated(founder(), e)).toBe(true);
    expect(canCancelEvent(founder(), e)).toBe(true);
  });
  it('joueur KO', () => {
    const e = event();
    expect(canMarkTerminated(player(), e)).toBe(false);
    expect(canCancelEvent(player(), e)).toBe(false);
  });
});

describe('canDeleteEvent', () => {
  it('dirigeant OK', () => {
    expect(canDeleteEvent(founder(), event())).toBe(true);
  });
  it('créateur non-dirigeant KO (doit passer par "annuler")', () => {
    const e = event({ createdBy: 'u1' });
    expect(canDeleteEvent(managerOfTeams('u1', ['t1']), e)).toBe(false);
  });
  it('joueur KO', () => {
    expect(canDeleteEvent(player(), event())).toBe(false);
  });
});

// ---------- Présences ----------

describe('canRespondToPresence', () => {
  it('invité sur événement scheduled → OK', () => {
    expect(canRespondToPresence(player(), event({ status: 'scheduled' }), true)).toBe(true);
  });
  it('non invité → KO', () => {
    expect(canRespondToPresence(player(), event({ status: 'scheduled' }), false)).toBe(false);
  });
  it('événement terminé → KO', () => {
    expect(canRespondToPresence(player(), event({ status: 'done' }), true)).toBe(false);
  });
  it('événement annulé → KO', () => {
    expect(canRespondToPresence(player(), event({ status: 'cancelled' }), true)).toBe(false);
  });
  it('uid vide → KO', () => {
    expect(canRespondToPresence(ctx({ uid: '' }), event(), true)).toBe(false);
  });
});

describe('canModifyOthersPresence', () => {
  it('dirigeant → OK sur tout', () => {
    expect(canModifyOthersPresence(founder(), event({ target: { scope: 'structure' } }))).toBe(true);
    expect(canModifyOthersPresence(founder(), event({ target: { scope: 'game', game: 'rocket_league' } }))).toBe(true);
    expect(canModifyOthersPresence(founder(), event({ target: { scope: 'teams', teamIds: ['t1'] } }))).toBe(true);
  });
  it('manager d\'une équipe ciblée → OK sur event teams', () => {
    const e = event({ target: { scope: 'teams', teamIds: ['t1', 't2'] } });
    expect(canModifyOthersPresence(managerOfTeams('u1', ['t1']), e)).toBe(true);
  });
  it('manager sur event structure → KO', () => {
    const e = event({ target: { scope: 'structure' } });
    expect(canModifyOthersPresence(managerOfTeams('u1', ['t1']), e)).toBe(false);
  });
  it('manager sur event game → KO', () => {
    const e = event({ target: { scope: 'game', game: 'rocket_league' } });
    expect(canModifyOthersPresence(managerOfTeams('u1', ['t1']), e)).toBe(false);
  });
  it('manager sans intersection d\'équipes → KO', () => {
    const e = event({ target: { scope: 'teams', teamIds: ['t1'] } });
    expect(canModifyOthersPresence(managerOfTeams('u1', ['t9']), e)).toBe(false);
  });
  it('joueur → KO', () => {
    expect(canModifyOthersPresence(player(), event())).toBe(false);
  });
});

// ---------- Liste des invités ----------

describe('getInvitedUserIds', () => {
  const members: MemberRef[] = [
    { userId: 'a', game: 'rocket_league' },
    { userId: 'b', game: 'trackmania' },
    { userId: 'c', game: 'rocket_league' },
    { userId: 'a', game: 'trackmania' }, // même user sur 2 jeux
  ];
  const teams: TeamRef[] = [
    { id: 't1', playerIds: ['a', 'b'], subIds: ['c'], staffIds: ['s1'] },
    { id: 't2', playerIds: ['d'], subIds: [], staffIds: ['s2'] },
    { id: 't3', playerIds: ['e'], subIds: ['f'], staffIds: [] },
  ];

  it('scope=structure → tous les uids membres, dédupliqués', () => {
    const ids = getInvitedUserIds({ scope: 'structure' }, members, teams);
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });

  it('scope=game rocket_league → uniquement les membres RL', () => {
    const ids = getInvitedUserIds({ scope: 'game', game: 'rocket_league' }, members, teams);
    expect(ids.sort()).toEqual(['a', 'c']);
  });

  it('scope=game sans game défini → []', () => {
    const ids = getInvitedUserIds({ scope: 'game' }, members, teams);
    expect(ids).toEqual([]);
  });

  it('scope=teams une équipe → players + subs + staff', () => {
    const ids = getInvitedUserIds({ scope: 'teams', teamIds: ['t1'] }, members, teams);
    expect(ids.sort()).toEqual(['a', 'b', 'c', 's1']);
  });

  it('scope=teams plusieurs équipes → union dédupliquée', () => {
    const ids = getInvitedUserIds({ scope: 'teams', teamIds: ['t1', 't2'] }, members, teams);
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 's1', 's2']);
  });

  it('scope=teams équipe inconnue → []', () => {
    const ids = getInvitedUserIds({ scope: 'teams', teamIds: ['tXX'] }, members, teams);
    expect(ids).toEqual([]);
  });

  it('scope=teams teamIds undefined → []', () => {
    const ids = getInvitedUserIds({ scope: 'teams' }, members, teams);
    expect(ids).toEqual([]);
  });

  it('tolère les arrays manquants sur TeamRef', () => {
    const partialTeams: TeamRef[] = [{ id: 't1', playerIds: ['a'] }];
    const ids = getInvitedUserIds({ scope: 'teams', teamIds: ['t1'] }, members, partialTeams);
    expect(ids).toEqual(['a']);
  });
});

// ---------- Validation de cible ----------

describe('validateEventTarget', () => {
  it('structure → OK', () => {
    expect(validateEventTarget({ scope: 'structure' })).toEqual({ ok: true });
  });
  it('game avec game → OK', () => {
    expect(validateEventTarget({ scope: 'game', game: 'rocket_league' })).toEqual({ ok: true });
  });
  it('game sans game → erreur', () => {
    const r = validateEventTarget({ scope: 'game' });
    expect(r.ok).toBe(false);
  });
  it('teams avec teamIds → OK', () => {
    expect(validateEventTarget({ scope: 'teams', teamIds: ['t1'] })).toEqual({ ok: true });
  });
  it('teams sans teamIds → erreur', () => {
    const r = validateEventTarget({ scope: 'teams' });
    expect(r.ok).toBe(false);
  });
  it('teams teamIds vide → erreur', () => {
    const r = validateEventTarget({ scope: 'teams', teamIds: [] });
    expect(r.ok).toBe(false);
  });
  it('scope inconnu → erreur', () => {
    // @ts-expect-error volontairement un scope invalide
    const r = validateEventTarget({ scope: 'xxx' });
    expect(r.ok).toBe(false);
  });
});
