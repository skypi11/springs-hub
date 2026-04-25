'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import {
  Shield, Users, Trophy, Loader2, AlertCircle,
  Save, Plus, Trash2, Eye, CheckCircle,
  Link2, MessageSquare, Settings,
  Check, UserMinus, X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import CalendarSection from '@/components/calendar/CalendarSection';
import TeamDetailDrawer, { type DrawerTab, type DrawerTeam } from '@/components/calendar/TeamDetailDrawer';
import { CalendarClock, ClipboardList, Film } from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import PublicPreviewFrame from '@/components/ui/PublicPreviewFrame';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import type { UserContext } from '@/lib/event-permissions';
import PlayerStructureView, { type PlayerStructure } from '@/components/structure/PlayerStructureView';
import ImageUploader from '@/components/ui/ImageUploader';
import DocumentsExplorer from '@/components/documents/DocumentsExplorer';
import CrossTeamTodosPanel from '@/components/structure/CrossTeamTodosPanel';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import { safeCopy } from '@/lib/clipboard';
import type {
  DashboardTab, MyStructure, TeamData, DiscordChannel, DiscordRole,
  InviteLink, JoinRequest, DirectInvite, Suggestion, ShortlistItem, HistoryItem,
} from './types';
import {
  DEPARTURE_NOTICE_DAYS, DEPARTURE_NOTICE_MS,
  STATUS_INFO, SOCIAL_LABELS,
} from './constants';
import { TabBar, SectionPanel, TeamActionChip } from './components';
import { DiscordConfigBlockRenderer } from './discord-config-block';
import { TeamsTab } from './tabs/teams-tab';
import { RecruitmentTab } from './tabs/recruitment-tab';
import { MembersTab } from './tabs/members-tab';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';


