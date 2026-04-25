'use client';
import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Clock, Loader2, User, UserPlus, Users } from 'lucide-react';
import MemberActionsMenu from '@/components/structure/MemberActionsMenu';
import {
  computeMemberRole, groupAffiliations, PRIMARY_ROLE_LABELS,
  type MemberRoleTeam,
} from '@/lib/member-role';
import type { DashboardTab, MyStructure, TeamData, HistoryItem } from '../types';
import {
  DEPARTURE_NOTICE_MS, PRIMARY_ROLE_ORDER, PRIMARY_ROLE_COLORS,
} from '../constants';

// Tab Membres complet — extrait de page.tsx pour réduire la taille du fichier orchestrateur.
// Comprend : bannière "sans équipe" (dirigeants only), liste des membres avec actions,
// historique d'appartenance (dirigeants/managers).
export interface MembersTabProps {
  s: MyStructure;
  teams: TeamData[];
  now: number;

  isDirigeantOfActive: boolean;
  isFounderOfActive: boolean;
  isCoFounderOfActive: boolean;
  isManagerOfActive: boolean;
  invActionLoading: string | null;

  history: HistoryItem[];
  historyLoading: boolean;

  setTab: (t: DashboardTab) => void;

  handleToggleStaffRole: (userId: string, displayName: string, role: 'coach' | 'manager', enable: boolean) => void;
  handlePromoteToCoFounder: (userId: string, displayName: string) => void;
  handleDemoteCoFounder: (userId: string, displayName: string) => void;
  handleTransferOwnership: (userId: string, displayName: string) => void;
  handleRemoveMember: (memberId: string, displayName: string) => void;
}

