'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  AlertTriangle, Clock, CheckCircle2, Calendar, Filter, Loader2, ListChecks, Users,
  Activity, ChevronDown, ChevronUp,
} from 'lucide-react';
import { auth } from '@/lib/firebase';
import { TODO_TYPE_META, type TodoType } from '@/lib/todos';

type OverviewTeam = { id: string; name: string; label: string | null; game: string; logoUrl: string | null };
type OverviewUser = { uid: string; displayName: string; avatarUrl: string };
type OverviewTodo = {
  id: string;
  structureId: string;
  subTeamId: string;
  assigneeId: string;
  type: TodoType;
  title: string;
  description: string;
  eventId: string | null;
  deadline: string | null;
  deadlineAt: number | null;
  done: boolean;
  doneAt: number | null;
  doneBy: string | null;
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

type StateFilter = 'all' | 'overdue' | 'today' | 'week' | 'pending' | 'done';

const GAME_COLOR: Record<string, string> = {
  rocket_league: 'var(--s-blue)',
  trackmania: 'var(--s-green)',
};
const GAME_SHORT: Record<string, string> = {
  rocket_league: 'RL',
  trackmania: 'TM',
};

function formatDeadline(ms: number | null, done: boolean): { text: string; color: string; bg: string } {
  if (done) return { text: 'Terminé', color: 'var(--s-violet-light)', bg: 'rgba(123,47,190,0.10)' };
  if (ms === null) return { text: 'Sans deadline', color: 'var(--s-text-muted)', bg: 'transparent' };
  const now = Date.now();
  const delta = ms - now;
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let core: string;
  if (mins < 60) core = `${mins} min`;
  else if (hours < 48) core = `${hours} h`;
  else core = `${days} j`;
  if (delta < 0) return { text: `En retard de ${core}`, color: '#ff7a7a', bg: 'rgba(255,85,85,0.10)' };
  if (delta < 24 * 3_600_000) return { text: `Dans ${core}`, color: 'var(--s-gold)', bg: 'rgba(255,184,0,0.10)' };
  return { text: `Dans ${core}`, color: 'var(--s-text-dim)', bg: 'var(--s-elevated)' };
}

function parisYmdClient(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

// "lun 14", "mar 15" — libellé court des colonnes.
function parisDayLabel(ms: number): string {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'short', day: '2-digit',
  });
  return fmt.format(new Date(ms)).replace('.', '');
}

const DAY_MS = 86_400_000;
const HEATMAP_MAX_PLAYERS = 15;

