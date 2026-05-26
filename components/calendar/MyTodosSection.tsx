'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Check, Calendar as CalIcon, ChevronDown, ChevronRight, ClipboardList, Shield, X } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api-client';
import {
  compareTodosPending,
  compareTodosDone,
  isOverdue,
  validateTodoResponse,
  normalizeTrainingPacks,
  getSteps,
  getStepProgress,
  TODO_TYPE_META,
  TODO_RESPONSE_MAX,
  type TodoRef,
  type TodoType,
  type ExerciseStep,
} from '@/lib/todos';
import { TodoConfigSummary, TodoResponseSummary } from './TeamTodosPanel';
import TodoDetailDrawer from './TodoDetailDrawer';

type MyTodo = TodoRef & {
  structureName: string;
  structureTag: string;
  teamName: string;
  eventTitle: string | null;
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDeadline(ymd: string, today: string): { label: string; color: string } {
  if (ymd < today) {
    const d1 = new Date(ymd + 'T12:00:00Z');
    const d2 = new Date(today + 'T12:00:00Z');
    const days = Math.round((d2.getTime() - d1.getTime()) / 86_400_000);
    return { label: days === 1 ? 'En retard (1 j)' : `En retard (${days} j)`, color: '#ff5555' };
  }
  if (ymd === today) {
    return { label: "Aujourd'hui", color: 'var(--s-gold)' };
  }
  const d1 = new Date(ymd + 'T12:00:00Z');
  const d2 = new Date(today + 'T12:00:00Z');
  const days = Math.round((d1.getTime() - d2.getTime()) / 86_400_000);
  if (days === 1) return { label: 'Demain', color: 'var(--s-gold)' };
  if (days <= 7) return { label: `Dans ${days} j`, color: 'var(--s-text-dim)' };
  const dd = new Date(ymd + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  return { label: dd, color: 'var(--s-text-dim)' };
}

export default function MyTodosSection() {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const [openTodoId, setOpenTodoId] = useState<string | null>(null);
  const today = useMemo(() => todayYmd(), []);

  const { data, isPending: loading } = useQuery({
    queryKey: ['todos', 'me'] as const,
    queryFn: () => api<{ todos: MyTodo[] }>('/api/todos/me'),
    enabled: !!firebaseUser,
  });
  const todos = data?.todos ?? [];

  // Deep-link : `?todo=ID` depuis l'embed Discord / notif ouvre directement le drawer
  // quand les exercices sont chargés. Consommé une seule fois, puis nettoie l'URL.
  const deepLinkConsumed = useRef(false);
  useEffect(() => {
    if (deepLinkConsumed.current || todos.length === 0 || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const todoParam = params.get('todo');
    if (!todoParam) return;
    if (todos.some(t => t.id === todoParam)) setOpenTodoId(todoParam);
    deepLinkConsumed.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('todo');
    window.history.replaceState({}, '', url.toString());
  }, [todos]);

  const { pending, done } = useMemo(() => {
    const p: MyTodo[] = [];
    const d: MyTodo[] = [];
    for (const t of todos) {
      if (t.done) d.push(t); else p.push(t);
    }
    p.sort(compareTodosPending);
    d.sort(compareTodosDone);
    return { pending: p, done: d };
  }, [todos]);

  // Toggle générique — utilisé pour rouvrir un exercice done, OU pour valider un exercice free/watch_party
  const toggleMutation = useMutation({
    mutationFn: ({ todo, response }: { todo: MyTodo; response?: Record<string, unknown> }) =>
      api(`/api/structures/${todo.structureId}/todos/${todo.id}`, {
        method: 'PATCH',
        body: { action: 'toggle', ...(response ? { response } : {}) },
      }).then(() => ({ todo, response })),
    onSuccess: ({ todo, response }) => {
      // Optimistic-ish : on met à jour le cache directement sans refetch
      qc.setQueryData<{ todos: MyTodo[] }>(['todos', 'me'], (prev) => {
        if (!prev) return prev;
        return {
          todos: prev.todos.map((t) => {
            if (t.id !== todo.id) return t;
            const willBeDone = !t.done;
            return {
              ...t,
              done: willBeDone,
              doneAt: willBeDone ? Date.now() : null,
              response: willBeDone ? (response ?? null) : null,
            };
          }),
        };
      });
      setOpenTodoId(null);
      toast.success(todo.done ? 'Exercice rouvert' : 'Exercice terminé');
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  const togglingId = toggleMutation.isPending ? toggleMutation.variables?.todo.id ?? null : null;
  function toggle(todo: MyTodo, response?: Record<string, unknown>) {
    if (togglingId) return;
    toggleMutation.mutate({ todo, response });
  }

  // v3 : toggle d'un step individuel (cocher/décocher + saisir réponse).
  // Recompute `done` global = tous steps completed → mis à jour dans le cache.
  const toggleStepMutation = useMutation({
    mutationFn: ({ todo, stepId, completed, response }: {
      todo: MyTodo; stepId: string; completed: boolean; response?: Record<string, unknown>;
    }) =>
      api(`/api/structures/${todo.structureId}/todos/${todo.id}`, {
        method: 'PATCH',
        body: { action: 'toggleStep', stepId, completed, ...(response ? { response } : {}) },
      }).then(() => ({ todo, stepId, completed, response })),
    onSuccess: ({ todo, stepId, completed, response }) => {
      qc.setQueryData<{ todos: MyTodo[] }>(['todos', 'me'], (prev) => {
        if (!prev) return prev;
        return {
          todos: prev.todos.map((t) => {
            if (t.id !== todo.id) return t;
            const currentSteps = getSteps(t);
            const nextSteps: ExerciseStep[] = currentSteps.map(s =>
              s.id === stepId
                ? { ...s, completed, completedAt: completed ? Date.now() : null, response: response ?? s.response ?? null }
                : s
            );
            const allDone = nextSteps.every(s => s.completed === true);
            return { ...t, steps: nextSteps, done: allDone, doneAt: allDone ? Date.now() : null };
          }),
        };
      });
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  const togglingStepId = toggleStepMutation.isPending ? toggleStepMutation.variables?.stepId ?? null : null;

  const editStepResponseMutation = useMutation({
    mutationFn: ({ todo, stepId, response }: { todo: MyTodo; stepId: string; response: Record<string, unknown> }) =>
      api(`/api/structures/${todo.structureId}/todos/${todo.id}`, {
        method: 'PATCH',
        body: { action: 'editStepResponse', stepId, response },
      }).then(() => ({ todo, stepId, response })),
    onSuccess: ({ todo, stepId, response }) => {
      qc.setQueryData<{ todos: MyTodo[] }>(['todos', 'me'], (prev) => {
        if (!prev) return prev;
        return {
          todos: prev.todos.map((t) => {
            if (t.id !== todo.id) return t;
            const currentSteps = getSteps(t);
            const nextSteps: ExerciseStep[] = currentSteps.map(s =>
              s.id === stepId ? { ...s, response } : s
            );
            return { ...t, steps: nextSteps };
          }),
        };
      });
      toast.success('Réponse mise à jour');
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });

  // v3 — Verrouillage de l'exercice (validation globale). Une fois cliqué,
  // plus aucune modification possible (sauf si un staff fait unlock).
  const lockMutation = useMutation({
    mutationFn: ({ todo }: { todo: MyTodo }) =>
      api(`/api/structures/${todo.structureId}/todos/${todo.id}`, {
        method: 'PATCH',
        body: { action: 'lock' },
      }).then(() => ({ todo })),
    onSuccess: ({ todo }) => {
      qc.setQueryData<{ todos: MyTodo[] }>(['todos', 'me'], (prev) => {
        if (!prev) return prev;
        return {
          todos: prev.todos.map((t) =>
            t.id === todo.id ? { ...t, lockedAt: Date.now(), lockedBy: firebaseUser?.uid ?? null } : t
          ),
        };
      });
      toast.success('Exercice verrouillé');
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  const lockingTodoId = lockMutation.isPending ? lockMutation.variables?.todo.id ?? null : null;

  // Action depuis la ligne : toujours ouvrir le drawer (détail complet + action ciblée).
  // Le drawer décide ensuite quoi afficher selon le type (form de réponse ou bouton "terminer").
  function handleOpen(todo: MyTodo) {
    setOpenTodoId(todo.id);
  }

  if (loading) {
    return (
      <section className="bevel animate-fade-in p-6 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </section>
    );
  }

  if (todos.length === 0) {
    return null;
  }

  return (
    <section id="my-todos" className="bevel animate-fade-in relative overflow-hidden scroll-mt-20" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold)50, transparent 70%)' }} />
      <div className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.07), transparent 60%)' }} />
      <div className="relative z-[1] p-6 space-y-4">
        <header className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bevel-sm" style={{ background: 'rgba(255,184,0,0.10)', border: '1px solid rgba(255,184,0,0.30)' }}>
            <ClipboardList size={18} style={{ color: 'var(--s-gold)' }} />
          </div>
          <div>
            <h2 className="font-display text-2xl" style={{ letterSpacing: '0.04em' }}>MES EXERCICES</h2>
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              {pending.length > 0
                ? `${pending.length} à faire${done.length > 0 ? ` — ${done.length} terminé${done.length > 1 ? 's' : ''}` : ''}`
                : done.length > 0
                ? `Tout est fait ! ${done.length} exercice${done.length > 1 ? 's' : ''} terminé${done.length > 1 ? 's' : ''}.`
                : 'Aucun exercice.'}
            </p>
          </div>
        </header>

        {pending.length > 0 && (
          <div className="space-y-2">
            {pending.map(t => (
              <TodoRow
                key={t.id}
                todo={t}
                today={today}
                toggling={togglingId === t.id}
                onOpen={() => handleOpen(t)}
                onToggleCheckbox={() => {
                  // v3 : pour les exos multi-step, le checkbox de la ligne ouvre forcément
                  // le drawer (on ne peut pas tout cocher d'un clic — il y a N étapes).
                  // Pour les single-step avec needsResponse : pareil, drawer.
                  // Pour les single-step simples (free/watch_party) : toggle direct.
                  const steps = getSteps(t);
                  const isMulti = steps.length > 1;
                  const needsResp = TODO_TYPE_META[t.type].needsResponse;
                  if (isMulti || (!t.done && needsResp)) {
                    handleOpen(t);
                  } else {
                    toggle(t);
                  }
                }}
              />
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div>
            <button type="button"
              onClick={() => setShowHistory(v => !v)}
              className="flex items-center gap-2 text-sm font-display w-full text-left py-2 transition-colors hover:text-white"
              style={{ color: 'var(--s-text-dim)', letterSpacing: '0.05em', cursor: 'pointer' }}>
              {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              HISTORIQUE ({done.length} FAIT{done.length > 1 ? 'S' : ''})
            </button>
            {showHistory && (
              <div className="space-y-2 mt-2">
                {done.map(t => (
                  <TodoRow
                    key={t.id}
                    todo={t}
                    today={today}
                    toggling={togglingId === t.id}
                    onOpen={() => handleOpen(t)}
                    onToggleCheckbox={() => toggle(t)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drawer de détail — affiche la checklist multi-step + callbacks step-level.
          Pour les exos legacy single-type, getSteps() les wrap en 1 step automatiquement. */}
      {(() => {
        const openTodo = openTodoId ? todos.find(t => t.id === openTodoId) ?? null : null;
        return (
          <TodoDetailDrawer
            open={!!openTodo}
            onClose={() => setOpenTodoId(null)}
            todo={openTodo}
            canEdit={!!openTodo}
            isStaff={false /* MyTodosSection = vue joueur ; le staff a ses propres outils dans CrossTeamTodosPanel */}
            toggleStepId={openTodo ? togglingStepId : null}
            locking={openTodo ? lockingTodoId === openTodo.id : false}
            onToggleStep={openTodo ? async (stepId, completed, response) => {
              await toggleStepMutation.mutateAsync({ todo: openTodo, stepId, completed, response });
            } : undefined}
            onEditStepResponse={openTodo ? async (stepId, response) => {
              await editStepResponseMutation.mutateAsync({ todo: openTodo, stepId, response });
            } : undefined}
            onLock={openTodo ? async () => {
              await lockMutation.mutateAsync({ todo: openTodo });
            } : undefined}
          />
        );
      })()}
    </section>
  );
}

function TodoRow({
  todo,
  today,
  toggling,
  onOpen,
  onToggleCheckbox,
}: {
  todo: MyTodo;
  today: string;
  toggling: boolean;
  onOpen: () => void;
  onToggleCheckbox: () => void;
}) {
  const overdue = isOverdue(todo, Date.now());
  const deadlineInfo = todo.deadline ? formatDeadline(todo.deadline, today) : null;
  const meta = TODO_TYPE_META[todo.type];
  // v3 : compteur d'étapes pour les exos multi-step (X/N) — affiché à côté du titre
  const stepProgress = getStepProgress(todo);
  const isMultiStep = stepProgress.total > 1;

  return (
    <div className="bevel-sm flex items-start gap-3 p-3 transition-all duration-150 hover:brightness-110"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{
        background: todo.done ? 'transparent' : 'var(--s-elevated)',
        border: `1px solid ${overdue ? 'rgba(255,85,85,0.35)' : 'var(--s-border)'}`,
        opacity: todo.done ? 0.6 : 1,
        cursor: 'pointer',
      }}>
      {/* Checkbox : stopPropagation pour ne pas aussi ouvrir le drawer ; toggle direct sinon. */}
      <button type="button"
        onClick={(e) => { e.stopPropagation(); onToggleCheckbox(); }}
        disabled={toggling}
        className="flex-shrink-0 flex items-center justify-center transition-all duration-150"
        style={{
          width: '22px',
          height: '22px',
          marginTop: '2px',
          background: todo.done ? 'var(--s-gold)' : 'transparent',
          border: `1px solid ${todo.done ? 'var(--s-gold)' : 'var(--s-text-muted)'}`,
          cursor: toggling ? 'wait' : 'pointer',
        }}
        aria-label={todo.done ? 'Rouvrir' : 'Marquer terminé'}>
        {toggling ? (
          <Loader2 size={12} className="animate-spin" style={{ color: todo.done ? '#fff' : 'var(--s-text-dim)' }} />
        ) : todo.done ? (
          <Check size={14} style={{ color: '#fff' }} strokeWidth={3} />
        ) : null}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold" style={{
            color: 'var(--s-text)',
            textDecoration: todo.done ? 'line-through' : 'none',
          }}>
            {todo.title}
          </p>
          {/* Compteur d'étapes (v3) — visible uniquement si multi-step */}
          {isMultiStep && (
            <span className="px-1.5 py-0.5 font-bold tracking-wider"
              style={{
                fontSize: '11px',
                background: stepProgress.done === stepProgress.total ? 'rgba(255,184,0,0.12)' : 'var(--s-surface)',
                border: `1px solid ${stepProgress.done === stepProgress.total ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                color: stepProgress.done === stepProgress.total ? 'var(--s-gold)' : 'var(--s-text-dim)',
              }}>
              {stepProgress.done}/{stepProgress.total} ÉTAPES
            </span>
          )}
          {/* Tag de type uniquement si single-step (sinon les types sont mixed) */}
          {!isMultiStep && todo.type !== 'free' && (
            <span className="px-1.5 py-0.5 text-xs font-bold tracking-wider"
              style={{
                fontSize: '12px',
                background: 'var(--s-surface)',
                border: '1px solid var(--s-border)',
                color: 'var(--s-text-dim)',
              }}>
              {meta.short.toUpperCase()}
            </span>
          )}
        </div>
        {todo.description && !todo.done && (
          <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
            {todo.description}
          </p>
        )}
        {!todo.done && <TodoConfigSummary todo={todo} />}
        {todo.done && todo.response && <TodoResponseSummary todo={todo} />}

        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {/* Le lien structure navigue directement — stopPropagation empêche aussi d'ouvrir le drawer. */}
          <Link href={`/community/structure/${todo.structureId}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 group transition-colors"
            style={{ color: 'var(--s-text-muted)' }}>
            <Shield size={12} />
            <span className="text-xs group-hover:text-white">
              {todo.structureTag || todo.structureName} · {todo.teamName}
            </span>
          </Link>
          {deadlineInfo && (
            <span className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: deadlineInfo.color }}>
              <CalIcon size={12} />
              {deadlineInfo.label}
            </span>
          )}
          {todo.eventTitle && (
            <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              À la suite de « {todo.eventTitle} »
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

