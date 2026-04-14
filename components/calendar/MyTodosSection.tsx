'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Check, Calendar as CalIcon, ChevronDown, ChevronRight, ClipboardList, Shield } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { compareTodosPending, compareTodosDone, isOverdue, type TodoRef } from '@/lib/todos';

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

  async function toggle(todo: MyTodo) {
    if (!firebaseUser || togglingId) return;
    setTogglingId(todo.id);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${todo.structureId}/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'toggle' }),
      });
      if (res.ok) {
        setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : null } : t));
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

        {/* À faire */}
        {pending.length > 0 && (
          <div className="space-y-2">
            {pending.map(t => (
              <TodoRow key={t.id} todo={t} today={today} onToggle={toggle} toggling={togglingId === t.id} />
            ))}
          </div>
        )}

        {/* Historique pliable */}
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
                  <TodoRow key={t.id} todo={t} today={today} onToggle={toggle} toggling={togglingId === t.id} />
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
  onToggle,
  toggling,
}: {
  todo: MyTodo;
  today: string;
  onToggle: (t: MyTodo) => void;
  toggling: boolean;
}) {
  const overdue = isOverdue(todo, today);
  const deadlineInfo = todo.deadline ? formatDeadline(todo.deadline, today) : null;

  return (
    <div className="bevel-sm flex items-start gap-3 p-3 transition-all duration-150"
      style={{
        background: todo.done ? 'transparent' : 'var(--s-elevated)',
        border: `1px solid ${overdue ? 'rgba(255,85,85,0.35)' : 'var(--s-border)'}`,
        opacity: todo.done ? 0.6 : 1,
      }}>
      {/* Checkbox */}
      <button type="button"
        onClick={() => onToggle(todo)}
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

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{
          color: 'var(--s-text)',
          textDecoration: todo.done ? 'line-through' : 'none',
        }}>
          {todo.title}
        </p>
        {todo.description && !todo.done && (
          <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
            {todo.description}
          </p>
        )}
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
      </div>
    </div>
  );
}
