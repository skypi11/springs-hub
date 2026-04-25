'use client';

import { useEffect, useState } from 'react';
import { X, Check, Loader2, Calendar as CalIcon, Shield, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import Portal from '@/components/ui/Portal';
import { TODO_TYPE_META, isOverdue, type TodoRef } from '@/lib/todos';
import { TodoConfigSummary, TodoResponseSummary } from './TeamTodosPanel';

// Formatte un ms epoch en string lisible Paris ("jeu. 15 janv. 2026 · 18:30").
function formatDeadlineFull(ms: number | null): string | null {
  if (ms === null) return null;
  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit', minute: '2-digit',
  });
  const d = new Date(ms);
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
}

// Relative "dans 2h", "il y a 3j", etc.
function formatRelative(ms: number | null, now: number): string | null {
  if (ms === null) return null;
  const delta = ms - now;
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let core: string;
  if (mins < 60) core = `${mins} min`;
  else if (hours < 48) core = `${hours} h`;
  else core = `${days} j`;
  return delta >= 0 ? `Dans ${core}` : `Il y a ${core}`;
}

export type DrawerTodo = TodoRef & {
  structureName?: string;
  structureTag?: string;
  teamName?: string;
  eventTitle?: string | null;
};

export default function TodoDetailDrawer({
  open,
  onClose,
  todo,
  toggling,
  onPrimaryAction,
  primaryActionLabel,
  responseForm,
  extraInfo,
}: {
  open: boolean;
  onClose: () => void;
  todo: DrawerTodo | null;
  toggling?: boolean;
  // Action principale (coché / rouvert / répondre) — le parent décide quoi faire selon le contexte.
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  // Form de réponse inline — rendu par le parent (évite de dupliquer la logique de ResponseForm).
  responseForm?: React.ReactNode;
  // Slot optionnel pour afficher le "créé par" ou autres infos contextuelles fournies par le parent.
  extraInfo?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !todo) return null;

  const meta = TODO_TYPE_META[todo.type];
  const now = Date.now();
  const overdue = !todo.done && isOverdue(todo, now);
  const deadlineFull = formatDeadlineFull(todo.deadlineAt);
  const deadlineRel = formatRelative(todo.deadlineAt, now);
  const doneFull = formatDeadlineFull(todo.doneAt);

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9500,
          display: 'flex',
          justifyContent: 'flex-end',
          background: visible ? 'rgba(4,4,8,0.72)' : 'rgba(4,4,8,0)',
          transition: 'background 0.25s ease',
        }}
        onClick={onClose}
      >
        <aside
          onClick={e => e.stopPropagation()}
          style={{
            width: 'min(640px, 94vw)',
            height: '100%',
            background: 'var(--s-surface)',
            borderLeft: '1px solid var(--s-border)',
            boxShadow: '-24px 0 64px rgba(0,0,0,0.55)',
            transform: visible ? 'translateX(0)' : 'translateX(24px)',
            opacity: visible ? 1 : 0,
            transition: 'transform 0.25s ease, opacity 0.25s ease',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Accent bar violet (système/navigation) */}
          <div className="h-[3px] flex-shrink-0" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold) 50%, transparent 70%)' }} />

          {/* Header : statut + titre + close */}
          <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {/* Indicateur statut (grand visuel) */}
              <div className="flex-shrink-0 flex items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  marginTop: 2,
                  background: todo.done ? 'var(--s-gold)' : overdue ? 'rgba(255,85,85,0.12)' : 'var(--s-elevated)',
                  border: `1px solid ${todo.done ? 'var(--s-gold)' : overdue ? 'rgba(255,85,85,0.35)' : 'var(--s-border)'}`,
                }}>
                {todo.done
                  ? <Check size={18} style={{ color: '#fff' }} strokeWidth={3} />
                  : overdue
                  ? <AlertTriangle size={16} style={{ color: '#ff5555' }} />
                  : <Clock size={16} style={{ color: 'var(--s-text-dim)' }} />}
              </div>
              <div className="min-w-0 flex-1">
                {todo.type !== 'free' && (
                  <div className="mb-1">
                    <span className="px-1.5 py-0.5 text-xs font-bold tracking-wider"
                      style={{
                        fontSize: '10px',
                        background: 'var(--s-surface)',
                        border: '1px solid var(--s-border)',
                        color: 'var(--s-text-dim)',
                      }}>
                      {meta.short.toUpperCase()}
                    </span>
                  </div>
                )}
                <h2 className="font-display text-2xl" style={{ letterSpacing: '0.03em', color: 'var(--s-text)', lineHeight: 1.15 }}>
                  {todo.title}
                </h2>
                <p className="text-xs mt-1.5" style={{ color: todo.done ? 'var(--s-gold)' : overdue ? '#ff9999' : 'var(--s-text-dim)' }}>
                  {todo.done
                    ? (doneFull ? `Terminé le ${doneFull}` : 'Terminé')
                    : overdue
                    ? 'En retard'
                    : 'À faire'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center transition-opacity duration-150 hover:opacity-100"
              aria-label="Fermer"
              style={{
                width: 36,
                height: 36,
                background: 'var(--s-elevated)',
                border: '1px solid var(--s-border)',
                color: 'var(--s-text-dim)',
                opacity: 0.85,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <X size={16} />
            </button>
          </header>

          {/* Contenu scrollable */}
          <div className="flex-1 overflow-y-auto" style={{ overflowX: 'hidden' }}>
            <div className="px-6 py-5 space-y-5">
              {/* Description */}
              {todo.description && (
                <section>
                  <h3 className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.1em' }}>
                    DESCRIPTION
                  </h3>
                  <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--s-text)', lineHeight: 1.55 }}>
                    {todo.description}
                  </p>
                </section>
              )}

              {/* Config type-specific */}
              {!todo.done && todo.type !== 'free' && (
                <section>
                  <h3 className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.1em' }}>
                    DÉTAILS
                  </h3>
                  <div className="p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <TodoConfigSummary todo={todo} />
                  </div>
                </section>
              )}

              {/* Réponse (si terminé) */}
              {todo.done && todo.response && (
                <section>
                  <h3 className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.1em' }}>
                    RÉPONSE
                  </h3>
                  <div className="p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <TodoResponseSummary todo={todo} />
                  </div>
                </section>
              )}

              {/* Métadonnées : Équipe / Event / Deadline */}
              <section>
                <h3 className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.1em' }}>
                  INFOS
                </h3>
                <div className="space-y-2">
                  {(todo.structureName || todo.structureTag || todo.teamName) && (
                    <Link href={`/community/structure/${todo.structureId}`}
                      className="flex items-center gap-2 p-2.5 group transition-colors bevel-sm"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <Shield size={14} style={{ color: 'var(--s-text-dim)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                          Équipe
                        </div>
                        <div className="text-sm font-semibold group-hover:text-white transition-colors" style={{ color: 'var(--s-text)' }}>
                          {todo.structureTag || todo.structureName}{todo.teamName ? ` · ${todo.teamName}` : ''}
                        </div>
                      </div>
                    </Link>
                  )}

                  {todo.eventTitle && todo.eventId && (
                    <div className="flex items-center gap-2 p-2.5 bevel-sm"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <CalIcon size={14} style={{ color: 'var(--s-text-dim)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                          À la suite de l&apos;événement
                        </div>
                        <div className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
                          {todo.eventTitle}
                        </div>
                      </div>
                    </div>
                  )}

                  {deadlineFull && (
                    <div className="flex items-center gap-2 p-2.5 bevel-sm"
                      style={{
                        background: 'var(--s-elevated)',
                        border: `1px solid ${overdue ? 'rgba(255,85,85,0.35)' : 'var(--s-border)'}`,
                      }}>
                      <Clock size={14} style={{ color: overdue ? '#ff5555' : 'var(--s-text-dim)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                          Deadline
                          {todo.deadlineMode === 'relative' && (
                            <span className="ml-1.5" style={{ color: 'var(--s-gold)' }}>
                              (relative à l&apos;event)
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-semibold" style={{ color: overdue ? '#ff9999' : 'var(--s-text)' }}>
                          {deadlineFull}
                        </div>
                        {deadlineRel && !todo.done && (
                          <div className="text-xs mt-0.5" style={{ color: overdue ? '#ff5555' : 'var(--s-text-dim)' }}>
                            {deadlineRel}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {extraInfo}
                </div>
              </section>

              {/* Formulaire de réponse inline — injecté par le parent */}
              {responseForm && (
                <section>
                  {responseForm}
                </section>
              )}
            </div>
          </div>

          {/* Footer : action principale */}
          {onPrimaryAction && (
            <footer className="flex items-center gap-2 px-6 py-4 flex-shrink-0"
              style={{ borderTop: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
              <button type="button" onClick={onPrimaryAction}
                disabled={!!toggling}
                className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-sm"
                style={{ cursor: toggling ? 'wait' : 'pointer' }}>
                {toggling
                  ? <Loader2 size={14} className="animate-spin" />
                  : todo.done
                  ? <CheckCircle2 size={14} />
                  : <Check size={14} />}
                <span>{primaryActionLabel || (todo.done ? 'Rouvrir le devoir' : 'Marquer comme terminé')}</span>
              </button>
              <button type="button" onClick={onClose}
                className="text-sm" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
                Fermer
              </button>
            </footer>
          )}
        </aside>
      </div>
    </Portal>
  );
}
