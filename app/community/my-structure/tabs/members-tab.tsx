'use client';
import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Clock, Loader2, Search, User, UserPlus, Users } from 'lucide-react';
import MemberActionsMenu from '@/components/structure/MemberActionsMenu';
import StaffGamesScopeModal from '@/components/structure/StaffGamesScopeModal';
import { getProfileHref } from '@/lib/user-slug';
import {
  computeMemberRole, groupAffiliations, PRIMARY_ROLE_LABELS,
  type MemberRoleTeam,
} from '@/lib/member-role';
import {
  filterSortMembers, memberGroupOf, isPlaceableMember,
  type MemberGroup, type MemberSort,
} from '@/lib/member-filter';
import type { DashboardTab, MyStructure, TeamData, HistoryItem } from '../types';
import {
  DEPARTURE_NOTICE_MS, PRIMARY_ROLE_ORDER, PRIMARY_ROLE_COLORS,
} from '../constants';
import GameTag from '@/components/games/GameTag';
import { isKnownGame } from '@/lib/games-registry';

// Chips de filtre par famille de rôle (3 groupes plutôt que 9 rôles — voir lib/member-filter).
const ROLE_GROUP_CHIPS: { key: MemberGroup; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'direction', label: 'Direction' },
  { key: 'staff', label: 'Staff' },
  { key: 'joueurs', label: 'Joueurs' },
];

