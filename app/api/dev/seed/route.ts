import { NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue, Timestamp, type WriteBatch } from 'firebase-admin/firestore';
import { DEV_UIDS, DEV_STRUCTURE_ID } from '@/lib/dev-seed-constants';

// POST /api/dev/seed — peuple Firestore avec une structure de démo "Phoenix Esports"
// (RL only, ~15 équipes actives + 2 archivées, staff complet, calendrier riche,
// devoirs variés, join requests, historique membre). Pensé pour impressionner lors
// d'une présentation sans avoir à naviguer une structure vide.
// Dev-only : bloqué en production. Tous les documents créés portent `isDev: true`
// pour permettre un cleanup en un appel via /api/dev/cleanup.

// ---------- IDs d'équipes — stables pour faciliter le debug en console Firestore ----------
const TEAM_MAIN = 'dev_team_rl_main';
const TEAM_ACADEMY = 'dev_team_rl_academy';
const TEAM_BTEAM = 'dev_team_rl_bteam';
const TEAM_FEM_MAIN = 'dev_team_rl_fem_main';
const TEAM_FEM_ACAD = 'dev_team_rl_fem_acad';
const TEAM_JUNIOR = 'dev_team_rl_junior';
const TEAM_U18 = 'dev_team_rl_u18';
const TEAM_U16 = 'dev_team_rl_u16';
const TEAM_NORTH = 'dev_team_rl_north';
const TEAM_SOUTH = 'dev_team_rl_south';
const TEAM_WEST = 'dev_team_rl_west';
const TEAM_AMATEUR = 'dev_team_rl_amateur';
const TEAM_CONTENT = 'dev_team_rl_content';
const TEAM_1V1 = 'dev_team_rl_1v1';
const TEAM_SCOUTING = 'dev_team_rl_scouting';
const TEAM_ARCH_S23 = 'dev_team_rl_arch_s23';
const TEAM_ARCH_FOUND = 'dev_team_rl_arch_found';

// ---------- Utilisateurs ----------
type UserSeed = {
  uid: string;
  displayName: string;
  username: string;
  rlRank?: string;
  rlMmr?: number;
};

// Staff — strictement les 6 rôles reconnus par le site.
// Pas de "analyste", "head coach", "manager Féminine" etc. — ces titres n'existent pas.
const STAFF: UserSeed[] = [
  { uid: DEV_UIDS.founder,         displayName: 'Matt Phoenix',   username: 'matt_phx' },
  { uid: DEV_UIDS.cofounder,       displayName: 'Luca Bernard',   username: 'luca_phx' },
  { uid: DEV_UIDS.responsable,     displayName: 'Sofia Lambert',  username: 'sofia_phx' },
  { uid: DEV_UIDS.coachStructure,  displayName: 'Elena Rivière',  username: 'elena_phx' },
  { uid: DEV_UIDS.teamManager,     displayName: 'Louis Chevalier',username: 'louis_phx' },
  { uid: DEV_UIDS.teamCoach,       displayName: 'Thomas Leclerc', username: 'thomas_phx' },
];

