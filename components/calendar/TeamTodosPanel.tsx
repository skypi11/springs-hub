'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Check, Calendar as CalIcon, X, ClipboardList, ChevronDown, ChevronUp, Library, Save } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { api } from '@/lib/api-client';
import {
  compareTodosPending,
  compareTodosDone,
  isOverdue,
  TODO_TITLE_MAX,
  TODO_DESCRIPTION_MAX,
  TODO_TYPES,
  TODO_TYPE_META,
  DEFAULT_MENTAL_PROMPTS,
  DEADLINE_OFFSET_DAYS_MAX,
  DEADLINE_OFFSET_DAYS_MIN,
  DEADLINE_OFFSET_PRESETS,
  normalizeTrainingPacks,
  type TodoRef,
  type TodoType,
  type DeadlineMode,
} from '@/lib/todos';
import { TEMPLATE_NAME_MAX } from '@/lib/todo-templates';
import { TodoConfigFields } from '@/components/calendar/TodoConfigFields';
import TodoTemplatesManager, { useTodoTemplates, type TodoTemplateUi } from '@/components/calendar/TodoTemplatesManager';

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
  const qc = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [showForm, setShowForm] = useState(false);
  const [showTemplatesManager, setShowTemplatesManager] = useState(false);
  const today = useMemo(() => todayYmd(), []);

  const { templates, reload: reloadTemplates } = useTodoTemplates(structureId);

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

  const todosQueryKey = ['structure', structureId, 'team', team.id, 'todos'] as const;
  const eventsQueryKey = ['structure', structureId, 'events'] as const;

  const { data: todosData, isPending: loading } = useQuery({
    queryKey: todosQueryKey,
    queryFn: () => api<{ todos: TodoRef[] }>(`/api/structures/${structureId}/todos?subTeamId=${team.id}&status=all`),
    enabled: !!firebaseUser,
  });

  const todos: TodoWithMeta[] = useMemo(() => {
    const raw = todosData?.todos ?? [];
    return raw.map(t => {
      const m = memberById.get(t.assigneeId);
      return {
        ...t,
        assigneeName: m?.displayName ?? t.assigneeId,
        assigneeAvatar: m?.avatarUrl || m?.discordAvatar || '',
      };
    });
  }, [todosData, memberById]);

  type EventApi = { id: string; title: string; startsAt: string | null; target?: { scope?: string; teamIds?: string[] } };
  const { data: eventsData } = useQuery({
    queryKey: eventsQueryKey,
    queryFn: () => api<{ events: EventApi[] }>(`/api/structures/${structureId}/events`),
    enabled: !!firebaseUser,
  });

  const events: EventOpt[] = useMemo(() => {
    const list = eventsData?.events ?? [];
    return list
      .filter(e => {
        const scope = e.target?.scope;
        const teamIds = e.target?.teamIds ?? [];
        return scope === 'all' || teamIds.includes(team.id);
      })
      .map(e => ({ id: e.id, title: e.title, startsAt: e.startsAt }));
  }, [eventsData, team.id]);

  const invalidateTodos = () => qc.invalidateQueries({ queryKey: todosQueryKey });

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

  const toggleMutation = useMutation({
    mutationFn: (todo: TodoWithMeta) =>
      api(`/api/structures/${structureId}/todos/${todo.id}`, {
        method: 'PATCH',
        body: { action: 'toggle' },
      }).then(() => todo),
    onSuccess: () => invalidateTodos(),
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });

  const deleteMutation = useMutation({
    mutationFn: (todo: TodoWithMeta) =>
      api(`/api/structures/${structureId}/todos/${todo.id}`, { method: 'DELETE' }).then(() => todo),
    onSuccess: () => { toast.success('Devoir supprimé'); invalidateTodos(); },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });

  const busyId = toggleMutation.isPending ? toggleMutation.variables?.id ?? null
    : deleteMutation.isPending ? deleteMutation.variables?.id ?? null
    : null;

  function toggleTodo(todo: TodoWithMeta) {
    if (busyId) return;
    toggleMutation.mutate(todo);
  }

  async function deleteTodo(todo: TodoWithMeta) {
    if (busyId) return;
    const ok = await confirm({
      title: 'Supprimer ce devoir ?',
      message: `« ${todo.title} » — assigné à ${todo.assigneeName}. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    deleteMutation.mutate(todo);
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
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button"
            onClick={() => setShowTemplatesManager(true)}
            className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150"
            style={{ color: 'var(--s-text-dim)' }}
            title="Gérer les templates">
            <Library size={11} /> Templates
            {templates.length > 0 && (
              <span style={{ color: 'var(--s-text-muted)' }}>({templates.length})</span>
            )}
          </button>
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
      </div>

      {/* Formulaire */}
      {showForm && (
        <NewTodoForm
          structureId={structureId}
          team={team}
          events={events}
          templates={templates}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); invalidateTodos(); }}
          onTemplateSaved={reloadTemplates}
        />
      )}

      {/* Modal gestion templates */}
      {showTemplatesManager && firebaseUser && (
        <TodoTemplatesManager
          structureId={structureId}
          currentUid={firebaseUser.uid}
          templates={templates}
          onClose={() => setShowTemplatesManager(false)}
          onChanged={reloadTemplates}
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
  const overdue = isOverdue(todo, Date.now());
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
          {todo.type !== 'free' && (
            <span className="px-1.5 py-0.5 text-xs font-bold tracking-wider"
              style={{
                fontSize: '10px',
                background: 'var(--s-elevated)',
                border: '1px solid var(--s-border)',
                color: 'var(--s-text-dim)',
              }}>
              {TODO_TYPE_META[todo.type].short.toUpperCase()}
            </span>
          )}
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
        {!todo.done && <TodoConfigSummary todo={todo} />}
        {todo.done && todo.response && <TodoResponseSummary todo={todo} />}
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
  templates,
  onCancel,
  onCreated,
  onTemplateSaved,
}: {
  structureId: string;
  team: TeamRef;
  events: EventOpt[];
  templates: TodoTemplateUi[];
  onCancel: () => void;
  onCreated: () => void;
  onTemplateSaved: () => void;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const [type, setType] = useState<TodoType>('free');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [eventId, setEventId] = useState('');
  // Deadline relative à l'event : uniquement actif si un event est sélectionné.
  const [deadlineMode, setDeadlineMode] = useState<DeadlineMode>('absolute');
  const [deadlineOffsetDays, setDeadlineOffsetDays] = useState<number>(1); // par défaut J+1 après l'event
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [postToChannel, setPostToChannel] = useState(false); // false = DM privé uniquement (par défaut)
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [saveAsShared, setSaveAsShared] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  // Feuille de match auto (présences confirmées de l'event lié ∩ roster). Null = pas fetché.
  const [lineup, setLineup] = useState<{ confirmed: string[]; rosterFallback: string[] } | null>(null);
  const [lineupLoading, setLineupLoading] = useState(false);

  // Config spécifique au type — un seul objet, les clés non-pertinentes sont ignorées à la soumission
  const [config, setConfig] = useState<Record<string, unknown>>({});
  function updateConfig(patch: Record<string, unknown>) {
    setConfig(prev => ({ ...prev, ...patch }));
  }
  // Changer de type réinitialise la config (les champs d'un type ne correspondent pas à un autre)
  function changeType(t: TodoType) {
    setType(t);
    if (t === 'mental_checkin') setConfig({ prompts: [...DEFAULT_MENTAL_PROMPTS] });
    else setConfig({});
  }

  // Applique un template : pré-remplit type + title + description + config.
  // Ne touche pas aux assignees/deadline/eventId — ceux-ci sont contextuels à chaque devoir.
  function applyTemplate(tpl: TodoTemplateUi) {
    setType(tpl.type);
    setTitle(tpl.titleTemplate);
    setDescription(tpl.descriptionTemplate);
    // Pour mental_checkin sans prompts dans le template, on repose sur les defaults.
    if (tpl.type === 'mental_checkin') {
      const prompts = Array.isArray((tpl.config as { prompts?: unknown }).prompts)
        ? ((tpl.config as { prompts: unknown[] }).prompts).filter(p => typeof p === 'string') as string[]
        : [];
      setConfig({ prompts: prompts.length > 0 ? prompts : [...DEFAULT_MENTAL_PROMPTS] });
    } else {
      setConfig({ ...tpl.config });
    }
    setShowTemplatePicker(false);
    toast.success(`Template « ${tpl.name} » appliqué`);
  }

  async function saveAsTemplate() {
    if (!firebaseUser || savingTemplate) return;
    if (!saveAsName.trim()) { toast.error('Donne un nom au template'); return; }
    setSavingTemplate(true);
    try {
      await api(`/api/structures/${structureId}/todo-templates`, {
        method: 'POST',
        body: {
          scope: saveAsShared ? 'structure' : 'personal',
          name: saveAsName.trim(),
          type,
          titleTemplate: title.trim(),
          descriptionTemplate: description.trim(),
          config,
        },
      });
      toast.success(saveAsShared ? 'Template partagé enregistré' : 'Template personnel enregistré');
      setShowSaveAs(false);
      setSaveAsName('');
      setSaveAsShared(false);
      onTemplateSaved();
    } catch (err) {
      toast.error((err as Error).message || 'Erreur création template');
    }
    setSavingTemplate(false);
  }

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

  // Fetch la feuille de match (présences confirmées + fallback roster) quand un event est lié.
  // Reset si eventId ou team change, puis re-fetch. Le staff clique ensuite sur "Prefill" pour appliquer.
  useEffect(() => {
    if (!eventId || !firebaseUser) {
      setLineup(null);
      return;
    }
    let cancelled = false;
    setLineupLoading(true);
    api<{ confirmed: string[]; rosterFallback: string[] }>(`/api/structures/${structureId}/events/${eventId}/lineup?subTeamId=${encodeURIComponent(team.id)}`)
      .then(data => {
        if (cancelled) return;
        if (data && Array.isArray(data.confirmed) && Array.isArray(data.rosterFallback)) {
          setLineup({ confirmed: data.confirmed, rosterFallback: data.rosterFallback });
        } else {
          setLineup(null);
        }
      })
      .catch(() => { if (!cancelled) setLineup(null); })
      .finally(() => { if (!cancelled) setLineupLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, team.id, structureId, firebaseUser]);

  // Applique la feuille de match : confirmés si présents, sinon roster complet.
  function prefillFromLineup() {
    if (!lineup) return;
    const next = lineup.confirmed.length > 0 ? lineup.confirmed : lineup.rosterFallback;
    setAssigneeIds(next);
  }

  async function submit() {
    if (!firebaseUser || creating) return;
    if (!title.trim()) { toast.error('Titre requis'); return; }
    if (assigneeIds.length === 0) { toast.error('Sélectionne au moins un joueur'); return; }
    setCreating(true);
    try {
      const data = await api<{ count: number }>(`/api/structures/${structureId}/todos`, {
        method: 'POST',
        body: {
          subTeamId: team.id,
          assigneeIds,
          type,
          title: title.trim(),
          description: description.trim() || undefined,
          config,
          eventId: eventId || undefined,
          ...(eventId && deadlineMode === 'relative'
            ? { deadlineMode: 'relative', deadlineOffsetDays }
            : { deadline: deadline || undefined }),
          postToChannel,
        },
      });
      toast.success(`${data.count} devoir${data.count > 1 ? 's' : ''} créé${data.count > 1 ? 's' : ''}`);
      onCreated();
    } catch (err) {
      toast.error((err as Error).message || 'Erreur création');
    }
    setCreating(false);
  }

  const visibleMembers = showAll ? everyone : everyone.slice(0, 8);

  return (
    <div className="p-3 space-y-3" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      {/* Picker template — visible uniquement s'il y en a au moins un */}
      {templates.length > 0 && (
        <div>
          <button type="button"
            onClick={() => setShowTemplatePicker(v => !v)}
            className="flex items-center gap-1.5 text-xs font-bold transition-colors"
            style={{ color: 'var(--s-gold)', cursor: 'pointer' }}>
            {showTemplatePicker ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            Partir d&apos;un template ({templates.length})
          </button>
          {showTemplatePicker && (
            <div className="mt-2 grid gap-1.5 grid-cols-1 sm:grid-cols-2">
              {templates.map(tpl => (
                <button key={tpl.id} type="button" onClick={() => applyTemplate(tpl)}
                  className="text-left p-2 transition-all duration-150"
                  style={{
                    background: 'var(--s-elevated)',
                    border: '1px solid var(--s-border)',
                    cursor: 'pointer',
                  }}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-bold truncate" style={{ color: 'var(--s-text)' }}>
                      {tpl.name}
                    </span>
                    <span className="px-1 py-0.5" style={{
                      fontSize: '9px',
                      background: 'var(--s-surface)',
                      border: '1px solid var(--s-border)',
                      color: 'var(--s-text-dim)',
                    }}>
                      {TODO_TYPE_META[tpl.type].short.toUpperCase()}
                    </span>
                    {tpl.scope === 'structure' && (
                      <span className="px-1 py-0.5" style={{
                        fontSize: '9px',
                        background: 'rgba(255,184,0,0.12)',
                        border: '1px solid rgba(255,184,0,0.3)',
                        color: 'var(--s-gold)',
                      }}>
                        PARTAGÉ
                      </span>
                    )}
                  </div>
                  {tpl.titleTemplate && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--s-text-dim)' }}>
                      {tpl.titleTemplate}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Type picker — chips horizontales, le choix du type change les champs affichés */}
      <div>
        <label className="t-label block mb-1.5" style={{ fontSize: '12px' }}>Type de devoir</label>
        <div className="flex flex-wrap gap-1.5">
          {TODO_TYPES.map(t => {
            const active = type === t;
            return (
              <button key={t} type="button"
                onClick={() => changeType(t)}
                className="px-2.5 py-1 text-xs font-bold transition-all duration-150"
                style={{
                  background: active ? 'var(--s-elevated)' : 'var(--s-surface)',
                  border: `1px solid ${active ? 'var(--s-gold)' : 'var(--s-border)'}`,
                  color: active ? 'var(--s-gold)' : 'var(--s-text-dim)',
                  cursor: 'pointer',
                }}>
                {TODO_TYPE_META[t].short.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Titre *</label>
        <input type="text" className="settings-input w-full text-sm"
          placeholder={titlePlaceholderFor(type)}
          maxLength={TODO_TITLE_MAX}
          value={title} onChange={e => setTitle(e.target.value)} />
      </div>

      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Description (optionnelle)</label>
        <textarea rows={2} className="settings-input w-full text-sm"
          placeholder="Contexte, consignes, points d'attention"
          maxLength={TODO_DESCRIPTION_MAX}
          value={description} onChange={e => setDescription(e.target.value)} />
      </div>

      {/* Champs spécifiques au type sélectionné */}
      <TodoConfigFields type={type} config={config} onChange={updateConfig} />

      <div>
        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
          <label className="t-label" style={{ fontSize: '12px' }}>Assigner à * ({assigneeIds.length})</label>
          <div className="flex items-center gap-3">
            {eventId && lineup && (
              <button type="button" onClick={prefillFromLineup}
                className="text-xs font-bold transition-colors flex items-center gap-1"
                style={{ color: 'var(--s-gold)', cursor: 'pointer' }}
                title={lineup.confirmed.length > 0
                  ? `${lineup.confirmed.length} joueur${lineup.confirmed.length > 1 ? 's' : ''} confirmé${lineup.confirmed.length > 1 ? 's' : ''} pour l'event`
                  : 'Aucun présent confirmé — prefill depuis le roster complet'}>
                <ClipboardList size={11} />
                {lineup.confirmed.length > 0
                  ? `Feuille de match (${lineup.confirmed.length})`
                  : `Roster complet (${lineup.rosterFallback.length})`}
              </button>
            )}
            {eventId && lineupLoading && (
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                <Loader2 size={11} className="inline animate-spin" /> Feuille de match…
              </span>
            )}
            <button type="button" onClick={selectAll}
              className="text-xs transition-colors" style={{ color: 'var(--s-violet-light)', cursor: 'pointer' }}>
              Tout sélectionner
            </button>
          </div>
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

      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Event lié (optionnel)</label>
        <select className="settings-input w-full text-sm"
          value={eventId}
          onChange={e => {
            const v = e.target.value;
            setEventId(v);
            // Si on retire l'event : repasse forcément en deadline absolue (sinon valeur orpheline).
            if (!v) setDeadlineMode('absolute');
          }}>
          <option value="">— Aucun —</option>
          {events.map(ev => (
            <option key={ev.id} value={ev.id}>
              {ev.title}
              {ev.startsAt ? ` (${new Date(ev.startsAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="t-label" style={{ fontSize: '12px' }}>Deadline (optionnelle)</label>
          {eventId && (
            <div className="flex items-center gap-1">
              {(['absolute', 'relative'] as const).map(mode => {
                const active = deadlineMode === mode;
                return (
                  <button key={mode} type="button"
                    onClick={() => setDeadlineMode(mode)}
                    className="px-2 py-0.5 text-xs font-bold transition-all duration-150"
                    style={{
                      background: active ? 'var(--s-elevated)' : 'transparent',
                      border: `1px solid ${active ? 'var(--s-gold)' : 'var(--s-border)'}`,
                      color: active ? 'var(--s-gold)' : 'var(--s-text-dim)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}>
                    {mode === 'absolute' ? 'DATE PRÉCISE' : 'APRÈS L\'EVENT'}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {eventId && deadlineMode === 'relative' ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {DEADLINE_OFFSET_PRESETS.map(n => {
                const active = deadlineOffsetDays === n;
                const label = n === 0 ? 'Le jour J' : n > 0 ? `J+${n}` : `J${n}`;
                return (
                  <button key={n} type="button"
                    onClick={() => setDeadlineOffsetDays(n)}
                    className="px-2.5 py-1 text-xs font-bold transition-all duration-150"
                    style={{
                      background: active ? 'var(--s-elevated)' : 'var(--s-surface)',
                      border: `1px solid ${active ? 'var(--s-gold)' : 'var(--s-border)'}`,
                      color: active ? 'var(--s-gold)' : 'var(--s-text-dim)',
                      cursor: 'pointer',
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>ou custom :</span>
              <input type="number" min={DEADLINE_OFFSET_DAYS_MIN} max={DEADLINE_OFFSET_DAYS_MAX}
                className="settings-input text-sm"
                style={{ width: '80px' }}
                value={deadlineOffsetDays}
                onChange={e => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    setDeadlineOffsetDays(Math.max(DEADLINE_OFFSET_DAYS_MIN, Math.min(DEADLINE_OFFSET_DAYS_MAX, Math.round(n))));
                  }
                }} />
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                {deadlineOffsetDays === 0
                  ? 'le jour de l’event'
                  : deadlineOffsetDays > 0
                    ? `jour${deadlineOffsetDays > 1 ? 's' : ''} APRÈS l’event`
                    : `jour${deadlineOffsetDays < -1 ? 's' : ''} AVANT l’event`}
                {' '}(négatif = avant, positif = après, max ±{DEADLINE_OFFSET_DAYS_MAX})
              </span>
            </div>
            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              Ex : J-1 = check-in / training pack à faire la veille du match. Si l’event est déplacé, la deadline suit automatiquement.
            </p>
          </div>
        ) : (
          <input type="date" className="settings-input w-full text-sm"
            value={deadline} onChange={e => setDeadline(e.target.value)} />
        )}
      </div>

      {/* Save-as-template : zone inline qui se déplie */}
      {showSaveAs ? (
        <div className="p-2.5 space-y-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-gold)' }}>
          <div className="flex items-center justify-between">
            <span className="t-label" style={{ fontSize: '11px', color: 'var(--s-gold)' }}>
              ENREGISTRER CE DEVOIR COMME TEMPLATE
            </span>
            <button type="button" onClick={() => setShowSaveAs(false)}
              className="p-1" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
              <X size={11} />
            </button>
          </div>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Nom du template (ex: Scouting 3v3 BO5)"
            maxLength={TEMPLATE_NAME_MAX}
            value={saveAsName}
            onChange={e => setSaveAsName(e.target.value)} />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={saveAsShared}
              onChange={e => setSaveAsShared(e.target.checked)} />
            <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
              Partager avec toute la structure (sinon : perso, visible par moi uniquement)
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={saveAsTemplate}
              disabled={savingTemplate || !saveAsName.trim()}
              className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
              style={{ opacity: !saveAsName.trim() ? 0.5 : 1 }}>
              {savingTemplate ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              <span>Enregistrer</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Case Discord : par défaut DM privé uniquement. Cocher = aussi poster dans le channel de l'équipe. */}
      <label className="flex items-start gap-2 cursor-pointer select-none p-2"
        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
        <input type="checkbox" checked={postToChannel}
          onChange={e => setPostToChannel(e.target.checked)}
          className="mt-0.5" />
        <span className="flex-1">
          <span className="block text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
            Aussi publier dans le channel Discord de l&apos;équipe
          </span>
          <span className="block text-xs mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
            Par défaut, seul un DM privé est envoyé à l&apos;assigné. Coche cette case pour que tous les membres de l&apos;équipe voient le devoir (ex : entraînement collectif).
          </span>
        </span>
      </label>

      <div className="flex items-center gap-2 flex-wrap">
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
        {!showSaveAs && title.trim() && (
          <button type="button" onClick={() => { setShowSaveAs(true); setSaveAsName(title.trim().slice(0, TEMPLATE_NAME_MAX)); }}
            className="ml-auto flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}
            title="Enregistrer ce devoir comme template réutilisable">
            <Save size={11} /> Enregistrer comme template
          </button>
        )}
      </div>
    </div>
  );
}

function titlePlaceholderFor(type: TodoType): string {
  switch (type) {
    case 'replay_review':  return 'Visionnage replay vs Alpha — samedi';
    case 'training_pack':  return 'Training pack défensif — 30 min';
    case 'vod_review':     return 'VOD G2 vs Karmine — rotations';
    case 'scouting':       return 'Scouting Team Nova — BO5 de dimanche';
    case 'watch_party':    return 'Watch party finale RLCS — 21h';
    case 'mental_checkin': return "Check-in d'avant match";
    case 'free':           return 'Tâche à accomplir';
    default:               return 'Tâche à accomplir';
  }
}

// Résumé compact de la config d'un devoir pending (visible côté staff ET joueur).
// Les valeurs vides sont ignorées — affiche uniquement ce qui apporte de l'info.
export function TodoConfigSummary({ todo }: { todo: TodoRef }) {
  const c = todo.config as Record<string, unknown>;
  const rows: { label: string; value: string; mono?: boolean }[] = [];
  switch (todo.type) {
    case 'replay_review':
      if (typeof c.replayNote === 'string' && c.replayNote) rows.push({ label: 'À regarder', value: c.replayNote });
      break;
    case 'training_pack': {
      const packs = normalizeTrainingPacks(c).filter(p => p.code);
      if (packs.length === 1) {
        rows.push({ label: 'Code', value: packs[0].code, mono: true });
        if (packs[0].objective) rows.push({ label: 'Objectif', value: packs[0].objective });
      } else if (packs.length > 1) {
        rows.push({
          label: `Packs (${packs.length})`,
          value: packs.map(p => p.code).join(' · '),
          mono: true,
        });
      }
      break;
    }
    case 'vod_review':
      if (typeof c.url === 'string' && c.url) rows.push({ label: 'VOD', value: c.url });
      if (typeof c.focus === 'string' && c.focus) rows.push({ label: 'Focus', value: c.focus });
      break;
    case 'scouting':
      if (typeof c.opponent === 'string' && c.opponent) rows.push({ label: 'Adversaire', value: c.opponent });
      break;
    case 'watch_party':
      if (typeof c.location === 'string' && c.location) rows.push({ label: 'Lieu', value: c.location });
      break;
    case 'mental_checkin': {
      const prompts = Array.isArray(c.prompts) ? c.prompts.filter(p => typeof p === 'string') as string[] : [];
      if (prompts.length > 0) rows.push({ label: 'Items', value: prompts.join(' · ') });
      break;
    }
    default:
      break;
  }
  if (rows.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {rows.map((r, i) => (
        <div key={i} className="text-xs flex gap-1.5" style={{ color: 'var(--s-text-dim)' }}>
          <span className="flex-shrink-0 font-bold" style={{ color: 'var(--s-text-muted)' }}>{r.label} :</span>
          {r.label === 'VOD' ? (
            <a href={r.value} target="_blank" rel="noopener noreferrer"
              className="truncate underline hover:no-underline" style={{ color: 'var(--s-blue)' }}>
              {r.value}
            </a>
          ) : (
            <span className={`${r.mono ? 'font-mono' : ''} truncate`}>{r.value}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// Résumé de la réponse d'un devoir done (visible côté staff pour relire ce que le joueur a rendu).
export function TodoResponseSummary({ todo }: { todo: TodoRef }) {
  if (!todo.response) return null;
  const r = todo.response as Record<string, unknown>;
  let body: React.ReactNode = null;
  switch (todo.type) {
    case 'replay_review':
    case 'vod_review':
      if (typeof r.analysis === 'string' && r.analysis) body = r.analysis;
      break;
    case 'training_pack': {
      // Nouvelle forme : { results: [{done, note}], comment }.
      // Ancienne forme (compat) : { result: string }.
      if (Array.isArray(r.results)) {
        const packs = normalizeTrainingPacks(todo.config as Record<string, unknown>).filter(p => p.code);
        const results = r.results as Array<{ done?: unknown; note?: unknown }>;
        const doneCount = results.filter(x => x?.done === true).length;
        const comment = typeof r.comment === 'string' ? r.comment : '';
        body = (
          <div className="space-y-1.5">
            <div className="text-xs font-bold" style={{ color: 'var(--s-gold)' }}>
              {doneCount}/{packs.length || results.length} pack{(packs.length || results.length) > 1 ? 's' : ''} réussi{doneCount > 1 ? 's' : ''}
            </div>
            <div className="space-y-0.5">
              {packs.map((p, i) => {
                const done = results[i]?.done === true;
                return (
                  <div key={i} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                    <span style={{ color: done ? 'var(--s-gold)' : 'var(--s-text-muted)' }}>
                      {done ? '✓' : '·'}
                    </span>
                    <span className="font-mono truncate">{p.code}</span>
                    {p.objective && (
                      <span className="truncate" style={{ color: 'var(--s-text-muted)' }}>— {p.objective}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {comment && (
              <div className="text-xs whitespace-pre-wrap mt-1" style={{ color: 'var(--s-text-dim)' }}>
                {comment}
              </div>
            )}
          </div>
        );
      } else if (typeof r.result === 'string' && r.result) {
        body = r.result;
      }
      break;
    }
    case 'scouting':
      if (typeof r.notes === 'string' && r.notes) body = r.notes;
      break;
    case 'mental_checkin': {
      const ratings = Array.isArray(r.ratings) ? r.ratings : [];
      const prompts = Array.isArray((todo.config as { prompts?: unknown }).prompts)
        ? ((todo.config as { prompts: unknown[] }).prompts).filter(p => typeof p === 'string') as string[]
        : [];
      body = (
        <div className="flex flex-wrap gap-1.5">
          {ratings.map((n, i) => (
            <span key={i} className="px-1.5 py-0.5 text-xs"
              style={{
                background: 'var(--s-elevated)',
                border: '1px solid var(--s-border)',
                color: 'var(--s-text-dim)',
                fontSize: '10px',
              }}>
              {(prompts[i] ?? `Item ${i + 1}`)} : <strong style={{ color: 'var(--s-gold)' }}>{String(n)}/5</strong>
            </span>
          ))}
        </div>
      );
      break;
    }
    default:
      break;
  }
  if (!body) return null;
  return (
    <div className="mt-1.5 p-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
      <div className="t-label mb-1" style={{ fontSize: '10px', color: 'var(--s-text-muted)' }}>RÉPONSE</div>
      {typeof body === 'string' ? (
        <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--s-text)' }}>{body}</p>
      ) : body}
    </div>
  );
}