// Tab Membres complet, extrait de page.tsx pour réduire la taille du fichier orchestrateur.
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

  // Modal de configuration du scope par jeu pour un Responsable/Coach.
  // Ouvert depuis MemberActionsMenu via onOpenStaffGamesScope.
  const [scopeTarget, setScopeTarget] = useState<{
    userId: string;
    name: string;
    role: 'manager' | 'coach';
  } | null>(null);

  // Recherche/tri de la liste des membres (état local, éphémère). La barre
  // n'apparaît qu'au-delà d'un petit seuil (inutile sur un roster minuscule).
  const [memberSearch, setMemberSearch] = useState('');
  const [roleGroup, setRoleGroup] = useState<MemberGroup>('all');
  const [sortKey, setSortKey] = useState<MemberSort>('role');
  const MEMBERS_TOOLBAR_MIN = 8;

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
    // Le staff STRUCTUREL (fondateur, co-fondateurs, responsables, coachs
    // structure) n'a pas vocation à être « placé en équipe » → jamais dans cette
    // bannière (bug remonté : un responsable la polluait). On s'appuie sur les
    // rôles structurels, fiables, pas sur le champ `m.role` stocké.
    const structuralStaff = new Set<string>([
      s.founderId,
      ...(s.coFounderIds ?? []),
      ...(s.managerIds ?? []),
      ...(s.coachIds ?? []),
    ].filter(Boolean));
    const unassigned = s.members.filter(m =>
      isPlaceableMember(m.userId, structuralStaff, assignedUids)
    );
    if (unassigned.length === 0) return null;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recentRecruits = unassigned.filter(m => (m.joinedAt ?? 0) >= sevenDaysAgo);
    return (
      <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid rgba(255,184,0,0.35)' }}>
        <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
          <div className="flex items-center gap-3">
            <UserPlus size={14} className="flex-shrink-0" style={{ color: 'var(--s-gold)' }} />
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
                <Link href={getProfileHref({ uid: m.userId, slug: m.slug ?? undefined })} className="flex items-center gap-3 flex-1 min-w-0">
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
                      <GameTag gameId={m.game} style={{ padding: '2px 6px' }} />
                      {isRecentRecruit && (
                        <span className="tag" style={{ fontSize: '12px', padding: '2px 6px', background: 'rgba(255,184,0,0.12)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.35)' }}>
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

    // Lignes enrichies (rôle dérivé + champs de recherche), puis filtrées/triées.
    // Client-side : ~150 membres max, le payload est déjà chargé entier.
    const rows = s.members.map(m => {
      const derived = computeMemberRole({
        userId: m.userId,
        founderId: s.founderId,
        coFounderIds: s.coFounderIds ?? [],
        managerIds: s.managerIds ?? [],
        coachIds: s.coachIds ?? [],
        teams: roleTeams,
      });
      return {
        m, derived,
        displayName: m.displayName,
        discordUsername: m.discordUsername,
        joinedAt: m.joinedAt,
        primary: derived.primary,
        roleOrder: PRIMARY_ROLE_ORDER.indexOf(derived.primary),
        teamNames: derived.affiliations.map(a => a.teamName),
      };
    });
    const visible = filterSortMembers(rows, { q: memberSearch, group: roleGroup, sort: sortKey });
    const showToolbar = s.members.length > MEMBERS_TOOLBAR_MIN;
    const groupCounts = { direction: 0, staff: 0, joueurs: 0 };
    for (const r of rows) groupCounts[memberGroupOf(r.primary)]++;

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
            <>
              {showToolbar && (
                <div className="px-5 py-3 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--s-border)' }}>
                  <div className="flex-1 relative min-w-[180px]">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
                    <input type="text" value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                      placeholder="Rechercher un membre, une équipe..."
                      className="settings-input has-icon-sm w-full text-sm" />
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {ROLE_GROUP_CHIPS.map(chip => {
                      const active = roleGroup === chip.key;
                      const count = chip.key === 'all' ? rows.length : groupCounts[chip.key];
                      return (
                        <button key={chip.key} type="button" onClick={() => setRoleGroup(chip.key)}
                          className="tag transition-all duration-150"
                          style={{
                            background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                            color: active ? 'var(--s-text)' : 'var(--s-text-muted)',
                            borderColor: active ? 'rgba(255,255,255,0.2)' : 'var(--s-border)',
                            cursor: 'pointer', padding: '4px 10px', fontSize: '12px',
                          }}>
                          {chip.label} · {count}
                        </button>
                      );
                    })}
                  </div>
                  <select value={sortKey} onChange={e => setSortKey(e.target.value as MemberSort)}
                    className="settings-input text-sm" style={{ width: 'auto' }} aria-label="Trier les membres">
                    <option value="role">Trier : rôle</option>
                    <option value="name">Trier : nom (A-Z)</option>
                    <option value="recent">Trier : arrivée récente</option>
                  </select>
                </div>
              )}
              {visible.length === 0 ? (
                <div className="p-6 text-center">
                  <Search size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    Aucun membre ne correspond{memberSearch ? ` à « ${memberSearch} »` : ''}.
                  </p>
                </div>
              ) : (
              <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
                {visible.map(({ m, derived }) => {
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
                    manager: { bg: 'rgba(255,184,0,0.1)', fg: 'var(--s-gold)', border: 'rgba(255,184,0,0.3)' },
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
                      <Link href={getProfileHref({ uid: m.userId, slug: m.slug ?? undefined })} className="flex items-center gap-3 flex-1 min-w-0">
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
                            <p className="t-mono" style={{ fontSize: '12px', color: structuralColor }}>{primaryLabel}</p>
                            {isKnownGame(m.game) && (
                              <GameTag gameId={m.game} style={{ padding: '2px 7px' }} />
                            )}
                            {affiliationBadges.map(b => {
                              const c = badgeColors[b.key] ?? badgeColors.joueur;
                              const names = b.teamNames.join(', ');
                              return (
                                <span key={b.key} className="tag" title={names}
                                  style={{ fontSize: '12px', padding: '2px 7px', background: c.bg, color: c.fg, borderColor: c.border }}>
                                  {b.label}
                                  {b.teamNames.length > 0 && (
                                    <span style={{ opacity: 0.75, marginLeft: 4 }}>· {names}</span>
                                  )}
                                </span>
                              );
                            })}
                            {derived.primary === 'membre' && derived.affiliations.length === 0 && (
                              <span className="tag"
                                style={{ fontSize: '12px', padding: '2px 7px', background: 'rgba(255,255,255,0.04)', color: 'var(--s-text-muted)', borderColor: 'var(--s-border)' }}>
                                Sans équipe
                              </span>
                            )}
                            {isCoFounderRow && daysLeft != null && (
                              <span className="tag" style={{ fontSize: '12px', padding: '2px 7px', background: 'rgba(255,85,85,0.1)', color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
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
                        targetName={m.displayName}
                        onToggleCoach={() => handleToggleStaffRole(m.userId, m.displayName, 'coach', !isCoachRow)}
                        onToggleManager={() => handleToggleStaffRole(m.userId, m.displayName, 'manager', !isManagerRow)}
                        onPromoteCoFounder={() => handlePromoteToCoFounder(m.userId, m.displayName)}
                        onDemoteCoFounder={() => handleDemoteCoFounder(m.userId, m.displayName)}
                        onTransferOwnership={() => handleTransferOwnership(m.userId, m.displayName)}
                        onRemove={() => handleRemoveMember(m.id, m.displayName)}
                        onOpenStaffGamesScope={canManageStaffRoles && (isCoachRow || isManagerRow)
                          ? () => setScopeTarget({
                              userId: m.userId,
                              name: m.displayName,
                              // Priorité au rôle de plus haut niveau si user a les 2
                              role: isManagerRow ? 'manager' : 'coach',
                            })
                          : undefined}
                      />
                    </div>
                  );
                })}
              </div>
              )}
            </>
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
        <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
          <div className="flex items-center gap-3">
            <Clock size={14} className="flex-shrink-0" style={{ color: 'var(--s-text-dim)' }} />
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
                    <Link href={getProfileHref({ uid: h.userId, slug: h.slug ?? undefined })} className="flex items-center gap-3 flex-1 min-w-0">
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
                          <GameTag gameId={h.game} style={{ padding: '2px 8px' }} />
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

  // Lookup du scope actuel pour le target sélectionné (managerGames/coachGames
  // depuis la structure). Null/undefined = all-games rétrocompat.
  const currentScope: string[] | null = (() => {
    if (!scopeTarget) return null;
    const field = scopeTarget.role === 'manager' ? s.managerGames : s.coachGames;
    const scoped = field?.[scopeTarget.userId];
    return Array.isArray(scoped) ? scoped : null;
  })();

  return (
    <>
      {renderUnassignedBanner()}
      {renderMembersList()}
      {renderHistory()}
      {scopeTarget && (
        <StaffGamesScopeModal
          open
          onClose={() => setScopeTarget(null)}
          structureId={s.id}
          targetUserId={scopeTarget.userId}
          targetName={scopeTarget.name}
          role={scopeTarget.role}
          structureGames={s.games ?? []}
          currentScope={currentScope}
          onSaved={() => {
            // Le parent (page my-structure) refetch via React Query
            // grâce à l'invalidation côté API (mutations utilisent invalidateQueries).
            // Ici on ferme juste le modal, le state de la struct sera refresh
            // via la query au prochain tick.
            setScopeTarget(null);
          }}
        />
      )}
    </>
  );
}