// Joueurs — alias gamer crédibles. rlRank varie par tier d'équipe.
const PLAYERS: UserSeed[] = [
  // Main (GC / SSL)
  { uid: DEV_UIDS.rlEliteCaptain,   displayName: 'Zephyr',     username: 'zephyr',     rlRank: 'Super Sonic Legend', rlMmr: 1680 },
  { uid: DEV_UIDS.rlEliteP1,        displayName: 'Kairos',     username: 'kairos',     rlRank: 'Grand Champion III', rlMmr: 1580 },
  { uid: DEV_UIDS.rlEliteP2,        displayName: 'Vex',        username: 'vex',        rlRank: 'Grand Champion III', rlMmr: 1560 },
  { uid: DEV_UIDS.rlEliteSub1,      displayName: 'Onyx',       username: 'onyx',       rlRank: 'Grand Champion II',  rlMmr: 1470 },
  { uid: DEV_UIDS.rlEliteSub2,      displayName: 'Blaze',      username: 'blaze',      rlRank: 'Grand Champion II',  rlMmr: 1450 },
  // Academy
  { uid: DEV_UIDS.rlAcademyCaptain, displayName: 'Echo',       username: 'echo_rl',    rlRank: 'Grand Champion II',  rlMmr: 1430 },
  { uid: DEV_UIDS.rlAcademyP1,      displayName: 'Nyx',        username: 'nyx_rl',     rlRank: 'Grand Champion I',   rlMmr: 1380 },
  { uid: DEV_UIDS.rlAcademyP2,      displayName: 'Drift',      username: 'drift_rl',   rlRank: 'Grand Champion I',   rlMmr: 1360 },
  { uid: DEV_UIDS.rlAcademySub,     displayName: 'Apex',       username: 'apex_rl',    rlRank: 'Champion III',       rlMmr: 1290 },
  // B-Team
  { uid: DEV_UIDS.rlBTeamCaptain,   displayName: 'Raven',      username: 'raven',      rlRank: 'Grand Champion I',   rlMmr: 1350 },
  { uid: DEV_UIDS.rlBTeamP1,        displayName: 'Talon',      username: 'talon',      rlRank: 'Champion III',       rlMmr: 1300 },
  { uid: DEV_UIDS.rlBTeamP2,        displayName: 'Pulse',      username: 'pulse',      rlRank: 'Champion III',       rlMmr: 1280 },
  { uid: DEV_UIDS.rlBTeamSub,       displayName: 'Shade',      username: 'shade',      rlRank: 'Champion II',        rlMmr: 1220 },
  // Féminine Main
  { uid: DEV_UIDS.rlFemMainCaptain, displayName: 'Aria',       username: 'aria',       rlRank: 'Grand Champion I',   rlMmr: 1340 },
  { uid: DEV_UIDS.rlFemMainP1,      displayName: 'Luna',       username: 'luna',       rlRank: 'Grand Champion I',   rlMmr: 1320 },
  { uid: DEV_UIDS.rlFemMainP2,      displayName: 'Vera',       username: 'vera',       rlRank: 'Champion III',       rlMmr: 1290 },
  { uid: DEV_UIDS.rlFemMainSub,     displayName: 'Nova',       username: 'nova',       rlRank: 'Champion II',        rlMmr: 1210 },
  // Féminine Academy
  { uid: DEV_UIDS.rlFemAcadCaptain, displayName: 'Elara',      username: 'elara',      rlRank: 'Champion II',        rlMmr: 1200 },
  { uid: DEV_UIDS.rlFemAcadP1,      displayName: 'Lyra',       username: 'lyra',       rlRank: 'Champion I',         rlMmr: 1150 },
  { uid: DEV_UIDS.rlFemAcadP2,      displayName: 'Mila',       username: 'mila',       rlRank: 'Diamant III',        rlMmr: 1090 },
  // Junior
  { uid: DEV_UIDS.rlJuniorCaptain,  displayName: 'Kyro',       username: 'kyro',       rlRank: 'Champion III',       rlMmr: 1280 },
  { uid: DEV_UIDS.rlJuniorP1,       displayName: 'Slick',      username: 'slick',      rlRank: 'Champion II',        rlMmr: 1210 },
  { uid: DEV_UIDS.rlJuniorP2,       displayName: 'Quinn',      username: 'quinn',      rlRank: 'Champion II',        rlMmr: 1190 },
  { uid: DEV_UIDS.rlJuniorSub,      displayName: 'Dex',        username: 'dex',        rlRank: 'Champion I',         rlMmr: 1130 },
  // U18
  { uid: DEV_UIDS.rlU18Captain,     displayName: 'Flex',       username: 'flex',       rlRank: 'Champion I',         rlMmr: 1140 },
  { uid: DEV_UIDS.rlU18P1,          displayName: 'Jolt',       username: 'jolt',       rlRank: 'Diamant III',        rlMmr: 1080 },
  { uid: DEV_UIDS.rlU18P2,          displayName: 'Zane',       username: 'zane',       rlRank: 'Diamant III',        rlMmr: 1060 },
  // U16
  { uid: DEV_UIDS.rlU16Captain,     displayName: 'Pip',        username: 'pip',        rlRank: 'Diamant II',         rlMmr: 1000 },
  { uid: DEV_UIDS.rlU16P1,          displayName: 'Rook',       username: 'rook',       rlRank: 'Diamant II',         rlMmr: 980  },
  { uid: DEV_UIDS.rlU16P2,          displayName: 'Skye',       username: 'skye',       rlRank: 'Diamant I',          rlMmr: 940  },
  // Régional North
  { uid: DEV_UIDS.rlNorthCaptain,   displayName: 'Storm',      username: 'storm',      rlRank: 'Champion II',        rlMmr: 1215 },
  { uid: DEV_UIDS.rlNorthP1,        displayName: 'Bolt',       username: 'bolt',       rlRank: 'Champion I',         rlMmr: 1160 },
  { uid: DEV_UIDS.rlNorthP2,        displayName: 'Hex',        username: 'hex',        rlRank: 'Champion I',         rlMmr: 1140 },
  // Régional South
  { uid: DEV_UIDS.rlSouthCaptain,   displayName: 'Rio',        username: 'rio',        rlRank: 'Champion II',        rlMmr: 1205 },
  { uid: DEV_UIDS.rlSouthP1,        displayName: 'Vega',       username: 'vega',       rlRank: 'Champion I',         rlMmr: 1150 },
  { uid: DEV_UIDS.rlSouthP2,        displayName: 'Crest',      username: 'crest',      rlRank: 'Champion I',         rlMmr: 1130 },
  // Régional West
  { uid: DEV_UIDS.rlWestCaptain,    displayName: 'Axis',       username: 'axis',       rlRank: 'Champion II',        rlMmr: 1220 },
  { uid: DEV_UIDS.rlWestP1,         displayName: 'Kato',       username: 'kato',       rlRank: 'Champion I',         rlMmr: 1170 },
  { uid: DEV_UIDS.rlWestP2,         displayName: 'Dune',       username: 'dune',       rlRank: 'Champion I',         rlMmr: 1140 },
  // Amateurs
  { uid: DEV_UIDS.rlAmateurCaptain, displayName: 'Milo',       username: 'milo',       rlRank: 'Diamant II',         rlMmr: 1000 },
  { uid: DEV_UIDS.rlAmateurP1,      displayName: 'Theo',       username: 'theo',       rlRank: 'Diamant I',          rlMmr: 950  },
  { uid: DEV_UIDS.rlAmateurP2,      displayName: 'Ben',        username: 'ben_rl',     rlRank: 'Platine III',        rlMmr: 880  },
  // Content creators
  { uid: DEV_UIDS.rlContentCaptain, displayName: 'Volt',       username: 'volt',       rlRank: 'Champion I',         rlMmr: 1160 },
  { uid: DEV_UIDS.rlContentP1,      displayName: 'Peak',       username: 'peak',       rlRank: 'Diamant III',        rlMmr: 1080 },
  { uid: DEV_UIDS.rlContentP2,      displayName: 'Zenith',     username: 'zenith',     rlRank: 'Diamant II',         rlMmr: 1010 },
  // 1v1 Specialists
  { uid: DEV_UIDS.rl1v1Captain,     displayName: 'Pyro',       username: 'pyro',       rlRank: 'Grand Champion I',   rlMmr: 1370 },
  { uid: DEV_UIDS.rl1v1P1,          displayName: 'Jett',       username: 'jett',       rlRank: 'Champion III',       rlMmr: 1280 },
  { uid: DEV_UIDS.rl1v1P2,          displayName: 'Sting',      username: 'sting',      rlRank: 'Champion II',        rlMmr: 1200 },
  // Scouting
  { uid: DEV_UIDS.rlScoutingCaptain,displayName: 'Scour',      username: 'scour',      rlRank: 'Champion III',       rlMmr: 1290 },
  { uid: DEV_UIDS.rlScoutingP1,     displayName: 'Vanta',      username: 'vanta',      rlRank: 'Champion II',        rlMmr: 1220 },
  { uid: DEV_UIDS.rlScoutingP2,     displayName: 'Omen',       username: 'omen',       rlRank: 'Champion II',        rlMmr: 1200 },
  // Archivés S2023
  { uid: DEV_UIDS.rlArchS23P1,      displayName: 'Crypt',      username: 'crypt_legacy',  rlRank: 'Grand Champion II', rlMmr: 1480 },
  { uid: DEV_UIDS.rlArchS23P2,      displayName: 'Ghoul',      username: 'ghoul_legacy',  rlRank: 'Grand Champion II', rlMmr: 1460 },
  { uid: DEV_UIDS.rlArchS23P3,      displayName: 'Wraith',     username: 'wraith_legacy', rlRank: 'Grand Champion I',  rlMmr: 1390 },
  { uid: DEV_UIDS.rlArchS23Sub1,    displayName: 'Spire',      username: 'spire_legacy',  rlRank: 'Champion III',      rlMmr: 1300 },
  // Archivés Founders
  { uid: DEV_UIDS.rlArchFoundP1,    displayName: 'Vigil',      username: 'vigil_founder', rlRank: 'Champion III',     rlMmr: 1290 },
  { uid: DEV_UIDS.rlArchFoundP2,    displayName: 'Sable',      username: 'sable_founder', rlRank: 'Champion II',      rlMmr: 1200 },
  { uid: DEV_UIDS.rlArchFoundP3,    displayName: 'Forge',      username: 'forge_founder', rlRank: 'Champion II',      rlMmr: 1190 },
  // Membre sans équipe
  { uid: DEV_UIDS.pureMember,       displayName: 'Sam (sans équipe)', username: 'sam_nobody' },
  // Admin Springs
  { uid: DEV_UIDS.admin,            displayName: 'Admin Springs', username: 'admin_springs' },
];

