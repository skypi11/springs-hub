'use client';
import React from 'react';
import {
  AlertCircle, Archive, ArchiveRestore, ChevronDown, ChevronUp, Crown, Eye,
  Gamepad2, GripVertical, ImageIcon, Loader2, MessageSquare, Settings,
  Plus, Save, Search, Tag, Trash2, UploadCloud,
} from 'lucide-react';
import ImageUploader from '@/components/ui/ImageUploader';
import PendingImagePicker from '@/components/ui/PendingImagePicker';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import {
  DndContext, closestCenter, useSensors,
  type DragEndEvent, type CollisionDetection,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Portal from '@/components/ui/Portal';
import type { TeamData, MyStructure, DiscordChannel } from '../types';
import { SectionPanel, RosterSlot, StaffRosterSlot } from '../components';
import { SortableTeam, SortableGroup, GroupDropZone } from '../teams-dnd';
import GameTag from '@/components/games/GameTag';
import { getGame, getGameColor, ALL_GAME_DEFS } from '@/lib/games-registry';

// Collision detection cloisonnée pour le D&D des équipes : un groupe ne peut
// cibler qu'un autre groupe, une équipe qu'une autre équipe ou une zone de
// groupe. Sans ce cloisonnement, un drag de groupe « visait » une carte d'équipe
// et le déplacement était silencieusement annulé (le label revenait en place).
const partitionedCollision: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const accept = activeId.startsWith('group:')
    ? (id: string) => id.startsWith('group:')
    : (id: string) => id.startsWith('team:') || id.startsWith('groupdrop:');
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(c => accept(String(c.id))),
  });
};

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
  newTeamLogoFile: File | null;
  setNewTeamLogoFile: (v: File | null) => void;
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
  isManagerOfActive: boolean;
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
    newTeamLabel, setNewTeamLabel, newTeamLogoFile, setNewTeamLogoFile,
    showArchived, setShowArchived,
    teamMenuOpen, setTeamMenuOpen, teamMenuRect, setTeamMenuRect,
    captainPickerOpen, setCaptainPickerOpen,
    teamLogoEdit, setTeamLogoEdit, teamLabelEdit, setTeamLabelEdit,
    teamDiscordEdit, setTeamDiscordEdit, teamActionLoading,
    expandedTeamGroups, setExpandedTeamGroups,
    collapsedTeamGroups, setCollapsedTeamGroups,
    healthOpen, setHealthOpen, collapsed, toggle,
    discordChannels, discordChannelsLoading, discordChannelsError, loadDiscordChannels,
    isDirigeantOfActive, isManagerOfActive, isFounderOfActive, canReorderTeams,
    teamScopeActive, isTeamInScope,
    handleCreateTeam, handleArchiveTeam, handleSetCaptain,
    handleUpdateTeamLogo, handleUpdateTeamLabel,
    handleUpdateTeamRoster, handleUpdateTeamStaff,
    handleDeleteTeam, handleUpdateTeamDiscordChannel,
    reorderTeamsInGroup, reorderGroups, moveTeamToGroup, dndSensors,
  } = props;

  // Modèle A (validé Matt 2026-05-24) : Responsable = bras droit du dirigeant,
  // accès admin équipes complet. On utilise ce booléen partout où "admin équipe"
  // est requis (au lieu de isDirigeantOfActive qui exclurait le responsable).
  const isAdminOfActive = isDirigeantOfActive || isManagerOfActive;

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

  // hasGrip : la carte est rendue dans un SortableTeam avec poignée drag visible
  // (absolute top-2 left-2). On décale alors la ligne d'en-tête pour ne pas que
  // le tag jeu (RL/TM) passe sous la poignée.
  const renderTeamCard = (team: TeamData, isArchived: boolean, hasGrip = false) => {
    const gameColor = getGameColor(team.game);
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
    // Limites roster dérivées de la registry : marche pour RL (3+2), TM (1+0),
    // et tout nouveau jeu ajouté (ex. Val 5+2). Jeu inconnu = pas de limite.
    const rosterDef = getGame(team.game)?.roster;
    const canAddPlayer = !rosterDef || team.players.length < rosterDef.titulaires;
    const canAddSub = !rosterDef || team.subs.length < rosterDef.remplacants;
    const captainId = team.captainId ?? null;
    const canManageTeam = isAdminOfActive;
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
          <div className={`flex items-center justify-between gap-2 ${hasGrip ? 'pl-6' : ''}`}>
            <div className="flex items-center gap-2.5 flex-wrap">
              <GameTag gameId={team.game} style={{ padding: '2px 7px' }} />
              {team.logoUrl ? (
                <span className="relative w-10 h-10 flex-shrink-0 bevel-sm overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={team.logoUrl} alt="" className="w-full h-full object-contain" />
                </span>
              ) : (
                <span
                  className="w-10 h-10 flex-shrink-0 bevel-sm flex items-center justify-center font-display"
                  style={{ background: 'var(--s-surface)', border: `1px solid ${gameColor}40`, color: gameColor, fontSize: '20px' }}
                  aria-hidden
                >
                  {(team.name.trim().charAt(0) || '?').toUpperCase()}
                </span>
              )}
              <span className="font-display text-xl flex-shrink-0" style={{ color: 'var(--s-text)', letterSpacing: '0.03em' }}>{team.name}</span>
              {isArchived && (
                <span className="tag tag-neutral" style={{ fontSize: '12px', padding: '2px 7px' }}>ARCHIVÉE</span>
              )}
              {team.discordChannelId && team.discordChannelName && !isArchived && (
                <span
                  className="inline-flex items-center gap-1 tag bevel-sm cursor-pointer"
                  style={{
                    fontSize: '12px',
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
                          className="absolute left-0 top-full mt-1 z-20 min-w-[200px] max-w-[calc(100vw-2rem)] py-1 bevel-sm"
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
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 bevel-sm text-xs font-semibold flex-shrink-0 transition-colors duration-150 ${menuOpen ? 'bg-[var(--s-hover)]' : 'bg-[var(--s-elevated)] hover:bg-[var(--s-hover)]'}`}
                  style={{ color: menuOpen ? 'var(--s-text)' : 'var(--s-text-dim)', border: '1px solid var(--s-border)' }}
                  aria-label="Gérer l'équipe"
                  aria-expanded={menuOpen}>
                  <Settings size={13} />
                  <span>Gérer</span>
                  <ChevronDown size={12} style={{ opacity: 0.55 }} />
                </button>
                {menuOpen && teamMenuRect && (
                  <Portal>
                    <div className="fixed inset-0 z-[60]" onClick={() => { setTeamMenuOpen(null); setTeamMenuRect(null); }} />
                    <div className="fixed z-[61] min-w-[220px] max-w-[calc(100vw-1rem)] py-1 bevel-sm animate-fade-in"
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
                      // discordChannels est déjà trié selon l'ordre réel du
                      // serveur Discord (cf. getGuildChannels). On regroupe par
                      // parentId — pas par nom : deux catégories homonymes ne
                      // doivent pas fusionner — en conservant l'ordre d'apparition.
                      const channelGroups = new Map<string, { name: string; list: DiscordChannel[] }>();
                      for (const c of (discordChannels ?? [])) {
                        const key = c.parentId ?? '__none__';
                        if (!channelGroups.has(key)) {
                          channelGroups.set(key, { name: c.parentName ?? '', list: [] });
                        }
                        channelGroups.get(key)!.list.push(c);
                      }
                      const nodes: React.ReactNode[] = [];
                      for (const [key, grp] of channelGroups) {
                        if (grp.name) {
                          nodes.push(
                            <optgroup key={`g_${key}`} label={grp.name.toUpperCase()}>
                              {grp.list.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                            </optgroup>
                          );
                        } else {
                          for (const c of grp.list) {
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

          {teamLogoEdit?.teamId === team.id && (() => {
            const logoBusy = teamActionLoading === `${team.id}_logo`;
            return (
              <div className="p-3 bevel-sm space-y-3" style={{ background: 'var(--s-surface)', border: '1px solid rgba(0,129,255,0.25)' }}>
                <div className="flex items-center gap-2">
                  <UploadCloud size={14} style={{ color: 'var(--s-blue)' }} />
                  <span className="t-label">Logo de l&apos;équipe</span>
                </div>

                {/* Méthode 1 — import direct d'un fichier (uploadé sur R2, converti en webp) */}
                <ImageUploader
                  currentUrl={teamLogoEdit.value.trim() || team.logoUrl || null}
                  endpoint="/api/upload/team-logo"
                  extraFields={{ structureId: s.id, teamId: team.id }}
                  aspect="square"
                  maxBytes={UPLOAD_LIMITS.STRUCTURE_LOGO_BYTES}
                  label="Importer une image"
                  hint="JPEG, PNG, WebP, GIF — max 2 MB. Format carré recommandé."
                  disabled={logoBusy}
                  onUploaded={(url) => handleUpdateTeamLogo(team.id, url)}
                />

                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px" style={{ background: 'var(--s-border)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>ou via un lien</span>
                  <div className="flex-1 h-px" style={{ background: 'var(--s-border)' }} />
                </div>

                {/* Méthode 2 — lien externe direct */}
                <div className="flex items-center gap-2">
                  {teamLogoEdit.value.trim() ? (
                    <span className="relative w-10 h-10 flex-shrink-0 bevel-sm overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={teamLogoEdit.value} alt="" className="w-full h-full object-contain" />
                    </span>
                  ) : null}
                  <input type="url" className="settings-input flex-1 text-sm" placeholder="https://..."
                    value={teamLogoEdit.value}
                    onChange={e => setTeamLogoEdit({ teamId: team.id, value: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); handleUpdateTeamLogo(team.id, teamLogoEdit.value); }
                      if (e.key === 'Escape') { e.preventDefault(); setTeamLogoEdit(null); }
                    }} />
                </div>
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Lien direct vers une image hébergée ailleurs.
                </p>

                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button"
                    onClick={() => handleUpdateTeamLogo(team.id, teamLogoEdit.value)}
                    disabled={logoBusy}
                    className="btn-springs btn-primary bevel-sm flex items-center gap-1.5 text-xs">
                    {logoBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    <span>Enregistrer le lien</span>
                  </button>
                  {team.logoUrl ? (
                    <button type="button"
                      onClick={() => handleUpdateTeamLogo(team.id, '')}
                      disabled={logoBusy}
                      className="btn-springs btn-ghost bevel-sm flex items-center gap-1.5 text-xs"
                      style={{ color: '#ff5555' }}>
                      <Trash2 size={12} />
                      <span>Retirer le logo</span>
                    </button>
                  ) : null}
                  <button type="button"
                    onClick={() => setTeamLogoEdit(null)}
                    className="btn-springs btn-ghost bevel-sm text-xs">
                    Fermer
                  </button>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <RosterSlot
              label="TITULAIRES"
              labelColor={gameColor}
              members={team.players}
              available={availableForRoster}
              canAdd={canAddPlayer && !isArchived}
              loading={teamActionLoading === `${team.id}_playerIds`}
              captainId={captainId}
              capacity={rosterDef && !rosterDef.allowSolo ? rosterDef.titulaires : undefined}
              emptyLabel="un titulaire"
              onAdd={(uid) => handleUpdateTeamRoster(team.id, 'playerIds', [...team.players.map(p => p.uid), uid])}
              onRemove={(uid) => handleUpdateTeamRoster(team.id, 'playerIds', team.players.filter(p => p.uid !== uid).map(p => p.uid))}
            />
            <RosterSlot
              label="REMPLAÇANTS"
              labelColor="var(--s-text-dim)"
              members={team.subs}
              available={availableForRoster}
              canAdd={canAddSub && !isArchived}
              loading={teamActionLoading === `${team.id}_subIds`}
              capacity={rosterDef && !rosterDef.allowSolo ? rosterDef.remplacants : undefined}
              emptyLabel="un remplaçant"
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
      action={isAdminOfActive ? (
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

      {/* Dashboard santé équipes — dirigeant + responsable */}
      {isAdminOfActive && !teamsLoading && (() => {
        const activeAll = teams.filter(t => (t.status ?? 'active') === 'active');
        if (activeAll.length === 0) return null;
        const noCaptain = activeAll.filter(t => !t.captainId);
        const noStaff = activeAll.filter(t => t.staff.length === 0);
        // Équipes incomplètes : tous jeux non-solo dont les titulaires sont en
        // sous-effectif (RL : <3, Val : <5…). Solo (TM) exclu par allowSolo.
        const rlIncomplete = activeAll.filter(t => {
          const r = getGame(t.game)?.roster;
          if (!r || r.allowSolo) return false;
          return t.players.length < r.titulaires;
        });
        const totalFlagged = noCaptain.length + noStaff.length + rlIncomplete.length;
        if (totalFlagged === 0) return null;
        const defaultOpen = totalFlagged <= 5;
        const isOpen = healthOpen ?? defaultOpen;
        const flagRow = (
          label: string,
          list: TeamData[],
          color: string,
        ) => list.length === 0 ? null : (
          <div key={label} className="flex items-start gap-2.5 py-2.5">
            <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center bevel-sm"
              style={{ background: `${color}18`, border: `1px solid ${color}40` }}>
              <AlertCircle size={13} style={{ color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold mb-1.5" style={{ color: 'var(--s-text)' }}>
                {label}
                <span className="ml-1.5 t-mono" style={{ color }}>{list.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {list.map(t => (
                  <button key={t.id} type="button"
                    onClick={() => { if (t.id) document.getElementById(`team-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                    title={`Aller à l'équipe ${t.name}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bevel-sm transition-colors duration-150 hover:bg-[var(--s-hover)]"
                    style={{ background: 'var(--s-elevated)', border: `1px solid ${color}55`, color: 'var(--s-text)' }}>
                    <span className="w-1.5 h-1.5 flex-shrink-0"
                      style={{ background: getGameColor(t.game), borderRadius: '50%' }} />
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
            className="settings-input has-icon-sm w-full text-sm" />
        </div>
      </div>

      {/* Formulaire nouvelle équipe — dirigeant + responsable */}
      {showNewTeam && isAdminOfActive && (
        <div className="mb-4 bevel-sm relative overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(0,129,255,0.25)' }}>
          <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, var(--s-blue), transparent 70%)' }} />
          <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Plus size={13} style={{ color: 'var(--s-blue)' }} />
            <span className="t-label" style={{ color: 'var(--s-blue)' }}>Nouvelle équipe</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                {ALL_GAME_DEFS.filter(g => s.games?.includes(g.id)).map(g => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
            </div>
          </div>
          <PendingImagePicker
            value={newTeamLogoFile}
            onChange={setNewTeamLogoFile}
            maxBytes={UPLOAD_LIMITS.STRUCTURE_LOGO_BYTES}
            label="Logo de l'équipe (optionnel)"
            hint="JPEG, PNG, WebP, GIF — max 2 MB. Format carré recommandé. Si vide, une icône générique est utilisée."
            aspect="square"
            disabled={teamActionLoading === 'create'}
          />
          <button type="button" onClick={handleCreateTeam}
            disabled={!newTeamName.trim() || !newTeamLabel.trim() || !newTeamGame || teamActionLoading === 'create'}
            className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
            style={{ opacity: (!newTeamName.trim() || !newTeamLabel.trim() || !newTeamGame) ? 0.5 : 1 }}>
            {teamActionLoading === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            <span>Créer</span>
          </button>
          </div>
        </div>
      )}

      {teamsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
        </div>
      ) : noActiveAtAll && archivedCount === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center bevel-sm"
            style={{ background: 'rgba(0,129,255,0.08)', border: '1px solid rgba(0,129,255,0.2)' }}>
            <Gamepad2 size={26} style={{ color: 'var(--s-blue)' }} />
          </div>
          <p className="t-sub mb-1" style={{ color: 'var(--s-text)' }}>Aucune équipe pour l&apos;instant</p>
          <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
            {isAdminOfActive
              ? 'Crée ta première équipe avec le bouton « Nouvelle équipe » en haut à droite.'
              : 'Les équipes apparaîtront ici une fois créées par un dirigeant.'}
          </p>
        </div>
      ) : emptyQueryMatches ? (
        <div className="text-center py-12 px-4">
          <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center bevel-sm"
            style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            <Search size={26} style={{ color: 'var(--s-text-muted)' }} />
          </div>
          <p className="t-sub mb-1" style={{ color: 'var(--s-text)' }}>Aucun résultat</p>
          <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
            Rien ne correspond à « {teamSearch} ».
          </p>
        </div>
      ) : (() => {
        // D&D à deux niveaux cloisonnés (cf. partitionedCollision) : un
        // SortableContext externe pour les groupes (réordonnables entre eux),
        // un SortableContext interne par groupe pour ses équipes. Le cloisonnement
        // empêche qu'un drag de groupe et un drag d'équipe se télescopent.
        const TEAM_GROUP_CAP = 12;
        const groupsDraggable = canReorderTeams && groups.length > 1;
        const groupIds = groups.map(g => `group:${g.label || '__nolabel__'}`);
        const handleDragEnd = (event: DragEndEvent) => {
          const { active, over } = event;
          if (!over || active.id === over.id) return;
          const a = String(active.id);
          const o = String(over.id);
          // Groupe → groupe : réordonne les labels entre eux (le groupe emporte
          // ses équipes, jamais imbriqué dans un autre).
          if (a.startsWith('group:') && o.startsWith('group:')) {
            reorderGroups(a.slice(6), o.slice(6));
            return;
          }
          if (!a.startsWith('team:')) return;
          const fromTeamId = a.slice(5);
          // Équipe → équipe : réordonne dans le groupe, ou change de groupe.
          if (o.startsWith('team:')) {
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
          // Équipe → en-tête d'un groupe : rattache l'équipe à la fin de ce groupe.
          if (o.startsWith('groupdrop:')) {
            moveTeamToGroup(fromTeamId, o.slice(10), null);
            return;
          }
        };
        return (
          <DndContext sensors={dndSensors} collisionDetection={partitionedCollision} onDragEnd={handleDragEnd}>
            <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-8">
                {groups.map(g => {
                  const groupKey = g.label || '__nolabel__';
                  const expanded = expandedTeamGroups.has(groupKey);
                  const groupCollapsed = collapsedTeamGroups.has(groupKey);
                  const needsPagination = g.teams.length > TEAM_GROUP_CAP;
                  const shownTeams = needsPagination && !expanded ? g.teams.slice(0, TEAM_GROUP_CAP) : g.teams;
                  const hiddenCount = g.teams.length - shownTeams.length;
                  const teamsDndEnabled = canReorderTeams && (!needsPagination || expanded);
                  const teamIds = shownTeams.map(t => `team:${t.id}`);
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
                          <GroupDropZone groupKey={groupKey} disabled={!canReorderTeams}>
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
                          </GroupDropZone>
                          {!groupCollapsed && (
                            <>
                              <SortableContext items={teamIds} strategy={verticalListSortingStrategy}>
                                <div className="space-y-3">
                                  {shownTeams.map(t => (
                                    <SortableTeam key={t.id} id={`team:${t.id}`} draggable={teamsDndEnabled}>
                                      {renderTeamCard(t, false, teamsDndEnabled)}
                                    </SortableTeam>
                                  ))}
                                </div>
                              </SortableContext>
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
