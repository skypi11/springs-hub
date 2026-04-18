// UIDs centralisés pour le seed dev — partagés entre /api/dev/seed et /api/dev/cleanup
// pour garantir que le cleanup supprime bien tous les comptes Firebase Auth créés.

export const DEV_STRUCTURE_ID = 'dev_test_structure';

export const DEV_UIDS = {
  // Rôles structure
  founder: 'discord_dev_founder',
  cofounder: 'discord_dev_cofounder',
  responsable: 'discord_dev_responsable',
  coachStructure: 'discord_dev_coach_structure',
  // Rôles équipe (staff)
  teamManager: 'discord_dev_team_manager',
  teamCoach: 'discord_dev_team_coach',
  // RL Elite
  rlEliteCaptain: 'discord_dev_rl_elite_captain',
  rlEliteP1: 'discord_dev_rl_elite_p1',
  rlEliteP2: 'discord_dev_rl_elite_p2',
  rlEliteSub1: 'discord_dev_rl_elite_sub1',
  rlEliteSub2: 'discord_dev_rl_elite_sub2',
  // RL Academy
  rlAcademyCaptain: 'discord_dev_rl_academy_captain',
  rlAcademyP1: 'discord_dev_rl_academy_p1',
  rlAcademyP2: 'discord_dev_rl_academy_p2',
  rlAcademySub: 'discord_dev_rl_academy_sub',
  // TM
  tmCaptain: 'discord_dev_tm_captain',
  tmPlayer: 'discord_dev_tm_player',
  // Membre sans équipe
  pureMember: 'discord_dev_pure_member',
  // Admin Springs
  admin: 'discord_dev_admin',
  // Recrues libres
  recruit1: 'discord_dev_recruit1',
  recruit2: 'discord_dev_recruit2',
  recruit3: 'discord_dev_recruit3',
} as const;