// Recrues libres — pas membres de la structure, visibles dans l'annuaire.
const RECRUITS: UserSeed[] = [
  { uid: DEV_UIDS.recruit1, displayName: 'Tempest', username: 'tempest_rl', rlRank: 'Grand Champion I',  rlMmr: 1400 },
  { uid: DEV_UIDS.recruit2, displayName: 'Hollow',  username: 'hollow_rl',  rlRank: 'Champion III',      rlMmr: 1310 },
  { uid: DEV_UIDS.recruit3, displayName: 'Breeze',  username: 'breeze_rl',  rlRank: 'Champion II',       rlMmr: 1210 },
  { uid: DEV_UIDS.recruit4, displayName: 'Glimmer', username: 'glimmer_rl', rlRank: 'Diamant III',       rlMmr: 1060 },
  { uid: DEV_UIDS.recruit5, displayName: 'Vortex',  username: 'vortex_rl',  rlRank: 'Grand Champion II', rlMmr: 1490 },
];

// ---------- Équipes ----------
type TeamSeed = {
  id: string;
  name: string;
  label: string;
  order: number;
  groupOrder: number;
  status: 'active' | 'archived';
  playerIds: string[];
  subIds: string[];
  captainId: string | null;
  staffIds: string[];
  staffRoles: Record<string, 'manager' | 'coach'>;
};

