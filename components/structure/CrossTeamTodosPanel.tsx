'use client';

// Refonte 2026-05-26 — Onglet "Exercices" structure repensé pour un coach pro :
//   - Header avec bouton "+ Nouvel exercice" (modal avec sélecteur d'équipe + NewTodoForm)
//   - 3 compteurs (en retard / cette semaine / faits 7j)
//   - Section "À RELANCER" : exos en retard groupés PAR JOUEUR avec bouton copier mention Discord
//   - Section "PERFORMANCE 7 DERNIERS JOURS" : leaderboard par joueur (barre + %)
//   - Liste filtrée enrichie : ligne d'exo riche (titre + tags steps + date + assignee + état)
//
// La heatmap brute par jour a été virée (illisible, info inactionnable).

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Clock, CheckCircle2, Filter, Loader2, ListChecks, Users, Plus, Send, X, Library,
  type LucideIcon,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import Portal from '@/components/ui/Portal';
import {
  TODO_TYPE_META, getSteps, getStepProgress,
  type TodoRef, type TodoType, type ExerciseStep,
} from '@/lib/todos';
import TodoDetailDrawer, { type DrawerTodo } from '@/components/calendar/TodoDetailDrawer';
import { NewTodoForm, type TeamRef, type Member, type EventOpt } from '@/components/calendar/TeamTodosPanel';
import TodoTemplatesManager, { useTodoTemplates } from '@/components/calendar/TodoTemplatesManager';
import { useAuth } from '@/context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────

type OverviewTeam = { id: string; name: string; label: string | null; game: string; logoUrl: string | null; order: number; groupOrder: number };
type OverviewUser = { uid: string; displayName: string; avatarUrl: string };
type OverviewTodo = {
  id: string;
  structureId: string;
  subTeamId: string;
  assigneeId: string;
  type: TodoType;
  title: string;
  description: string;
  config: Record<string, unknown>;
  response: Record<string, unknown> | null;
  steps?: ExerciseStep[];
  eventId: string | null;
  deadline: string | null;
  deadlineAt: number | null;
  deadlineMode: 'absolute' | 'relative' | null;
  deadlineOffsetDays: number | null;
  done: boolean;
  doneAt: number | null;
  doneBy: string | null;
  lockedAt: number | null;
  lockedBy: string | null;
  createdBy: string;
  createdAt: number;
};
type OverviewCounts = { overdue: number; dueToday: number; dueThisWeek: number; doneLast7d: number; pendingTotal: number };
type OverviewData = {
  teams: OverviewTeam[];
  users: OverviewUser[];
  todos: OverviewTodo[];
  counts: OverviewCounts;
  canSeeAll: boolean;
  isDirigeant: boolean;
};

// Shape du payload renvoyé par /api/structures/teams?structureId=X (utilisé pour la modal create)
type TeamFull = {
  id: string;
  name: string;
  label: string;
  game: string;
  players: Member[];
  subs: Member[];
  staff: Member[];
  status: 'active' | 'archived';
};

type StateFilter = 'all' | 'overdue' | 'today' | 'week' | 'pending' | 'done';

const GAME_COLOR: Record<string, string> = {
  rocket_league: 'var(--s-blue)',
  trackmania: 'var(--s-green)',
};

const DAY_MS = 86_400_000;

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDeadlineLabel(ms: number | null, done: boolean): { text: string; color: string; bg: string; border: string } {
  if (done) return { text: 'Terminé', color: 'var(--s-gold)', bg: 'rgba(255,184,0,0.10)', border: 'rgba(255,184,0,0.30)' };
  if (ms === null) return { text: 'Sans deadline', color: 'var(--s-text-muted)', bg: 'transparent', border: 'var(--s-border)' };
  const now = Date.now();
  const delta = ms - now;
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / DAY_MS);
  let core: string;
  if (mins < 60) core = `${mins} min`;
  else if (hours < 48) core = `${hours} h`;
  else core = `${days} j`;
  if (delta < 0) return {
    text: `En retard de ${core}`,
    color: '#ff7a7a', bg: 'rgba(255,85,85,0.10)', border: 'rgba(255,85,85,0.35)',
  };
  if (delta < 24 * 3_600_000) return {
    text: `Dans ${core}`,
    color: 'var(--s-gold)', bg: 'rgba(255,184,0,0.10)', border: 'rgba(255,184,0,0.30)',
  };
  return {
    text: `Dans ${core}`,
    color: 'var(--s-text-dim)', bg: 'var(--s-elevated)', border: 'var(--s-border)',
  };
}

