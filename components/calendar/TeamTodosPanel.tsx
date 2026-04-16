'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { Loader2, Plus, Trash2, Check, Calendar as CalIcon, X, ClipboardList, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { compareTodosPending, compareTodosDone, isOverdue, TODO_TITLE_MAX, TODO_DESCRIPTION_MAX, type TodoRef } from '@/lib/todos';

type Member = {
  uid: string;
  displayName: string;
  avatarUrl: string;
  discordAvatar: string;
};

type TeamRef = {
  id: string;
  name: string;
  players: Member[];
  subs: Member[];
  staff: Member[];
};

type TodoWithMeta = TodoRef & {
  assigneeName?: string;
  assigneeAvatar?: string;
};

type EventOpt = {
  id: string;
  title: string;
  startsAt: string | null;
};

type StatusFilter = 'pending' | 'done' | 'all';

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDeadlineShort(ymd: string, today: string): { label: string; color: string } {
  if (ymd < today) {
    return { label: `Retard`, color: '#ff5555' };
  }
  if (ymd === today) return { label: "Aujourd'hui", color: 'var(--s-gold)' };
  const dd = new Date(ymd + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  return { label: dd, color: 'var(--s-text-dim)' };
}

export default function TeamTodosPanel({
  structureId,
  team,
  embedded,
}: {
  structureId: string;
  team: TeamRef;
  embedded?: boolean;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [todos, setTodos] = useState<TodoWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventOpt[]>([]);
  const today = useMemo(() => todayYmd(), []);

  const allMembers = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of [...team.players, ...team.subs, ...team.staff]) {
      if (!map.has(m.uid)) map.set(m.uid, m);
    }
    return Array.from(map.values());
  }, [team]);

  const memberById = useMemo(() => {
    const m = new Map<string, Member>();
    for (const x of allMembers) m.set(x.uid, x);
    return m;
  }, [allMembers]);

  const enrichTodos = useCallback((raw: TodoRef[]): TodoWithMeta[] => {
    return raw.map(t => {
      const m = memberById.get(t.assigneeId);
      return {
        ...t,
        assigneeName: m?.displayName ?? t.assigneeId,
        assigneeAvatar: m?.avatarUrl || m?.discordAvatar || '',
      };
    });
  }, [memberById]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/todos?subTeamId=${team.id}&status=all`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTodos(enrichTodos(data.todos ?? []));
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur chargement devoirs');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setLoading(false);
  }, [firebaseUser, structureId, team.id, enrichTodos, toast]);

  const loadEvents = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/events`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        type EventApi = { id: string; title: string; startsAt: string | null; target?: { scope?: string; teamIds?: string[] } };
        const list: EventOpt[] = ((data.events ?? []) as EventApi[])
          .filter(e => {
            const scope = e.target?.scope;
            const teamIds = e.target?.teamIds ?? [];
            return scope === 'all' || teamIds.includes(team.id);
          })
          .map(e => ({ id: e.id, title: e.title, startsAt: e.startsAt }));
        setEvents(list);
      }
    } catch {
      // Events dropdown est optionnel — silencieux
    }
  }, [firebaseUser, structureId, team.id]);

  useEffect(() => { load(); loadEvents(); }, [load, loadEvents]);

  const filtered = useMemo(() => {
    const list = todos.filter(t => {
      if (filter === 'pending') return !t.done;
      if (filter === 'done') return t.done;
      return true;
    });
    list.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.done ? compareTodosDone(a, b) : compareTodosPending(a, b);
    });
    return list;
  }, [todos, filter]);

  const counts = useMemo(() => ({
    pending: todos.filter(t => !t.done).length,
    done: todos.filter(t => t.done).length,
    all: todos.length,
  }), [todos]);

  async function toggleTodo(todo: TodoWithMeta) {
    if (!firebaseUser || busyId) return;
    setBusyId(todo.id);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'toggle' }),
      });
      if (res.ok) {
        setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : null } : t));
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setBusyId(null);
  }

  async function deleteTodo(todo: TodoWithMeta) {
    if (!firebaseUser || busyId) return;
    const ok = await confirm({
      title: 'Supprimer ce devoir ?',
      message: `« ${todo.title} » — assigné à ${todo.assigneeName}. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(todo.id);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/todos/${todo.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        setTodos(prev => prev.filter(t => t.id !== todo.id));
        toast.success('Devoir supprimé');
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setBusyId(null);
  }

  return (
    <div
      className={embedded ? 'space-y-4' : 'space-y-3 pt-3'}
      style={embedded ? undefined : { borderTop: '1px dashed var(--s-border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList size={embedded ? 16 : 14} style={{ color: 'var(--s-violet-light)' }} />
          <span className="t-label" style={{ fontSize: embedded ? '13px' : '12px', color: 'var(--s-text-dim)', letterSpacing: '0.05em' }}>
            {embedded ? 'DEVOIRS' : "DEVOIRS DE L'ÉQUIPE"}
          </span>
          <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            ({counts.pending} à faire · {counts.done} fait{counts.done > 1 ? 's' : ''})
          </span>
        </div>
        {embedded ? (
          <button type="button"
            onClick={() => setShowForm(v => !v)}
            className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs">
            {showForm ? <X size={12} /> : <Plus size={12} />}
            {showForm ? 'Annuler' : 'Nouveau devoir'}
          </button>
        ) : (
          <button type="button"
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150"
            style={{ color: 'var(--s-violet-light)' }}>
            {showForm ? <X size={11} /> : <Plus size={11} />}
            {showForm ? 'Annuler' : 'Nouveau devoir'}
          </button>
        )}
      </div>

      {/* Formulaire */}
      {showForm && (
        <NewTodoForm
          structureId={structureId}
          team={team}
          events={events}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
        />
      )}

      {/* Filtres */}
      {todos.length > 0 && (
        <div className="flex gap-1.5">
          {(['pending', 'done', 'all'] as const).map(f => (
            <button key={f} type="button"
              onClick={() => setFilter(f)}
              className="px-2.5 py-1 text-xs font-bold transition-all duration-150"
              style={{
                background: filter === f ? 'var(--s-violet)' : 'var(--s-surface)',
                border: `1px solid ${filter === f ? 'var(--s-violet)' : 'var(--s-border)'}`,
                color: filter === f ? '#fff' : 'var(--s-text-dim)',
                cursor: 'pointer',
              }}>
              {f === 'pending' ? `À FAIRE (${counts.pending})` : f === 'done' ? `FAIT (${counts.done})` : `TOUS (${counts.all})`}
            </button>
          ))}
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
          {todos.length === 0 ? 'Aucun devoir pour cette équipe.' : 'Aucun devoir dans ce filtre.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map(todo => (
            <TodoStaffRow
              key={todo.id}
              todo={todo}
              today={today}
              busy={busyId === todo.id}
              onToggle={() => toggleTodo(todo)}
              onDelete={() => deleteTodo(todo)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TodoStaffRow({
  todo,
  today,
  busy,
  onToggle,
  onDelete,
}: {
  todo: TodoWithMeta;
  today: string;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const overdue = isOverdue(todo, today);
  const deadlineInfo = todo.deadline ? formatDeadlineShort(todo.deadline, today) : null;
  return (
    <div className="flex items-start gap-2.5 p-2.5 transition-all duration-150"
      style={{
        background: todo.done ? 'transparent' : 'var(--s-surface)',
        border: `1px solid ${overdue ? 'rgba(255,85,85,0.35)' : 'var(--s-border)'}`,
        opacity: todo.done ? 0.55 : 1,
      }}>
      <button type="button" onClick={onToggle} disabled={busy}
        className="flex-shrink-0 flex items-center justify-center transition-all duration-150"
        style={{
          width: '20px', height: '20px', marginTop: '1px',
          background: todo.done ? 'var(--s-violet)' : 'transparent',
          border: `1px solid ${todo.done ? 'var(--s-violet)' : 'var(--s-text-muted)'}`,
          cursor: busy ? 'wait' : 'pointer',
        }}
        aria-label={todo.done ? 'Rouvrir' : 'Marquer terminé'}>
        {busy ? <Loader2 size={10} className="animate-spin" style={{ color: '#fff' }} />
          : todo.done ? <Check size={12} style={{ color: '#fff' }} strokeWidth={3} /> : null}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {todo.assigneeAvatar ? (
            <Image src={todo.assigneeAvatar} alt={todo.assigneeName ?? ''} width={16} height={16} unoptimized className="rounded-full flex-shrink-0" />
          ) : (
            <div className="flex-shrink-0 rounded-full" style={{ width: 16, height: 16, background: 'var(--s-elevated)' }} />
          )}
          <span className="text-xs font-semibold" style={{ color: 'var(--s-text-dim)' }}>
            {todo.assigneeName}
          </span>
          {deadlineInfo && (
            <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: deadlineInfo.color }}>
              <CalIcon size={11} /> {deadlineInfo.label}
            </span>
          )}
        </div>
        <p className="text-sm mt-0.5" style={{
          color: 'var(--s-text)',
          textDecoration: todo.done ? 'line-through' : 'none',
        }}>
          {todo.title}
        </p>
        {todo.description && !todo.done && (
          <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
            {todo.description}
          </p>
        )}
      </div>

      <button type="button" onClick={onDelete} disabled={busy}
        className="flex-shrink-0 p-1 transition-opacity duration-150"
        style={{ color: '#ff5555', opacity: 0.5, cursor: busy ? 'wait' : 'pointer' }}
        aria-label="Supprimer">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function NewTodoForm({
  structureId,
  team,
  events,
  onCancel,
  onCreated,
}: {
  structureId: string;
  team: TeamRef;
  events: EventOpt[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [eventId, setEventId] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const everyone = useMemo(() => {
    const map = new Map<string, Member & { group: string }>();
    for (const m of team.players) if (!map.has(m.uid)) map.set(m.uid, { ...m, group: 'Titulaire' });
    for (const m of team.subs) if (!map.has(m.uid)) map.set(m.uid, { ...m, group: 'Remplaçant' });
    for (const m of team.staff) if (!map.has(m.uid)) map.set(m.uid, { ...m, group: 'Staff' });
    return Array.from(map.values());
  }, [team]);

  function toggleAssignee(uid: string) {
    setAssigneeIds(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  }

  function selectAll() {
    setAssigneeIds(everyone.map(m => m.uid));
  }

  async function submit() {
    if (!firebaseUser || creating) return;
    if (!title.trim()) { toast.error('Titre requis'); return; }
    if (assigneeIds.length === 0) { toast.error('Sélectionne au moins un joueur'); return; }
    setCreating(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          subTeamId: team.id,
          assigneeIds,
          title: title.trim(),
          description: description.trim() || undefined,
          deadline: deadline || undefined,
          eventId: eventId || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`${data.count} devoir${data.count > 1 ? 's' : ''} créé${data.count > 1 ? 's' : ''}`);
        onCreated();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur création');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setCreating(false);
  }

  const visibleMembers = showAll ? everyone : everyone.slice(0, 8);

  return (
    <div className="p-3 space-y-3" style={{ background: 'var(--s-surface)', border: '1px solid rgba(123,47,190,0.25)' }}>
      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Titre *</label>
        <input type="text" className="settings-input w-full text-sm"
          placeholder="Regarder la VOD du match de samedi"
          maxLength={TODO_TITLE_MAX}
          value={title} onChange={e => setTitle(e.target.value)} />
      </div>

      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Description (optionnelle)</label>
        <textarea rows={2} className="settings-input w-full text-sm"
          placeholder="Noter 2 situations à retravailler avant mardi"
          maxLength={TODO_DESCRIPTION_MAX}
          value={description} onChange={e => setDescription(e.target.value)} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="t-label" style={{ fontSize: '12px' }}>Assigner à * ({assigneeIds.length})</label>
          <button type="button" onClick={selectAll}
            className="text-xs transition-colors" style={{ color: 'var(--s-violet-light)', cursor: 'pointer' }}>
            Tout sélectionner
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {visibleMembers.map(m => {
            const selected = assigneeIds.includes(m.uid);
            return (
              <button key={m.uid} type="button"
                onClick={() => toggleAssignee(m.uid)}
                className="flex items-center gap-2 px-2 py-1.5 transition-all duration-150"
                style={{
                  background: selected ? 'rgba(123,47,190,0.18)' : 'var(--s-elevated)',
                  border: `1px solid ${selected ? 'var(--s-violet-light)' : 'var(--s-border)'}`,
                  cursor: 'pointer',
                }}>
                <div className="flex-shrink-0 flex items-center justify-center"
                  style={{
                    width: '16px', height: '16px',
                    background: selected ? 'var(--s-violet)' : 'transparent',
                    border: `1px solid ${selected ? 'var(--s-violet)' : 'var(--s-text-muted)'}`,
                  }}>
                  {selected && <Check size={10} style={{ color: '#fff' }} strokeWidth={3} />}
                </div>
                {(m.avatarUrl || m.discordAvatar) ? (
                  <Image src={m.avatarUrl || m.discordAvatar} alt={m.displayName} width={18} height={18} unoptimized className="rounded-full flex-shrink-0" />
                ) : (
                  <div className="flex-shrink-0 rounded-full" style={{ width: 18, height: 18, background: 'var(--s-surface)' }} />
                )}
                <span className="text-xs truncate flex-1 text-left" style={{ color: 'var(--s-text)' }}>
                  {m.displayName}
                </span>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--s-text-muted)', fontSize: '10px' }}>
                  {m.group.slice(0, 3)}
                </span>
              </button>
            );
          })}
        </div>
        {everyone.length > 8 && (
          <button type="button" onClick={() => setShowAll(v => !v)}
            className="mt-2 flex items-center gap-1 text-xs" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
            {showAll ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {showAll ? 'Réduire' : `Voir ${everyone.length - 8} de plus`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Deadline (optionnelle)</label>
          <input type="date" className="settings-input w-full text-sm"
            value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Event lié (optionnel)</label>
          <select className="settings-input w-full text-sm"
            value={eventId} onChange={e => setEventId(e.target.value)}>
            <option value="">— Aucun —</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
                {ev.startsAt ? ` (${new Date(ev.startsAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={submit}
          disabled={creating || !title.trim() || assigneeIds.length === 0}
          className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
          style={{ opacity: (!title.trim() || assigneeIds.length === 0) ? 0.5 : 1 }}>
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          <span>Créer</span>
        </button>
        <button type="button" onClick={onCancel}
          className="text-xs" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