export default function MyStructurePage() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [structures, setStructures] = useState<MyStructure[]>([]);
  const [playerStructures, setPlayerStructures] = useState<PlayerStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStructure, setActiveStructure] = useState<MyStructure | null>(null);

  // Editing state
  const [editDesc, setEditDesc] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editDiscordUrl, setEditDiscordUrl] = useState('');
  const [editSocials, setEditSocials] = useState<Record<string, string>>({});
  const [editRecruiting, setEditRecruiting] = useState<{ active: boolean; positions: { game: string; role: string }[]; message: string }>({ active: false, positions: [], message: '' });
  const recruitMessageRef = useRef<HTMLTextAreaElement>(null);
  const [editAchievements, setEditAchievements] = useState<{ placement: string; competition: string; game: string; date: string }[]>([]);
  // Teams state
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamGame, setNewTeamGame] = useState('');
  const [newTeamLabel, setNewTeamLabel] = useState('');
  const [newTeamLogoUrl, setNewTeamLogoUrl] = useState('');
  const [teamLogoEdit, setTeamLogoEdit] = useState<{ teamId: string; value: string } | null>(null);
  const [teamLabelEdit, setTeamLabelEdit] = useState<{ teamId: string; value: string } | null>(null);
  const [teamDiscordEdit, setTeamDiscordEdit] = useState<string | null>(null); // teamId en cours d'édition
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[] | null>(null);
  const [discordChannelsLoading, setDiscordChannelsLoading] = useState(false);
  const [discordChannelsError, setDiscordChannelsError] = useState<string | null>(null);
  const [discordRoles, setDiscordRoles] = useState<DiscordRole[] | null>(null);
  const [discordRolesLoading, setDiscordRolesLoading] = useState(false);
  const [discordRolesError, setDiscordRolesError] = useState<string | null>(null);
  const [discordConfigSaving, setDiscordConfigSaving] = useState<string | null>(null); // clé = scope (structure|game:rocket_league|staff)
  type DiscordConfigScope = { scope: 'structure' | 'staff' } | { scope: 'game'; game: string };
  const [discordConfigExpanded, setDiscordConfigExpanded] = useState<Record<string, boolean>>({});
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [teamActionLoading, setTeamActionLoading] = useState<string | null>(null);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  // Groupes d'équipes "dépliés" (au-delà du cap par groupe). Key = label du groupe.
  const [expandedTeamGroups, setExpandedTeamGroups] = useState<Set<string>>(new Set());
  // Groupes d'équipes "repliés entièrement" — séparé du state ci-dessus pour
  // ne pas mélanger pagination (>12 équipes) et collapse manuel global.
  // Persisté en localStorage par structureId pour rester en place entre sessions.
  const [collapsedTeamGroups, setCollapsedTeamGroups] = useState<Set<string>>(new Set());
  const [healthOpen, setHealthOpen] = useState<boolean | null>(null);
  const [teamMenuOpen, setTeamMenuOpen] = useState<string | null>(null);
  // Coordonnées fixes du bouton kebab quand le menu est ouvert — permet au menu
  // d'être rendu via Portal hors du clip-path "bevel" de la SectionPanel parent.
  const [teamMenuRect, setTeamMenuRect] = useState<{ top: number; right: number } | null>(null);
  const [captainPickerOpen, setCaptainPickerOpen] = useState<string | null>(null);
  // Drawer détail équipe (Dispos + Devoirs) — ouvert via chips des cards équipe
  const [drawerState, setDrawerState] = useState<{ team: DrawerTeam; tab: DrawerTab; canEditConfig: boolean } | null>(null);

  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [directInvites, setDirectInvites] = useState<DirectInvite[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [shortlist, setShortlist] = useState<ShortlistItem[]>([]);
  const [shortlistLoading, setShortlistLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [invLoading, setInvLoading] = useState(false);
  const [invActionLoading, setInvActionLoading] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState('');
  const [newLinkGame, setNewLinkGame] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showEmojis, setShowEmojis] = useState(false);
  const [tab, setTab] = useState<DashboardTab>('general');
  // Deep-link pending consommé par CrossTeamTodosPanel pour ouvrir son drawer détail.
  const [pendingTodoId, setPendingTodoId] = useState<string | null>(null);
  // Deep-link non consommé : on lit `?tab=...&team=...&todo=...` au mount et on applique
  // tab/drawer/todo une seule fois quand les données sont là, puis on nettoie l'URL.
  const deepLinkRef = useRef<{ tab: string | null; teamId: string | null; todoId: string | null; consumed: boolean }>({
    tab: null, teamId: null, todoId: null, consumed: false,
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    deepLinkRef.current = {
      tab: params.get('tab'),
      teamId: params.get('team'),
      todoId: params.get('todo'),
      consumed: false,
    };
  }, []);
  const descRef = useRef<HTMLTextAreaElement>(null);
  // `now` est utilisé pour calculer le temps restant sur les préavis de départ.
  // Lazy-init : appelé une seule fois au montage, puis refresh toutes les 60s.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Si le tab actif n'est pas visible pour le rôle de l'user sur la structure active,
  // on rabat sur le premier tab visible. Calculé ici pour rester au niveau hooks top-level.
  useEffect(() => {
    if (!activeStructure || !firebaseUser) return;
    const isFounder = activeStructure.founderId === firebaseUser.uid;
    const isCoFounder = (activeStructure.coFounderIds ?? []).includes(firebaseUser.uid);
    const isDirigeant = isFounder || isCoFounder;
    const isManager = !isDirigeant && (activeStructure.managerIds ?? []).includes(firebaseUser.uid);
    const isCoach = !isDirigeant && !isManager && (activeStructure.coachIds ?? []).includes(firebaseUser.uid);
    const visible: DashboardTab[] = isDirigeant
      ? ['general', 'teams', 'recruitment', 'members', 'calendar', 'todos', 'documents']
      : isManager
      ? ['teams', 'members', 'calendar', 'todos']
      : isCoach
      ? ['members', 'calendar', 'todos']
      : ['calendar'];
    if (!visible.includes(tab)) setTab(visible[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStructure?.id, firebaseUser?.uid]);

  // Hydrate la liste des groupes repliés depuis localStorage à chaque changement
  // de structure active. Clé scopée par structureId pour que deux structures
  // gardent des préférences indépendantes.
  useEffect(() => {
    if (!activeStructure?.id) { setCollapsedTeamGroups(new Set()); return; }
    try {
      const raw = localStorage.getItem(`my-structure:teamGroupsCollapsed:${activeStructure.id}`);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setCollapsedTeamGroups(new Set(arr.filter(x => typeof x === 'string')));
        else setCollapsedTeamGroups(new Set());
      } else {
        setCollapsedTeamGroups(new Set());
      }
    } catch {
      setCollapsedTeamGroups(new Set());
    }
  }, [activeStructure?.id]);

  // Consommation du deep-link : applique tab / team / todo une fois les données prêtes,
  // puis nettoie l'URL pour éviter de réouvrir au prochain changement de state.
  useEffect(() => {
    if (deepLinkRef.current.consumed) return;
    if (!activeStructure || !firebaseUser) return;
    const { tab: tabParam, teamId, todoId } = deepLinkRef.current;
    if (!tabParam && !teamId && !todoId) return;

    const validTabs: DashboardTab[] = ['general', 'teams', 'recruitment', 'members', 'calendar', 'todos', 'documents'];
    if (tabParam && (validTabs as string[]).includes(tabParam)) {
      setTab(tabParam as DashboardTab);
    }

    if (teamId) {
      // Attendre que les équipes soient chargées pour ouvrir le drawer.
      if (teams.length === 0) return;
      const t = teams.find(x => x.id === teamId);
      if (t) {
        const isFounder = activeStructure.founderId === firebaseUser.uid;
        const isCoFounder = (activeStructure.coFounderIds ?? []).includes(firebaseUser.uid);
        const drawerTeam: DrawerTeam = {
          id: t.id, name: t.name, game: t.game,
          players: t.players, subs: t.subs, staff: t.staff,
        };
        setDrawerState({ team: drawerTeam, tab: 'todos', canEditConfig: isFounder || isCoFounder });
      }
    }

    if (todoId) setPendingTodoId(todoId);

    deepLinkRef.current.consumed = true;
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('tab');
      url.searchParams.delete('team');
      url.searchParams.delete('todo');
      window.history.replaceState({}, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStructure?.id, firebaseUser?.uid, teams.length]);

  async function loadStructures() {
    if (!firebaseUser) return;
    try {
      const [staffData, playerData] = await Promise.all([
        api<{ structures: MyStructure[] }>('/api/structures/my').catch(() => ({ structures: [] as MyStructure[] })),
        api<{ structures: PlayerStructure[] }>('/api/structures/my-player').catch(() => ({ structures: [] as PlayerStructure[] })),
      ]);
      setStructures(staffData.structures ?? []);
      if (staffData.structures?.length > 0 && !activeStructure) {
        selectStructure(staffData.structures[0]);
      }
      setPlayerStructures(playerData.structures ?? []);
    } catch (err) {
      console.error('[MyStructure] load error:', err);
    }
    setLoading(false);
  }

  async function loadTeams(structureId: string) {
    setTeamsLoading(true);
    try {
      const data = await api<{ teams: TeamData[] }>(`/api/structures/teams?structureId=${structureId}`);
      setTeams(data.teams ?? []);
    } catch (err) {
      console.error('[MyStructure] load teams error:', err);
    }
    setTeamsLoading(false);
  }

  // D&D — Sensors avec activation distance pour ne pas déclencher un drag
  // au moindre clic dans une carte (qui contient kebab, chips, picker capitaine…).
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Réorganisation intra-groupe d'équipes : renumérote les `order` du groupe
  // affecté (0..n-1) puis push un batch reorder à l'API. Optimistic — rollback
  // via reload en cas d'erreur.
  function reorderTeamsInGroup(groupKey: string, fromTeamId: string, toTeamId: string) {
    if (!activeStructure?.id) return;
    const groupTeams = teams
      .filter(t => (t.label || '__nolabel__') === groupKey && (t.status ?? 'active') === 'active')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const oldIdx = groupTeams.findIndex(t => t.id === fromTeamId);
    const newIdx = groupTeams.findIndex(t => t.id === toTeamId);
    if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
    const reordered = arrayMove(groupTeams, oldIdx, newIdx);
    const updates = reordered.map((t, i) => ({ teamId: t.id, order: i }));
    const updatesById = new Map(updates.map(u => [u.teamId, u.order]));
    setTeams(prev => prev.map(t => {
      const o = updatesById.get(t.id);
      return o !== undefined ? { ...t, order: o } : t;
    }));
    const structureId = activeStructure.id;
    api('/api/structures/teams', {
      method: 'POST',
      body: { action: 'reorder', structureId, items: updates },
    }).catch((err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Erreur lors de la réorganisation.');
      loadTeams(structureId);
    });
  }

  // Réorganisation des groupes (labels) entre eux : arrayMove la liste des groupes
  // par leur clé courante, puis push un `groupOrder` cohérent sur toutes les équipes
  // de chaque groupe. Optimistic — rollback via reload en cas d'erreur API.
  function reorderGroups(fromGroupKey: string, toGroupKey: string) {
    if (!activeStructure?.id) return;
    if (fromGroupKey === toGroupKey) return;
    // Reconstruire la liste ordonnée des groupes courante (par groupOrder asc).
    const groupKeyToOrder = new Map<string, number>();
    for (const t of teams) {
      if ((t.status ?? 'active') !== 'active') continue;
      const k = (t.label || '').trim() || '__nolabel__';
      const cur = groupKeyToOrder.get(k);
      const o = typeof t.groupOrder === 'number' ? t.groupOrder : 0;
      if (cur === undefined || o < cur) groupKeyToOrder.set(k, o);
    }
    const orderedKeys = Array.from(groupKeyToOrder.entries())
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(e => e[0]);
    const oldIdx = orderedKeys.indexOf(fromGroupKey);
    const newIdx = orderedKeys.indexOf(toGroupKey);
    if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
    const next = arrayMove(orderedKeys, oldIdx, newIdx);
    const newGroupOrderByKey = new Map(next.map((k, i) => [k, i]));

    // Construire updates pour TOUTES les équipes actives (groupOrder mis à jour selon leur groupe).
    const updates: { teamId: string; groupOrder: number }[] = [];
    for (const t of teams) {
      if ((t.status ?? 'active') !== 'active') continue;
      const k = (t.label || '').trim() || '__nolabel__';
      const go = newGroupOrderByKey.get(k);
      if (go === undefined) continue;
      if ((t.groupOrder ?? 0) === go) continue;
      updates.push({ teamId: t.id, groupOrder: go });
    }
    if (updates.length === 0) return;
    const updatesById = new Map(updates.map(u => [u.teamId, u.groupOrder]));
    setTeams(prev => prev.map(t => {
      const go = updatesById.get(t.id);
      return go !== undefined ? { ...t, groupOrder: go } : t;
    }));
    const structureId = activeStructure.id;
    api('/api/structures/teams', {
      method: 'POST',
      body: { action: 'reorder', structureId, items: updates },
    }).catch((err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Erreur lors de la réorganisation des groupes.');
      loadTeams(structureId);
    });
  }

  // Déplace une équipe vers un autre groupe (label). Si beforeTeamId est fourni,
  // l'équipe est insérée juste avant ; sinon elle est ajoutée à la fin du groupe cible.
  // Renumérote source ET cible (order 0..n-1) et change le label de l'équipe déplacée.
  // targetGroupKey === '__nolabel__' -> label vidé (FieldValue.delete côté API).
  function moveTeamToGroup(teamId: string, targetGroupKey: string, beforeTeamId: string | null) {
    if (!activeStructure?.id) return;
    const moving = teams.find(t => t.id === teamId);
    if (!moving) return;
    const sourceKey = (moving.label || '').trim() || '__nolabel__';
    if (sourceKey === targetGroupKey) return;

    const sourceTeams = teams
      .filter(t => t.id !== teamId
        && ((t.label || '').trim() || '__nolabel__') === sourceKey
        && (t.status ?? 'active') === 'active')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const targetTeams = teams
      .filter(t => ((t.label || '').trim() || '__nolabel__') === targetGroupKey
        && (t.status ?? 'active') === 'active')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    let insertAt = targetTeams.length;
    if (beforeTeamId) {
      const idx = targetTeams.findIndex(t => t.id === beforeTeamId);
      if (idx >= 0) insertAt = idx;
    }
    const newTargetTeams = [
      ...targetTeams.slice(0, insertAt),
      moving,
      ...targetTeams.slice(insertAt),
    ];

    // Reprendre le groupOrder du groupe cible (le plus petit groupOrder y existant)
    // pour que l'équipe déplacée tombe dans la bonne position de tri groupe.
    const targetGroupOrder = targetTeams.length > 0
      ? Math.min(...targetTeams.map(t => typeof t.groupOrder === 'number' ? t.groupOrder : 0))
      : (typeof moving.groupOrder === 'number' ? moving.groupOrder : 0);

    const updates: {
      teamId: string;
      order?: number;
      label?: string;
      groupOrder?: number;
    }[] = [];

    sourceTeams.forEach((t, i) => {
      if ((t.order ?? 0) !== i) updates.push({ teamId: t.id, order: i });
    });
    newTargetTeams.forEach((t, i) => {
      if (t.id === teamId) {
        updates.push({
          teamId: t.id,
          order: i,
          label: targetGroupKey === '__nolabel__' ? '' : targetGroupKey,
          groupOrder: targetGroupOrder,
        });
      } else if ((t.order ?? 0) !== i) {
        updates.push({ teamId: t.id, order: i });
      }
    });

    if (updates.length === 0) return;

    // Optimistic local update
    const updMap = new Map(updates.map(u => [u.teamId, u]));
    setTeams(prev => prev.map(t => {
      const u = updMap.get(t.id);
      if (!u) return t;
      const next: TeamData = { ...t };
      if (typeof u.order === 'number') next.order = u.order;
      if (typeof u.groupOrder === 'number') next.groupOrder = u.groupOrder;
      if (typeof u.label === 'string') next.label = u.label;
      return next;
    }));

    const structureId = activeStructure.id;
    api('/api/structures/teams', {
      method: 'POST',
      body: { action: 'reorder', structureId, items: updates },
    }).catch((err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Erreur lors du déplacement.');
      loadTeams(structureId);
    });
  }

  function selectStructure(s: MyStructure) {
    setActiveStructure(s);
    setEditDesc(s.description || '');
    setEditLogoUrl(s.logoUrl || '');
    setEditDiscordUrl(s.discordUrl || '');
    setEditSocials(s.socials || {});
    setEditRecruiting({
      active: s.recruiting?.active ?? false,
      positions: s.recruiting?.positions ?? [],
      message: s.recruiting?.message ?? '',
    });
    setEditAchievements((s.achievements || []).map(a => ({
      placement: a.placement || a.title || '',
      competition: a.competition || '',
      game: a.game || s.games?.[0] || 'rocket_league',
      date: a.date || '',
    })));
    setSaved(false);
    setError('');
    setShowNewTeam(false);
    loadTeams(s.id);
    // Invitations : API réservée aux dirigeant/manager — on évite le 403 côté coach.
    const uid = firebaseUser?.uid;
    const canLoadInvitations = !!uid && (
      s.founderId === uid ||
      (s.coFounderIds ?? []).includes(uid) ||
      (s.managerIds ?? []).includes(uid)
    );
    if (canLoadInvitations) loadInvitations(s.id);
    else { setInviteLinks([]); setJoinRequests([]); setDirectInvites([]); }
    // Suggestions : dirigeant ou manager
    const canSeeSuggestions = !!uid && (
      s.founderId === uid ||
      (s.coFounderIds ?? []).includes(uid) ||
      (s.managerIds ?? []).includes(uid)
    );
    if (canSeeSuggestions && s.recruiting?.active) loadSuggestions(s.id);
    else setSuggestions([]);
    // Shortlist : dirigeant (founder/cofounder/manager) uniquement
    if (canLoadInvitations) loadShortlist(s.id);
    else setShortlist([]);
    // Historique d'appartenance : dirigeant uniquement (Phase 3 item N)
    if (canLoadInvitations) loadHistory(s.id);
    else setHistory([]);
  }

  async function handleCreateTeam() {
    if (!activeStructure || !firebaseUser || !newTeamName.trim() || !newTeamGame || !newTeamLabel.trim()) return;
    setTeamActionLoading('create');
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: {
          action: 'create',
          structureId: activeStructure.id,
          name: newTeamName,
          game: newTeamGame,
          label: newTeamLabel.trim(),
          logoUrl: newTeamLogoUrl.trim(),
          playerIds: [],
          subIds: [],
          staffIds: [],
        },
      });
      setNewTeamName('');
      setNewTeamLabel('');
      setNewTeamLogoUrl('');
      setShowNewTeam(false);
      await loadTeams(activeStructure.id);
      toast.success('Équipe créée');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  async function handleArchiveTeam(teamId: string, archive: boolean) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(teamId);
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: { action: archive ? 'archive' : 'unarchive', structureId: activeStructure.id, teamId },
      });
      await loadTeams(activeStructure.id);
      toast.success(archive ? 'Équipe archivée' : 'Équipe désarchivée');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
    setTeamMenuOpen(null);
  }

  async function handleSetCaptain(teamId: string, captainId: string | null) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_captain`);
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: { action: 'update', structureId: activeStructure.id, teamId, captainId },
      });
      await loadTeams(activeStructure.id);
      toast.success(captainId ? 'Capitaine désigné' : 'Capitaine retiré');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  async function handleUpdateTeamLogo(teamId: string, rawLogoUrl: string) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_logo`);
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: { action: 'update', structureId: activeStructure.id, teamId, logoUrl: rawLogoUrl.trim() },
      });
      await loadTeams(activeStructure.id);
      toast.success(rawLogoUrl.trim() ? 'Logo mis à jour' : 'Logo retiré');
      setTeamLogoEdit(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  async function handleUpdateTeamLabel(teamId: string, rawLabel: string) {
    if (!activeStructure || !firebaseUser) return;
    const label = rawLabel.trim();
    if (!label) {
      toast.error('Le label ne peut pas être vide');
      return;
    }
    setTeamActionLoading(`${teamId}_label`);
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: { action: 'update', structureId: activeStructure.id, teamId, label },
      });
      await loadTeams(activeStructure.id);
      toast.success('Label mis à jour');
      setTeamLabelEdit(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  async function handleUpdateTeamRoster(teamId: string, field: 'playerIds' | 'subIds' | 'staffIds', ids: string[]) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_${field}`);
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: { action: 'update', structureId: activeStructure.id, teamId, [field]: ids },
      });
      await loadTeams(activeStructure.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  // Met à jour staffIds + staffRoles simultanément. Utilisé quand on ajoute/retire
  // un staff ou quand on toggle son rôle (coach ↔ manager).
  async function handleUpdateTeamStaff(teamId: string, staffIds: string[], staffRoles: Record<string, 'coach' | 'manager'>) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_staffIds`);
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: { action: 'update', structureId: activeStructure.id, teamId, staffIds, staffRoles },
      });
      await loadTeams(activeStructure.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  async function handleDeleteTeam(teamId: string, teamName: string) {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Supprimer l\'équipe',
      message: `Supprimer l'équipe "${teamName}" ? Cette action est irréversible.`,
      variant: 'danger',
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    setTeamActionLoading(teamId);
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: { action: 'delete', structureId: activeStructure.id, teamId },
      });
      await loadTeams(activeStructure.id);
      toast.success('Équipe supprimée');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.push('/');
      return;
    }
    if (firebaseUser) loadStructures();
  }, [authLoading, firebaseUser]);

  // Retour du flow Discord install : on lit ?discord=... dans l'URL, on affiche
  // un toast, puis on nettoie la query string pour ne pas re-déclencher au refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const discord = params.get('discord');
    if (!discord) return;
    if (discord === 'connected') {
      toast.success('Bot Discord connecté à ton serveur.');
    } else if (discord === 'cancelled') {
      toast.info('Connexion Discord annulée.');
    } else if (discord === 'error') {
      toast.error('Impossible de connecter Discord. Réessaie.');
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('discord');
    url.searchParams.delete('reason');
    url.searchParams.delete('structureId');
    window.history.replaceState({}, '', url.toString());
  }, [toast]);

  async function handleConnectDiscord() {
    if (!activeStructure || !firebaseUser || discordLoading) return;
    setDiscordLoading(true);
    try {
      const data = await api<{ url?: string }>('/api/discord/install', {
        method: 'POST',
        body: { structureId: activeStructure.id },
      });
      if (!data.url) {
        toast.error('Impossible de démarrer la connexion.');
        setDiscordLoading(false);
        return;
      }
      // Navigation vers Discord — le retour se fait sur /api/discord/install/callback
      // qui redirige vers /community/my-structure?discord=connected.
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
      setDiscordLoading(false);
    }
  }

  // Charge (ou recharge) la liste des salons Discord postables. Appelé la première
  // fois que le fondateur ouvre un picker dans une card d'équipe. On cache dans
  // discordChannels pour ne pas re-solliciter l'API à chaque ouverture.
  // Ferme le menu kebab des équipes quand on scroll ou qu'on redimensionne :
  // le menu est rendu via Portal en position fixe, ses coordonnées calculées à
  // l'ouverture deviennent obsolètes au moindre scroll.
  useEffect(() => {
    if (!teamMenuOpen) return;
    const close = () => { setTeamMenuOpen(null); setTeamMenuRect(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [teamMenuOpen]);

  // Invalide le cache des salons quand la structure active change ou que le bot
  // est (dé)connecté — évite d'afficher les salons d'un autre serveur.
  useEffect(() => {
    setDiscordChannels(null);
    setDiscordChannelsError(null);
    setDiscordRoles(null);
    setDiscordRolesError(null);
    setTeamDiscordEdit(null);
    setDiscordConfigExpanded({});
  }, [activeStructure?.id, activeStructure?.discordIntegration?.guildId]);

  async function loadDiscordChannels(force = false) {
    if (!activeStructure || !firebaseUser) return;
    if (!force && discordChannels !== null) return;
    setDiscordChannelsLoading(true);
    setDiscordChannelsError(null);
    try {
      const data = await api<{ channels?: unknown }>(`/api/discord/channels?structureId=${encodeURIComponent(activeStructure.id)}`);
      setDiscordChannels(Array.isArray(data.channels) ? (data.channels as DiscordChannel[]) : []);
    } catch (err) {
      setDiscordChannelsError(err instanceof ApiError ? err.message : 'Erreur réseau');
      setDiscordChannels([]);
    }
    setDiscordChannelsLoading(false);
  }

  async function loadDiscordRoles(force = false) {
    if (!activeStructure || !firebaseUser) return;
    if (!force && discordRoles !== null) return;
    setDiscordRolesLoading(true);
    setDiscordRolesError(null);
    try {
      const data = await api<{ roles?: unknown }>(`/api/discord/roles?structureId=${encodeURIComponent(activeStructure.id)}`);
      setDiscordRoles(Array.isArray(data.roles) ? (data.roles as DiscordRole[]) : []);
    } catch (err) {
      setDiscordRolesError(err instanceof ApiError ? err.message : 'Erreur réseau');
      setDiscordRoles([]);
    }
    setDiscordRolesLoading(false);
  }

  async function handleSaveDiscordConfig(
    scope: DiscordConfigScope,
    channelId: string | null,
    roleId: string | null,
  ) {
    if (!activeStructure || !firebaseUser) return;
    const key = scope.scope === 'game' ? `game:${scope.game}` : scope.scope;
    setDiscordConfigSaving(key);
    try {
      const channel = channelId ? (discordChannels ?? []).find(c => c.id === channelId) : null;
      const role = roleId ? (discordRoles ?? []).find(r => r.id === roleId) : null;
      await api('/api/discord/config', {
        method: 'POST',
        body: {
          structureId: activeStructure.id,
          scope: scope.scope,
          ...(scope.scope === 'game' ? { game: scope.game } : {}),
          channelId: channelId ?? null,
          channelName: channel?.name ?? null,
          roleId: roleId ?? null,
          roleName: role?.name ?? null,
        },
      });
      // Patch optimiste local : on met à jour activeStructure.discordIntegration
      // sans re-fetch complet pour garder une UI fluide.
      const next = { ...(activeStructure.discordIntegration ?? {}) } as NonNullable<MyStructure['discordIntegration']>;
      if (scope.scope === 'structure') {
        next.structureChannelId = channelId;
        next.structureChannelName = channel?.name ?? null;
        next.structureRoleId = roleId;
        next.structureRoleName = role?.name ?? null;
      } else if (scope.scope === 'game') {
        next.gameChannels = { ...(next.gameChannels ?? {}) };
        next.gameChannels[scope.game] = {
          channelId,
          channelName: channel?.name ?? null,
          roleId,
          roleName: role?.name ?? null,
        };
      } else {
        next.staffChannelId = channelId;
        next.staffChannelName = channel?.name ?? null;
        next.staffRoleId = roleId;
        next.staffRoleName = role?.name ?? null;
      }
      setActiveStructure({ ...activeStructure, discordIntegration: next });
      setDiscordConfigExpanded(prev => ({ ...prev, [key]: false }));
      toast.success('Config Discord enregistrée.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setDiscordConfigSaving(null);
  }

  async function handleUpdateTeamDiscordChannel(teamId: string, channelId: string | null, channelName: string | null) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_discord`);
    try {
      await api('/api/structures/teams', {
        method: 'POST',
        body: {
          action: 'update',
          structureId: activeStructure.id,
          teamId,
          discordChannelId: channelId,
          discordChannelName: channelName,
        },
      });
      await loadTeams(activeStructure.id);
      setTeamDiscordEdit(null);
      toast.success(channelId ? 'Salon Discord lié à l\u0027équipe.' : 'Salon Discord retiré.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  // Helper JSX : un bloc de config Discord (un par scope structure/jeu/staff).
  // État "replié" = résumé + bouton "Modifier". État "déplié" = 2 selects + Save.
  function renderDiscordConfigBlock(opts: {
    key: string;
    scope: DiscordConfigScope;
    label: string;
    accentColor: string;
    currentChannelId: string | null;
    currentChannelName: string | null;
    currentRoleId: string | null;
    currentRoleName: string | null;
  }) {
    const expanded = !!discordConfigExpanded[opts.key];
    const saving = discordConfigSaving === opts.key;
    const openPicker = () => {
      setDiscordConfigExpanded(prev => ({ ...prev, [opts.key]: true }));
      loadDiscordChannels();
      loadDiscordRoles();
    };
    const closePicker = () => {
      setDiscordConfigExpanded(prev => ({ ...prev, [opts.key]: false }));
    };
    return (
      <DiscordConfigBlockRenderer
        key={opts.key}
        opts={opts}
        expanded={expanded}
        saving={saving}
        openPicker={openPicker}
        closePicker={closePicker}
        channels={discordChannels}
        channelsLoading={discordChannelsLoading}
        channelsError={discordChannelsError}
        roles={discordRoles}
        rolesLoading={discordRolesLoading}
        rolesError={discordRolesError}
        onSave={(channelId, roleId) => handleSaveDiscordConfig(opts.scope, channelId, roleId)}
        onReloadChannels={() => loadDiscordChannels(true)}
        onReloadRoles={() => loadDiscordRoles(true)}
      />
    );
  }

  async function handleDisconnectDiscord() {
    if (!activeStructure || !firebaseUser || discordLoading) return;
    const integration = activeStructure.discordIntegration;
    const ok = await confirm({
      title: 'Déconnecter Discord',
      message: `Déconnecter le bot de "${integration?.guildName ?? 'ce serveur'}" ? Les notifications s'arrêteront. Tu devras retirer le bot manuellement côté Discord si tu veux aussi le faire sortir du serveur.`,
      variant: 'danger',
      confirmLabel: 'Déconnecter',
    });
    if (!ok) return;
    setDiscordLoading(true);
    try {
      await api(`/api/discord/install?structureId=${encodeURIComponent(activeStructure.id)}`, {
        method: 'DELETE',
      });
      setActiveStructure({ ...activeStructure, discordIntegration: null });
      await loadStructures();
      toast.success('Discord déconnecté.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setDiscordLoading(false);
  }

  async function handleSave() {
    if (!activeStructure || !firebaseUser) return;
    setSaving(true);
    setError('');
    setSaved(false);

    try {
      await api('/api/structures/my', {
        method: 'PUT',
        body: {
          structureId: activeStructure.id,
          description: editDesc,
          logoUrl: editLogoUrl,
          discordUrl: editDiscordUrl,
          socials: editSocials,
          recruiting: editRecruiting,
          achievements: editAchievements.filter(a => a.placement.trim() && a.competition.trim()),
        },
      });
      setSaved(true);
      await loadStructures();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur réseau.');
    }
    setSaving(false);
  }

  // ─── Loading / empty states ──────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (structures.length === 0) {
    // Vue dédiée joueur : l'user n'est dirigeant/staff nulle part, mais il est
    // membre simple d'au moins une structure — on affiche le layout joueur.
    if (playerStructures.length > 0) {
      return (
        <div className="min-h-screen hex-bg px-4 md:px-8 py-8">
          <div className="relative z-[1] max-w-6xl mx-auto space-y-10">
            <Breadcrumbs items={[{ label: 'Communauté', href: '/community' }, { label: 'Ma structure' }]} />
            {playerStructures.map(ps => (
              <PlayerStructureView key={ps.id} structure={ps} />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen hex-bg px-8 py-8 flex items-center justify-center">
        <div className="relative z-[1] bevel p-10 text-center max-w-md" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
            <Shield size={24} style={{ color: 'var(--s-gold)' }} />
          </div>
          <h2 className="font-display text-2xl mb-2">AUCUNE STRUCTURE</h2>
          <p className="t-body mb-6" style={{ color: 'var(--s-text-dim)' }}>Tu n&apos;as pas encore créé de structure.</p>
          <Link href="/community/create-structure" className="btn-springs btn-primary bevel-sm">
            Créer une structure
          </Link>
        </div>
      </div>
    );
  }

  const s = activeStructure!;
  const statusInfo = STATUS_INFO[s.status] ?? STATUS_INFO.pending_validation;
  const StatusIcon = statusInfo.icon;
  // Le dashboard est ouvert au fondateur ET aux co-fondateurs. Certaines actions
  // sont réservées au fondateur (promouvoir/rétrograder, transférer, supprimer).
  const isFounderOfActive = !!firebaseUser && s.founderId === firebaseUser.uid;
  const isCoFounderOfActive = !!firebaseUser && (s.coFounderIds ?? []).includes(firebaseUser.uid);
  const isDirigeantOfActive = isFounderOfActive || isCoFounderOfActive;
  const isManagerOfActive = !!firebaseUser && !isDirigeantOfActive && (s.managerIds ?? []).includes(firebaseUser.uid);
  const isCoachOfActive = !!firebaseUser && !isDirigeantOfActive && !isManagerOfActive && (s.coachIds ?? []).includes(firebaseUser.uid);
  // D&D équipes : aligne sur le gate de l'API (`isAdminOfStructure` côté serveur).
  const canReorderTeams = isDirigeantOfActive || isManagerOfActive;
  // Matrice de capacités par rôle — cf. visibleTabs ci-dessous pour la vue d'ensemble.
  // Les tabs filtrent déjà 95% des boutons write ; les quelques actions exposées sur des tabs
  // partagés (Membres = dirigeant+manager+coach) sont gatées à la volée via isDirigeantOfActive.
  // Onglets visibles selon le rôle. Les tabs cachés retirent à la fois le contenu
  // et l'entrée de la barre — aucun faux positif possible côté UI.
  // - Dirigeant : tout
  // - Manager   : équipes + recrutement (liens/demandes/invites/shortlist/suggestions — toggle ON/OFF
  //               + message public = dirigeant-only via PUT API gate) + membres + calendrier
  // - Coach     : membres (readonly) + calendrier (avec dispos/todos par équipe)
  // La branding et le toggle recrutement restent dirigeant-only (PUT API gate).
  // Capitaine-seul : accès uniquement à "son" équipe via ÉQUIPES (scope automatique)
  // et au calendrier. Pas de recrutement ni de membres structure-wide.
  const captainOnlyAccess = !isDirigeantOfActive && !isManagerOfActive && !isCoachOfActive && firebaseUser
    ? teams.some(t => t.captainId === firebaseUser.uid)
    : false;
  const visibleTabs: DashboardTab[] = isDirigeantOfActive
    ? ['general', 'teams', 'recruitment', 'members', 'calendar', 'todos', 'documents']
    : isManagerOfActive
    ? ['teams', 'recruitment', 'members', 'calendar', 'todos']
    : isCoachOfActive
    ? ['members', 'calendar', 'todos']
    : captainOnlyAccess
    ? ['teams', 'calendar']
    : ['calendar'];
  const myDepartureIso = firebaseUser ? s.coFounderDepartures?.[firebaseUser.uid] : null;
  const myDepartureRemainingMs = myDepartureIso ? Math.max(0, new Date(myDepartureIso).getTime() + DEPARTURE_NOTICE_MS - now) : null;

  // Transfert de propriété en cours (fenêtre 24h pour annuler)
  const transferPending = s.transferPending ?? null;
  const transferRemainingMs = transferPending?.scheduledAtMs
    ? Math.max(0, transferPending.scheduledAtMs - now)
    : null;
  const transferReady = transferPending?.scheduledAtMs != null && now >= transferPending.scheduledAtMs;
  const transferTargetMember = transferPending
    ? s.members.find(m => m.userId === transferPending.toUid)
    : null;
  const transferTargetName = transferTargetMember?.displayName || transferTargetMember?.discordUsername || 'le nouveau fondateur';
  const isTransferTarget = !!firebaseUser && transferPending?.toUid === firebaseUser.uid;

  // Contexte user pour le calendrier (derivé des données déjà chargées).
  const myMemberRole = firebaseUser ? s.members.find(m => m.userId === firebaseUser.uid)?.role : undefined;
  const staffedTeamIds = firebaseUser
    ? teams.filter(t => t.staff.some(st => st.uid === firebaseUser.uid)).map(t => t.id)
    : [];
  const captainOfTeamIds = firebaseUser
    ? teams.filter(t => t.captainId === firebaseUser.uid).map(t => t.id)
    : [];
  // Vue scopée sur ÉQUIPES pour tout rôle non-dirigeant (manager, coach, capitaine) :
  // n'affiche que les équipes où l'utilisateur est staff ou capitaine.
  const teamScopeActive = !isDirigeantOfActive && !!firebaseUser;
  const isTeamInScope = (team: TeamData) =>
    !teamScopeActive ||
    team.staff.some(st => st.uid === firebaseUser?.uid) ||
    team.captainId === firebaseUser?.uid;
  const userContext: UserContext = {
    uid: firebaseUser?.uid ?? '',
    isFounder: isFounderOfActive,
    isCoFounder: isCoFounderOfActive,
    isManager: myMemberRole === 'manager' || (firebaseUser ? (s.managerIds ?? []).includes(firebaseUser.uid) : false),
    isCoach: myMemberRole === 'coach' || (firebaseUser ? (s.coachIds ?? []).includes(firebaseUser.uid) : false),
    staffedTeamIds,
    captainOfTeamIds,
  };
  const calendarTeams = teams.map(t => ({
    id: t.id,
    name: t.name,
    game: t.game,
    logoUrl: t.logoUrl,
    playerIds: t.players.map(p => p.uid),
    subIds: t.subs.map(p => p.uid),
    staffIds: t.staff.map(p => p.uid),
    staffRoles: t.staffRoles ?? {},
  }));

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  async function loadInvitations(structureId: string) {
    if (!firebaseUser) return;
    setInvLoading(true);
    try {
      const data = await api<{ links?: InviteLink[]; requests?: JoinRequest[]; directInvites?: DirectInvite[] }>(
        `/api/structures/invitations?structureId=${structureId}`,
      );
      setInviteLinks(data.links ?? []);
      setJoinRequests(data.requests ?? []);
      setDirectInvites(data.directInvites ?? []);
    } catch (err) {
      console.error('[MyStructure] load invitations error:', err);
    }
    setInvLoading(false);
  }

  async function loadSuggestions(structureId: string) {
    if (!firebaseUser) return;
    setSuggestionsLoading(true);
    try {
      const data = await api<{ suggestions?: Suggestion[] }>(`/api/structures/${structureId}/recruitment-suggestions`);
      setSuggestions(data.suggestions ?? []);
    } catch (err) {
      console.error('[MyStructure] load suggestions error:', err);
    }
    setSuggestionsLoading(false);
  }

  async function loadShortlist(structureId: string) {
    if (!firebaseUser) return;
    setShortlistLoading(true);
    try {
      const data = await api<{ shortlist?: ShortlistItem[] }>(`/api/structures/${structureId}/shortlist`);
      setShortlist(data.shortlist ?? []);
    } catch (err) {
      console.error('[MyStructure] load shortlist error:', err);
    }
    setShortlistLoading(false);
  }

  async function loadHistory(structureId: string) {
    if (!firebaseUser) return;
    setHistoryLoading(true);
    try {
      const data = await api<{ history?: HistoryItem[] }>(`/api/structures/${structureId}/history`);
      setHistory(data.history ?? []);
    } catch (err) {
      console.error('[MyStructure] load history error:', err);
    }
    setHistoryLoading(false);
  }

  async function handleRemoveFromShortlist(targetUserId: string) {
    if (!activeStructure || !firebaseUser) return;
    // Optimistic update
    setShortlist(prev => prev.filter(s => s.uid !== targetUserId));
    try {
      await api(
        `/api/structures/${activeStructure.id}/shortlist?userId=${encodeURIComponent(targetUserId)}`,
        { method: 'DELETE' },
      );
    } catch {
      // Rollback
      await loadShortlist(activeStructure.id);
    }
  }

  async function handleCreateLink() {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading('create_link');
    try {
      const data = await api<{ token: string }>('/api/structures/invitations', {
        method: 'POST',
        body: {
          action: 'create_link',
          structureId: activeStructure.id,
          game: newLinkGame || null,
        },
      });
      const link = `${window.location.origin}/community/join/${data.token}`;
      const copied = await safeCopy(link);
      if (copied) {
        setCopiedLink(data.token);
        setTimeout(() => setCopiedLink(''), 3000);
      } else {
        toast.error('Lien créé — impossible de le copier, il est visible dans la liste.');
      }
      await loadInvitations(activeStructure.id);
    } catch (err) {
      console.error('[MyStructure] create link error:', err);
    }
    setInvActionLoading(null);
  }

  async function handleRevokeLink(invitationId: string) {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading(invitationId);
    try {
      await api('/api/structures/invitations', {
        method: 'POST',
        body: { action: 'revoke_link', structureId: activeStructure.id, invitationId },
      });
      await loadInvitations(activeStructure.id);
    } catch (err) {
      console.error('[MyStructure] revoke link error:', err);
    }
    setInvActionLoading(null);
  }

  async function handleCancelDirectInvite(invitationId: string) {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading(invitationId);
    try {
      await api('/api/structures/invitations', {
        method: 'POST',
        body: { action: 'cancel_direct_invite', structureId: activeStructure.id, invitationId },
      });
      await loadInvitations(activeStructure.id);
    } catch (err) {
      console.error('[MyStructure] cancel direct invite error:', err);
    }
    setInvActionLoading(null);
  }

  async function handleRequestAction(invitationId: string, accept: boolean) {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading(invitationId);
    try {
      await api('/api/structures/invitations', {
        method: 'POST',
        body: {
          action: accept ? 'accept_request' : 'decline_request',
          structureId: activeStructure.id,
          invitationId,
        },
      });
      await loadInvitations(activeStructure.id);
      if (accept) await loadStructures();
    } catch (err) {
      console.error('[MyStructure] request action error:', err);
    }
    setInvActionLoading(null);
  }

  async function handlePromoteToCoFounder(userId: string, memberName: string) {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Promouvoir co-fondateur',
      message: `Promouvoir ${memberName} en co-fondateur ? Il pourra gérer la structure comme toi (sauf transfert, suppression et gestion des co-fondateurs).`,
      confirmLabel: 'Promouvoir',
    });
    if (!ok) return;
    setInvActionLoading(userId);
    try {
      await api('/api/structures/co-founders', {
        method: 'POST',
        body: { structureId: activeStructure.id, targetUserId: userId },
      });
      await loadStructures();
      toast.success(`${memberName} promu co-fondateur`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleDemoteCoFounder(userId: string, memberName: string) {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Rétrograder le co-fondateur',
      message: `Retirer les droits de co-fondateur à ${memberName} ? Il redevient simple joueur de la structure.`,
      variant: 'danger',
      confirmLabel: 'Rétrograder',
    });
    if (!ok) return;
    setInvActionLoading(userId);
    try {
      await api('/api/structures/co-founders', {
        method: 'DELETE',
        body: { structureId: activeStructure.id, targetUserId: userId },
      });
      await loadStructures();
      toast.success(`${memberName} rétrogradé`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleToggleStaffRole(userId: string, memberName: string, role: 'manager' | 'coach', enabled: boolean) {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading(`${userId}:${role}`);
    try {
      await api('/api/structures/staff-role', {
        method: 'POST',
        body: { structureId: activeStructure.id, targetUserId: userId, role, enabled },
      });
      await loadStructures();
      const label = role === 'manager' ? 'Manager' : 'Coach';
      toast.success(enabled ? `${memberName} est maintenant ${label}` : `${memberName} n'est plus ${label}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleTransferOwnership(userId: string, memberName: string) {
    if (!activeStructure || !firebaseUser) return;
    const keepAsCoFounder = await confirm({
      title: `Transférer à ${memberName}`,
      message: `${memberName} deviendra le nouveau fondateur. Veux-tu rester dans la structure en tant que co-fondateur ?\n\n(Clique "Non" pour redevenir simple joueur à la place.)`,
      confirmLabel: 'Oui, co-fondateur',
      cancelLabel: 'Non, simple joueur',
    });
    const confirmTransfer = await confirm({
      title: 'Lancer le transfert',
      message: `Tu vas programmer le transfert de ${activeStructure.name} à ${memberName}. Une fenêtre de 24h s'ouvrira pour te laisser annuler si besoin. Au-delà, le transfert pourra être finalisé. Lancer ?`,
      variant: 'danger',
      confirmLabel: 'Lancer le transfert',
    });
    if (!confirmTransfer) return;
    setInvActionLoading(userId);
    try {
      await api('/api/structures/transfer', {
        method: 'POST',
        body: { action: 'initiate', structureId: activeStructure.id, newFounderId: userId, keepAsCoFounder },
      });
      await loadStructures();
      toast.success(`Transfert lancé. Tu as ${24}h pour annuler.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleCancelTransfer() {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Annuler le transfert',
      message: 'Tu vas annuler le transfert de propriété en cours. Tu resteras fondateur.',
      confirmLabel: 'Annuler le transfert',
    });
    if (!ok) return;
    setInvActionLoading('transfer-cancel');
    try {
      await api('/api/structures/transfer', {
        method: 'POST',
        body: { action: 'cancel', structureId: activeStructure.id },
      });
      await loadStructures();
      toast.success('Transfert annulé');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleConfirmTransfer() {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Finaliser le transfert',
      message: 'La fenêtre de 24h est écoulée. Le changement de fondateur sera appliqué immédiatement.',
      variant: 'danger',
      confirmLabel: 'Finaliser',
    });
    if (!ok) return;
    setInvActionLoading('transfer-confirm');
    try {
      await api('/api/structures/transfer', {
        method: 'POST',
        body: { action: 'confirm', structureId: activeStructure.id },
      });
      await loadStructures();
      toast.success('Transfert finalisé');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleLeaveAsCoFounder() {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Quitter en tant que co-fondateur',
      message: `Tu vas déposer un préavis de ${DEPARTURE_NOTICE_DAYS} jours. Passé ce délai tu seras automatiquement retiré du rôle de co-fondateur et redeviendra simple joueur. Tu peux annuler ton préavis à tout moment avant expiration.`,
      variant: 'danger',
      confirmLabel: 'Déposer le préavis',
    });
    if (!ok) return;
    setInvActionLoading('leave');
    try {
      await api('/api/structures/co-founders/leave', {
        method: 'POST',
        body: { structureId: activeStructure.id },
      });
      await loadStructures();
      toast.success('Préavis déposé');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleCancelLeave() {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading('leave');
    try {
      await api('/api/structures/co-founders/leave', {
        method: 'DELETE',
        body: { structureId: activeStructure.id },
      });
      await loadStructures();
      toast.success('Préavis annulé');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleRemoveMember(memberId: string, memberName: string) {
    if (!activeStructure || !firebaseUser) return;

    // Contextualiser le confirm : équipes impactées + rôles tenus (manager, coach,
    // capitaine…) pour éviter les retraits accidentels d'un membre clé.
    const member = activeStructure.members.find(m => m.id === memberId);
    const memberUid = member?.userId;
    const teamsImpacted = memberUid
      ? teams.filter(t =>
          t.players.some(p => p.uid === memberUid) ||
          t.subs.some(p => p.uid === memberUid) ||
          t.staff.some(p => p.uid === memberUid),
        )
      : [];
    const specialRoles: string[] = [];
    if (memberUid && (activeStructure.managerIds ?? []).includes(memberUid)) specialRoles.push('manager de structure');
    if (memberUid && (activeStructure.coachIds ?? []).includes(memberUid)) specialRoles.push('coach de structure');
    const captainOf = memberUid ? teams.filter(t => t.captainId === memberUid).map(t => t.name) : [];
    if (captainOf.length > 0) specialRoles.push(`capitaine de ${captainOf.join(', ')}`);

    let msg = `Retirer ${memberName} de la structure ?`;
    if (teamsImpacted.length > 0) {
      msg += `\n\nIl sera aussi retiré de ${teamsImpacted.length} équipe${teamsImpacted.length > 1 ? 's' : ''} : ${teamsImpacted.map(t => t.name).slice(0, 5).join(', ')}${teamsImpacted.length > 5 ? '…' : ''}.`;
    }
    if (specialRoles.length > 0) {
      msg += `\n\n⚠ Attention — ${memberName} est actuellement : ${specialRoles.join(' · ')}. Ce rôle sera perdu.`;
    }
    msg += '\n\nCette action est irréversible : si tu veux le réintégrer, il devra refaire une demande.';

    const ok = await confirm({
      title: `Retirer ${memberName}`,
      message: msg,
      variant: 'danger',
      confirmLabel: 'Retirer définitivement',
    });
    if (!ok) return;
    setInvActionLoading(memberId);
    try {
      await api('/api/structures/invitations', {
        method: 'POST',
        body: { action: 'remove_member', structureId: activeStructure.id, memberId },
      });
      await loadStructures();
      toast.success(`${memberName} retiré de la structure`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setInvActionLoading(null);
  }

  // ─── Not active state ────────────────────────────────────────────────
  // Structure en attente, suspendue ou refusée — vue minimale pour tous les rôles.
  if (s.status !== 'active') {
    return (
      <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
        <div className="relative z-[1]">
          {/* Header */}
          <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${statusInfo.color}, ${statusInfo.color}50, transparent 80%)` }} />
            <div className="relative z-[1] p-8 flex items-center gap-6">
              <div className="flex-shrink-0 w-16 h-16 relative overflow-hidden bevel-sm" style={{ background: 'var(--s-elevated)', border: '2px solid var(--s-border)' }}>
                {s.logoUrl ? (
                  <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Shield size={28} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="font-display text-3xl" style={{ letterSpacing: '0.03em' }}>{s.name}</h1>
                  <span className="tag tag-neutral">{s.tag}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon size={13} style={{ color: statusInfo.color }} />
                  <span className="t-mono text-xs" style={{ color: statusInfo.color }}>{statusInfo.label}</span>
                </div>
              </div>
            </div>
          </header>

          <div className="bevel p-10 text-center mt-6" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <StatusIcon size={32} className="mx-auto mb-4" style={{ color: statusInfo.color }} />
            <h2 className="font-display text-2xl mb-2">{s.name}</h2>
            <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>{statusInfo.desc}</p>
            {s.reviewComment && (
              <div className="mt-5 px-5 py-3 mx-auto max-w-md" style={{ background: 'var(--s-elevated)', border: `1px solid ${statusInfo.color}30` }}>
                <p className="t-label mb-1" style={{ color: statusInfo.color }}>Message admin</p>
                <p className="t-body">{s.reviewComment}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Active structure — full dashboard ───────────────────────────────

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
      <CompactStickyHeader
        icon={Shield}
        title={s.name || 'Ma structure'}
        accent="var(--s-gold)"
      />
      <div className="relative z-[1] space-y-8">

        <Breadcrumbs items={[
          { label: 'Communauté', href: '/community' },
          { label: 'Ma structure' },
        ]} />

        {/* Sélecteur si plusieurs structures */}
        {structures.length > 1 && (
          <div className="flex gap-3 animate-fade-in">
            {structures.map(st => (
              <button key={st.id} onClick={() => selectStructure(st)}
                className="tag transition-all duration-150"
                style={{
                  background: st.id === s.id ? 'rgba(255,184,0,0.15)' : 'transparent',
                  color: st.id === s.id ? 'var(--s-gold)' : 'var(--s-text-dim)',
                  borderColor: st.id === s.id ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                  cursor: 'pointer', padding: '8px 16px', fontSize: '12px',
                }}>
                {st.name}
              </button>
            ))}
          </div>
        )}

        {/* ═══ Header ═══ */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, var(--s-gold), var(--s-gold)50, transparent 80%)` }} />
          {/* Glow or subtil */}
          <div className="absolute top-0 left-0 w-64 h-64 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 0% 0%, rgba(255,184,0,0.06), transparent 60%)' }} />
          <div className="relative z-[1] p-8 flex items-center gap-6">
            <div className="flex-shrink-0 w-[72px] h-[72px] relative overflow-hidden bevel-sm" style={{ background: 'var(--s-elevated)', border: '2px solid rgba(255,184,0,0.2)' }}>
              {s.logoUrl ? (
                <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1.5" unoptimized />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Shield size={30} style={{ color: 'var(--s-text-muted)' }} />
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1.5">
                <h1 className="font-display text-4xl" style={{ letterSpacing: '0.04em' }}>{s.name}</h1>
                <span className="tag tag-gold" style={{ fontSize: '11px', padding: '3px 10px' }}>{s.tag}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <StatusIcon size={12} style={{ color: statusInfo.color }} />
                  <span className="t-mono text-xs" style={{ color: statusInfo.color }}>{statusInfo.label}</span>
                </div>
                <span style={{ color: 'var(--s-text-muted)' }}>·</span>
                <div className="flex gap-1.5">
                  {s.games?.map(g => (
                    <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                      style={{ fontSize: '9px', padding: '2px 6px' }}>
                      {g === 'rocket_league' ? 'RL' : 'TM'}
                    </span>
                  ))}
                </div>
                <span style={{ color: 'var(--s-text-muted)' }}>·</span>
                <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>{s.members.length} membre{s.members.length > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 flex-shrink-0">
              <Link href={`/community/structure/${s.id}`} className="btn-springs btn-secondary bevel-sm-border">
                <span><Eye size={14} /></span> <span>Page publique</span>
              </Link>
              {isCoFounderOfActive && !myDepartureIso && (
                <button type="button" onClick={handleLeaveAsCoFounder}
                  disabled={invActionLoading === 'leave'}
                  className="btn-springs btn-secondary bevel-sm-border text-xs"
                  style={{ color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                  {invActionLoading === 'leave' ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                  <span>Quitter (préavis {DEPARTURE_NOTICE_DAYS}j)</span>
                </button>
              )}
              {isCoFounderOfActive && myDepartureIso && myDepartureRemainingMs != null && (
                <button type="button" onClick={handleCancelLeave}
                  disabled={invActionLoading === 'leave'}
                  className="btn-springs btn-secondary bevel-sm-border text-xs"
                  style={{ color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.35)' }}>
                  {invActionLoading === 'leave' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  <span>Annuler préavis ({Math.ceil(myDepartureRemainingMs / (24 * 60 * 60 * 1000))}j restants)</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ═══ Bandeau transfert de propriété en cours ═══ */}
        {transferPending && (
          <div className="bevel relative"
            style={{
              background: 'rgba(255,184,0,0.06)',
              border: '1px solid rgba(255,184,0,0.35)',
            }}>
            <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.4) 60%, transparent)' }} />
            <div className="p-4 flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.3)' }}>
                  <AlertCircle size={14} style={{ color: 'var(--s-gold)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm tracking-wider mb-0.5" style={{ color: 'var(--s-gold)' }}>
                    Transfert de propriété en cours
                  </div>
                  <div className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    {isTransferTarget
                      ? <>Le fondateur t&apos;a désigné comme nouveau propriétaire de <strong style={{ color: 'var(--s-text)' }}>{s.name}</strong>.</>
                      : <>Tu as programmé le transfert à <strong style={{ color: 'var(--s-text)' }}>{transferTargetName}</strong>.</>}
                    {' '}
                    {transferReady
                      ? 'La fenêtre de 24h est écoulée — le transfert peut être finalisé.'
                      : transferRemainingMs != null
                      ? <>Il reste <strong style={{ color: 'var(--s-text)' }}>
                          {Math.max(1, Math.ceil(transferRemainingMs / (60 * 60 * 1000)))}h
                        </strong> avant de pouvoir le finaliser.</>
                      : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isFounderOfActive && (
                  <button type="button" onClick={handleCancelTransfer}
                    disabled={invActionLoading === 'transfer-cancel'}
                    className="btn-springs btn-secondary bevel-sm-border text-xs"
                    style={{ color: 'var(--s-text)' }}>
                    {invActionLoading === 'transfer-cancel' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                    <span>Annuler le transfert</span>
                  </button>
                )}
                {(isFounderOfActive || isTransferTarget) && transferReady && (
                  <button type="button" onClick={handleConfirmTransfer}
                    disabled={invActionLoading === 'transfer-confirm'}
                    className="btn-springs btn-primary bevel-sm">
                    {invActionLoading === 'transfer-confirm' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    <span>Finaliser maintenant</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ Aperçu public (onglet général uniquement) ═══ */}
        {tab === 'general' && s.status === 'active' && (
          <PublicPreviewFrame
            href={`/community/structure/${s.id}`}
            helper="Ta carte telle qu'elle apparaît dans l'annuaire des structures et les feeds communauté."
          >
            <div
              className="panel bevel relative overflow-hidden"
              style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
            >
              <div
                className="h-[3px]"
                style={{
                  background: s.games.includes('rocket_league')
                    ? 'linear-gradient(90deg, var(--s-blue), transparent 70%)'
                    : 'linear-gradient(90deg, var(--s-green), transparent 70%)',
                }}
              />
              <div className="p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div
                    className="w-14 h-14 flex-shrink-0 relative overflow-hidden"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
                  >
                    {s.logoUrl ? (
                      <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Shield size={20} style={{ color: 'var(--s-text-muted)' }} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-display text-lg tracking-wider truncate">{s.name}</h3>
                      <span
                        className="tag tag-neutral"
                        style={{ fontSize: '9px', padding: '1px 5px', flexShrink: 0 }}
                      >
                        {s.tag}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {s.games.map((g) => (
                        <span
                          key={g}
                          className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                          style={{ fontSize: '9px', padding: '1px 6px' }}
                        >
                          {g === 'rocket_league' ? 'RL' : 'TM'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className="flex items-center justify-between pt-3"
                  style={{ borderTop: '1px dashed var(--s-border)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <Users size={12} style={{ color: 'var(--s-text-muted)' }} />
                    <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>
                      {s.members.length} membre{s.members.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  {s.recruiting?.active && (
                    <span className="tag tag-green" style={{ fontSize: '9px', padding: '2px 7px' }}>
                      RECRUTE
                    </span>
                  )}
                </div>
              </div>
            </div>
          </PublicPreviewFrame>
        )}

        {/* ═══ Onglets ═══ */}
        <TabBar active={tab} onChange={setTab} visible={visibleTabs} />

        {/* ═══ Dashboard — layout dynamique par onglet ═══ */}
        {tab !== 'calendar' && (
        <div className={`grid gap-6 animate-fade-in ${tab === 'general' ? 'grid-cols-3' : 'grid-cols-1'}`}>

          {/* ─── Colonne gauche (ou pleine largeur hors général) ──────── */}
          <div className={
            tab === 'general' ? 'col-span-2 space-y-6'
            : tab === 'members' ? 'hidden'
            : 'space-y-6'
          }>

            {/* ═══ GÉNÉRAL — Description / Configuration / Réseaux sociaux ═══ */}
            {tab === 'general' && (<>
            <SectionPanel accent="var(--s-violet)" icon={MessageSquare} title="DESCRIPTION"
              collapsed={collapsed.desc} onToggle={() => toggle('desc')}>
              <div className="space-y-3">
                <div className="relative">
                  <textarea ref={descRef} className="settings-input w-full" rows={5}
                    value={editDesc} onChange={e => setEditDesc(e.target.value)}
                    placeholder="Présente ta structure..." />
                  {/* Emoji picker toggle */}
                  <div className="relative inline-block">
                    <button type="button" onClick={() => setShowEmojis(!showEmojis)}
                      className="mt-1.5 text-xs flex items-center gap-1.5 px-2 py-1 transition-colors duration-150"
                      style={{ color: showEmojis ? 'var(--s-gold)' : 'var(--s-text-muted)', background: showEmojis ? 'rgba(255,184,0,0.08)' : 'transparent', border: `1px solid ${showEmojis ? 'rgba(255,184,0,0.2)' : 'var(--s-border)'}` }}>
                      <span style={{ fontSize: '14px' }}>😀</span> Emojis
                    </button>
                    {showEmojis && (
                      <div className="absolute left-0 top-full mt-1 p-2 z-50 flex flex-wrap" style={{ width: '320px', background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        {['🏆', '🥇', '🥈', '🥉', '⭐', '🔥', '💪', '🎮', '🎯', '🚀', '⚽', '🏎️', '🏁', '👑', '💎', '🛡️', '⚔️', '🎉', '📢', '💬', '✅', '❌', '🔵', '🟢', '🟡', '🔴', '⚡', '💥', '🌟', '🏅', '👊', '🤝', '📊', '📈', '🗓️', '🎪', '🏟️', '🎖️', '🧩', '🕹️'].map(emoji => (
                          <button key={emoji} type="button"
                            className="hover:bg-[var(--s-hover)] transition-colors duration-100"
                            style={{ width: '30px', height: '30px', fontSize: '16px', lineHeight: '30px', textAlign: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}
                            onClick={() => {
                              const ta = descRef.current;
                              if (ta) {
                                const start = ta.selectionStart;
                                const end = ta.selectionEnd;
                                const newVal = editDesc.slice(0, start) + emoji + editDesc.slice(end);
                                setEditDesc(newVal);
                                setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + emoji.length; }, 0);
                              } else {
                                setEditDesc(editDesc + emoji);
                              }
                            }}>
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* Légende markdown */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-1" style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}>
                  <span><strong style={{ color: 'var(--s-text-dim)' }}>**gras**</strong></span>
                  <span><em>*italique*</em></span>
                  <span>## Titre</span>
                  <span>- liste</span>
                  <span>[lien](url)</span>
                  <span>&gt; citation</span>
                </div>
                {editDesc.trim() && (
                  <div>
                    <p className="t-label mb-2" style={{ color: 'var(--s-text-muted)' }}>APERÇU</p>
                    <div className="p-3 prose-springs text-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <ReactMarkdown>{editDesc}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </SectionPanel>

            {/* Configuration */}
            <SectionPanel accent="var(--s-gold)" icon={Settings} title="CONFIGURATION"
              collapsed={collapsed.config} onToggle={() => toggle('config')}>
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  <ImageUploader
                    label="Logo de la structure"
                    hint="Carré — idéalement fond transparent. Max 2 MB."
                    aspect="square"
                    maxBytes={UPLOAD_LIMITS.STRUCTURE_LOGO_BYTES}
                    currentUrl={activeStructure?.logoUrl || editLogoUrl || null}
                    endpoint="/api/upload/structure-image"
                    extraFields={{ structureId: activeStructure?.id || '', type: 'logo' }}
                    disabled={!activeStructure}
                    onUploaded={(url) => {
                      setEditLogoUrl(url);
                      if (activeStructure) setActiveStructure({ ...activeStructure, logoUrl: url });
                      void loadStructures();
                    }}
                  />
                  <div>
                    <label className="t-label block mb-2">Serveur Discord</label>
                    <input type="url" className="settings-input w-full"
                      value={editDiscordUrl} onChange={e => setEditDiscordUrl(e.target.value)}
                      placeholder="https://discord.gg/..." />
                  </div>
                </div>
                <ImageUploader
                  label="Bannière de la page publique"
                  hint="Ratio 4:1 recommandé (1920×480). Max 5 MB."
                  aspect="banner"
                  maxBytes={UPLOAD_LIMITS.STRUCTURE_BANNER_BYTES}
                  currentUrl={activeStructure?.coverUrl || null}
                  endpoint="/api/upload/structure-image"
                  extraFields={{ structureId: activeStructure?.id || '', type: 'banner' }}
                  disabled={!activeStructure}
                  onUploaded={(url) => {
                    if (activeStructure) setActiveStructure({ ...activeStructure, coverUrl: url });
                    void loadStructures();
                  }}
                />
              </div>
            </SectionPanel>

            {/* Bot Discord — pour les notifs automatiques dans les salons d'équipe */}
            <SectionPanel accent="#5865F2" icon={MessageSquare} title="BOT DISCORD"
              collapsed={collapsed.discordBot} onToggle={() => toggle('discordBot')}>
              {activeStructure?.discordIntegration ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bevel-sm"
                    style={{ background: 'rgba(88,101,242,0.08)', border: '1px solid rgba(88,101,242,0.25)' }}>
                    <div className="flex items-center justify-center w-10 h-10 bevel-sm"
                      style={{ background: 'rgba(88,101,242,0.2)', border: '1px solid rgba(88,101,242,0.4)' }}>
                      <Check size={18} style={{ color: '#5865F2' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="t-sub truncate">Connecté à {activeStructure.discordIntegration.guildName}</div>
                      <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        Le bot peut poster les notifs d&apos;événements dans les salons d&apos;équipe.
                      </div>
                    </div>
                  </div>
                  {/* Config Discord par scope (structure, par jeu, staff).
                      Les salons par équipe sont configurés depuis la card
                      de l'équipe (menu kebab → "Configurer le salon Discord"). */}
                  <div className="space-y-2">
                    <div className="t-label flex items-center gap-2" style={{ color: 'var(--s-text-dim)' }}>
                      <Settings size={12} />
                      Salons & rôles par scope
                    </div>
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Pour les events qui ciblent toute la structure, un jeu entier,
                      ou le staff : choisis le salon où poster et le rôle à ping.
                      Les salons par équipe se configurent directement sur la card
                      de chaque équipe.
                    </p>
                    {renderDiscordConfigBlock({
                      key: 'structure',
                      scope: { scope: 'structure' },
                      label: 'Toute la structure',
                      accentColor: '#FFB800',
                      currentChannelId: activeStructure.discordIntegration.structureChannelId ?? null,
                      currentChannelName: activeStructure.discordIntegration.structureChannelName ?? null,
                      currentRoleId: activeStructure.discordIntegration.structureRoleId ?? null,
                      currentRoleName: activeStructure.discordIntegration.structureRoleName ?? null,
                    })}
                    {activeStructure.games.includes('rocket_league') && renderDiscordConfigBlock({
                      key: 'game:rocket_league',
                      scope: { scope: 'game', game: 'rocket_league' },
                      label: 'Rocket League',
                      accentColor: '#0081FF',
                      currentChannelId: activeStructure.discordIntegration.gameChannels?.rocket_league?.channelId ?? null,
                      currentChannelName: activeStructure.discordIntegration.gameChannels?.rocket_league?.channelName ?? null,
                      currentRoleId: activeStructure.discordIntegration.gameChannels?.rocket_league?.roleId ?? null,
                      currentRoleName: activeStructure.discordIntegration.gameChannels?.rocket_league?.roleName ?? null,
                    })}
                    {activeStructure.games.includes('trackmania') && renderDiscordConfigBlock({
                      key: 'game:trackmania',
                      scope: { scope: 'game', game: 'trackmania' },
                      label: 'Trackmania',
                      accentColor: '#00D936',
                      currentChannelId: activeStructure.discordIntegration.gameChannels?.trackmania?.channelId ?? null,
                      currentChannelName: activeStructure.discordIntegration.gameChannels?.trackmania?.channelName ?? null,
                      currentRoleId: activeStructure.discordIntegration.gameChannels?.trackmania?.roleId ?? null,
                      currentRoleName: activeStructure.discordIntegration.gameChannels?.trackmania?.roleName ?? null,
                    })}
                    {renderDiscordConfigBlock({
                      key: 'staff',
                      scope: { scope: 'staff' },
                      label: 'Staff',
                      accentColor: 'var(--s-violet-light)',
                      currentChannelId: activeStructure.discordIntegration.staffChannelId ?? null,
                      currentChannelName: activeStructure.discordIntegration.staffChannelName ?? null,
                      currentRoleId: activeStructure.discordIntegration.staffRoleId ?? null,
                      currentRoleName: activeStructure.discordIntegration.staffRoleName ?? null,
                    })}
                  </div>
                  <div className="flex justify-end pt-2 border-t" style={{ borderColor: 'var(--s-border)' }}>
                    <button type="button"
                      className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
                      disabled={discordLoading}
                      onClick={handleDisconnectDiscord}>
                      {discordLoading ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                      Déconnecter
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    Connecte le bot Springs Hub à ton serveur Discord pour recevoir
                    automatiquement les notifications d&apos;événements dans le salon
                    de chaque équipe. Tu pourras choisir le salon par équipe après la connexion.
                  </p>
                  <div className="p-3 bevel-sm text-xs space-y-1"
                    style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.2)', color: 'var(--s-text-dim)' }}>
                    <div className="flex items-center gap-2 font-medium" style={{ color: 'var(--s-gold)' }}>
                      <AlertCircle size={12} />
                      Le bot demande la permission Administrator
                    </div>
                    <p>
                      C&apos;est nécessaire pour poster dans les salons privés des équipes
                      sans que tu doives ajouter le bot manuellement sur chaque salon. Le bot
                      ne fait rien d&apos;autre que poster des embeds d&apos;événements —
                      tu peux révoquer son accès à tout moment en le retirant du serveur.
                    </p>
                  </div>
                  <button type="button"
                    className="btn-springs btn-primary bevel-sm flex items-center gap-2"
                    disabled={discordLoading}
                    onClick={handleConnectDiscord}>
                    {discordLoading ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                    Connecter Discord
                  </button>
                </div>
              )}
            </SectionPanel>

            {/* Réseaux sociaux */}
            <SectionPanel accent="#5865F2" icon={Link2} title="RÉSEAUX SOCIAUX"
              collapsed={collapsed.socials} onToggle={() => toggle('socials')}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {Object.entries(SOCIAL_LABELS).map(([key, label]) => (
                  <div key={key}>
                    <label className="t-label block mb-1.5">{label}</label>
                    <input type="url" className="settings-input w-full" placeholder="https://..."
                      value={editSocials[key] || ''}
                      onChange={e => setEditSocials({ ...editSocials, [key]: e.target.value })} />
                  </div>
                ))}
              </div>
            </SectionPanel>
            </>)}

            {/* ═══ RECRUTEMENT ═══ */}
            {tab === 'recruitment' && (
              <RecruitmentTab
                s={s}
                editRecruiting={editRecruiting}
                setEditRecruiting={setEditRecruiting}
                recruitMessageRef={recruitMessageRef}
                handleSave={handleSave}
                saving={saving}
                saved={saved}
                error={error}
                collapsed={collapsed}
                toggle={toggle}
                isDirigeantOfActive={isDirigeantOfActive}
                isManagerOfActive={isManagerOfActive}
                newLinkGame={newLinkGame}
                setNewLinkGame={setNewLinkGame}
                inviteLinks={inviteLinks}
                copiedLink={copiedLink}
                setCopiedLink={setCopiedLink}
                handleCreateLink={handleCreateLink}
                handleRevokeLink={handleRevokeLink}
                invActionLoading={invActionLoading}
                invLoading={invLoading}
                joinRequests={joinRequests}
                handleRequestAction={handleRequestAction}
                directInvites={directInvites}
                handleCancelDirectInvite={handleCancelDirectInvite}
                shortlist={shortlist}
                shortlistLoading={shortlistLoading}
                handleRemoveFromShortlist={handleRemoveFromShortlist}
                suggestions={suggestions}
                suggestionsLoading={suggestionsLoading}
                toast={toast}
              />
            )}


            {/* ═══ GÉNÉRAL — Palmarès ═══ */}
            {tab === 'general' && (
            <SectionPanel accent="var(--s-gold)" icon={Trophy} title="PALMARÈS"
              collapsed={collapsed.palmares} onToggle={() => toggle('palmares')}
              action={
                <button type="button" onClick={() => setEditAchievements([...editAchievements, { placement: '', competition: '', game: s.games[0] || 'rocket_league', date: '' }])}
                  className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150" style={{ color: 'var(--s-gold)' }}>
                  <Plus size={11} /> Ajouter
                </button>
              }>
              {editAchievements.length === 0 ? (
                <div className="text-center py-4">
                  <Trophy size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun résultat enregistré.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {editAchievements.map((a, i) => (
                    <div key={i} className="p-3 space-y-2.5" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <div>
                            <label className="t-label block mb-1">Placement *</label>
                            <select className="settings-input w-full" value={a.placement}
                              onChange={e => {
                                const achs = [...editAchievements];
                                achs[i] = { ...a, placement: e.target.value };
                                setEditAchievements(achs);
                              }}>
                              <option value="">Choisir...</option>
                              <option value="1er">1er</option>
                              <option value="2e">2e</option>
                              <option value="3e">3e</option>
                              <option value="Top 4">Top 4</option>
                              <option value="Top 8">Top 8</option>
                              <option value="Top 16">Top 16</option>
                              <option value="Demi-finale">Demi-finale</option>
                              <option value="Quart de finale">Quart de finale</option>
                              <option value="Participant">Participant</option>
                            </select>
                          </div>
                          <div>
                            <label className="t-label block mb-1">Compétition *</label>
                            <input type="text" className="settings-input w-full" placeholder="Springs Cup S2"
                              value={a.competition} onChange={e => {
                                const achs = [...editAchievements];
                                achs[i] = { ...a, competition: e.target.value };
                                setEditAchievements(achs);
                              }} />
                          </div>
                        </div>
                        <button type="button" onClick={() => setEditAchievements(editAchievements.filter((_, j) => j !== i))}
                          className="mt-3 p-1" style={{ color: '#ff5555' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="t-label block mb-1">Jeu</label>
                          <select className="settings-input w-full" value={a.game}
                            onChange={e => {
                              const achs = [...editAchievements];
                              achs[i] = { ...a, game: e.target.value };
                              setEditAchievements(achs);
                            }}>
                            <option value="rocket_league">Rocket League</option>
                            <option value="trackmania">Trackmania</option>
                          </select>
                        </div>
                        <div>
                          <label className="t-label block mb-1">Date</label>
                          <input type="month" className="settings-input w-full"
                            value={a.date} onChange={e => {
                              const achs = [...editAchievements];
                              achs[i] = { ...a, date: e.target.value };
                              setEditAchievements(achs);
                            }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionPanel>
            )}

            {/* ═══ ÉQUIPES ═══ */}
            {tab === 'teams' && (
              <TeamsTab
                s={s}
                activeStructure={activeStructure}
                teams={teams}
                teamsLoading={teamsLoading}
                teamSearch={teamSearch}
                setTeamSearch={setTeamSearch}
                showNewTeam={showNewTeam}
                setShowNewTeam={setShowNewTeam}
                newTeamName={newTeamName}
                setNewTeamName={setNewTeamName}
                newTeamGame={newTeamGame}
                setNewTeamGame={setNewTeamGame}
                newTeamLabel={newTeamLabel}
                setNewTeamLabel={setNewTeamLabel}
                newTeamLogoUrl={newTeamLogoUrl}
                setNewTeamLogoUrl={setNewTeamLogoUrl}
                showArchived={showArchived}
                setShowArchived={setShowArchived}
                teamMenuOpen={teamMenuOpen}
                setTeamMenuOpen={setTeamMenuOpen}
                teamMenuRect={teamMenuRect}
                setTeamMenuRect={setTeamMenuRect}
                captainPickerOpen={captainPickerOpen}
                setCaptainPickerOpen={setCaptainPickerOpen}
                teamLogoEdit={teamLogoEdit}
                setTeamLogoEdit={setTeamLogoEdit}
                teamLabelEdit={teamLabelEdit}
                setTeamLabelEdit={setTeamLabelEdit}
                teamDiscordEdit={teamDiscordEdit}
                setTeamDiscordEdit={setTeamDiscordEdit}
                teamActionLoading={teamActionLoading}
                expandedTeamGroups={expandedTeamGroups}
                setExpandedTeamGroups={setExpandedTeamGroups}
                collapsedTeamGroups={collapsedTeamGroups}
                setCollapsedTeamGroups={setCollapsedTeamGroups}
                healthOpen={healthOpen}
                setHealthOpen={setHealthOpen}
                collapsed={collapsed}
                toggle={toggle}
                discordChannels={discordChannels}
                discordChannelsLoading={discordChannelsLoading}
                discordChannelsError={discordChannelsError}
                loadDiscordChannels={loadDiscordChannels}
                isDirigeantOfActive={isDirigeantOfActive}
                isFounderOfActive={isFounderOfActive}
                canReorderTeams={canReorderTeams}
                teamScopeActive={teamScopeActive}
                isTeamInScope={isTeamInScope}
                handleCreateTeam={handleCreateTeam}
                handleArchiveTeam={handleArchiveTeam}
                handleSetCaptain={handleSetCaptain}
                handleUpdateTeamLogo={handleUpdateTeamLogo}
                handleUpdateTeamLabel={handleUpdateTeamLabel}
                handleUpdateTeamRoster={handleUpdateTeamRoster}
                handleUpdateTeamStaff={handleUpdateTeamStaff}
                handleDeleteTeam={handleDeleteTeam}
                handleUpdateTeamDiscordChannel={handleUpdateTeamDiscordChannel}
                reorderTeamsInGroup={reorderTeamsInGroup}
                reorderGroups={reorderGroups}
                moveTeamToGroup={moveTeamToGroup}
                dndSensors={dndSensors}
              />
            )}


            {/* ═══ Save button — onglet général uniquement (recrutement a son propre save in-panel) ═══ */}
            {tab === 'general' && isDirigeantOfActive && (<>
            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bevel-sm" style={{ background: 'rgba(255,50,50,0.08)', border: '1px solid rgba(255,50,50,0.25)' }}>
                <AlertCircle size={14} style={{ color: '#ff5555' }} />
                <span className="text-sm" style={{ color: '#ff5555' }}>{error}</span>
              </div>
            )}

            <button onClick={handleSave} disabled={saving}
              className="btn-springs btn-primary bevel-sm flex items-center gap-2 px-6 py-3">
              {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle size={15} /> : <Save size={15} />}
              <span className="font-display text-sm tracking-wider">
                {saving ? 'SAUVEGARDE...' : saved ? 'SAUVEGARDÉ !' : 'SAUVEGARDER'}
              </span>
            </button>
            </>)}
          </div>

          {/* ─── Colonne droite ─ Invites+Membres (members) ou Info+Stats (general) ──── */}
          <div className={
            tab === 'general' ? 'space-y-6 animate-fade-in-d2'
            : tab === 'members' ? 'space-y-6 animate-fade-in-d2'
            : 'hidden'
          }>

            {/* ═══ MEMBRES — Joueurs sans équipe + bannière nouvelle recrue ═══ */}
            {tab === 'members' && (
              <MembersTab
                s={s}
                teams={teams}
                now={now}
                isDirigeantOfActive={isDirigeantOfActive}
                isFounderOfActive={isFounderOfActive}
                isCoFounderOfActive={isCoFounderOfActive}
                isManagerOfActive={isManagerOfActive}
                invActionLoading={invActionLoading}
                history={history}
                historyLoading={historyLoading}
                setTab={setTab}
                handleToggleStaffRole={handleToggleStaffRole}
                handlePromoteToCoFounder={handlePromoteToCoFounder}
                handleDemoteCoFounder={handleDemoteCoFounder}
                handleTransferOwnership={handleTransferOwnership}
                handleRemoveMember={handleRemoveMember}
              />
            )}


            {/* ═══ GÉNÉRAL — Informations ═══ */}
            {tab === 'general' && (
            <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), rgba(123,47,190,0.3), transparent 70%)' }} />
              <div className="relative z-[1] px-5 py-3.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(123,47,190,0.08)', border: '1px solid rgba(123,47,190,0.2)' }}>
                    <Shield size={13} style={{ color: 'var(--s-violet-light)' }} />
                  </div>
                  <span className="font-display text-sm tracking-wider">INFORMATIONS</span>
                </div>
              </div>
              <div className="relative z-[1] p-5 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Statut</span>
                  <span className="tag" style={{ background: `${statusInfo.color}12`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '9px', padding: '2px 8px' }}>
                    {statusInfo.label}
                  </span>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Jeux</span>
                  <div className="flex gap-1.5">
                    {s.games?.map(g => (
                      <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                        style={{ fontSize: '9px', padding: '2px 6px' }}>
                        {g === 'rocket_league' ? 'RL' : 'TM'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Équipes</span>
                  <span className="font-display text-sm">{teams.length}</span>
                </div>
                {s.validatedAt && (
                  <>
                    <div className="divider" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Validée le</span>
                      <span className="t-mono text-xs">{new Date(s.validatedAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            )}

            {/* ═══ GÉNÉRAL — Quick stats ═══ */}
            {tab === 'general' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bevel-sm p-4 text-center relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,129,255,0.06), transparent 70%)' }} />
                <p className="font-display text-2xl relative z-[1]" style={{ color: 'var(--s-blue)' }}>{teams.filter(t => t.game === 'rocket_league').length}</p>
                <p className="t-label mt-1 relative z-[1]">ÉQUIPES RL</p>
              </div>
              <div className="bevel-sm p-4 text-center relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,217,54,0.06), transparent 70%)' }} />
                <p className="font-display text-2xl relative z-[1]" style={{ color: 'var(--s-green)' }}>{teams.filter(t => t.game === 'trackmania').length}</p>
                <p className="t-label mt-1 relative z-[1]">ÉQUIPES TM</p>
              </div>
            </div>
            )}
          </div>
        </div>
        )}

        {/* ═══ CALENDRIER ═══ */}
        {tab === 'calendar' && (
        <div className="animate-fade-in-d3 space-y-6">
          {/* Launcher Dispos & matching : une carte par équipe accessible (staff ou dirigeant).
              Cœur de l'UX — le coach accède aux dispos de son équipe depuis ici, le manager
              et le dirigeant voient toutes les équipes pour préparer les rosters côté calendrier. */}
          {(() => {
            const isDirigeant = isDirigeantOfActive;
            const isManagerLevel = isDirigeant || isManagerOfActive;
            // Équipes visibles :
            // - dirigeant/manager : toutes les équipes de la structure
            // - coach : uniquement celles dont il est staff (via staffedTeamIds)
            const visibleTeams = isManagerLevel
              ? teams
              : teams.filter(t => staffedTeamIds.includes(t.id));
            if (visibleTeams.length === 0) return null;
            return (
              <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), rgba(123,47,190,0.3), transparent 70%)' }} />
                <div className="absolute top-0 right-0 w-40 h-40 pointer-events-none"
                  style={{ background: 'radial-gradient(circle at 100% 0%, rgba(123,47,190,0.06), transparent 70%)' }} />
                <div className="relative z-[1] px-5 py-3.5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--s-border)' }}>
                  <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(123,47,190,0.1)', border: '1px solid rgba(123,47,190,0.25)' }}>
                    <CalendarClock size={13} style={{ color: 'var(--s-violet-light)' }} />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-display text-sm tracking-wider">DISPOS, DEVOIRS &amp; REPLAYS PAR ÉQUIPE</h2>
                    <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Ouvre une équipe pour voir les dispos, les devoirs en cours et la bibliothèque de replays.</p>
                  </div>
                </div>
                <div className="relative z-[1] p-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                  {visibleTeams.map(team => {
                    const drawerTeam: DrawerTeam = {
                      id: team.id,
                      name: team.name,
                      game: team.game,
                      players: team.players,
                      subs: team.subs,
                      staff: team.staff,
                    };
                    const gameTag = team.game === 'rocket_league' ? 'RL' : team.game === 'trackmania' ? 'TM' : team.game;
                    const gameClass = team.game === 'rocket_league' ? 'tag-blue' : 'tag-green';
                    return (
                      <div key={team.id} className="p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`tag ${gameClass}`} style={{ fontSize: '9px', padding: '2px 6px' }}>{gameTag}</span>
                          <span className="font-display text-sm tracking-wider flex-1 truncate">{team.name.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <TeamActionChip
                            icon={<CalendarClock size={12} />}
                            label="Dispos & matching"
                            onClick={() => setDrawerState({ team: drawerTeam, tab: 'availability', canEditConfig: isDirigeant })}
                          />
                          <TeamActionChip
                            icon={<ClipboardList size={12} />}
                            label="Devoirs"
                            onClick={() => setDrawerState({ team: drawerTeam, tab: 'todos', canEditConfig: isDirigeant })}
                          />
                          <TeamActionChip
                            icon={<Film size={12} />}
                            label="Replays"
                            onClick={() => setDrawerState({ team: drawerTeam, tab: 'replays', canEditConfig: isDirigeant })}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <CalendarSection
            structureId={s.id}
            structureGames={s.games ?? []}
            structureLogoUrl={s.logoUrl}
            members={s.members}
            teams={calendarTeams}
            userContext={userContext}
            structureRoles={{
              founderId: s.founderId,
              coFounderIds: s.coFounderIds,
              managerIds: s.managerIds,
              coachIds: s.coachIds,
            }}
          />
        </div>
        )}

        {/* ═══ DEVOIRS (cross-teams) ═══ */}
        {tab === 'todos' && (
          <div className="animate-fade-in-d3">
            <CrossTeamTodosPanel
              structureId={s.id}
              initialTodoId={pendingTodoId}
              onConsumedTodo={() => setPendingTodoId(null)}
              onOpenTeam={(teamId) => {
                const t = teams.find(x => x.id === teamId);
                if (!t) return;
                const drawerTeam: DrawerTeam = {
                  id: t.id, name: t.name, game: t.game,
                  players: t.players, subs: t.subs, staff: t.staff,
                };
                setDrawerState({ team: drawerTeam, tab: 'todos', canEditConfig: isDirigeantOfActive });
              }}
            />
          </div>
        )}

        {/* ═══ DOCUMENTS ═══ */}
        {tab === 'documents' && isDirigeantOfActive && (
          <div className="animate-fade-in-d3">
            <DocumentsExplorer structureId={s.id} />
          </div>
        )}
      </div>
      {/* Drawer détail équipe (Dispos + Devoirs) */}
      <TeamDetailDrawer
        open={drawerState !== null}
        onClose={() => setDrawerState(null)}
        structureId={s.id}
        team={drawerState?.team ?? null}
        initialTab={drawerState?.tab ?? 'availability'}
        canEditConfig={drawerState?.canEditConfig ?? false}
        userContext={userContext}
      />
    </div>
  );
}
