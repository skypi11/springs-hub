// UIDs centralisés pour le seed dev — partagés entre /api/dev/seed, /api/dev/cleanup
// et le DevSwitcher pour garantir la cohérence (création ↔ impersonate ↔ cleanup Auth).

export const DEV_STRUCTURE_ID = 'dev_test_structure';

// Seuls rôles reconnus par le site : fondateur, co-fondateur, responsable (managerIds),
// coach structure (coachIds), manager d'équipe + coach d'équipe (staffIds + staffRoles),
// capitaine, joueur, remplaçant, membre. Aucun autre rôle stocké — cf. lib/member-role.ts.
export const DEV_UIDS = {
  // Rôles structure
  founder: 'discord_dev_founder',
  cofounder: 'discord_dev_cofounder',
  responsable: 'discord_dev_responsable',
  coachStructure: 'discord_dev_coach_structure',
  // Staff d'équipe (affectés via staffIds + staffRoles sur les sub_teams)
  teamManager: 'discord_dev_team_manager',
  teamCoach: 'discord_dev_team_coach',

  // Main (senior compétitif)
  rlEliteCaptain: 'discord_dev_rl_elite_captain',
  rlEliteP1: 'discord_dev_rl_elite_p1',
  rlEliteP2: 'discord_dev_rl_elite_p2',
  rlEliteSub1: 'discord_dev_rl_elite_sub1',
  rlEliteSub2: 'discord_dev_rl_elite_sub2',
  // Academy
  rlAcademyCaptain: 'discord_dev_rl_academy_captain',
  rlAcademyP1: 'discord_dev_rl_academy_p1',
  rlAcademyP2: 'discord_dev_rl_academy_p2',
  rlAcademySub: 'discord_dev_rl_academy_sub',
  // B-Team
  rlBTeamCaptain: 'discord_dev_rl_bteam_captain',
  rlBTeamP1: 'discord_dev_rl_bteam_p1',
  rlBTeamP2: 'discord_dev_rl_bteam_p2',
  rlBTeamSub: 'discord_dev_rl_bteam_sub',

  // Féminine Main
  rlFemMainCaptain: 'discord_dev_rl_fem_main_captain',
  rlFemMainP1: 'discord_dev_rl_fem_main_p1',
  rlFemMainP2: 'discord_dev_rl_fem_main_p2',
  rlFemMainSub: 'discord_dev_rl_fem_main_sub',
  // Féminine Academy
  rlFemAcadCaptain: 'discord_dev_rl_fem_acad_captain',
  rlFemAcadP1: 'discord_dev_rl_fem_acad_p1',
  rlFemAcadP2: 'discord_dev_rl_fem_acad_p2',

  // Junior (18+)
  rlJuniorCaptain: 'discord_dev_rl_junior_captain',
  rlJuniorP1: 'discord_dev_rl_junior_p1',
  rlJuniorP2: 'discord_dev_rl_junior_p2',
  rlJuniorSub: 'discord_dev_rl_junior_sub',
  // U18
  rlU18Captain: 'discord_dev_rl_u18_captain',
  rlU18P1: 'discord_dev_rl_u18_p1',
  rlU18P2: 'discord_dev_rl_u18_p2',
  // U16
  rlU16Captain: 'discord_dev_rl_u16_captain',
  rlU16P1: 'discord_dev_rl_u16_p1',
  rlU16P2: 'discord_dev_rl_u16_p2',

  // Division régionale
  rlNorthCaptain: 'discord_dev_rl_north_captain',
  rlNorthP1: 'discord_dev_rl_north_p1',
  rlNorthP2: 'discord_dev_rl_north_p2',
  rlSouthCaptain: 'discord_dev_rl_south_captain',
  rlSouthP1: 'discord_dev_rl_south_p1',
  rlSouthP2: 'discord_dev_rl_south_p2',
  rlWestCaptain: 'discord_dev_rl_west_captain',
  rlWestP1: 'discord_dev_rl_west_p1',
  rlWestP2: 'discord_dev_rl_west_p2',

  // Amateur / spécialisé
  rlAmateurCaptain: 'discord_dev_rl_amateur_captain',
  rlAmateurP1: 'discord_dev_rl_amateur_p1',
  rlAmateurP2: 'discord_dev_rl_amateur_p2',
  rlContentCaptain: 'discord_dev_rl_content_captain',
  rlContentP1: 'discord_dev_rl_content_p1',
  rlContentP2: 'discord_dev_rl_content_p2',
  rl1v1Captain: 'discord_dev_rl_1v1_captain',
  rl1v1P1: 'discord_dev_rl_1v1_p1',
  rl1v1P2: 'discord_dev_rl_1v1_p2',
  rlScoutingCaptain: 'discord_dev_rl_scouting_captain',
  rlScoutingP1: 'discord_dev_rl_scouting_p1',
  rlScoutingP2: 'discord_dev_rl_scouting_p2',

  // Archivés — Saison 2023
  rlArchS23P1: 'discord_dev_rl_arch_s23_p1',
  rlArchS23P2: 'discord_dev_rl_arch_s23_p2',
  rlArchS23P3: 'discord_dev_rl_arch_s23_p3',
  rlArchS23Sub1: 'discord_dev_rl_arch_s23_sub1',
  // Archivés — Founders squad
  rlArchFoundP1: 'discord_dev_rl_arch_found_p1',
  rlArchFoundP2: 'discord_dev_rl_arch_found_p2',
  rlArchFoundP3: 'discord_dev_rl_arch_found_p3',

  // Membre sans équipe
  pureMember: 'discord_dev_pure_member',
  // Admin Springs
  admin: 'discord_dev_admin',
  // Recrues libres
  recruit1: 'discord_dev_recruit1',
  recruit2: 'discord_dev_recruit2',
  recruit3: 'discord_dev_recruit3',
  recruit4: 'discord_dev_recruit4',
  recruit5: 'discord_dev_recruit5',
} as const;