// Format date courte ("14 mai", "lun 14") pour l'affichage dans les lignes
function formatShortDate(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit', month: 'short',
  }).format(new Date(ms));
}

// ─── Composant principal ──────────────────────────────────────────────────

export default function CrossTeamTodosPanel({
  structureId,
  initialTodoId,
  onConsumedTodo,
  onOpenTeam,
}: {
  structureId: string;
  initialTodoId?: string | null;
  onConsumedTodo?: () => void;
  onOpenTeam?: (teamId: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('pending');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [openTodoId, setOpenTodoId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTemplatesManager, setShowTemplatesManager] = useState(false);
  const { firebaseUser } = useAuth();
  const templates = useTodoTemplates(structureId);

  const { data, isPending: loading, error: queryError, refetch } = useQuery({
    queryKey: ['structure', structureId, 'todos-overview'] as const,
    queryFn: () => api<OverviewData>(`/api/structures/${structureId}/todos/overview`),
  });
  const error = queryError ? (queryError instanceof ApiError ? queryError.message : queryError.message || 'Erreur de chargement') : null;

  // Ping Discord d'un assignee — envoie un DM via le bot avec la liste de ses exos en retard
  const pingMutation = useMutation({
    mutationFn: ({ assigneeId }: { assigneeId: string }) =>
      api<{ overdueCount: number }>(`/api/structures/${structureId}/todos/ping-assignee`, {
        method: 'POST',
        body: { assigneeId },
      }),
    onSuccess: (res) => {
      toast.success(`DM envoyé — ${res.overdueCount} exo${res.overdueCount > 1 ? 's' : ''} listé${res.overdueCount > 1 ? 's' : ''}`);
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  const pingingUid = pingMutation.isPending ? pingMutation.variables?.assigneeId ?? null : null;

  // Suppression d'un exercice (staff uniquement — API contrôle déjà la permission)
  const deleteMutation = useMutation({
    mutationFn: ({ todoId }: { todoId: string }) =>
      api(`/api/structures/${structureId}/todos/${todoId}`, { method: 'DELETE' }).then(() => ({ todoId })),
    onSuccess: () => {
      toast.success('Exercice supprimé');
      setOpenTodoId(null);
      void refetch();
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  const deletingTodoId = deleteMutation.isPending ? deleteMutation.variables?.todoId ?? null : null;

  async function handleDeleteTodo(todoId: string, title: string) {
    const ok = await confirm({
      title: 'Supprimer cet exercice ?',
      message: `« ${title} » sera supprimé définitivement pour tous les assignés. Les réponses et captures déjà saisies seront perdues. Action irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    deleteMutation.mutate({ todoId });
  }

  // Deep-link : si initialTodoId pointe vers un exercice qu'on a chargé, ouvrir le drawer une fois.
  useEffect(() => {
    if (!initialTodoId || !data) return;
    if (data.todos.some(t => t.id === initialTodoId)) {
      setOpenTodoId(initialTodoId);
    }
    onConsumedTodo?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTodoId, data]);

  const teamMap = useMemo(() => {
    const m = new Map<string, OverviewTeam>();
    if (data) for (const t of data.teams) m.set(t.id, t);
    return m;
  }, [data]);

  const userMap = useMemo(() => {
    const m = new Map<string, OverviewUser>();
    if (data) for (const u of data.users) m.set(u.uid, u);
    return m;
  }, [data]);

  // ── À RELANCER : exos en retard groupés par joueur ──────────────────────
  const relancer = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const byUser = new Map<string, OverviewTodo[]>();
    for (const t of data.todos) {
      if (t.done) continue;
      if (t.deadlineAt === null || t.deadlineAt >= now) continue;
      let list = byUser.get(t.assigneeId);
      if (!list) { list = []; byUser.set(t.assigneeId, list); }
      list.push(t);
    }
    return Array.from(byUser.entries())
      .map(([uid, todos]) => ({
        uid,
        user: userMap.get(uid),
        todos: todos.sort((a, b) => (a.deadlineAt ?? 0) - (b.deadlineAt ?? 0)),
      }))
      .sort((a, b) => b.todos.length - a.todos.length);
  }, [data, userMap]);

  // ── PERFORMANCE 7 derniers jours : par joueur, ratio fait/total ────────
  const performance = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const sevenDaysAgo = now - 7 * DAY_MS;
    // On compte les exos dont la deadline OU la création est dans la fenêtre des 7j
    type Stats = { done: number; total: number; lockedCount: number };
    const byUser = new Map<string, Stats>();
    for (const t of data.todos) {
      const inWindow =
        (t.deadlineAt !== null && t.deadlineAt >= sevenDaysAgo) ||
        (t.createdAt >= sevenDaysAgo);
      if (!inWindow) continue;
      let s = byUser.get(t.assigneeId);
      if (!s) { s = { done: 0, total: 0, lockedCount: 0 }; byUser.set(t.assigneeId, s); }
      s.total++;
      if (t.done) s.done++;
      if (t.lockedAt) s.lockedCount++;
    }
    return Array.from(byUser.entries())
      .map(([uid, s]) => ({
        uid,
        user: userMap.get(uid),
        done: s.done,
        total: s.total,
        pct: s.total > 0 ? Math.round((s.done / s.total) * 100) : 0,
      }))
      .sort((a, b) => {
        if (a.pct !== b.pct) return b.pct - a.pct;
        return b.total - a.total;
      });
  }, [data, userMap]);

  // ── Liste filtrée (gardée comme avant) ──────────────────────────────────
  const filteredTodos = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndMs = todayEnd.getTime();
    const weekEndMs = todayEndMs + 6 * DAY_MS;
    const sevenDaysAgoMs = now - 7 * DAY_MS;

    const matches = data.todos.filter(t => {
      if (teamFilter !== 'all' && t.subTeamId !== teamFilter) return false;
      if (assigneeFilter !== 'all' && t.assigneeId !== assigneeFilter) return false;
      switch (stateFilter) {
        case 'all': return true;
        case 'overdue': return !t.done && t.deadlineAt !== null && t.deadlineAt < now;
        case 'today': return !t.done && t.deadlineAt !== null && t.deadlineAt >= now && t.deadlineAt <= todayEndMs;
        case 'week': return !t.done && t.deadlineAt !== null && t.deadlineAt > todayEndMs && t.deadlineAt <= weekEndMs;
        case 'pending': return !t.done;
        case 'done': return t.done && t.doneAt !== null && t.doneAt >= sevenDaysAgoMs;
      }
    });

    matches.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const aMs = a.deadlineAt;
      const bMs = b.deadlineAt;
      if (aMs !== null && bMs !== null) return aMs - bMs;
      if (aMs !== null) return -1;
      if (bMs !== null) return 1;
      return b.createdAt - a.createdAt;
    });
    return matches;
  }, [data, teamFilter, stateFilter, assigneeFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm p-5 bevel-sm" style={{ background: 'rgba(255,85,85,0.08)', border: '1px solid rgba(255,85,85,0.3)', color: '#ff9999' }}>
        {error}
      </div>
    );
  }
  if (!data) return null;

  const counts = data.counts;
  const activeAssignees = data.users.slice().sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="space-y-5">
      {/* ── Header avec bouton Nouvel exercice ──────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ListChecks size={16} style={{ color: 'var(--s-gold)' }} />
          <h2 className="font-display text-xl tracking-wider" style={{ letterSpacing: '0.05em' }}>
            EXERCICES
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Gérer les templates — modal complète (création/édition/suppression/partage) */}
          <button
            type="button"
            onClick={() => setShowTemplatesManager(true)}
            className="bevel-sm flex items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--s-hover)]"
            style={{
              fontSize: '13px', fontWeight: 600,
              background: 'var(--s-elevated)',
              border: '1px solid var(--s-border)',
              color: 'var(--s-text-dim)',
              cursor: 'pointer',
            }}
            title="Créer / éditer / partager des templates d'exercices"
          >
            <Library size={13} />
            <span>Templates ({templates.templates.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-sm"
          >
            <Plus size={13} />
            <span>Nouvel exercice</span>
          </button>
        </div>
      </div>

      {/* ── 3 compteurs ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <CountCard
          label="En retard"
          value={counts.overdue}
          icon={AlertTriangle}
          color="#ff5555"
          active={stateFilter === 'overdue'}
          onClick={() => setStateFilter('overdue')}
        />
        <CountCard
          label="Cette semaine"
          value={counts.dueToday + counts.dueThisWeek}
          icon={Clock}
          color="var(--s-gold)"
          active={stateFilter === 'today' || stateFilter === 'week'}
          onClick={() => setStateFilter('week')}
        />
        <CountCard
          label="Faits (7j)"
          value={counts.doneLast7d}
          icon={CheckCircle2}
          color="#33ff66"
          active={stateFilter === 'done'}
          onClick={() => setStateFilter('done')}
        />
      </div>

      {/* ── Section À RELANCER ──────────────────────────────────────────── */}
      {relancer.length > 0 && (
        <section className="bevel-sm overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid rgba(255,85,85,0.30)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, #ff5555, rgba(255,85,85,0.4), transparent 70%)' }} />
          <div className="px-4 py-2.5 flex items-center justify-between"
            style={{ background: 'rgba(255,85,85,0.06)', borderBottom: '1px solid rgba(255,85,85,0.20)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} style={{ color: '#ff5555' }} />
              <span className="font-display text-xs tracking-wider uppercase" style={{ letterSpacing: '0.08em', color: '#ff9999' }}>
                À relancer
              </span>
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                · {relancer.length} joueur{relancer.length > 1 ? 's' : ''} concerné{relancer.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
            {relancer.map(({ uid, user, todos }) => (
              <RelanceRow
                key={uid}
                uid={uid}
                user={user}
                todos={todos}
                teamMap={teamMap}
                pinging={pingingUid === uid}
                onOpenTodo={(id) => setOpenTodoId(id)}
                onPing={() => pingMutation.mutate({ assigneeId: uid })}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Section PERFORMANCE 7j ──────────────────────────────────────── */}
      {performance.length > 0 && (
        <section className="bevel-sm overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="px-4 py-2.5 flex items-center gap-2"
            style={{ borderBottom: '1px solid var(--s-border)' }}>
            <CheckCircle2 size={13} style={{ color: 'var(--s-gold)' }} />
            <span className="font-display text-xs tracking-wider uppercase" style={{ letterSpacing: '0.08em' }}>
              Performance 7 derniers jours
            </span>
            <span className="text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>
              {performance.length} joueur{performance.length > 1 ? 's' : ''} actif{performance.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="p-4 space-y-2">
            {performance.map(row => (
              <PerformanceRow key={row.uid} row={row} />
            ))}
          </div>
        </section>
      )}

      {/* ── Filtres ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5" style={{ color: 'var(--s-text-muted)' }}>
          <Filter size={12} />
          <span className="text-xs uppercase tracking-wider">Filtres</span>
        </div>
        <SelectChip
          icon={Users}
          value={teamFilter}
          onChange={setTeamFilter}
          options={[
            { value: 'all', label: `Toutes les équipes (${data.teams.length})` },
            ...[...data.teams]
              .sort((a, b) => {
                const ga = a.groupOrder ?? 0, gb = b.groupOrder ?? 0;
                if (ga !== gb) return ga - gb;
                const lc = (a.label ?? '').localeCompare(b.label ?? '');
                if (lc !== 0) return lc;
                const oa = a.order ?? 0, ob = b.order ?? 0;
                if (oa !== ob) return oa - ob;
                return a.name.localeCompare(b.name);
              })
              .map(t => ({ value: t.id, label: `${t.name}${t.label ? ` — ${t.label}` : ''}` })),
          ]}
        />
        <SelectChip
          icon={ListChecks}
          value={stateFilter}
          onChange={(v) => setStateFilter(v as StateFilter)}
          options={[
            { value: 'all', label: 'Tous les exercices' },
            { value: 'overdue', label: `En retard (${counts.overdue})` },
            { value: 'today', label: `Aujourd'hui (${counts.dueToday})` },
            { value: 'week', label: `Cette semaine (${counts.dueThisWeek})` },
            { value: 'pending', label: `En cours (${counts.pendingTotal})` },
            { value: 'done', label: `Faits 7j (${counts.doneLast7d})` },
          ]}
        />
        <SelectChip
          icon={Users}
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[
            { value: 'all', label: `Tous les joueurs (${activeAssignees.length})` },
            ...activeAssignees.map(u => ({ value: u.uid, label: u.displayName })),
          ]}
        />
      </div>

      {/* ── Liste des exercices ─────────────────────────────────────────── */}
      {filteredTodos.length === 0 ? (
        <div className="p-10 text-center bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <div className="font-display text-sm tracking-wider mb-1" style={{ color: 'var(--s-text-dim)' }}>
            RIEN À AFFICHER
          </div>
          <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
            Aucun exercice ne correspond à ces filtres.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredTodos.map(t => (
            <TodoRow
              key={t.id}
              todo={t}
              team={teamMap.get(t.subTeamId)}
              assignee={userMap.get(t.assigneeId)}
              onOpen={() => setOpenTodoId(t.id)}
              onOpenTeam={onOpenTeam ? () => onOpenTeam(t.subTeamId) : undefined}
            />
          ))}
        </ul>
      )}

      {/* Drawer détail — vue staff : read-only sur les steps, mais bouton supprimer dispo */}
      {(() => {
        if (!openTodoId || !data) return null;
        const ot = data.todos.find(t => t.id === openTodoId);
        if (!ot) return null;
        const team = teamMap.get(ot.subTeamId);
        const drawerTodo: DrawerTodo = {
          ...(ot as OverviewTodo as unknown as TodoRef),
          teamName: team ? (team.label ? `${team.name} — ${team.label}` : team.name) : undefined,
        };
        return (
          <TodoDetailDrawer
            open
            onClose={() => setOpenTodoId(null)}
            todo={drawerTodo}
            isStaff
            deleting={deletingTodoId === ot.id}
            onDelete={() => handleDeleteTodo(ot.id, ot.title)}
          />
        );
      })()}

      {/* Modal Nouvel exercice */}
      {showCreateModal && (
        <CreateTodoModal
          structureId={structureId}
          visibleTeamIds={data.teams.map(t => t.id)}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            void refetch();
          }}
        />
      )}

      {/* Modal Gestion templates — permet de créer/éditer/partager des templates
          d'exercices sans devoir passer par le panel d'une équipe spécifique. */}
      {showTemplatesManager && firebaseUser && (
        <TodoTemplatesManager
          structureId={structureId}
          currentUid={firebaseUser.uid}
          templates={templates.templates}
          onClose={() => setShowTemplatesManager(false)}
          onChanged={() => templates.reload()}
        />
      )}
    </div>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────

function CountCard({
  label, value, icon: Icon, color, active, onClick,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bevel-sm p-3 text-left transition-all duration-150 cursor-pointer"
      style={{
        background: active ? 'var(--s-elevated)' : 'var(--s-surface)',
        border: `1px solid ${active ? color + '55' : 'var(--s-border)'}`,
        boxShadow: active ? `0 0 0 1px ${color}22 inset` : 'none',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} style={{ color }} />
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--s-text-muted)', fontSize: '12px', letterSpacing: '0.1em' }}>
          {label}
        </span>
      </div>
      <div className="font-display text-3xl" style={{ color, lineHeight: 1 }}>
        {value}
      </div>
    </button>
  );
}

function SelectChip({
  icon: Icon, value, onChange, options,
}: {
  icon: LucideIcon;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="relative inline-flex items-center gap-1.5 bevel-sm cursor-pointer"
      style={{
        background: 'var(--s-elevated)',
        border: '1px solid var(--s-border)',
        padding: '6px 10px',
      }}>
      <Icon size={12} style={{ color: 'var(--s-text-muted)' }} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent outline-none text-sm pr-1 cursor-pointer"
        style={{ color: 'var(--s-text)' }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value} style={{ background: 'var(--s-surface)' }}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// Ligne "À relancer" : 1 joueur + ses exos en retard + bouton ping Discord
function RelanceRow({
  uid, user, todos, teamMap, pinging, onOpenTodo, onPing,
}: {
  uid: string;
  user: OverviewUser | undefined;
  todos: OverviewTodo[];
  teamMap: Map<string, OverviewTeam>;
  pinging: boolean;
  onOpenTodo: (id: string) => void;
  onPing: () => void;
}) {
  return (
    <div className="p-3 flex items-start gap-3">
      <div className="w-9 h-9 flex-shrink-0 bevel-sm overflow-hidden relative"
        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
        {user?.avatarUrl ? (
          <Image src={user.avatarUrl} alt={user.displayName} fill className="object-cover" unoptimized />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs font-bold" style={{ color: 'var(--s-text-muted)' }}>
            {(user?.displayName ?? '?').slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
            {user?.displayName ?? uid}
          </span>
          <span className="px-1.5 py-0.5 text-xs font-bold"
            style={{
              fontSize: '11px',
              background: 'rgba(255,85,85,0.12)',
              border: '1px solid rgba(255,85,85,0.35)',
              color: '#ff9999',
            }}>
            {todos.length} EXO{todos.length > 1 ? 'S' : ''} EN RETARD
          </span>
        </div>
        <ul className="space-y-1">
          {todos.map(t => {
            const team = teamMap.get(t.subTeamId);
            const deadline = formatDeadlineLabel(t.deadlineAt, t.done);
            const meta = TODO_TYPE_META[t.type];
            const stepProgress = getStepProgress(t);
            const isMulti = stepProgress.total > 1;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => onOpenTodo(t.id)}
                  className="w-full text-left flex items-center gap-2 px-2 py-1 transition-colors hover:bg-[var(--s-elevated)]"
                  style={{ borderRadius: 2 }}>
                  <span className="px-1.5 py-0.5"
                    style={{
                      fontSize: '10px', fontWeight: 700,
                      background: 'var(--s-elevated)',
                      border: '1px solid var(--s-border)',
                      color: 'var(--s-text-dim)',
                    }}>
                    {isMulti ? `${stepProgress.done}/${stepProgress.total}` : meta.short.toUpperCase()}
                  </span>
                  <span className="text-sm flex-1 truncate" style={{ color: 'var(--s-text)' }}>
                    {t.title}
                  </span>
                  {team && (
                    <span className="text-xs hidden sm:inline" style={{ color: 'var(--s-text-muted)' }}>
                      {team.name}
                    </span>
                  )}
                  <span className="text-xs font-semibold" style={{ color: deadline.color }}>
                    {deadline.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <button type="button" onClick={onPing}
        disabled={pinging}
        className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bevel-sm transition-colors hover:brightness-110"
        style={{
          fontSize: '11px',
          fontWeight: 700,
          background: pinging ? 'var(--s-elevated)' : 'rgba(255,184,0,0.12)',
          border: `1px solid ${pinging ? 'var(--s-border)' : 'rgba(255,184,0,0.35)'}`,
          color: pinging ? 'var(--s-text-dim)' : 'var(--s-gold)',
          cursor: pinging ? 'wait' : 'pointer',
        }}
        title="Envoyer un DM Discord via le bot Aedral">
        {pinging ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
        <span className="hidden sm:inline">{pinging ? 'Envoi…' : 'Relancer sur Discord'}</span>
      </button>
    </div>
  );
}

// Ligne leaderboard performance 7j
function PerformanceRow({ row }: { row: { uid: string; user: OverviewUser | undefined; done: number; total: number; pct: number } }) {
  const color = row.pct >= 80
    ? '#33ff66'
    : row.pct >= 50
    ? 'var(--s-gold)'
    : row.pct > 0
    ? '#ff9f43'
    : '#ff5555';
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 flex-shrink-0 bevel-sm overflow-hidden relative"
        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
        {row.user?.avatarUrl ? (
          <Image src={row.user.avatarUrl} alt={row.user.displayName} fill className="object-cover" unoptimized />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] font-bold" style={{ color: 'var(--s-text-muted)' }}>
            {(row.user?.displayName ?? '?').slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <span className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--s-text)', minWidth: '100px' }}>
        {row.user?.displayName ?? row.uid}
      </span>
      <div className="flex-1 h-2 relative" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
        <div className="absolute inset-y-0 left-0 transition-all"
          style={{ width: `${row.pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--s-text-dim)', minWidth: '40px', textAlign: 'right' }}>
        {row.done}/{row.total}
      </span>
      <span className="text-xs font-bold flex-shrink-0" style={{ color, minWidth: '40px', textAlign: 'right' }}>
        {row.pct}%
      </span>
    </div>
  );
}

// Ligne d'exo enrichie : titre + tag steps/type + preview steps si multi + dates + assignee + état
function TodoRow({
  todo, team, assignee, onOpen, onOpenTeam,
}: {
  todo: OverviewTodo;
  team: OverviewTeam | undefined;
  assignee: OverviewUser | undefined;
  onOpen: () => void;
  onOpenTeam?: () => void;
}) {
  const meta = TODO_TYPE_META[todo.type];
  const deadline = formatDeadlineLabel(todo.deadlineAt, todo.done);
  const gameColor = team ? (GAME_COLOR[team.game] ?? 'var(--s-text-dim)') : 'var(--s-text-dim)';
  const steps = getSteps(todo);
  const stepProgress = getStepProgress(todo);
  const isMulti = stepProgress.total > 1;
  const stepsPreview = isMulti
    ? steps.slice(0, 4).map(s => TODO_TYPE_META[s.type].short).join(' · ') + (steps.length > 4 ? ` · +${steps.length - 4}` : '')
    : '';

  return (
    <li className="bevel-sm transition-colors cursor-pointer hover:brightness-110"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      onClick={onOpen}>
      <div className="p-3 flex items-start gap-3">
        {/* Assignee avatar */}
        <div className="w-9 h-9 flex-shrink-0 bevel-sm overflow-hidden relative"
          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          {assignee?.avatarUrl ? (
            <Image src={assignee.avatarUrl} alt={assignee.displayName} fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs font-bold" style={{ color: 'var(--s-text-muted)' }}>
              {(assignee?.displayName ?? '?').slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        {/* Contenu central */}
        <div className="flex-1 min-w-0">
          {/* Row 1 : tag + titre + lock */}
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="px-1.5 py-0.5 font-bold uppercase tracking-wider"
              style={{
                fontSize: '11px',
                background: isMulti ? 'rgba(255,184,0,0.10)' : 'var(--s-elevated)',
                border: `1px solid ${isMulti ? 'rgba(255,184,0,0.30)' : 'var(--s-border)'}`,
                color: isMulti ? 'var(--s-gold)' : 'var(--s-text-dim)',
              }}>
              {isMulti ? `${stepProgress.done}/${stepProgress.total} ÉTAPES` : meta.short.toUpperCase()}
            </span>
            <span className="text-sm font-semibold truncate" style={{
              color: todo.done ? 'var(--s-text-dim)' : 'var(--s-text)',
              textDecoration: todo.done ? 'line-through' : 'none',
            }}>
              {todo.title}
            </span>
            {todo.lockedAt && (
              <span className="text-xs px-1 py-0.5"
                style={{
                  fontSize: '10px',
                  background: 'rgba(255,184,0,0.10)',
                  border: '1px solid rgba(255,184,0,0.30)',
                  color: 'var(--s-gold)',
                }}>
                VERROUILLÉ
              </span>
            )}
          </div>
          {/* Row 2 : preview steps si multi */}
          {isMulti && stepsPreview && (
            <div className="text-xs mb-1 truncate" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.05em' }}>
              {stepsPreview}
            </div>
          )}
          {/* Row 3 : assignee + équipe + créé le */}
          <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--s-text-muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--s-text-dim)' }}>
              {assignee?.displayName ?? '—'}
            </span>
            {team && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: gameColor }} />
                  {team.name}{team.label ? ` — ${team.label}` : ''}
                </span>
              </>
            )}
            <span>·</span>
            <span title={`Créé le ${new Date(todo.createdAt).toLocaleString('fr-FR')}`}>
              Créé {formatShortDate(todo.createdAt)}
            </span>
          </div>
        </div>

        {/* Deadline + lien équipe */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <div className="text-xs px-2 py-1 bevel-sm whitespace-nowrap"
            style={{ background: deadline.bg, color: deadline.color, border: `1px solid ${deadline.border}` }}>
            {deadline.text}
          </div>
          {team && onOpenTeam && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onOpenTeam(); }}
              className="text-[10px] uppercase tracking-wider cursor-pointer hover:text-white transition-colors"
              style={{ color: 'var(--s-text-muted)', background: 'transparent', border: 'none', padding: 0 }}>
              Voir équipe →
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── Modal Nouvel exercice ────────────────────────────────────────────────
// Fetch les équipes complètes (avec rosters) puis affiche un sélecteur d'équipe.
// Une fois l'équipe choisie, on instancie le NewTodoForm existant.

function CreateTodoModal({
  structureId,
  visibleTeamIds,
  onClose,
  onCreated,
}: {
  structureId: string;
  visibleTeamIds: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const visibleSet = useMemo(() => new Set(visibleTeamIds), [visibleTeamIds]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const templates = useTodoTemplates(structureId);

  const teamsQuery = useQuery({
    queryKey: ['structure', structureId, 'teams-full-for-todos'] as const,
    queryFn: () => api<{ teams: TeamFull[] }>(`/api/structures/teams?structureId=${structureId}`),
  });

  // Auto-sélection si une seule équipe visible
  useEffect(() => {
    if (!teamsQuery.data) return;
    const visible = teamsQuery.data.teams.filter(t => visibleSet.has(t.id) && t.status === 'active');
    if (visible.length === 1 && !selectedTeamId) {
      setSelectedTeamId(visible[0].id);
    }
  }, [teamsQuery.data, visibleSet, selectedTeamId]);

  const visibleTeams = (teamsQuery.data?.teams ?? [])
    .filter(t => visibleSet.has(t.id) && t.status === 'active');
  const selectedTeam = selectedTeamId
    ? visibleTeams.find(t => t.id === selectedTeamId)
    : null;

  // Events vides — la création depuis l'onglet exercices ne propose pas de lier un event
  // (l'utilisateur peut toujours le faire depuis l'onglet calendrier de l'équipe).
  const events: EventOpt[] = [];

  return (
    <Portal>
      <div
        className="fixed inset-0 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto"
        style={{ background: 'rgba(0,0,0,0.72)', zIndex: 9700 }}
        onClick={onClose}
      >
        <div
          className="bevel w-full max-w-2xl my-auto"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-2">
              <Plus size={14} style={{ color: 'var(--s-gold)' }} />
              <span className="font-display text-sm tracking-wider uppercase" style={{ letterSpacing: '0.08em' }}>
                Nouvel exercice
              </span>
            </div>
            <button type="button" onClick={onClose}
              className="p-1" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}
              aria-label="Fermer">
              <X size={16} />
            </button>
          </div>

          <div className="p-4 space-y-3">
            {teamsQuery.isPending ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={18} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />
              </div>
            ) : teamsQuery.error ? (
              <div className="text-sm p-3" style={{ background: 'rgba(255,85,85,0.08)', border: '1px solid rgba(255,85,85,0.3)', color: '#ff9999' }}>
                Impossible de charger les équipes.
              </div>
            ) : visibleTeams.length === 0 ? (
              <div className="text-sm p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                Aucune équipe à gérer.
              </div>
            ) : (
              <>
                {/* Sélecteur d'équipe */}
                <div>
                  <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Équipe *</label>
                  <select
                    className="settings-input w-full text-sm"
                    value={selectedTeamId ?? ''}
                    onChange={e => setSelectedTeamId(e.target.value || null)}
                  >
                    <option value="">— Choisir une équipe —</option>
                    {visibleTeams.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.label ? ` — ${t.label}` : ''} ({(t.game === 'rocket_league' ? 'RL' : t.game === 'trackmania' ? 'TM' : t.game.toUpperCase())})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Form de création — instancié seulement si équipe choisie */}
                {selectedTeam && (
                  <NewTodoForm
                    key={selectedTeam.id /* reset le form si on change d'équipe */}
                    structureId={structureId}
                    team={{
                      id: selectedTeam.id,
                      name: selectedTeam.name,
                      players: selectedTeam.players,
                      subs: selectedTeam.subs,
                      staff: selectedTeam.staff,
                    } satisfies TeamRef}
                    events={events}
                    templates={templates.templates}
                    onCancel={onClose}
                    onCreated={onCreated}
                    onTemplateSaved={() => templates.reload()}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
