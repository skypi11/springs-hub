'use client';
import React from 'react';
import {
  AlertCircle, Archive, ArchiveRestore, ChevronDown, ChevronUp, Crown, Eye,
  Gamepad2, GripVertical, ImageIcon, Loader2, MessageSquare, MoreVertical,
  Plus, Save, Search, Tag, Trash2,
} from 'lucide-react';
import {
  DndContext, closestCenter, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Portal from '@/components/ui/Portal';
import type { TeamData, MyStructure, DiscordChannel } from '../types';
import { SectionPanel, RosterSlot, StaffRosterSlot } from '../components';
import { SortableTeam, SortableGroup } from '../teams-dnd';

// Tab Équipes complet — extrait de page.tsx pour réduire la taille du fichier orchestrateur.
// Chaque dépendance (état, handler, computed) est passée en prop pour rester React-friendly.
// Le tab gère :
//  - création / archivage / suppression d'équipes
//  - rosters (titulaires, remplaçants, staff) avec verrous "1 joueur = 1 équipe par jeu"
//  - capitaine (picker dropdown)
//  - menu kebab par équipe (logo, label, discord, archive, suppression)
//  - dashboard santé (no captain, no staff, RL incomplet) — dirigeant only
//  - groupement par label avec collapse + pagination + D&D inter/intra-groupes
export interface TeamsTabProps {
  s: MyStructure;
  activeStructure: MyStructure | null;
  teams: TeamData[];
  teamsLoading: boolean;

  teamSearch: string;
  setTeamSearch: (v: string) => void;
  showNewTeam: boolean;
  setShowNewTeam: React.Dispatch<React.SetStateAction<boolean>>;
  newTeamName: string;
  setNewTeamName: (v: string) => void;
  newTeamGame: string;
  setNewTeamGame: (v: string) => void;
  newTeamLabel: string;
  setNewTeamLabel: (v: string) => void;
  newTeamLogoUrl: string;
  setNewTeamLogoUrl: (v: string) => void;
  showArchived: boolean;
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>;

  teamMenuOpen: string | null;
  setTeamMenuOpen: (v: string | null) => void;
  teamMenuRect: { top: number; right: number } | null;
  setTeamMenuRect: (v: { top: number; right: number } | null) => void;
  captainPickerOpen: string | null;
  setCaptainPickerOpen: (v: string | null) => void;
  teamLogoEdit: { teamId: string; value: string } | null;
  setTeamLogoEdit: (v: { teamId: string; value: string } | null) => void;
  teamLabelEdit: { teamId: string; value: string } | null;
  setTeamLabelEdit: (v: { teamId: string; value: string } | null) => void;
  teamDiscordEdit: string | null;
  setTeamDiscordEdit: (v: string | null) => void;
  teamActionLoading: string | null;
  expandedTeamGroups: Set<string>;
  setExpandedTeamGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  collapsedTeamGroups: Set<string>;
  setCollapsedTeamGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  healthOpen: boolean | null;
  setHealthOpen: (v: boolean) => void;

  collapsed: Record<string, boolean>;
  toggle: (key: string) => void;

  discordChannels: DiscordChannel[] | null;
  discordChannelsLoading: boolean;
  discordChannelsError: string | null;
  loadDiscordChannels: (force?: boolean) => void;

  isDirigeantOfActive: boolean;
  isFounderOfActive: boolean;
  canReorderTeams: boolean;
  teamScopeActive: boolean;
  isTeamInScope: (t: TeamData) => boolean;

  handleCreateTeam: () => void;
  handleArchiveTeam: (teamId: string, archive: boolean) => void;
  handleSetCaptain: (teamId: string, captainId: string | null) => void;
  handleUpdateTeamLogo: (teamId: string, rawLogoUrl: string) => void;
  handleUpdateTeamLabel: (teamId: string, rawLabel: string) => void;
  handleUpdateTeamRoster: (teamId: string, field: 'playerIds' | 'subIds' | 'staffIds', ids: string[]) => void;
  handleUpdateTeamStaff: (teamId: string, staffIds: string[], staffRoles: Record<string, 'coach' | 'manager'>) => void;
  handleDeleteTeam: (teamId: string, teamName: string) => void;
  handleUpdateTeamDiscordChannel: (teamId: string, channelId: string | null, channelName: string | null) => void;
  reorderTeamsInGroup: (groupKey: string, fromTeamId: string, toTeamId: string) => void;
  reorderGroups: (fromGroupKey: string, toGroupKey: string) => void;
  moveTeamToGroup: (teamId: string, targetGroupKey: string, beforeTeamId: string | null) => void;

  dndSensors: ReturnType<typeof useSensors>;
}

export function TeamsTab(props: TeamsTabProps) {
  const {
    s, activeStructure, teams, teamsLoading,
    teamSearch, setTeamSearch, showNewTeam, setShowNewTeam,
    newTeamName, setNewTeamName, newTeamGame, setNewTeamGame,
    newTeamLabel, setNewTeamLabel, newTeamLogoUrl, setNewTeamLogoUrl,
    showArchived, setShowArchived,
    teamMenuOpen, setTeamMenuOpen, teamMenuRect, setTeamMenuRect,
    captainPickerOpen, setCaptainPickerOpen,
    teamLogoEdit, setTeamLogoEdit, teamLabelEdit, setTeamLabelEdit,
    teamDiscordEdit, setTeamDiscordEdit, teamActionLoading,
    expandedTeamGroups, setExpandedTeamGroups,
    collapsedTeamGroups, setCollapsedTeamGroups,
    healthOpen, setHealthOpen, collapsed, toggle,
    discordChannels, discordChannelsLoading, discordChannelsError, loadDiscordChannels,
    isDirigeantOfActive, isFounderOfActive, canReorderTeams,
    teamScopeActive, isTeamInScope,
    handleCreateTeam, handleArchiveTeam, handleSetCaptain,
    handleUpdateTeamLogo, handleUpdateTeamLabel,
    handleUpdateTeamRoster, handleUpdateTeamStaff,
    handleDeleteTeam, handleUpdateTeamDiscordChannel,
    reorderTeamsInGroup, reorderGroups, moveTeamToGroup, dndSensors,
  } = props;

  // Filtrage par recherche (nom équipe / label / pseudo joueur)
  const q = teamSearch.trim().toLowerCase();
  const matchTeam = (t: TeamData) => {
    if (!q) return true;
    if (t.name?.toLowerCase().includes(q)) return true;
    if ((t.label ?? '').toLowerCase().includes(q)) return true;
    const allMembers = [...t.players, ...t.subs, ...t.staff];
    return allMembers.some(m => (m.displayName ?? '').toLowerCase().includes(q));
  };
  const activeTeams = teams.filter(t => (t.status ?? 'active') === 'active' && matchTeam(t) && isTeamInScope(t));
  const archivedTeams = teams.filter(t => t.status === 'archived' && matchTeam(t) && isTeamInScope(t));
  const archivedCount = teams.filter(t => t.status === 'archived' && isTeamInScope(t)).length;

  // Grouper par label (label vide = "Sans label")
  type Group = { label: string; displayLabel: string; groupOrder: number; teams: TeamData[] };
  const groupsMap = new Map<string, Group>();
  for (const t of activeTeams) {
    const label = (t.label ?? '').trim();
    const key = label || '__nolabel__';
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        label,
        displayLabel: label || 'Sans label',
        groupOrder: typeof t.groupOrder === 'number' ? t.groupOrder : 0,
        teams: [],
      });
    } else {
      const g = groupsMap.get(key)!;
      if (typeof t.groupOrder === 'number' && t.groupOrder < g.groupOrder) g.groupOrder = t.groupOrder;
    }
    groupsMap.get(key)!.teams.push(t);
  }
  const groups = Array.from(groupsMap.values())
    .sort((a, b) => a.groupOrder - b.groupOrder || a.displayLabel.localeCompare(b.displayLabel));
  for (const g of groups) {
    g.teams.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  }

  const renderTeamCard = (team: TeamData, isArchived: boolean) => {
    const gameColor = team.game === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)';
    const assignedIds = [...team.players.map(p => p.uid), ...team.subs.map(p => p.uid), ...team.staff.map(p => p.uid)];
    const rosterLockedIds = new Set<string>();
    for (const t of teams) {
      if (t.id === team.id) continue;
      if ((t.status ?? 'active') !== 'active') continue;
      if (t.game !== team.game) continue;
      for (const p of t.players) rosterLockedIds.add(p.uid);
      for (const p of t.subs) rosterLockedIds.add(p.uid);
    }
    const availableForRoster = s.members.filter(m =>
      m.game === team.game && !assignedIds.includes(m.userId) && !rosterLockedIds.has(m.userId)
    );
    const availableForStaff = s.members.filter(m =>
      m.game === team.game && !assignedIds.includes(m.userId)
    );
    const isRL = team.game === 'rocket_league';
    const canAddPlayer = !isRL || team.players.length < 3;
    const canAddSub = !isRL || team.subs.length < 2;
    const captainId = team.captainId ?? null;
    const canManageTeam = isDirigeantOfActive;
    const canDeleteTeam = isFounderOfActive;
    const menuOpen = teamMenuOpen === team.id;

    return (
      <div key={team.id} id={`team-${team.id}`} className="relative"
        style={{
          background: 'var(--s-elevated)',
          border: '1px solid var(--s-border)',
          opacity: isArchived ? 0.65 : 1,
        }}>
        <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${gameColor}, transparent 60%)` }} />
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className={`tag ${team.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '9px', padding: '2px 7px' }}>
                {team.game === 'rocket_league' ? 'RL' : 'TM'}
              </span>
              {team.logoUrl ? (
                <span className="relative w-6 h-6 flex-shrink-0 bevel-sm overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={team.logoUrl} alt="" className="w-full h-full object-contain" />
                </span>
              ) : null}
              <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>{team.name}</span>
              {isArchived && (
                <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '2px 7px' }}>ARCHIVÉE</span>
              )}
              {team.discordChannelId && team.discordChannelName && !isArchived && (
                <span
                  className="inline-flex items-center gap-1 tag bevel-sm cursor-pointer"
                  style={{
                    fontSize: '10px',
                    padding: '2px 7px',
                    background: 'rgba(88,101,242,0.12)',
                    border: '1px solid rgba(88,101,242,0.35)',
                    color: '#a5b0ff',
                  }}
                  title={`Salon Discord : #${team.discordChannelName}`}
                  onClick={canManageTeam ? () => { setTeamDiscordEdit(team.id); loadDiscordChannels(); } : undefined}>
                  <MessageSquare size={9} />
                  <span className="normal-case" style={{ letterSpacing: 0 }}>#{team.discordChannelName}</span>
                </span>
              )}
              {(() => {
                const cap = captainId ? team.players.find(p => p.uid === captainId) : null;
                const canPick = canManageTeam && !isArchived && team.players.length > 0;
                const pickerOpen = captainPickerOpen === team.id;
                const busyCaptain = teamActionLoading === `${team.id}_captain`;

                if (!canPick) {
                  return cap && !isArchived ? (
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--s-gold)' }}>
                      <Crown size={11} />
                      <span className="font-semibold">{cap.displayName}</span>
                    </span>
                  ) : null;
                }

                return (
                  <div className="relative inline-flex">
                    <button
                      type="button"
                      onClick={() => setCaptainPickerOpen(pickerOpen ? null : team.id)}
                      disabled={busyCaptain}
                      title={cap ? 'Changer le capitaine' : 'Désigner un capitaine'}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs transition-colors duration-150 disabled:opacity-50"
                      style={{
                        color: cap ? 'var(--s-gold)' : 'var(--s-text-muted)',
                        border: `1px solid ${cap ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                        background: pickerOpen ? 'var(--s-hover)' : 'transparent',
                      }}
                    >
                      <Crown size={11} />
                      <span className="font-semibold">
                        {cap ? cap.displayName : 'Désigner capitaine'}
                      </span>
                    </button>
                    {pickerOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setCaptainPickerOpen(null)} />
                        <div
                          className="absolute left-0 top-full mt-1 z-20 min-w-[200px] py-1 bevel-sm"
                          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                        >
                          <div className="px-3 py-1.5 t-label" style={{ color: 'var(--s-text-muted)' }}>Capitaine</div>
                          <div className="space-y-0.5">
                            {team.players.map(p => (
                              <button
                                key={p.uid}
                                type="button"
                                onClick={() => {
                                  handleSetCaptain(team.id, captainId === p.uid ? null : p.uid);
                                  setCaptainPickerOpen(null);
                                }}
                                disabled={busyCaptain}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left hover:bg-[var(--s-hover)] disabled:opacity-50"
                              >
                                <Crown size={11} style={{ color: captainId === p.uid ? 'var(--s-gold)' : 'var(--s-text-muted)' }} />
                                <span style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
                                {captainId === p.uid && (
                                  <span className="ml-auto text-xs" style={{ color: 'var(--s-gold)' }}>actuel</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
            {canManageTeam && (
              <div className="relative">
                <button type="button"
                  onClick={(e) => {
                    if (menuOpen) {
                      setTeamMenuOpen(null);
                      setTeamMenuRect(null);
                    } else {
                      const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                      setTeamMenuRect({ top: r.bottom + 4, right: window.innerWidth - r.right });
                      setTeamMenuOpen(team.id);
                    }
                  }}
                  className="p-1.5 transition-opacity duration-150"
                  style={{ color: 'var(--s-text-dim)', opacity: 0.7 }}
                  aria-label="Menu de l'équipe">
                  <MoreVertical size={14} />
                </button>
                {menuOpen && teamMenuRect && (
                  <Portal>
                    <div className="fixed inset-0 z-[60]" onClick={() => { setTeamMenuOpen(null); setTeamMenuRect(null); }} />
                    <div className="fixed z-[61] min-w-[220px] py-1 bevel-sm animate-fade-in"
                      style={{
                        top: teamMenuRect.top,
                        right: teamMenuRect.right,
                        background: 'var(--s-surface)',
                        border: '1px solid var(--s-border)',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                      }}>
                      {!isArchived && (
                        <button type="button"
                          onClick={() => { setTeamMenuOpen(null); setTeamMenuRect(null); setTeamLogoEdit({ teamId: team.id, value: team.logoUrl ?? '' }); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                          style={{ color: 'var(--s-text)' }}>
                          <ImageIcon size={12} />
                          <span>{team.logoUrl ? 'Modifier le logo' : 'Ajouter un logo'}</span>
                        </button>
                      )}
                      {!isArchived && (
                        <button type="button"
                          onClick={() => { setTeamMenuOpen(null); setTeamMenuRect(null); setTeamLabelEdit({ teamId: team.id, value: team.label ?? '' }); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                          style={{ color: 'var(--s-text)' }}>
                          <Tag size={12} />
                          <span>Modifier le label</span>
                        </button>
                      )}
                      {!isArchived && (
                        <button type="button"
                          onClick={() => {
                            setTeamMenuOpen(null);
                            setTeamDiscordEdit(team.id);
                            loadDiscordChannels();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                          style={{ color: 'var(--s-text)' }}>
                          <MessageSquare size={12} />
                          <span>{team.discordChannelId ? 'Modifier le salon Discord' : 'Configurer le salon Discord'}</span>
                        </button>
                      )}
                      {!isArchived ? (
                        <button type="button"
                          onClick={() => handleArchiveTeam(team.id, true)}
                          disabled={teamActionLoading === team.id}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                          style={{ color: 'var(--s-text)' }}>
                          <Archive size={12} />
                          <span>Archiver l&apos;équipe</span>
                        </button>
                      ) : (
                        <button type="button"
                          onClick={() => handleArchiveTeam(team.id, false)}
                          disabled={teamActionLoading === team.id}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                          style={{ color: 'var(--s-text)' }}>
                          <ArchiveRestore size={12} />
                          <span>Désarchiver</span>
                        </button>
                      )}
                      {canDeleteTeam && (
                        <button type="button"
                          onClick={() => { setTeamMenuOpen(null); setTeamMenuRect(null); handleDeleteTeam(team.id, team.name); }}
                          disabled={teamActionLoading === team.id}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left border-t"
                          style={{ color: '#ff5555', borderColor: 'var(--s-border)' }}>
                          <Trash2 size={12} />
                          <span>Supprimer définitivement</span>
                        </button>
                      )}
                    </div>
                  </Portal>
                )}
              </div>
            )}
          </div>

          {teamDiscordEdit === team.id && (
            <div className="p-3 bevel-sm space-y-2" style={{ background: 'var(--s-surface)', border: '1px solid rgba(88,101,242,0.25)' }}>
              <div className="flex items-center gap-2">
                <MessageSquare size={14} style={{ color: '#5865F2' }} />
                <span className="t-label">Salon Discord de l&apos;équipe</span>
              </div>
              {!activeStructure?.discordIntegration ? (
                <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  Connecte d&apos;abord le bot Discord depuis l&apos;onglet <strong>Général → Bot Discord</strong>.
                </p>
              ) : discordChannelsLoading ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  <Loader2 size={12} className="animate-spin" />
                  <span>Chargement des salons…</span>
                </div>
              ) : discordChannelsError ? (
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: '#ff5555' }}>{discordChannelsError}</p>
                  <button type="button"
                    onClick={() => loadDiscordChannels(true)}
                    className="btn-springs btn-ghost bevel-sm text-xs">
                    Réessayer
                  </button>
                </div>
              ) : (
                <>
                  <select
                    className="settings-input w-full text-sm"
                    value={team.discordChannelId ?? ''}
                    disabled={teamActionLoading === `${team.id}_discord`}
                    onChange={e => {
                      const id = e.target.value || null;
                      if (!id) {
                        handleUpdateTeamDiscordChannel(team.id, null, null);
                      } else {
                        const ch = (discordChannels ?? []).find(c => c.id === id);
                        handleUpdateTeamDiscordChannel(team.id, id, ch?.name ?? null);
                      }
                    }}>
                    <option value="">— Aucun salon —</option>
                    {(() => {
                      const channelGroups = new Map<string, DiscordChannel[]>();
                      for (const c of (discordChannels ?? [])) {
                        const key = c.parentName ?? '';
                        if (!channelGroups.has(key)) channelGroups.set(key, []);
                        channelGroups.get(key)!.push(c);
                      }
                      const nodes: React.ReactNode[] = [];
                      for (const [groupName, list] of channelGroups) {
                        if (groupName) {
                          nodes.push(
                            <optgroup key={`g_${groupName}`} label={groupName.toUpperCase()}>
                              {list.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                            </optgroup>
                          );
                        } else {
                          for (const c of list) {
                            nodes.push(<option key={c.id} value={c.id}>#{c.name}</option>);
                          }
                        }
                      }
                      return nodes;
                    })()}
                  </select>
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    Le bot doit avoir accès à ce salon. Les événements de cette équipe y seront postés automatiquement.
                  </p>
                </>
              )}
              <div className="flex items-center justify-end">
                <button type="button"
                  onClick={() => setTeamDiscordEdit(null)}
                  className="btn-springs btn-ghost bevel-sm text-xs">
                  Fermer
                </button>
              </div>
            </div>
          )}

          {teamLabelEdit?.teamId === team.id && (
            <div className="p-3 bevel-sm space-y-2" style={{ background: 'var(--s-surface)', border: '1px solid rgba(255,184,0,0.25)' }}>
              <div className="flex items-center gap-2">
                <Tag size={13} style={{ color: 'var(--s-gold)' }} />
                <span className="t-label">Label de l&apos;équipe (groupe)</span>
              </div>
              <input type="text" className="settings-input w-full text-sm" placeholder="Ex: Équipes principales"
                value={teamLabelEdit.value}
                onChange={e => setTeamLabelEdit({ teamId: team.id, value: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleUpdateTeamLabel(team.id, teamLabelEdit.value); }
                  if (e.key === 'Escape') { e.preventDefault(); setTeamLabelEdit(null); }
                }} />
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                Regroupe plusieurs équipes sous un même titre dans l&apos;onglet Équipes.
              </p>
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={() => handleUpdateTeamLabel(team.id, teamLabelEdit.value)}
                  disabled={teamActionLoading === `${team.id}_label` || !teamLabelEdit.value.trim() || teamLabelEdit.value.trim() === (team.label ?? '').trim()}
                  className="btn-springs btn-primary bevel-sm flex items-center gap-1.5 text-xs">
                  {teamActionLoading === `${team.id}_label` ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  <span>Enregistrer</span>
                </button>
                <button type="button"
                  onClick={() => setTeamLabelEdit(null)}
                  className="btn-springs btn-ghost bevel-sm text-xs">
                  Annuler
                </button>
              </div>
            </div>
          )}

          {teamLogoEdit?.teamId === team.id && (
            <div className="p-3 bevel-sm space-y-2" style={{ background: 'var(--s-surface)', border: '1px solid rgba(0,129,255,0.25)' }}>
              <label className="t-label block">Logo de l&apos;équipe (URL)</label>
              <div className="flex items-center gap-2">
                {teamLogoEdit.value.trim() ? (
                  <span className="relative w-10 h-10 flex-shrink-0 bevel-sm overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={teamLogoEdit.value} alt="" className="w-full h-full object-contain" />
                  </span>
                ) : null}
                <input type="url" className="settings-input flex-1 text-sm" placeholder="https://..."
                  value={teamLogoEdit.value}
                  onChange={e => setTeamLogoEdit({ teamId: team.id, value: e.target.value })} />
              </div>
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                Lien direct vers une image (PNG/JPG). Laisser vide pour retirer le logo.
              </p>
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={() => handleUpdateTeamLogo(team.id, teamLogoEdit.value)}
                  disabled={teamActionLoading === `${team.id}_logo`}
                  className="btn-springs btn-primary bevel-sm flex items-center gap-1.5 text-xs">
                  {teamActionLoading === `${team.id}_logo` ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  <span>Enregistrer</span>
                </button>
                <button type="button"
                  onClick={() => setTeamLogoEdit(null)}
                  className="btn-springs btn-ghost bevel-sm text-xs">
                  Annuler
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <RosterSlot
              label={`TITULAIRES${isRL ? ' (max 3)' : ''}`}
              labelColor={gameColor}
              members={team.players}
              available={availableForRoster}
              canAdd={canAddPlayer && !isArchived}
              loading={teamActionLoading === `${team.id}_playerIds`}
              captainId={captainId}
              onAdd={(uid) => handleUpdateTeamRoster(team.id, 'playerIds', [...team.players.map(p => p.uid), uid])}
              onRemove={(uid) => handleUpdateTeamRoster(team.id, 'playerIds', team.players.filter(p => p.uid !== uid).map(p => p.uid))}
            />
            <RosterSlot
              label={`REMPLAÇANTS${isRL ? ' (max 2)' : ''}`}
              labelColor="var(--s-text-dim)"
              members={team.subs}
              available={availableForRoster}
              canAdd={canAddSub && !isArchived}
              loading={teamActionLoading === `${team.id}_subIds`}
              onAdd={(uid) => handleUpdateTeamRoster(team.id, 'subIds', [...team.subs.map(p => p.uid), uid])}
              onRemove={(uid) => handleUpdateTeamRoster(team.id, 'subIds', team.subs.filter(p => p.uid !== uid).map(p => p.uid))}
            />
            <StaffRosterSlot
              label="STAFF"
              labelColor="var(--s-gold)"
              members={team.staff}
              staffRoles={team.staffRoles ?? {}}
              available={availableForStaff}
              canAdd={!isArchived}
              loading={teamActionLoading === `${team.id}_staffIds`}
              onAdd={(uid, role) => {
                const newStaffIds = [...team.staff.map(p => p.uid), uid];
                const newRoles = { ...(team.staffRoles ?? {}), [uid]: role };
                handleUpdateTeamStaff(team.id, newStaffIds, newRoles);
              }}
              onRemove={(uid) => {
                const newStaffIds = team.staff.filter(p => p.uid !== uid).map(p => p.uid);
                const nextRoles = { ...(team.staffRoles ?? {}) };
                delete nextRoles[uid];
                handleUpdateTeamStaff(team.id, newStaffIds, nextRoles);
              }}
              onChangeRole={(uid, role) => {
                const newRoles = { ...(team.staffRoles ?? {}), [uid]: role };
                handleUpdateTeamStaff(team.id, team.staff.map(p => p.uid), newRoles);
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  const emptyQueryMatches = !teamsLoading && activeTeams.length === 0 && archivedTeams.length === 0;
  const noActiveAtAll = !teamsLoading && teams.filter(t => (t.status ?? 'active') === 'active').length === 0;

  return (
    <SectionPanel accent="var(--s-blue)" icon={Gamepad2} title={`ÉQUIPES${teams.length > 0 ? ` · ${teams.filter(t => (t.status ?? 'active') === 'active' && isTeamInScope(t)).length}` : ''}`}
      collapsed={collapsed.teams} onToggle={() => toggle('teams')}
      action={isDirigeantOfActive ? (
        <button type="button" onClick={() => setShowNewTeam(prev => !prev)}
          className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150" style={{ color: 'var(--s-blue)' }}>
          {showNewTeam ? <ChevronUp size={11} /> : <Plus size={11} />}
          {showNewTeam ? 'Annuler' : 'Nouvelle équipe'}
        </button>
      ) : null}>

      {teamScopeActive && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bevel-sm" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}>
          <Eye size={12} style={{ color: 'var(--s-gold)', flexShrink: 0 }} />
          <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
            Vue limitée aux équipes où tu es <span style={{ color: 'var(--s-gold)' }}>staff</span> ou <span style={{ color: 'var(--s-gold)' }}>capitaine</span>.
          </span>
        </div>
      )}

      {/* Dashboard santé équipes — dirigeant only */}
      {isDirigeantOfActive && !teamsLoading && (() => {
        const activeAll = teams.filter(t => (t.status ?? 'active') === 'active');
        if (activeAll.length === 0) return null;
        const noCaptain = activeAll.filter(t => !t.captainId);
        const noStaff = activeAll.filter(t => t.staff.length === 0);
        const rlIncomplete = activeAll.filter(t => t.game === 'rocket_league' && t.players.length < 3);
        const totalFlagged = noCaptain.length + noStaff.length + rlIncomplete.length;
        if (totalFlagged === 0) return null;
        const defaultOpen = totalFlagged <= 5;
        const isOpen = healthOpen ?? defaultOpen;
        const flagRow = (
          label: string,
          list: TeamData[],
          color: string,
        ) => list.length === 0 ? null : (
          <div key={label} className="flex items-start gap-2 py-1.5">
            <AlertCircle size={12} style={{ color, flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--s-text)' }}>
                {label} <span className="font-normal" style={{ color: 'var(--s-text-muted)' }}>· {list.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {list.map(t => (
                  <button key={t.id} type="button"
                    onClick={() => { if (t.id) document.getElementById(`team-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                    className="text-xs px-1.5 py-0.5 transition-colors duration-150"
                    style={{ background: 'var(--s-elevated)', border: `1px solid ${color}40`, color: 'var(--s-text-dim)' }}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
        return (
          <div className="mb-4 p-3 bevel-sm relative overflow-hidden"
            style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.25)' }}>
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 70%)' }} />
            <button type="button" onClick={() => setHealthOpen(!isOpen)}
              className="w-full flex items-center gap-2 transition-colors duration-150"
              style={{ cursor: 'pointer' }}>
              <AlertCircle size={13} style={{ color: 'var(--s-gold)' }} />
              <span className="t-label" style={{ color: 'var(--s-gold)' }}>Santé des équipes</span>
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                · {totalFlagged} point{totalFlagged > 1 ? 's' : ''} d&apos;attention
              </span>
              <div className="flex-1" />
              {isOpen ? <ChevronUp size={12} style={{ color: 'var(--s-text-dim)' }} /> : <ChevronDown size={12} style={{ color: 'var(--s-text-dim)' }} />}
            </button>
            {isOpen && (
              <div className="mt-2 divide-y" style={{ borderColor: 'var(--s-border)' }}>
                {flagRow('Sans capitaine', noCaptain, '#ffb800')}
                {flagRow('Sans staff (manager/coach)', noStaff, '#7a7a95')}
                {flagRow('Roster RL incomplet (<3 titulaires)', rlIncomplete, '#0081ff')}
              </div>
            )}
          </div>
        );
      })()}

      {/* Toolbar : recherche */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
          <input type="text" value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
            placeholder="Rechercher une équipe, un label, un joueur..."
            className="settings-input w-full pl-7 text-sm" />
        </div>
      </div>

      {/* Formulaire nouvelle équipe */}
      {showNewTeam && isDirigeantOfActive && (
        <div className="p-4 mb-4 space-y-3" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(0,129,255,0.2)' }}>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="t-label block mb-1.5">Nom de l&apos;équipe *</label>
              <input type="text" className="settings-input w-full" placeholder="Équipe principale"
                value={newTeamName} onChange={e => setNewTeamName(e.target.value)} />
            </div>
            <div>
              <label className="t-label block mb-1.5">Label de niveau *</label>
              <input type="text" className="settings-input w-full" placeholder="Elite, Academy, Amateur..."
                value={newTeamLabel} onChange={e => setNewTeamLabel(e.target.value)}
                list="team-labels-datalist" />
              <datalist id="team-labels-datalist">
                {Array.from(new Set(teams.map(t => (t.label ?? '').trim()).filter(Boolean))).map(l => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="t-label block mb-1.5">Jeu *</label>
              <select className="settings-input w-full" value={newTeamGame}
                onChange={e => setNewTeamGame(e.target.value)}>
                <option value="">Choisir...</option>
                {s.games?.includes('rocket_league') && <option value="rocket_league">Rocket League</option>}
                {s.games?.includes('trackmania') && <option value="trackmania">Trackmania</option>}
              </select>
            </div>
          </div>
          <div>
            <label className="t-label block mb-1.5">Logo de l&apos;équipe (URL, optionnel)</label>
            <input type="url" className="settings-input w-full text-sm" placeholder="https://..."
              value={newTeamLogoUrl} onChange={e => setNewTeamLogoUrl(e.target.value)} />
            <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
              Lien direct vers une image (PNG/JPG). Si vide, une icône générique est utilisée.
            </p>
          </div>
          <button type="button" onClick={handleCreateTeam}
            disabled={!newTeamName.trim() || !newTeamLabel.trim() || !newTeamGame || teamActionLoading === 'create'}
            className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
            style={{ opacity: (!newTeamName.trim() || !newTeamLabel.trim() || !newTeamGame) ? 0.5 : 1 }}>
            {teamActionLoading === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            <span>Créer</span>
          </button>
        </div>
      )}

      {teamsLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
        </div>
      ) : noActiveAtAll && archivedCount === 0 ? (
        <div className="text-center py-6">
          <Gamepad2 size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe créée.</p>
        </div>
      ) : emptyQueryMatches ? (
        <div className="text-center py-6">
          <Search size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun résultat pour « {teamSearch} ».</p>
        </div>
      ) : (() => {
        // Lot 2b D&D — un SEUL DndContext top-level pour gérer 3 cas via onDragEnd.
        const TEAM_GROUP_CAP = 12;
        const sortableIds: string[] = [];
        for (const g of groups) {
          const gKey = g.label || '__nolabel__';
          sortableIds.push(`group:${gKey}`);
          if (collapsedTeamGroups.has(gKey)) continue;
          const isExp = expandedTeamGroups.has(gKey);
          const needsPag = g.teams.length > TEAM_GROUP_CAP;
          const shown = needsPag && !isExp ? g.teams.slice(0, TEAM_GROUP_CAP) : g.teams;
          for (const t of shown) sortableIds.push(`team:${t.id}`);
        }
        const groupsDraggable = canReorderTeams && groups.length > 1;
        const handleDragEnd = (event: DragEndEvent) => {
          const { active, over } = event;
          if (!over || active.id === over.id) return;
          const a = String(active.id);
          const o = String(over.id);
          if (a.startsWith('group:') && o.startsWith('group:')) {
            reorderGroups(a.slice(6), o.slice(6));
            return;
          }
          if (a.startsWith('team:') && o.startsWith('team:')) {
            const fromTeamId = a.slice(5);
            const toTeamId = o.slice(5);
            const fromTeam = teams.find(t => t.id === fromTeamId);
            const toTeam = teams.find(t => t.id === toTeamId);
            if (!fromTeam || !toTeam) return;
            const fromGroup = (fromTeam.label || '').trim() || '__nolabel__';
            const toGroup = (toTeam.label || '').trim() || '__nolabel__';
            if (fromGroup === toGroup) {
              reorderTeamsInGroup(fromGroup, fromTeamId, toTeamId);
            } else {
              moveTeamToGroup(fromTeamId, toGroup, toTeamId);
            }
            return;
          }
          if (a.startsWith('team:') && o.startsWith('group:')) {
            moveTeamToGroup(a.slice(5), o.slice(6), null);
            return;
          }
        };
        return (
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-8">
                {groups.map(g => {
                  const groupKey = g.label || '__nolabel__';
                  const expanded = expandedTeamGroups.has(groupKey);
                  const groupCollapsed = collapsedTeamGroups.has(groupKey);
                  const needsPagination = g.teams.length > TEAM_GROUP_CAP;
                  const shownTeams = needsPagination && !expanded ? g.teams.slice(0, TEAM_GROUP_CAP) : g.teams;
                  const hiddenCount = g.teams.length - shownTeams.length;
                  const teamsDndEnabled = canReorderTeams && (!needsPagination || expanded);
                  const toggleCollapsed = () => {
                    setCollapsedTeamGroups(prev => {
                      const next = new Set(prev);
                      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
                      if (activeStructure?.id) {
                        try {
                          localStorage.setItem(
                            `my-structure:teamGroupsCollapsed:${activeStructure.id}`,
                            JSON.stringify(Array.from(next)),
                          );
                        } catch { /* localStorage indispo (Safari privé), tant pis */ }
                      }
                      return next;
                    });
                  };
                  return (
                    <SortableGroup key={groupKey} id={`group:${groupKey}`} draggable={groupsDraggable}>
                      {({ attributes, listeners, setActivatorNodeRef }) => (
                        <div className="space-y-3">
                          <div className="w-full flex items-center gap-2" style={{ paddingTop: 4, paddingBottom: 6 }}>
                            {groupsDraggable && (
                              <button
                                type="button"
                                ref={setActivatorNodeRef}
                                {...attributes}
                                {...listeners}
                                aria-label="Réorganiser le groupe"
                                className="flex-shrink-0 p-1 cursor-grab active:cursor-grabbing transition-opacity duration-150 hover:opacity-100"
                                style={{ color: 'var(--s-text-muted)', opacity: 0.45 }}
                                onClick={e => e.stopPropagation()}
                              >
                                <GripVertical size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={toggleCollapsed}
                              className="flex-1 flex items-center gap-3 text-left group/grouphdr"
                            >
                              <div className="w-1 self-stretch flex-shrink-0" style={{ background: 'var(--s-gold)', minHeight: 24 }} />
                              <Tag size={14} style={{ color: 'var(--s-gold)' }} className="flex-shrink-0" />
                              <h3 className="font-display tracking-wider flex-shrink-0" style={{ color: 'var(--s-gold)', fontSize: 19, lineHeight: 1.1 }}>
                                {g.displayLabel.toUpperCase()}
                              </h3>
                              <span className="text-xs flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>
                                · {g.teams.length} équipe{g.teams.length > 1 ? 's' : ''}
                              </span>
                              <div className="flex-1 h-px" style={{ background: 'var(--s-border)' }} />
                              <div className="flex-shrink-0 transition-transform duration-150" style={{ color: 'var(--s-text-dim)' }}>
                                {groupCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                              </div>
                            </button>
                          </div>
                          {!groupCollapsed && (
                            <>
                              <div className="space-y-3">
                                {shownTeams.map(t => (
                                  <SortableTeam key={t.id} id={`team:${t.id}`} draggable={teamsDndEnabled}>
                                    {renderTeamCard(t, false)}
                                  </SortableTeam>
                                ))}
                              </div>
                              {needsPagination && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedTeamGroups(prev => {
                                    const next = new Set(prev);
                                    if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
                                    return next;
                                  })}
                                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide transition-colors"
                                  style={{ color: 'var(--s-text-dim)' }}
                                >
                                  {expanded ? (
                                    <>
                                      <ChevronUp size={11} />
                                      <span>Réduire</span>
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown size={11} />
                                      <span>Afficher les {hiddenCount} équipe{hiddenCount > 1 ? 's' : ''} suivante{hiddenCount > 1 ? 's' : ''}</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </SortableGroup>
                  );
                })}

                {/* Section archivées (collapse) */}
                {archivedCount > 0 && (
                  <div className="pt-2">
                    <button type="button" onClick={() => setShowArchived(prev => !prev)}
                      className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide transition-colors"
                      style={{ color: 'var(--s-text-dim)' }}>
                      <Archive size={12} />
                      <span>Archivées · {archivedCount}</span>
                      {showArchived ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                    {showArchived && (
                      <div className="mt-3 space-y-3">
                        {archivedTeams.length === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune archive ne correspond à la recherche.</p>
                        ) : archivedTeams.map(t => renderTeamCard(t, true))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SortableContext>
          </DndContext>
        );
      })()}
    </SectionPanel>
  );
}