const TEAMS: TeamSeed[] = [
  // Groupe 0 — Senior compétitif
  {
    id: TEAM_MAIN, name: 'Main', label: 'Senior compétitif', order: 0, groupOrder: 0, status: 'active',
    playerIds: [DEV_UIDS.rlEliteCaptain, DEV_UIDS.rlEliteP1, DEV_UIDS.rlEliteP2],
    subIds: [DEV_UIDS.rlEliteSub1, DEV_UIDS.rlEliteSub2],
    captainId: DEV_UIDS.rlEliteCaptain,
    staffIds: [DEV_UIDS.teamManager, DEV_UIDS.teamCoach, DEV_UIDS.coachStructure],
    staffRoles: {
      [DEV_UIDS.teamManager]: 'manager',
      [DEV_UIDS.teamCoach]: 'coach',
      [DEV_UIDS.coachStructure]: 'coach',
    },
  },
  {
    id: TEAM_ACADEMY, name: 'Academy', label: 'Senior compétitif', order: 1, groupOrder: 0, status: 'active',
    playerIds: [DEV_UIDS.rlAcademyCaptain, DEV_UIDS.rlAcademyP1, DEV_UIDS.rlAcademyP2],
    subIds: [DEV_UIDS.rlAcademySub],
    captainId: DEV_UIDS.rlAcademyCaptain,
    staffIds: [DEV_UIDS.teamCoach],
    staffRoles: { [DEV_UIDS.teamCoach]: 'coach' },
  },
  {
    id: TEAM_BTEAM, name: 'B-Team', label: 'Senior compétitif', order: 2, groupOrder: 0, status: 'active',
    playerIds: [DEV_UIDS.rlBTeamCaptain, DEV_UIDS.rlBTeamP1, DEV_UIDS.rlBTeamP2],
    subIds: [DEV_UIDS.rlBTeamSub],
    captainId: DEV_UIDS.rlBTeamCaptain,
    staffIds: [DEV_UIDS.teamCoach],
    staffRoles: { [DEV_UIDS.teamCoach]: 'coach' },
  },
  // Groupe 1 — Féminin
  {
    id: TEAM_FEM_MAIN, name: 'Féminine Main', label: 'Féminin', order: 0, groupOrder: 1, status: 'active',
    playerIds: [DEV_UIDS.rlFemMainCaptain, DEV_UIDS.rlFemMainP1, DEV_UIDS.rlFemMainP2],
    subIds: [DEV_UIDS.rlFemMainSub],
    captainId: DEV_UIDS.rlFemMainCaptain,
    staffIds: [DEV_UIDS.teamManager, DEV_UIDS.coachStructure],
    staffRoles: {
      [DEV_UIDS.teamManager]: 'manager',
      [DEV_UIDS.coachStructure]: 'coach',
    },
  },
  {
    id: TEAM_FEM_ACAD, name: 'Féminine Academy', label: 'Féminin', order: 1, groupOrder: 1, status: 'active',
    playerIds: [DEV_UIDS.rlFemAcadCaptain, DEV_UIDS.rlFemAcadP1, DEV_UIDS.rlFemAcadP2],
    subIds: [],
    captainId: DEV_UIDS.rlFemAcadCaptain,
    staffIds: [DEV_UIDS.coachStructure],
    staffRoles: { [DEV_UIDS.coachStructure]: 'coach' },
  },
  // Groupe 2 — Relève jeunes
  {
    id: TEAM_JUNIOR, name: 'Junior', label: 'Relève jeunes', order: 0, groupOrder: 2, status: 'active',
    playerIds: [DEV_UIDS.rlJuniorCaptain, DEV_UIDS.rlJuniorP1, DEV_UIDS.rlJuniorP2],
    subIds: [DEV_UIDS.rlJuniorSub],
    captainId: DEV_UIDS.rlJuniorCaptain,
    staffIds: [DEV_UIDS.teamManager, DEV_UIDS.coachStructure],
    staffRoles: {
      [DEV_UIDS.teamManager]: 'manager',
      [DEV_UIDS.coachStructure]: 'coach',
    },
  },
  {
    id: TEAM_U18, name: 'U18', label: 'Relève jeunes', order: 1, groupOrder: 2, status: 'active',
    playerIds: [DEV_UIDS.rlU18Captain, DEV_UIDS.rlU18P1, DEV_UIDS.rlU18P2],
    subIds: [],
    captainId: DEV_UIDS.rlU18Captain,
    staffIds: [DEV_UIDS.coachStructure],
    staffRoles: { [DEV_UIDS.coachStructure]: 'coach' },
  },
  {
    id: TEAM_U16, name: 'U16', label: 'Relève jeunes', order: 2, groupOrder: 2, status: 'active',
    playerIds: [DEV_UIDS.rlU16Captain, DEV_UIDS.rlU16P1, DEV_UIDS.rlU16P2],
    subIds: [],
    captainId: DEV_UIDS.rlU16Captain,
    staffIds: [DEV_UIDS.coachStructure],
    staffRoles: { [DEV_UIDS.coachStructure]: 'coach' },
  },
  // Groupe 3 — Divisions régionales
  {
    id: TEAM_NORTH, name: 'North Division', label: 'Divisions régionales', order: 0, groupOrder: 3, status: 'active',
    playerIds: [DEV_UIDS.rlNorthCaptain, DEV_UIDS.rlNorthP1, DEV_UIDS.rlNorthP2],
    subIds: [],
    captainId: DEV_UIDS.rlNorthCaptain,
    staffIds: [DEV_UIDS.coachStructure],
    staffRoles: { [DEV_UIDS.coachStructure]: 'coach' },
  },
  {
    id: TEAM_SOUTH, name: 'South Division', label: 'Divisions régionales', order: 1, groupOrder: 3, status: 'active',
    playerIds: [DEV_UIDS.rlSouthCaptain, DEV_UIDS.rlSouthP1, DEV_UIDS.rlSouthP2],
    subIds: [],
    captainId: DEV_UIDS.rlSouthCaptain,
    staffIds: [DEV_UIDS.coachStructure],
    staffRoles: { [DEV_UIDS.coachStructure]: 'coach' },
  },
  {
    id: TEAM_WEST, name: 'West Division', label: 'Divisions régionales', order: 2, groupOrder: 3, status: 'active',
    playerIds: [DEV_UIDS.rlWestCaptain, DEV_UIDS.rlWestP1, DEV_UIDS.rlWestP2],
    subIds: [],
    captainId: DEV_UIDS.rlWestCaptain,
    staffIds: [DEV_UIDS.coachStructure],
    staffRoles: { [DEV_UIDS.coachStructure]: 'coach' },
  },
  // Groupe 4 — Amateur & spécialisé
  {
    id: TEAM_AMATEUR, name: 'Amateurs', label: 'Amateur & spécialisé', order: 0, groupOrder: 4, status: 'active',
    playerIds: [DEV_UIDS.rlAmateurCaptain, DEV_UIDS.rlAmateurP1, DEV_UIDS.rlAmateurP2],
    subIds: [],
    captainId: DEV_UIDS.rlAmateurCaptain,
    staffIds: [],
    staffRoles: {},
  },
  {
    id: TEAM_CONTENT, name: 'Content Creators', label: 'Amateur & spécialisé', order: 1, groupOrder: 4, status: 'active',
    playerIds: [DEV_UIDS.rlContentCaptain, DEV_UIDS.rlContentP1, DEV_UIDS.rlContentP2],
    subIds: [],
    captainId: DEV_UIDS.rlContentCaptain,
    staffIds: [],
    staffRoles: {},
  },
  {
    id: TEAM_1V1, name: '1v1 Specialists', label: 'Amateur & spécialisé', order: 2, groupOrder: 4, status: 'active',
    playerIds: [DEV_UIDS.rl1v1Captain, DEV_UIDS.rl1v1P1, DEV_UIDS.rl1v1P2],
    subIds: [],
    captainId: DEV_UIDS.rl1v1Captain,
    staffIds: [DEV_UIDS.teamCoach],
    staffRoles: { [DEV_UIDS.teamCoach]: 'coach' },
  },
  {
    id: TEAM_SCOUTING, name: 'Scouting Squad', label: 'Amateur & spécialisé', order: 3, groupOrder: 4, status: 'active',
    playerIds: [DEV_UIDS.rlScoutingCaptain, DEV_UIDS.rlScoutingP1, DEV_UIDS.rlScoutingP2],
    subIds: [],
    captainId: DEV_UIDS.rlScoutingCaptain,
    staffIds: [DEV_UIDS.coachStructure],
    staffRoles: { [DEV_UIDS.coachStructure]: 'coach' },
  },
  // Archivées
  {
    id: TEAM_ARCH_S23, name: 'Saison 2023', label: 'Archives', order: 0, groupOrder: 99, status: 'archived',
    playerIds: [DEV_UIDS.rlArchS23P1, DEV_UIDS.rlArchS23P2, DEV_UIDS.rlArchS23P3],
    subIds: [DEV_UIDS.rlArchS23Sub1],
    captainId: DEV_UIDS.rlArchS23P1,
    staffIds: [],
    staffRoles: {},
  },
  {
    id: TEAM_ARCH_FOUND, name: 'Founders Squad', label: 'Archives', order: 1, groupOrder: 99, status: 'archived',
    playerIds: [DEV_UIDS.rlArchFoundP1, DEV_UIDS.rlArchFoundP2, DEV_UIDS.rlArchFoundP3],
    subIds: [],
    captainId: DEV_UIDS.rlArchFoundP1,
    staffIds: [],
    staffRoles: {},
  },
];

// ---------- Helpers ----------

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

// Tous les UIDs qui doivent être membres de la structure : staff + joueurs de toutes
// les équipes (y compris archivées) + membre sans équipe.
function allStructureMemberUids(): string[] {
  const ids = new Set<string>();
  for (const s of STAFF) ids.add(s.uid);
  for (const t of TEAMS) {
    t.playerIds.forEach(id => ids.add(id));
    t.subIds.forEach(id => ids.add(id));
    t.staffIds.forEach(id => ids.add(id));
  }
  ids.add(DEV_UIDS.pureMember);
  return Array.from(ids);
}

// Commit batch et repartir — évite la limite de 500 ops par batch.
async function flush(batchRef: { current: WriteBatch; count: number }, db: FirebaseFirestore.Firestore) {
  if (batchRef.count === 0) return;
  await batchRef.current.commit();
  batchRef.current = db.batch();
  batchRef.count = 0;
}

async function write(
  batchRef: { current: WriteBatch; count: number },
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  opts?: { merge?: boolean },
) {
  if (opts?.merge) batchRef.current.set(ref, data, { merge: true });
  else batchRef.current.set(ref, data);
  batchRef.count++;
  if (batchRef.count >= 400) await flush(batchRef, db);
}

// ---------- Seed ----------

