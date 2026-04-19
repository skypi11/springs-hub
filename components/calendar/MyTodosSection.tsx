'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Check, Calendar as CalIcon, ChevronDown, ChevronRight, ClipboardList, Shield, X } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  compareTodosPending,
  compareTodosDone,
  isOverdue,
  validateTodoResponse,
  normalizeTrainingPacks,
  TODO_TYPE_META,
  TODO_RESPONSE_MAX,
  type TodoRef,
  type TodoType,
} from '@/lib/todos';
import { TodoConfigSummary, TodoResponseSummary } from './TeamTodosPanel';

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
  const [todos, setTodos] = useState<MyTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const today = useMemo(() => todayYmd(), []);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/todos/me', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTodos(data.todos ?? []);
      }
    } catch (err) {
      console.error('[MyTodos] load error:', err);
    }
    setLoading(false);
  }, [firebaseUser]);

  useEffect(() => { load(); }, [load]);

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

  // Toggle générique — utilisé pour rouvrir un devoir done, OU pour valider un devoir free/watch_party
  async function toggle(todo: MyTodo, response?: Record<string, unknown>) {
    if (!firebaseUser || togglingId) return;
    setTogglingId(todo.id);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${todo.structureId}/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'toggle', ...(response ? { response } : {}) }),
      });
      if (res.ok) {
        setTodos(prev => prev.map(t => {
          if (t.id !== todo.id) return t;
          const willBeDone = !t.done;
          return {
            ...t,
            done: willBeDone,
            doneAt: willBeDone ? Date.now() : null,
            response: willBeDone ? (response ?? null) : null,
          };
        }));
        setRespondingId(null);
        toast.success(todo.done ? 'Devoir rouvert' : 'Devoir terminé');
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setTogglingId(null);
  }

  function handleValidate(todo: MyTodo) {
    const meta = TODO_TYPE_META[todo.type];
    if (!meta.needsResponse) {
      // Pas de réponse requise → toggle direct
      toggle(todo);
    } else {
      // Réponse requise → ouvre le formulaire inline
      setRespondingId(todo.id);
    }
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
    <section className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), var(--s-violet-light)50, transparent 70%)' }} />
      <div className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 100% 0%, rgba(123,47,190,0.07), transparent 60%)' }} />
      <div className="relative z-[1] p-6 space-y-4">
        <header className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bevel-sm" style={{ background: 'rgba(123,47,190,0.10)', border: '1px solid rgba(123,47,190,0.30)' }}>
            <ClipboardList size={18} style={{ color: 'var(--s-violet-light)' }} />
          </div>
          <div>
            <h2 className="font-display text-2xl" style={{ letterSpacing: '0.04em' }}>MES DEVOIRS</h2>
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              {pending.length > 0
                ? `${pending.length} à faire${done.length > 0 ? ` — ${done.length} terminé${done.length > 1 ? 's' : ''}` : ''}`
                : done.length > 0
                ? `Tout est fait ! ${done.length} devoir${done.length > 1 ? 's' : ''} terminé${done.length > 1 ? 's' : ''}.`
                : 'Aucun devoir.'}
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
                responding={respondingId === t.id}
                onValidate={() => handleValidate(t)}
                onCancelResponse={() => setRespondingId(null)}
                onSubmitResponse={(resp) => toggle(t, resp)}
                onReopen={() => toggle(t)}
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
                    responding={false}
                    onValidate={() => handleValidate(t)}
                    onCancelResponse={() => setRespondingId(null)}
                    onSubmitResponse={(resp) => toggle(t, resp)}
                    onReopen={() => toggle(t)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TodoRow({
  todo,
  today,
  toggling,
  responding,
  onValidate,
  onCancelResponse,
  onSubmitResponse,
  onReopen,
}: {
  todo: MyTodo;
  today: string;
  toggling: boolean;
  responding: boolean;
  onValidate: () => void;
  onCancelResponse: () => void;
  onSubmitResponse: (response: Record<string, unknown>) => void;
  onReopen: () => void;
}) {
  const overdue = isOverdue(todo, today);
  const deadlineInfo = todo.deadline ? formatDeadline(todo.deadline, today) : null;
  const meta = TODO_TYPE_META[todo.type];

  return (
    <div className="bevel-sm flex items-start gap-3 p-3 transition-all duration-150"
      style={{
        background: todo.done ? 'transparent' : 'var(--s-elevated)',
        border: `1px solid ${overdue ? 'rgba(255,85,85,0.35)' : 'var(--s-border)'}`,
        opacity: todo.done ? 0.6 : 1,
      }}>
      {/* Checkbox — click ouvre le form de réponse si type le demande, sinon toggle direct */}
      <button type="button"
        onClick={todo.done ? onReopen : onValidate}
        disabled={toggling}
        className="flex-shrink-0 flex items-center justify-center transition-all duration-150"
        style={{
          width: '22px',
          height: '22px',
          marginTop: '2px',
          background: todo.done ? 'var(--s-violet)' : 'transparent',
          border: `1px solid ${todo.done ? 'var(--s-violet)' : 'var(--s-text-muted)'}`,
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
          {todo.type !== 'free' && (
            <span className="px-1.5 py-0.5 text-xs font-bold tracking-wider"
              style={{
                fontSize: '10px',
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
          <Link href={`/community/structure/${todo.structureId}`}
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

        {/* Formulaire de réponse inline pour les types qui en demandent une */}
        {responding && !todo.done && meta.needsResponse && (
          <ResponseForm
            type={todo.type}
            config={todo.config as Record<string, unknown>}
            onCancel={onCancelResponse}
            onSubmit={onSubmitResponse}
          />
        )}
      </div>
    </div>
  );
}

function ResponseForm({
  type,
  config,
  onCancel,
  onSubmit,
}: {
  type: TodoType;
  config: Record<string, unknown>;
  onCancel: () => void;
  onSubmit: (response: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const [analysis, setAnalysis] = useState('');
  const [notes, setNotes] = useState('');
  const promptsRaw = Array.isArray(config.prompts) ? config.prompts as unknown[] : [];
  const prompts: string[] = promptsRaw
    .map(p => typeof p === 'string' ? p : '')
    .filter(p => p.length > 0);
  const [ratings, setRatings] = useState<number[]>(prompts.map(() => 3));

  // Training pack : 1 case à cocher par pack + commentaire global.
  const packs = normalizeTrainingPacks(config).filter(p => p.code);
  const [packResults, setPackResults] = useState<boolean[]>(() => packs.map(() => false));
  const [packComment, setPackComment] = useState('');

  function build(): Record<string, unknown> | null {
    switch (type) {
      case 'replay_review':
      case 'vod_review':
        return { analysis };
      case 'training_pack':
        return {
          results: packResults.map(done => ({ done, note: '' })),
          comment: packComment,
        };
      case 'scouting':
        return { notes };
      case 'mental_checkin':
        return { ratings };
      default:
        return null;
    }
  }

  function submit() {
    const payload = build();
    if (!payload) return;
    const check = validateTodoResponse(type, payload);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    onSubmit(check.value);
  }

  const label: Record<TodoType, string> = {
    free: '',
    watch_party: '',
    replay_review: 'Ton analyse *',
    vod_review: 'Ton analyse *',
    training_pack: 'Ton résultat *',
    scouting: 'Tes notes *',
    mental_checkin: '',
  };

  return (
    <div className="mt-3 p-3 space-y-3" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-center justify-between">
        <span className="t-label" style={{ fontSize: '11px', color: 'var(--s-text-dim)' }}>
          VALIDER LE DEVOIR
        </span>
        <button type="button" onClick={onCancel}
          className="p-0.5" style={{ color: 'var(--s-text-muted)', cursor: 'pointer' }}
          aria-label="Annuler">
          <X size={12} />
        </button>
      </div>

      {(type === 'replay_review' || type === 'vod_review') && (
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>{label[type]}</label>
          <textarea rows={4} className="settings-input w-full text-sm"
            placeholder="Ce que tu as identifié, ce que tu vas retravailler..."
            maxLength={TODO_RESPONSE_MAX}
            value={analysis} onChange={e => setAnalysis(e.target.value)} />
        </div>
      )}

      {type === 'training_pack' && (
        <div className="space-y-2">
          <label className="t-label block" style={{ fontSize: '12px' }}>
            Coche les packs réussis
          </label>
          <div className="space-y-1.5">
            {packs.map((p, i) => {
              const done = packResults[i] ?? false;
              return (
                <button key={i} type="button"
                  onClick={() => setPackResults(prev => prev.map((v, idx) => idx === i ? !v : v))}
                  className="w-full flex items-center gap-2.5 p-2 text-left transition-colors"
                  style={{
                    background: done ? 'rgba(255,184,0,0.08)' : 'var(--s-elevated)',
                    border: `1px solid ${done ? 'var(--s-gold)' : 'var(--s-border)'}`,
                    cursor: 'pointer',
                  }}>
                  <span className="flex items-center justify-center flex-shrink-0"
                    style={{
                      width: '16px', height: '16px',
                      background: done ? 'var(--s-gold)' : 'transparent',
                      border: `1px solid ${done ? 'var(--s-gold)' : 'var(--s-border)'}`,
                    }}>
                    {done && <Check size={11} style={{ color: '#000' }} strokeWidth={3} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono" style={{ color: 'var(--s-text)' }}>{p.code}</div>
                    {p.objective && (
                      <div className="text-xs truncate" style={{ color: 'var(--s-text-muted)', fontSize: '11px' }}>
                        {p.objective}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div>
            <label className="t-label block mb-1" style={{ fontSize: '12px' }}>
              Commentaire (optionnel)
            </label>
            <textarea rows={2} className="settings-input w-full text-sm"
              placeholder="Ex : le 3e pack j'ai eu du mal sur les resets après save"
              maxLength={TODO_RESPONSE_MAX}
              value={packComment} onChange={e => setPackComment(e.target.value)} />
          </div>
        </div>
      )}

      {type === 'scouting' && (
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>{label[type]}</label>
          <textarea rows={5} className="settings-input w-full text-sm"
            placeholder="Style de jeu, forces/faiblesses, joueur clé, hypothèses de compo"
            maxLength={TODO_RESPONSE_MAX}
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      )}

      {type === 'mental_checkin' && (
        <div className="space-y-2">
          {prompts.map((p, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-sm flex-1" style={{ color: 'var(--s-text)' }}>{p}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => {
                  const active = ratings[i] === n;
                  return (
                    <button key={n} type="button"
                      onClick={() => setRatings(prev => prev.map((r, idx) => idx === i ? n : r))}
                      className="w-7 h-7 flex items-center justify-center text-xs font-bold transition-all"
                      style={{
                        background: active ? 'var(--s-gold)' : 'var(--s-elevated)',
                        border: `1px solid ${active ? 'var(--s-gold)' : 'var(--s-border)'}`,
                        color: active ? '#000' : 'var(--s-text-dim)',
                        cursor: 'pointer',
                      }}>
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={submit}
          className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs">
          <Check size={12} />
          <span>Valider & terminer</span>
        </button>
        <button type="button" onClick={onCancel}
          className="text-xs" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