export default function CrossTeamTodosPanel({ structureId }: { structureId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('overdue');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [heatmapOpen, setHeatmapOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          setError('Connexion requise');
          return;
        }
        const res = await fetch(`/api/structures/${structureId}/todos/overview`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body?.error ?? 'Erreur de chargement');
          return;
        }
        if (!cancelled) setData(body as OverviewData);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur de chargement');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [structureId]);

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

  // Heatmap : 7 derniers jours Paris × top joueurs actifs sur la fenêtre.
  const heatmap = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    // Jour Paris courant -> 7 derniers jours YMDs (ascendant, J-6 d'abord).
    const todayMs = now;
    const days: { ymd: string; label: string; ms: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const ms = todayMs - i * DAY_MS;
      days.push({ ymd: parisYmdClient(ms), label: parisDayLabel(ms), ms });
    }
    const daySet = new Set(days.map(d => d.ymd));

    // Aggrégation par joueur × jour.
    type Cell = { total: number; done: number; overdue: number };
    const byPlayer = new Map<string, Map<string, Cell>>();
    for (const t of data.todos) {
      if (!t.deadline || !daySet.has(t.deadline)) continue;
      let perDay = byPlayer.get(t.assigneeId);
      if (!perDay) { perDay = new Map(); byPlayer.set(t.assigneeId, perDay); }
      let c = perDay.get(t.deadline);
      if (!c) { c = { total: 0, done: 0, overdue: 0 }; perDay.set(t.deadline, c); }
      c.total++;
      if (t.done) c.done++;
      else if (t.deadlineAt !== null && t.deadlineAt < now) c.overdue++;
    }
    // Liste ordonnée : plus gros totaux d'abord, cap HEATMAP_MAX_PLAYERS.
    const rows = Array.from(byPlayer.entries())
      .map(([uid, perDay]) => {
        let total = 0;
        for (const c of perDay.values()) total += c.total;
        return { uid, perDay, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, HEATMAP_MAX_PLAYERS);

    return { days, rows };
  }, [data]);

  const filteredTodos = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndMs = todayEnd.getTime();
    const weekEndMs = todayEndMs + 6 * 86400000;
    const sevenDaysAgoMs = now - 7 * 86400000;

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
      {/* Compteurs globaux */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CountCard
          label="En retard"
          value={counts.overdue}
          icon={AlertTriangle}
          color="#ff5555"
          active={stateFilter === 'overdue'}
          onClick={() => setStateFilter('overdue')}
        />
        <CountCard
          label="Aujourd'hui"
          value={counts.dueToday}
          icon={Clock}
          color="var(--s-gold)"
          active={stateFilter === 'today'}
          onClick={() => setStateFilter('today')}
        />
        <CountCard
          label="Cette semaine"
          value={counts.dueThisWeek}
          icon={Calendar}
          color="var(--s-text-dim)"
          active={stateFilter === 'week'}
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

      {/* Heatmap joueurs × 7 derniers jours */}
      {heatmap && heatmap.rows.length > 0 && (
        <div className="bevel-sm" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <button
            type="button"
            onClick={() => setHeatmapOpen(o => !o)}
            className="w-full px-4 py-2.5 flex items-center justify-between cursor-pointer"
            style={{ borderBottom: heatmapOpen ? '1px solid var(--s-border)' : 'none' }}
          >
            <div className="flex items-center gap-2">
              <Activity size={13} style={{ color: '#4da6ff' }} />
              <span className="font-display text-xs tracking-wider uppercase" style={{ letterSpacing: '0.08em' }}>
                Activité 7 derniers jours
              </span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--s-text-muted)' }}>
                · top {heatmap.rows.length} joueur{heatmap.rows.length > 1 ? 's' : ''}
              </span>
            </div>
            {heatmapOpen ? <ChevronUp size={14} style={{ color: 'var(--s-text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--s-text-muted)' }} />}
          </button>
          {heatmapOpen && (
            <div className="p-4 overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '4px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', minWidth: 140 }} />
                    {heatmap.days.map(d => (
                      <th key={d.ymd} className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.08em' }}>
                        {d.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.rows.map(row => {
                    const user = userMap.get(row.uid);
                    return (
                      <tr key={row.uid}>
                        <td className="pr-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 flex-shrink-0 bevel-sm overflow-hidden relative"
                              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                              {user?.avatarUrl ? (
                                <Image src={user.avatarUrl} alt={user.displayName} fill className="object-cover" unoptimized />
                              ) : null}
                            </div>
                            <span className="text-xs truncate" style={{ color: 'var(--s-text)', maxWidth: 110 }}>
                              {user?.displayName ?? row.uid}
                            </span>
                          </div>
                        </td>
                        {heatmap.days.map(d => {
                          const cell = row.perDay.get(d.ymd);
                          const { bg, border, content, title } = heatmapCellStyle(cell);
                          return (
                            <td key={d.ymd} style={{ textAlign: 'center' }}>
                              <div
                                title={`${user?.displayName ?? row.uid} — ${d.label} : ${title}`}
                                className="w-7 h-7 flex items-center justify-center text-[10px] font-bold mx-auto"
                                style={{ background: bg, border, color: 'rgba(255,255,255,0.85)' }}
                              >
                                {content}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center gap-4 mt-3 text-[10px] uppercase tracking-wider" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.08em' }}>
                <LegendDot color="rgba(51,255,102,0.22)" border="rgba(51,255,102,0.45)" label="Tous faits" />
                <LegendDot color="rgba(255,184,0,0.18)" border="rgba(255,184,0,0.45)" label="Partiel" />
                <LegendDot color="rgba(255,85,85,0.22)" border="rgba(255,85,85,0.5)" label="Retard" />
                <LegendDot color="transparent" border="var(--s-border)" label="Rien" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filtres */}
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
            ...data.teams.map(t => ({ value: t.id, label: `${t.name}${t.label ? ` — ${t.label}` : ''}` })),
          ]}
        />
        <SelectChip
          icon={ListChecks}
          value={stateFilter}
          onChange={(v) => setStateFilter(v as StateFilter)}
          options={[
            { value: 'all', label: 'Tous les devoirs' },
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

      {/* Liste des devoirs */}
      {filteredTodos.length === 0 ? (
        <div className="p-10 text-center bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <div className="font-display text-sm tracking-wider mb-1" style={{ color: 'var(--s-text-dim)' }}>
            RIEN À AFFICHER
          </div>
          <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
            Aucun devoir ne correspond à ces filtres.
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
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CountCard({
  label, value, icon: Icon, color, active, onClick,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
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
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--s-text-muted)', fontSize: '10px', letterSpacing: '0.1em' }}>
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
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
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

function heatmapCellStyle(cell: { total: number; done: number; overdue: number } | undefined): {
  bg: string; border: string; content: string; title: string;
} {
  if (!cell || cell.total === 0) {
    return { bg: 'transparent', border: '1px dashed var(--s-border)', content: '', title: 'rien assigné' };
  }
  if (cell.overdue > 0) {
    return {
      bg: 'rgba(255,85,85,0.22)',
      border: '1px solid rgba(255,85,85,0.5)',
      content: `${cell.done}/${cell.total}`,
      title: `${cell.overdue} en retard sur ${cell.total}`,
    };
  }
  if (cell.done === cell.total) {
    return {
      bg: 'rgba(51,255,102,0.22)',
      border: '1px solid rgba(51,255,102,0.45)',
      content: `${cell.total}`,
      title: `${cell.total}/${cell.total} faits`,
    };
  }
  return {
    bg: 'rgba(255,184,0,0.18)',
    border: '1px solid rgba(255,184,0,0.45)',
    content: `${cell.done}/${cell.total}`,
    title: `${cell.done}/${cell.total} faits`,
  };
}

function LegendDot({ color, border, label }: { color: string; border: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3 h-3" style={{ background: color, border }} />
      {label}
    </span>
  );
}

function TodoRow({
  todo, team, assignee,
}: {
  todo: OverviewTodo;
  team: OverviewTeam | undefined;
  assignee: OverviewUser | undefined;
}) {
  const meta = TODO_TYPE_META[todo.type];
  const deadline = formatDeadline(todo.deadlineAt, todo.done);
  const gameColor = team ? (GAME_COLOR[team.game] ?? 'var(--s-text-dim)') : 'var(--s-text-dim)';
  const gameShort = team ? (GAME_SHORT[team.game] ?? team.game.toUpperCase()) : '';

  return (
    <li className="bevel-sm transition-colors"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="p-3 flex items-center gap-3">
        {/* Assignee avatar */}
        <div className="w-8 h-8 flex-shrink-0 bevel-sm overflow-hidden relative"
          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          {assignee?.avatarUrl ? (
            <Image src={assignee.avatarUrl} alt={assignee.displayName} fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] font-bold" style={{ color: 'var(--s-text-muted)' }}>
              {(assignee?.displayName ?? '?').slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        {/* Titre + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            {todo.type !== 'free' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5"
                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
                {meta.short}
              </span>
            )}
            <span className="text-sm font-semibold truncate" style={{ color: todo.done ? 'var(--s-text-dim)' : 'var(--s-text)' }}>
              {todo.title}
            </span>
          </div>
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
                  {gameShort && <span className="ml-1 text-[10px] opacity-70">{gameShort}</span>}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Deadline badge */}
        <div className="flex-shrink-0 text-right">
          <div className="text-xs px-2 py-1 bevel-sm inline-block"
            style={{ background: deadline.bg, color: deadline.color, border: '1px solid var(--s-border)' }}>
            {deadline.text}
          </div>
          {team && (
            <div className="mt-1">
              <Link href={`/community/structure/${todo.structureId}`} className="text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--s-text-muted)' }}>
                Voir équipe →
              </Link>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