export async function POST() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Dev only' }, { status: 403 });
  }

  const db = getAdminDb();
  const adminAuth = getAdminAuth();
  const batchRef = { current: db.batch(), count: 0 };

  // 1) Firebase Auth — crée les comptes manquants (séquentiel, tolère 'auth/uid-already-exists').
  const allSeeds: UserSeed[] = [...STAFF, ...PLAYERS, ...RECRUITS];
  for (const u of allSeeds) {
    try {
      await adminAuth.getUser(u.uid);
    } catch {
      try {
        await adminAuth.createUser({ uid: u.uid, displayName: u.displayName });
      } catch {
        // ignore — probablement créé en parallèle
      }
    }
  }

  // 2) users docs
  for (const u of [...STAFF, ...PLAYERS]) {
    await write(batchRef, db, db.collection('users').doc(u.uid), {
      uid: u.uid,
      discordId: u.uid.replace('discord_', ''),
      discordUsername: u.username,
      displayName: u.displayName,
      discordAvatar: '',
      games: ['rocket_league'],
      country: 'FR',
      ...(u.rlRank ? { rlRank: u.rlRank } : {}),
      ...(u.rlMmr ? { rlMmr: u.rlMmr } : {}),
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // 3) Recrues (flaguées recrutables)
  const recruitTargets: Record<string, { role: string; message: string }> = {
    [DEV_UIDS.recruit1]: { role: 'joueur', message: 'GC1 stable, je cherche une Main/Academy qui grind vers le GC2. Dispo soirs + weekends.' },
    [DEV_UIDS.recruit2]: { role: 'joueur', message: 'C3 sérieux, disponibilité large, focus rotations. Cherche squad engagée.' },
    [DEV_UIDS.recruit3]: { role: 'joueur', message: 'C2 joueur offensif, je cherche une équipe pour progresser en scrim.' },
    [DEV_UIDS.recruit4]: { role: 'joueur', message: 'D3 jeune (16 ans), je cherche une structure avec coaching pour évoluer.' },
    [DEV_UIDS.recruit5]: { role: 'joueur', message: 'GC2 expérimenté, dispo pour Main/B-Team, un peu de coaching possible.' },
  };
  for (const r of RECRUITS) {
    const t = recruitTargets[r.uid] ?? { role: 'joueur', message: 'Disponible pour rejoindre une structure.' };
    await write(batchRef, db, db.collection('users').doc(r.uid), {
      uid: r.uid,
      discordId: r.uid.replace('discord_', ''),
      discordUsername: r.username,
      displayName: r.displayName,
      discordAvatar: '',
      games: ['rocket_league'],
      country: 'FR',
      rlRank: r.rlRank,
      rlMmr: r.rlMmr,
      isAvailableForRecruitment: true,
      recruitmentRole: t.role,
      recruitmentMessage: t.message,
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // 4) Admin Springs
  await write(batchRef, db, db.collection('admins').doc(DEV_UIDS.admin), {
    uid: DEV_UIDS.admin,
    isDev: true,
    addedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // 5) Structure "Phoenix Esports" — RL only
  await write(batchRef, db, db.collection('structures').doc(DEV_STRUCTURE_ID), {
    name: 'Phoenix Esports',
    tag: 'PHX',
    logoUrl: '',
    coverUrl: '',
    description: "Structure esport française, créée en 2022. Spécialisée Rocket League, avec 15+ équipes réparties du niveau amateur au GC/SSL. Formation, scouting, content — tout sous le même toit.",
    games: ['rocket_league'],
    founderId: DEV_UIDS.founder,
    coFounderIds: [DEV_UIDS.cofounder],
    managerIds: [DEV_UIDS.responsable],
    coachIds: [DEV_UIDS.coachStructure],
    status: 'active',
    recruiting: {
      active: true,
      positions: [
        { game: 'rocket_league', role: 'joueur' },
        { game: 'rocket_league', role: 'coach' },
      ],
      message: "## Phoenix Esports recrute\n\nOn cherche des joueurs **Champion 3+** et des **coachs passionnés** pour renforcer nos équipes Academy/B-Team. Formation et coaching interne inclus.\n\n- **Niveau min. joueur** : Champion III\n- **Engagement** : 3 soirs/semaine + weekends\n- **Communication vocale** obligatoire\n- **Ambiance** détendue mais compétitive",
    },
    achievements: [],
    socials: {},
    discordUrl: 'https://discord.gg/phoenix-demo',
    isDev: true,
    validatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // 6) structure_members + historique — 1 membre par UID structure
  const memberUids = allStructureMemberUids();
  for (const uid of memberUids) {
    const role = uid === DEV_UIDS.founder ? 'fondateur'
      : uid === DEV_UIDS.cofounder ? 'co_fondateur'
      : uid === DEV_UIDS.pureMember ? 'membre'
      : 'joueur';
    await write(batchRef, db, db.collection('structure_members').doc(`${DEV_STRUCTURE_ID}_${uid}_rocket_league`), {
      structureId: DEV_STRUCTURE_ID,
      userId: uid,
      game: 'rocket_league',
      role,
      isDev: true,
      joinedAt: FieldValue.serverTimestamp(),
    });
    await write(batchRef, db, db.collection('structure_member_history').doc(), {
      structureId: DEV_STRUCTURE_ID,
      userId: uid,
      game: 'rocket_league',
      role,
      joinReason: role === 'fondateur' ? 'founder' : 'other',
      joinedAt: FieldValue.serverTimestamp(),
      leftAt: null,
      leftReason: null,
      isDev: true,
    });
  }

  // 6bis) Historique de membres partis — montre que la structure a un passé
  const D_MS = 86_400 * 1000;
  const nowMs = Date.now();
  const pastLeavers: { uid: string; displayName: string; joinedOffsetDays: number; leftOffsetDays: number; reason: string }[] = [
    { uid: DEV_UIDS.rlArchS23P1,   displayName: 'Crypt (transfert KC eSports)', joinedOffsetDays: -720, leftOffsetDays: -180, reason: 'transfer' },
    { uid: DEV_UIDS.rlArchFoundP1, displayName: 'Vigil (retraite)',             joinedOffsetDays: -900, leftOffsetDays: -450, reason: 'retirement' },
  ];
  for (const l of pastLeavers) {
    await write(batchRef, db, db.collection('structure_member_history').doc(), {
      structureId: DEV_STRUCTURE_ID,
      userId: l.uid,
      game: 'rocket_league',
      role: 'joueur',
      joinReason: 'other',
      joinedAt: Timestamp.fromMillis(nowMs + l.joinedOffsetDays * D_MS),
      leftAt: Timestamp.fromMillis(nowMs + l.leftOffsetDays * D_MS),
      leftReason: l.reason,
      displayNameSnapshot: l.displayName,
      isDev: true,
    });
  }

  // 7) Équipes
  for (const t of TEAMS) {
    await write(batchRef, db, db.collection('sub_teams').doc(t.id), {
      structureId: DEV_STRUCTURE_ID,
      game: 'rocket_league',
      name: t.name,
      label: t.label,
      order: t.order,
      groupOrder: t.groupOrder,
      status: t.status,
      playerIds: t.playerIds,
      subIds: t.subIds,
      staffIds: t.staffIds,
      staffRoles: t.staffRoles,
      captainId: t.captainId,
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
      ...(t.status === 'archived' ? { archivedAt: FieldValue.serverTimestamp() } : {}),
    });
  }

  // 8) Événements — mix passé/futur, variés par type
  const H = 3600 * 1000;
  const ts = (offsetMs: number) => Timestamp.fromMillis(nowMs + offsetMs);

  type EventSeed = {
    id: string;
    title: string;
    type: 'training' | 'scrim' | 'match' | 'other';
    teamId: string;
    createdBy: string;
    startsAt: Timestamp;
    endsAt: Timestamp;
    adversaire?: string | null;
    status: 'scheduled' | 'completed' | 'cancelled';
    compteRendu?: string;
    aTravailler?: string;
  };

  const events: EventSeed[] = [
    // Passé terminé — Main
    {
      id: 'dev_ev_main_scrim_past',
      title: 'Scrim vs Ombre Nine',
      type: 'scrim',
      teamId: TEAM_MAIN,
      createdBy: DEV_UIDS.teamManager,
      startsAt: ts(-2 * 24 * H),
      endsAt: ts(-2 * 24 * H + 2 * H),
      adversaire: 'Ombre Nine',
      status: 'completed',
      compteRendu: '8W / 4L sur 12 maps. Bonne session, rotations propres en 2e mi-temps. MVP : Zephyr.',
      aTravailler: 'Reset 3e homme sur dégagements offensifs, communication d\'engagement.',
    },
    // Passé terminé — Academy
    {
      id: 'dev_ev_acad_training_past',
      title: 'Training rotations',
      type: 'training',
      teamId: TEAM_ACADEMY,
      createdBy: DEV_UIDS.teamCoach,
      startsAt: ts(-3 * 24 * H),
      endsAt: ts(-3 * 24 * H + 90 * 60 * 1000),
      status: 'completed',
      compteRendu: 'Focus sur les rotations défensives 2e homme. Echo a bien progressé, Drift encore en retard sur les timings.',
      aTravailler: 'Timings de rotation post-kickoff.',
    },
    // Passé terminé — Féminine Main
    {
      id: 'dev_ev_fem_match_past',
      title: 'Match Ligue Féminine J4',
      type: 'match',
      teamId: TEAM_FEM_MAIN,
      createdBy: DEV_UIDS.teamManager,
      startsAt: ts(-5 * 24 * H),
      endsAt: ts(-5 * 24 * H + 2 * H),
      adversaire: 'Nyx Féminine',
      status: 'completed',
      compteRendu: 'Victoire 4-2. Aria énorme en défense. Le résultat nous qualifie pour les playoffs.',
      aTravailler: 'Préparation playoffs : BO7 à anticiper.',
    },
    // Futur — Main
    {
      id: 'dev_ev_main_training',
      title: 'Training mécaniques + kickoffs',
      type: 'training',
      teamId: TEAM_MAIN,
      createdBy: DEV_UIDS.teamCoach,
      startsAt: ts(6 * H),
      endsAt: ts(6 * H + 2 * H),
      status: 'scheduled',
    },
    {
      id: 'dev_ev_main_scrim_future',
      title: 'Scrim vs Team Apex',
      type: 'scrim',
      teamId: TEAM_MAIN,
      createdBy: DEV_UIDS.teamManager,
      startsAt: ts(2 * 24 * H),
      endsAt: ts(2 * 24 * H + 2 * H),
      adversaire: 'Team Apex',
      status: 'scheduled',
    },
    {
      id: 'dev_ev_main_match',
      title: 'Match qualif — RLCS Tier 1',
      type: 'match',
      teamId: TEAM_MAIN,
      createdBy: DEV_UIDS.teamManager,
      startsAt: ts(5 * 24 * H),
      endsAt: ts(5 * 24 * H + 3 * H),
      adversaire: 'Karmic Legion',
      status: 'scheduled',
    },
    // Futur — Academy
    {
      id: 'dev_ev_acad_training',
      title: 'Training défense 2v3',
      type: 'training',
      teamId: TEAM_ACADEMY,
      createdBy: DEV_UIDS.teamCoach,
      startsAt: ts(8 * H),
      endsAt: ts(8 * H + 90 * 60 * 1000),
      status: 'scheduled',
    },
    {
      id: 'dev_ev_acad_scrim',
      title: 'Scrim Academy vs Lumina',
      type: 'scrim',
      teamId: TEAM_ACADEMY,
      createdBy: DEV_UIDS.teamCoach,
      startsAt: ts(3 * 24 * H),
      endsAt: ts(3 * 24 * H + 2 * H),
      adversaire: 'Lumina Academy',
      status: 'scheduled',
    },
    // Futur — B-Team
    {
      id: 'dev_ev_bteam_training',
      title: 'Training aérien + flips',
      type: 'training',
      teamId: TEAM_BTEAM,
      createdBy: DEV_UIDS.teamCoach,
      startsAt: ts(24 * H + 4 * H),
      endsAt: ts(24 * H + 4 * H + 90 * 60 * 1000),
      status: 'scheduled',
    },
    // Futur — Féminine
    {
      id: 'dev_ev_fem_training',
      title: 'Training pré-playoffs',
      type: 'training',
      teamId: TEAM_FEM_MAIN,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(2 * 24 * H + 3 * H),
      endsAt: ts(2 * 24 * H + 5 * H),
      status: 'scheduled',
    },
    {
      id: 'dev_ev_fem_match',
      title: 'Match Ligue Féminine — Playoffs',
      type: 'match',
      teamId: TEAM_FEM_MAIN,
      createdBy: DEV_UIDS.teamManager,
      startsAt: ts(7 * 24 * H),
      endsAt: ts(7 * 24 * H + 2 * H),
      adversaire: 'À déterminer',
      status: 'scheduled',
    },
    {
      id: 'dev_ev_fem_acad_training',
      title: 'Training tactique',
      type: 'training',
      teamId: TEAM_FEM_ACAD,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(24 * H + 6 * H),
      endsAt: ts(24 * H + 8 * H),
      status: 'scheduled',
    },
    // Futur — Jeunes
    {
      id: 'dev_ev_junior_training',
      title: 'Training Junior — rotations',
      type: 'training',
      teamId: TEAM_JUNIOR,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(24 * H + 2 * H),
      endsAt: ts(24 * H + 3 * H + 30 * 60 * 1000),
      status: 'scheduled',
    },
    {
      id: 'dev_ev_u18_training',
      title: 'Training U18',
      type: 'training',
      teamId: TEAM_U18,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(3 * 24 * H + 2 * H),
      endsAt: ts(3 * 24 * H + 4 * H),
      status: 'scheduled',
    },
    {
      id: 'dev_ev_u16_training',
      title: 'Training U16 fondamentaux',
      type: 'training',
      teamId: TEAM_U16,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(4 * 24 * H + 2 * H),
      endsAt: ts(4 * 24 * H + 3 * H + 30 * 60 * 1000),
      status: 'scheduled',
    },
    // Futur — Régional
    {
      id: 'dev_ev_north_training',
      title: 'Training North Division',
      type: 'training',
      teamId: TEAM_NORTH,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(2 * 24 * H + 5 * H),
      endsAt: ts(2 * 24 * H + 7 * H),
      status: 'scheduled',
    },
    {
      id: 'dev_ev_south_scrim',
      title: 'Scrim South vs Team Crescent',
      type: 'scrim',
      teamId: TEAM_SOUTH,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(3 * 24 * H + 4 * H),
      endsAt: ts(3 * 24 * H + 6 * H),
      adversaire: 'Team Crescent',
      status: 'scheduled',
    },
    // Futur — Amateur/Content
    {
      id: 'dev_ev_content_session',
      title: 'Session content — Freestyle stream',
      type: 'other',
      teamId: TEAM_CONTENT,
      createdBy: DEV_UIDS.rlContentCaptain,
      startsAt: ts(24 * H + 7 * H),
      endsAt: ts(24 * H + 10 * H),
      status: 'scheduled',
    },
    // Futur — Scouting watch party
    {
      id: 'dev_ev_scouting_watch',
      title: 'Watch party — RLCS EU finale',
      type: 'other',
      teamId: TEAM_SCOUTING,
      createdBy: DEV_UIDS.coachStructure,
      startsAt: ts(2 * 24 * H + 8 * H),
      endsAt: ts(2 * 24 * H + 11 * H),
      status: 'scheduled',
    },
  ];

  for (const ev of events) {
    const team = TEAMS.find(t => t.id === ev.teamId);
    if (!team) continue;
    const invited = uniq([...team.playerIds, ...team.subIds, ...team.staffIds]);
    await write(batchRef, db, db.collection('structure_events').doc(ev.id), {
      structureId: DEV_STRUCTURE_ID,
      createdBy: ev.createdBy,
      title: ev.title,
      type: ev.type,
      description: '',
      location: '',
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      target: { scope: 'teams', teamIds: [ev.teamId] },
      status: ev.status,
      completedAt: ev.status === 'completed' ? ev.endsAt : null,
      completedBy: ev.status === 'completed' ? ev.createdBy : null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      compteRendu: ev.compteRendu ?? '',
      aTravailler: ev.aTravailler ?? '',
      adversaire: ev.adversaire ?? null,
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const userId of invited) {
      // Pour un event passé terminé, on simule que tout le monde a répondu "yes".
      const isPast = ev.status === 'completed';
      await write(batchRef, db, db.collection('event_presences').doc(`${ev.id}_${userId}`), {
        eventId: ev.id,
        structureId: DEV_STRUCTURE_ID,
        userId,
        status: isPast ? 'yes' : 'pending',
        wasStructureMember: true,
        respondedAt: isPast ? ev.startsAt : null,
        updatedBy: null,
        history: [],
        isDev: true,
      });
    }
  }

  // 9) Devoirs — mix de types + statuts
  type TodoSeed = {
    id: string;
    teamId: string;
    assigneeId: string;
    type: 'free' | 'replay_review' | 'training_pack' | 'vod_review' | 'scouting' | 'mental_checkin';
    title: string;
    description: string;
    config: Record<string, unknown>;
    deadlineOffsetDays: number; // relatif à now
    done?: boolean;
    response?: Record<string, unknown> | null;
    createdBy: string;
  };

  const todos: TodoSeed[] = [
    {
      id: 'dev_todo_main_replay', teamId: TEAM_MAIN,
      assigneeId: DEV_UIDS.rlEliteCaptain,
      type: 'replay_review',
      title: 'Replay scrim vs Ombre Nine — Map 7',
      description: 'Regarde la map 7, focus sur nos rotations défensives en 2e mi-temps (minutes 3:40 → 4:20).',
      config: { replayId: null, replayNote: 'Map 7 — zoom sur les rotations 3e homme.' },
      deadlineOffsetDays: 1,
      createdBy: DEV_UIDS.teamCoach,
    },
    {
      id: 'dev_todo_main_training', teamId: TEAM_MAIN,
      assigneeId: DEV_UIDS.rlEliteP1,
      type: 'training_pack',
      title: 'Training pack — Air dribbles niveau 2',
      description: 'Trois passes minimum sur chaque pack, objectif 70% de réussite.',
      config: {
        packs: [
          { code: 'A503-264B-9D4C-E4F7', objective: '70% sans rater de reset' },
          { code: 'B612-87AC-4D1F-2901', objective: 'Valider au moins 5/10 aerials' },
        ],
      },
      deadlineOffsetDays: 2,
      createdBy: DEV_UIDS.teamCoach,
    },
    {
      id: 'dev_todo_main_vod_done', teamId: TEAM_MAIN,
      assigneeId: DEV_UIDS.rlEliteP2,
      type: 'vod_review',
      title: 'VOD pros — Karmine Corp vs BDS',
      description: 'Focus sur le positionnement en challenge. Noter 3 situations intéressantes.',
      config: { url: 'https://www.youtube.com/watch?v=demo', focus: 'Positionnement 2e homme en challenge.' },
      deadlineOffsetDays: -1,
      done: true,
      response: { type: 'vod_review', analysis: '1) Challenge 50/50 prop à 2:15 bien géré. 2) Rotation backpost trop lente à 5:40. 3) Aerial défensif excellent à 8:12.' },
      createdBy: DEV_UIDS.coachStructure,
    },
    {
      id: 'dev_todo_acad_mental_done', teamId: TEAM_ACADEMY,
      assigneeId: DEV_UIDS.rlAcademyCaptain,
      type: 'mental_checkin',
      title: 'Check-in mental — avant scrim',
      description: 'Prends 2 min pour noter ton état avant la session.',
      config: { prompts: ['Humeur', 'Énergie', 'Motivation'] },
      deadlineOffsetDays: -1,
      done: true,
      response: { type: 'mental_checkin', ratings: [4, 3, 5] },
      createdBy: DEV_UIDS.teamCoach,
    },
    {
      id: 'dev_todo_acad_replay', teamId: TEAM_ACADEMY,
      assigneeId: DEV_UIDS.rlAcademyP1,
      type: 'replay_review',
      title: 'Replay training rotations',
      description: 'Noter où tu as eu 3 joueurs côté droit. Focus sur la Map 3.',
      config: { replayId: null, replayNote: 'Map 3 — minutes 1:30 à 2:30.' },
      deadlineOffsetDays: 2,
      createdBy: DEV_UIDS.teamCoach,
    },
    {
      id: 'dev_todo_fem_scouting', teamId: TEAM_FEM_MAIN,
      assigneeId: DEV_UIDS.rlFemMainCaptain,
      type: 'scouting',
      title: 'Scouting Nyx Féminine — playoffs',
      description: 'Regarder leurs 3 derniers matchs. Identifier faiblesses en défense et leur kickoff préféré.',
      config: { opponent: 'Nyx Féminine' },
      deadlineOffsetDays: 3,
      createdBy: DEV_UIDS.teamManager,
    },
    {
      id: 'dev_todo_bteam_free', teamId: TEAM_BTEAM,
      assigneeId: DEV_UIDS.rlBTeamCaptain,
      type: 'free',
      title: 'Confirmer les joueurs dispo pour le match du WE',
      description: 'Envoyer le message au groupe Discord avant jeudi.',
      config: {},
      deadlineOffsetDays: 2,
      createdBy: DEV_UIDS.teamCoach,
    },
    {
      id: 'dev_todo_junior_training', teamId: TEAM_JUNIOR,
      assigneeId: DEV_UIDS.rlJuniorP1,
      type: 'training_pack',
      title: 'Training pack — Fundamentals',
      description: 'Pack rotations de base, 30 min par jour pendant 3 jours.',
      config: {
        packs: [{ code: 'C782-1234-5678-ABCD', objective: 'Rotations fluides sans temps mort' }],
      },
      deadlineOffsetDays: 3,
      createdBy: DEV_UIDS.coachStructure,
    },
    {
      id: 'dev_todo_u16_mental', teamId: TEAM_U16,
      assigneeId: DEV_UIDS.rlU16Captain,
      type: 'mental_checkin',
      title: 'Check-in — gestion frustration',
      description: 'On fait le point sur les dernières sessions. Prends le temps de répondre honnêtement.',
      config: { prompts: ['Humeur', 'Confiance', 'Envie de jouer'] },
      deadlineOffsetDays: 1,
      createdBy: DEV_UIDS.coachStructure,
    },
    {
      id: 'dev_todo_fem_acad_replay_done', teamId: TEAM_FEM_ACAD,
      assigneeId: DEV_UIDS.rlFemAcadCaptain,
      type: 'replay_review',
      title: 'Replay dernière session',
      description: 'Focus sur tes kickoffs.',
      config: { replayId: null, replayNote: 'Analyse 5 kickoffs de suite.' },
      deadlineOffsetDays: -2,
      done: true,
      response: { type: 'replay_review', analysis: 'J\'ai identifié que je pars trop tôt sur 3 des 5 kickoffs. À corriger en challenge fake.' },
      createdBy: DEV_UIDS.coachStructure,
    },
    {
      id: 'dev_todo_south_free', teamId: TEAM_SOUTH,
      assigneeId: DEV_UIDS.rlSouthCaptain,
      type: 'free',
      title: 'Proposer 2 créneaux de scrim pour la semaine prochaine',
      description: 'Sondage Discord + retour avant dimanche.',
      config: {},
      deadlineOffsetDays: 4,
      createdBy: DEV_UIDS.coachStructure,
    },
  ];

  for (const t of todos) {
    const team = TEAMS.find(x => x.id === t.teamId);
    if (!team) continue;
    const deadlineAt = nowMs + t.deadlineOffsetDays * D_MS;
    const deadlineYmd = new Date(deadlineAt).toISOString().slice(0, 10);
    await write(batchRef, db, db.collection('structure_todos').doc(t.id), {
      structureId: DEV_STRUCTURE_ID,
      subTeamId: t.teamId,
      assigneeId: t.assigneeId,
      type: t.type,
      title: t.title,
      description: t.description,
      config: t.config,
      response: t.response ?? null,
      eventId: null,
      deadline: deadlineYmd,
      deadlineAt,
      deadlineMode: 'absolute',
      deadlineOffsetDays: null,
      postToChannel: false,
      done: t.done ?? false,
      doneAt: t.done ? Timestamp.fromMillis(deadlineAt - 12 * H) : null,
      doneBy: t.done ? t.assigneeId : null,
      createdBy: t.createdBy,
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // 10) Join requests — recrues candidates vers différentes équipes
  const joinRequests: { id: string; uid: string; message: string }[] = [
    { id: 'dev_jr_recruit1', uid: DEV_UIDS.recruit1, message: 'Bonjour, GC1 dispo tous les soirs + weekends. J\'aimerais postuler à la Main/Academy.' },
    { id: 'dev_jr_recruit2', uid: DEV_UIDS.recruit2, message: 'C3 stable, 2 ans d\'expérience scrim, je cherche une structure sérieuse.' },
    { id: 'dev_jr_recruit3', uid: DEV_UIDS.recruit3, message: 'Dispo soirs + WE, je cherche une B-Team/Academy pour grind.' },
    { id: 'dev_jr_recruit4', uid: DEV_UIDS.recruit4, message: 'Jeune joueur D3, je cherche une structure avec coaching U16/U18.' },
  ];
  for (const jr of joinRequests) {
    await write(batchRef, db, db.collection('structure_invitations').doc(jr.id), {
      type: 'join_request',
      structureId: DEV_STRUCTURE_ID,
      applicantId: jr.uid,
      createdBy: jr.uid,
      game: 'rocket_league',
      role: 'joueur',
      message: jr.message,
      status: 'pending',
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await flush(batchRef, db);

  return NextResponse.json({
    ok: true,
    structure: DEV_STRUCTURE_ID,
    structureName: 'Phoenix Esports',
    users: STAFF.length + PLAYERS.length + RECRUITS.length,
    staff: STAFF.length,
    players: PLAYERS.length,
    recruits: RECRUITS.length,
    teams: { active: TEAMS.filter(t => t.status === 'active').length, archived: TEAMS.filter(t => t.status === 'archived').length },
    events: events.length,
    todos: todos.length,
    joinRequests: joinRequests.length,
  });
}