export function MembersTab(props: MembersTabProps) {
  const {
    s, teams, now,
    isDirigeantOfActive, isFounderOfActive, isCoFounderOfActive, isManagerOfActive,
    invActionLoading,
    history, historyLoading,
    setTab,
    handleToggleStaffRole, handlePromoteToCoFounder, handleDemoteCoFounder,
    handleTransferOwnership, handleRemoveMember,
  } = props;

  // ─── Bannière "sans équipe" (dirigeants only) ────────────────────────────
  const renderUnassignedBanner = () => {
    if (!isDirigeantOfActive) return null;
    const assignedUids = new Set<string>();
    for (const t of teams) {
      if ((t.status ?? 'active') !== 'active') continue;
      for (const p of t.players) assignedUids.add(p.uid);
      for (const p of t.subs) assignedUids.add(p.uid);
      for (const p of t.staff) assignedUids.add(p.uid);
      if (t.captainId) assignedUids.add(t.captainId);
    }
    const unassigned = s.members.filter(m =>
      m.role !== 'fondateur' && m.role !== 'co_fondateur' && !assignedUids.has(m.userId)
    );
    if (unassigned.length === 0) return null;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recentRecruits = unassigned.filter(m => (m.joinedAt ?? 0) >= sevenDaysAgo);
    return (
      <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid rgba(255,184,0,0.35)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
        <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)' }}>
              <UserPlus size={13} style={{ color: 'var(--s-gold)' }} />
            </div>
            <div>
              <span className="font-display text-sm tracking-wider">SANS ÉQUIPE</span>
              {recentRecruits.length > 0 && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--s-gold)' }}>
                  {recentRecruits.length} nouvelle{recentRecruits.length > 1 ? 's' : ''} recrue{recentRecruits.length > 1 ? 's' : ''} cette semaine à placer
                </p>
              )}
            </div>
          </div>
          <span className="font-display text-lg" style={{ color: 'var(--s-gold)' }}>{unassigned.length}</span>
        </div>
        <div className="relative z-[1] divide-y" style={{ borderColor: 'var(--s-border)' }}>
          {unassigned.map(m => {
            const avatar = m.avatarUrl || m.discordAvatar;
            const isRecentRecruit = (m.joinedAt ?? 0) >= sevenDaysAgo;
            const daysSince = m.joinedAt ? Math.floor((now - m.joinedAt) / (24 * 60 * 60 * 1000)) : null;
            return (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                <Link href={`/profile/${m.userId}`} className="flex items-center gap-3 flex-1 min-w-0">
                  {avatar ? (
                    <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <Image src={avatar} alt={m.displayName} fill className="object-cover" unoptimized />
                    </div>
                  ) : (
                    <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <User size={12} style={{ color: 'var(--s-text-muted)' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{m.displayName}</p>
                      <span className={`tag ${m.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                        {m.game === 'rocket_league' ? 'RL' : 'TM'}
                      </span>
                      {isRecentRecruit && (
                        <span className="tag" style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,184,0,0.12)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.35)' }}>
                          NOUVELLE RECRUE
                        </span>
                      )}
                    </div>
                    {daysSince != null && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                        Rejoint il y a {daysSince === 0 ? "aujourd'hui" : `${daysSince}j`}
                      </p>
                    )}
                  </div>
                </Link>
                <button type="button" onClick={() => setTab('teams')}
                  className="text-xs font-semibold px-3 py-1.5 transition-colors duration-150 bevel-sm"
                  style={{ background: 'rgba(255,184,0,0.12)', color: 'var(--s-gold)', border: '1px solid rgba(255,184,0,0.3)' }}>
                  Placer en équipe
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─── Liste des membres ────────────────────────────────────────────────────
  const renderMembersList = () => {
    const roleTeams: MemberRoleTeam[] = teams.map(t => ({
      id: t.id,
      name: t.name,
      playerIds: t.players.map(p => p.uid),
      subIds: t.subs.map(p => p.uid),
      staffIds: t.staff.map(p => p.uid),
      staffRoles: t.staffRoles,
      captainId: t.captainId ?? null,
      status: t.status,
    }));

    return (
      <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
        <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.06), transparent 70%)' }} />
        <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
              <Users size={13} style={{ color: 'var(--s-gold)' }} />
            </div>
            <span className="font-display text-sm tracking-wider">MEMBRES</span>
          </div>
          <span className="font-display text-lg" style={{ color: 'var(--s-gold)' }}>{s.members.length}</span>
        </div>
        <div className="relative z-[1]">
          {s.members.length === 0 ? (
            <div className="p-6 text-center">
              <Users size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun membre.</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
              {[...s.members]
                .map(m => ({
                  m,
                  derived: computeMemberRole({
                    userId: m.userId,
                    founderId: s.founderId,
                    coFounderIds: s.coFounderIds ?? [],
                    managerIds: s.managerIds ?? [],
                    coachIds: s.coachIds ?? [],
                    teams: roleTeams,
                  }),
                }))
                .sort((a, b) =>
                  PRIMARY_ROLE_ORDER.indexOf(a.derived.primary) - PRIMARY_ROLE_ORDER.indexOf(b.derived.primary)
                )
                .map(({ m, derived }) => {
                  const avatar = m.avatarUrl || m.discordAvatar;
                  const primaryLabel = PRIMARY_ROLE_LABELS[derived.primary];
                  const affiliationBadges = groupAffiliations(derived.affiliations);
                  const isFounderRow = derived.primary === 'fondateur';
                  const isCoFounderRow = derived.primary === 'co_fondateur';
                  const isManagerRow = (s.managerIds ?? []).includes(m.userId);
                  const isCoachRow = (s.coachIds ?? []).includes(m.userId);
                  const structuralColor = PRIMARY_ROLE_COLORS[derived.primary];
                  const canRemove = !isFounderRow && !isCoFounderRow && isDirigeantOfActive;
                  const canManageStaffRoles = (isFounderOfActive || isCoFounderOfActive) && !isFounderRow;
                  const memberDepartureIso = s.coFounderDepartures?.[m.userId];
                  const memberRemainingMs = memberDepartureIso ? Math.max(0, new Date(memberDepartureIso).getTime() + DEPARTURE_NOTICE_MS - now) : null;
                  const daysLeft = memberRemainingMs != null ? Math.ceil(memberRemainingMs / (24 * 60 * 60 * 1000)) : null;
                  const badgeColors: Record<string, { bg: string; fg: string; border: string }> = {
                    manager: { bg: 'rgba(123,47,190,0.1)', fg: 'var(--s-violet-light)', border: 'rgba(123,47,190,0.3)' },
                    coach: { bg: 'rgba(0,129,255,0.1)', fg: '#4db1ff', border: 'rgba(0,129,255,0.3)' },
                    capitaine: { bg: 'rgba(255,184,0,0.1)', fg: 'var(--s-gold)', border: 'rgba(255,184,0,0.3)' },
                    joueur: { bg: 'rgba(255,255,255,0.05)', fg: 'var(--s-text-dim)', border: 'var(--s-border)' },
                    remplacant: { bg: 'rgba(255,255,255,0.05)', fg: 'var(--s-text-muted)', border: 'var(--s-border)' },
                  };
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-3 group transition-all duration-150"
                      style={{ background: 'transparent' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--s-elevated)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <Link href={`/profile/${m.userId}`} className="flex items-center gap-3 flex-1 min-w-0">
                        {avatar ? (
                          <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                            <Image src={avatar} alt={m.displayName} fill className="object-cover" unoptimized />
                          </div>
                        ) : (
                          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                            <User size={12} style={{ color: 'var(--s-text-muted)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--s-text)' }}>{m.displayName}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="t-mono" style={{ fontSize: '10px', color: structuralColor }}>{primaryLabel}</p>
                            {(m.game === 'rocket_league' || m.game === 'trackmania') && (
                              <span className={`tag ${m.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                                style={{ fontSize: '10px', padding: '2px 7px' }}>
                                {m.game === 'rocket_league' ? 'RL' : 'TM'}
                              </span>
                            )}
                            {affiliationBadges.map(b => {
                              const c = badgeColors[b.key] ?? badgeColors.joueur;
                              const names = b.teamNames.join(', ');
                              return (
                                <span key={b.key} className="tag" title={names}
                                  style={{ fontSize: '10px', padding: '2px 7px', background: c.bg, color: c.fg, borderColor: c.border }}>
                                  {b.label}
                                  {b.teamNames.length > 0 && (
                                    <span style={{ opacity: 0.75, marginLeft: 4 }}>· {names}</span>
                                  )}
                                </span>
                              );
                            })}
                            {derived.primary === 'membre' && derived.affiliations.length === 0 && (
                              <span className="tag"
                                style={{ fontSize: '10px', padding: '2px 7px', background: 'rgba(255,255,255,0.04)', color: 'var(--s-text-muted)', borderColor: 'var(--s-border)' }}>
                                Sans équipe
                              </span>
                            )}
                            {isCoFounderRow && daysLeft != null && (
                              <span className="tag" style={{ fontSize: '10px', padding: '2px 7px', background: 'rgba(255,85,85,0.1)', color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                                Préavis : {daysLeft}j
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                      <MemberActionsMenu
                        canManageStaffRoles={canManageStaffRoles}
                        canManageCoFounder={isFounderOfActive && !isFounderRow}
                        canRemove={canRemove}
                        isCoach={isCoachRow}
                        isManager={isManagerRow}
                        isCoFounder={isCoFounderRow}
                        busyKey={invActionLoading}
                        memberId={m.id}
                        userId={m.userId}
                        onToggleCoach={() => handleToggleStaffRole(m.userId, m.displayName, 'coach', !isCoachRow)}
                        onToggleManager={() => handleToggleStaffRole(m.userId, m.displayName, 'manager', !isManagerRow)}
                        onPromoteCoFounder={() => handlePromoteToCoFounder(m.userId, m.displayName)}
                        onDemoteCoFounder={() => handleDemoteCoFounder(m.userId, m.displayName)}
                        onTransferOwnership={() => handleTransferOwnership(m.userId, m.displayName)}
                        onRemove={() => handleRemoveMember(m.id, m.displayName)}
                      />
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Historique d'appartenance (dirigeants/managers) ──────────────────────
  const renderHistory = () => {
    if (!isDirigeantOfActive && !isManagerOfActive) return null;
    return (
      <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-text-dim), rgba(122,122,149,0.3), transparent 70%)' }} />
        <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 100% 0%, rgba(122,122,149,0.06), transparent 70%)' }} />
        <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(122,122,149,0.08)', border: '1px solid rgba(122,122,149,0.2)' }}>
              <Clock size={13} style={{ color: 'var(--s-text-dim)' }} />
            </div>
            <span className="font-display text-sm tracking-wider">HISTORIQUE</span>
          </div>
          <span className="font-display text-lg" style={{ color: 'var(--s-text-dim)' }}>{history.length}</span>
        </div>
        <div className="relative z-[1]">
          {historyLoading ? (
            <div className="p-6 text-center">
              <Loader2 size={16} className="animate-spin mx-auto" style={{ color: 'var(--s-text-muted)' }} />
            </div>
          ) : history.length === 0 ? (
            <div className="p-6 text-center">
              <Clock size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun passage enregistré.</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
              {history.map(h => {
                const avatar = h.avatarUrl || h.discordAvatar;
                const joinLabel = h.joinedAt ? new Date(h.joinedAt).toLocaleDateString('fr-FR') : '—';
                const leftLabel = h.leftAt ? new Date(h.leftAt).toLocaleDateString('fr-FR') : null;
                const reasonMap: Record<string, string> = {
                  founder: 'Fondateur',
                  direct_invite: 'Invite directe',
                  join_request: 'Candidature',
                  invite_link: 'Lien',
                  targeted_link: 'Lien perso',
                  other: '—',
                };
                const leftReasonMap: Record<string, string> = {
                  removed: 'Retiré',
                  left: 'Parti',
                  structure_deleted: 'Structure dissoute',
                  other: '—',
                };
                return (
                  <div key={h.id} className="flex items-center gap-3 px-5 py-3 group transition-all duration-150"
                    style={{ background: 'transparent' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--s-elevated)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <Link href={`/profile/${h.userId}`} className="flex items-center gap-3 flex-1 min-w-0">
                      {avatar ? (
                        <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <Image src={avatar} alt={h.displayName} fill className="object-cover" unoptimized />
                        </div>
                      ) : (
                        <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <User size={12} style={{ color: 'var(--s-text-muted)' }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{h.displayName || h.userId}</p>
                          <span className={`tag ${h.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '2px 8px' }}>
                            {h.game === 'rocket_league' ? 'RL' : 'TM'}
                          </span>
                          {h.isOpen ? (
                            <span className="tag" style={{ fontSize: '12px', padding: '2px 8px', background: 'rgba(0,217,54,0.12)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.35)' }}>
                              Actif
                            </span>
                          ) : (
                            <span className="tag" style={{ fontSize: '12px', padding: '2px 8px', background: 'rgba(255,85,85,0.1)', color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                              {leftReasonMap[h.leftReason || 'other'] || 'Parti'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
                          {reasonMap[h.joinReason] || '—'} · {joinLabel}
                          {leftLabel && ` → ${leftLabel}`}
                          {h.durationDays != null && ` · ${h.durationDays}j`}
                        </p>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {renderUnassignedBanner()}
      {renderMembersList()}
      {renderHistory()}
    </>
  );
}
