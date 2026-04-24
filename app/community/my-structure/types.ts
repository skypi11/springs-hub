export type DashboardTab = 'general' | 'teams' | 'recruitment' | 'members' | 'calendar' | 'todos' | 'documents';

export type Member = {
  id: string;
  userId: string;
  game: string;
  role: string;
  displayName: string;
  discordUsername: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
  joinedAt?: number | null;
};

export type MyStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  coverUrl?: string;
  description: string;
  games: string[];
  discordUrl: string;
  socials: Record<string, string>;
  recruiting: { active: boolean; positions: { game: string; role: string }[]; message?: string };
  achievements: { placement?: string; title?: string; competition?: string; game?: string; date?: string }[];
  status: string;
  reviewComment?: string;
  founderId: string;
  coFounderIds?: string[];
  coFounderDepartures?: Record<string, string | null>;
  transferPending?: {
    toUid: string;
    keepAsCoFounder: boolean;
    initiatedBy: string;
    initiatedAt: string | null;
    scheduledAtMs: number | null;
  } | null;
  managerIds?: string[];
  coachIds?: string[];
  discordIntegration?: {
    guildId: string;
    guildName: string;
    guildIconHash?: string | null;
    installedBy: string;
    structureChannelId?: string | null;
    structureChannelName?: string | null;
    structureRoleId?: string | null;
    structureRoleName?: string | null;
    gameChannels?: Record<string, {
      channelId?: string | null;
      channelName?: string | null;
      roleId?: string | null;
      roleName?: string | null;
    }>;
    staffChannelId?: string | null;
    staffChannelName?: string | null;
    staffRoleId?: string | null;
    staffRoleName?: string | null;
  } | null;
  members: Member[];
  requestedAt?: string;
  validatedAt?: string;
  accessLevel?: 'dirigeant' | 'staff';
};
