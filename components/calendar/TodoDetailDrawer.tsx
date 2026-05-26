'use client';

import { useEffect, useState } from 'react';
import { X, Check, Loader2, Calendar as CalIcon, Shield, Clock, AlertTriangle, Pencil } from 'lucide-react';
import Link from 'next/link';
import Portal from '@/components/ui/Portal';
import {
  TODO_TYPE_META,
  isOverdue,
  getSteps,
  getStepProgress,
  normalizeTrainingPacks,
  type TodoRef,
  type ExerciseStep,
} from '@/lib/todos';
import { StepResponseForm } from './StepResponseForm';

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
  canEdit = false,
  toggleStepId,
  onToggleStep,
  onEditStepResponse,
  extraInfo,
}: {
  open: boolean;
  onClose: () => void;
  todo: DrawerTodo | null;
  /** Si true, l'utilisateur peut cocher les steps / saisir des réponses (= assignee ou staff). */
  canEdit?: boolean;
  /** stepId actuellement en cours d'API call (pour disable + spinner). */
  toggleStepId?: string | null;
  /**
   * Toggle un step (cocher/décocher). Pour les types needsResponse, response
   * est requis quand completed=true. Le drawer gère le form de réponse en interne.
   */
  onToggleStep?: (stepId: string, completed: boolean, response?: Record<string, unknown>) => Promise<void> | void;
  /** Édition d'une réponse déjà saisie (sans changer l'état completed). */
  onEditStepResponse?: (stepId: string, response: Record<string, unknown>) => Promise<void> | void;
  /** Slot optionnel pour afficher le "créé par" ou autres infos contextuelles fournies par le parent. */
  extraInfo?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  // stepId pour lequel on a ouvert le form de réponse (validation OU édition).
  const [openFormStepId, setOpenFormStepId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'validate' | 'edit'>('validate');

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    }
    setVisible(false);
    setOpenFormStepId(null);
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

  const steps = getSteps(todo);
  const progress = getStepProgress(todo);
  const isMultiStep = steps.length > 1;
  const now = Date.now();
  const overdue = !todo.done && isOverdue(todo, now);
  const deadlineFull = formatDeadlineFull(todo.deadlineAt);
  const deadlineRel = formatRelative(todo.deadlineAt, now);
  const doneFull = formatDeadlineFull(todo.doneAt);

  // Endpoint d'upload screenshot — disponible uniquement si l'utilisateur peut éditer
  // ET qu'on a structureId+todoId pour construire l'URL.
  const screenshotUploadUrl = canEdit && todo.structureId && todo.id
    ? `/api/structures/${todo.structureId}/todos/${todo.id}/screenshot`
    : undefined;

  async function handleStepToggle(step: ExerciseStep, response?: Record<string, unknown>) {
    if (!onToggleStep) return;
    const willBeCompleted = !step.completed;
    await onToggleStep(step.id, willBeCompleted, response);
    setOpenFormStepId(null);
  }

  async function handleEditResponse(step: ExerciseStep, response: Record<string, unknown>) {
    if (!onEditStepResponse) return;
    await onEditStepResponse(step.id, response);
    setOpenFormStepId(null);
  }

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
            width: 'min(680px, 94vw)',
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
          <div className="h-[3px] flex-shrink-0" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold) 50%, transparent 70%)' }} />

          {/* Header : statut + titre + close */}
          <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="flex items-start gap-3 min-w-0 flex-1">
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
                <h2 className="font-display text-2xl" style={{ letterSpacing: '0.03em', color: 'var(--s-text)', lineHeight: 1.15 }}>
                  {todo.title}
                </h2>
                <p className="text-xs mt-1.5 flex items-center gap-2 flex-wrap" style={{ color: todo.done ? 'var(--s-gold)' : overdue ? '#ff9999' : 'var(--s-text-dim)' }}>
                  <span>
                    {todo.done
                      ? (doneFull ? `Terminé le ${doneFull}` : 'Terminé')
                      : overdue
                      ? 'En retard'
                      : 'À faire'}
                  </span>
                  {isMultiStep && (
                    <>
                      <span style={{ color: 'var(--s-text-muted)' }}>·</span>
                      <span style={{ color: 'var(--s-text-dim)' }}>
                        {progress.done}/{progress.total} étape{progress.total > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center transition-opacity duration-150 hover:opacity-100"
              aria-label="Fermer"
              style={{
                width: 36, height: 36,
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

              {/* CHECKLIST DE STEPS — cœur de la v3 multi-step */}
              <section>
                <h3 className="text-xs font-bold tracking-wider mb-3" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.1em' }}>
                  {isMultiStep ? `ÉTAPES (${progress.done}/${progress.total})` : 'À FAIRE'}
                </h3>
                <div className="space-y-2.5">
                  {steps.map((step, idx) => (
                    <StepCard
                      key={step.id}
                      step={step}
                      index={idx}
                      isMultiStep={isMultiStep}
                      canEdit={canEdit}
                      isToggling={toggleStepId === step.id}
                      openForm={openFormStepId === step.id}
                      openFormMode={formMode}
                      screenshotUploadUrl={screenshotUploadUrl}
                      onOpenValidate={() => { setOpenFormStepId(step.id); setFormMode('validate'); }}
                      onOpenEdit={() => { setOpenFormStepId(step.id); setFormMode('edit'); }}
                      onCancelForm={() => setOpenFormStepId(null)}
                      onSubmitValidate={(resp) => handleStepToggle(step, resp)}
                      onSubmitEdit={(resp) => handleEditResponse(step, resp)}
                      onUncheck={() => handleStepToggle(step)}
                    />
                  ))}
                </div>
              </section>

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
            </div>
          </div>

          {/* Footer minimaliste : juste fermer (les actions sont sur chaque step) */}
          <footer className="flex items-center justify-end gap-2 px-6 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
            <button type="button" onClick={onClose}
              className="text-sm" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
              Fermer
            </button>
          </footer>
        </aside>
      </div>
    </Portal>
  );
}

// ─── Carte d'un step ────────────────────────────────────────────────────────

function StepCard({
  step,
  index,
  isMultiStep,
  canEdit,
  isToggling,
  openForm,
  openFormMode,
  screenshotUploadUrl,
  onOpenValidate,
  onOpenEdit,
  onCancelForm,
  onSubmitValidate,
  onSubmitEdit,
  onUncheck,
}: {
  step: ExerciseStep;
  index: number;
  isMultiStep: boolean;
  canEdit: boolean;
  isToggling: boolean;
  openForm: boolean;
  openFormMode: 'validate' | 'edit';
  screenshotUploadUrl?: string;
  onOpenValidate: () => void;
  onOpenEdit: () => void;
  onCancelForm: () => void;
  onSubmitValidate: (response?: Record<string, unknown>) => void;
  onSubmitEdit: (response: Record<string, unknown>) => void;
  onUncheck: () => void;
}) {
  const meta = TODO_TYPE_META[step.type];
  const needsResp = meta.needsResponse;
  const completed = step.completed === true;
  const stepTitle = step.label?.trim() || meta.label;

  return (
    <div
      className="bevel-sm"
      style={{
        background: completed ? 'rgba(255,184,0,0.06)' : 'var(--s-elevated)',
        border: `1px solid ${completed ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
      }}
    >
      {/* Header : checkbox + numéro/label + tag type + bouton action */}
      <div className="flex items-start gap-3 p-3">
        {/* Checkbox cliquable si pas needsResp (type free/watch_party) ou déjà complété */}
        <button
          type="button"
          onClick={() => {
            if (!canEdit || isToggling) return;
            if (completed) {
              onUncheck();
            } else if (needsResp) {
              onOpenValidate();
            } else {
              onSubmitValidate(undefined); // free/watch_party : pas de réponse à valider
            }
          }}
          disabled={!canEdit || isToggling}
          className="flex-shrink-0 flex items-center justify-center transition-all duration-150"
          style={{
            width: 22, height: 22, marginTop: 1,
            background: completed ? 'var(--s-gold)' : 'transparent',
            border: `1.5px solid ${completed ? 'var(--s-gold)' : 'var(--s-text-muted)'}`,
            cursor: canEdit && !isToggling ? 'pointer' : 'not-allowed',
            opacity: canEdit ? 1 : 0.5,
          }}
          aria-label={completed ? 'Décocher cette étape' : 'Cocher cette étape'}
        >
          {isToggling
            ? <Loader2 size={12} className="animate-spin" style={{ color: completed ? '#000' : 'var(--s-text-dim)' }} />
            : completed
            ? <Check size={13} style={{ color: '#000' }} strokeWidth={3} />
            : null}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            {isMultiStep && (
              <span className="text-xs font-bold" style={{ color: 'var(--s-text-muted)' }}>
                Étape {index + 1}
              </span>
            )}
            <span className="px-1.5 py-0.5" style={{
              fontSize: '11px',
              fontWeight: 700,
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              color: 'var(--s-text-dim)',
            }}>
              {meta.short.toUpperCase()}
            </span>
          </div>
          <p className="text-sm font-semibold" style={{ color: completed ? 'var(--s-text-dim)' : 'var(--s-text)', textDecoration: completed ? 'line-through' : 'none' }}>
            {stepTitle}
          </p>

          {/* Détails de la config (si pas free et qu'il y a quelque chose à afficher) */}
          {step.type !== 'free' && (
            <StepConfigPreview step={step} />
          )}
        </div>

        {/* Bouton "Modifier la réponse" pour les steps déjà cochés needsResp */}
        {canEdit && completed && needsResp && !openForm && (
          <button
            type="button"
            onClick={onOpenEdit}
            className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1 transition-colors"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              background: 'transparent',
              border: '1px solid var(--s-border)',
              color: 'var(--s-text-dim)',
              cursor: 'pointer',
            }}
            title="Modifier ma réponse"
          >
            <Pencil size={10} />
            Modifier
          </button>
        )}
      </div>

      {/* Réponse déjà saisie (visible quand validé sans form ouvert) */}
      {completed && step.response && !openForm && (
        <div className="mx-3 mb-3 p-2.5 space-y-2" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <StepResponseSummary step={step} />
          {/* Capture d'écran si présente — thumbnail cliquable qui ouvre en grand */}
          {(() => {
            const attUrl = typeof (step.response as Record<string, unknown>)?.attachmentUrl === 'string'
              ? (step.response as { attachmentUrl: string }).attachmentUrl : '';
            if (!attUrl) return null;
            return (
              <a href={attUrl} target="_blank" rel="noopener noreferrer"
                className="block relative bevel-sm overflow-hidden"
                style={{ width: '160px', height: '100px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
                title="Cliquer pour voir en grand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attUrl} alt="Capture d'écran" className="absolute inset-0 w-full h-full object-cover" />
              </a>
            );
          })()}
        </div>
      )}

      {/* Form de réponse inline — pour validation ou édition */}
      {openForm && canEdit && needsResp && (
        <div className="px-3 pb-3">
          <StepResponseForm
            type={step.type}
            config={step.config}
            initialResponse={openFormMode === 'edit' ? step.response : null}
            uploadUrl={screenshotUploadUrl}
            stepId={step.id}
            onCancel={onCancelForm}
            onSubmit={openFormMode === 'edit' ? onSubmitEdit : (resp) => onSubmitValidate(resp)}
            submitLabel={openFormMode === 'edit' ? 'Sauvegarder' : 'Valider cette étape'}
          />
        </div>
      )}
    </div>
  );
}

// ─── Aperçu compact de la config d'un step ──────────────────────────────────

function StepConfigPreview({ step }: { step: ExerciseStep }) {
  const c = step.config;
  const rows: { label: string; value: string; mono?: boolean }[] = [];
  switch (step.type) {
    case 'replay_review':
      if (typeof c.replayNote === 'string' && c.replayNote) rows.push({ label: 'À regarder', value: c.replayNote });
      break;
    case 'training_pack': {
      const packs = normalizeTrainingPacks(c).filter(p => p.code);
      if (packs.length === 1) {
        rows.push({ label: 'Code', value: packs[0].code, mono: true });
        if (packs[0].objective) rows.push({ label: 'Objectif', value: packs[0].objective });
      } else if (packs.length > 1) {
        rows.push({ label: `Packs (${packs.length})`, value: packs.map(p => p.code).join(', '), mono: true });
      }
      break;
    }
    case 'vod_review':
      if (typeof c.url === 'string' && c.url) rows.push({ label: 'VOD', value: c.url, mono: true });
      if (typeof c.focus === 'string' && c.focus) rows.push({ label: 'Focus', value: c.focus });
      break;
    case 'scouting':
      if (typeof c.opponent === 'string' && c.opponent) rows.push({ label: 'Adversaire', value: c.opponent });
      break;
    case 'watch_party':
      if (typeof c.location === 'string' && c.location) rows.push({ label: 'Lieu', value: c.location });
      break;
    case 'mental_checkin': {
      const prompts = Array.isArray(c.prompts) ? (c.prompts as unknown[]).filter(p => typeof p === 'string') : [];
      if (prompts.length > 0) rows.push({ label: 'À évaluer', value: prompts.join(' · ') });
      break;
    }
    case 'workshop_map':
      if (typeof c.code === 'string' && c.code) rows.push({ label: 'Map', value: c.code, mono: true });
      if (typeof c.objective === 'string' && c.objective) rows.push({ label: 'Objectif', value: c.objective });
      break;
    case 'free_play':
      if (typeof c.durationMinutes === 'number') rows.push({ label: 'Durée', value: `${c.durationMinutes} min` });
      if (typeof c.focus === 'string' && c.focus) rows.push({ label: 'Focus', value: c.focus });
      break;
  }
  if (rows.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {rows.map((r, i) => (
        <div key={i} className="text-xs flex flex-wrap gap-1.5" style={{ color: 'var(--s-text-muted)' }}>
          <span style={{ color: 'var(--s-text-dim)', fontWeight: 600 }}>{r.label} :</span>
          <span style={{ color: 'var(--s-text)', fontFamily: r.mono ? 'monospace' : undefined, wordBreak: 'break-word' }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Résumé compact de la réponse d'un step ────────────────────────────────

function StepResponseSummary({ step }: { step: ExerciseStep }) {
  const r = step.response ?? {};
  switch (step.type) {
    case 'replay_review':
    case 'vod_review': {
      const analysis = typeof (r as { analysis?: unknown }).analysis === 'string'
        ? (r as { analysis: string }).analysis : '';
      return <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--s-text)' }}>{analysis || '(vide)'}</p>;
    }
    case 'scouting': {
      const notes = typeof (r as { notes?: unknown }).notes === 'string'
        ? (r as { notes: string }).notes : '';
      return <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--s-text)' }}>{notes || '(vide)'}</p>;
    }
    case 'training_pack': {
      const results = Array.isArray((r as { results?: unknown }).results) ? (r as { results: unknown[] }).results : [];
      const comment = typeof (r as { comment?: unknown }).comment === 'string' ? (r as { comment: string }).comment : '';
      const done = results.filter(x => x && typeof x === 'object' && (x as { done?: boolean }).done === true).length;
      return (
        <div className="text-xs space-y-0.5" style={{ color: 'var(--s-text)' }}>
          <div>{done}/{results.length} pack{results.length > 1 ? 's' : ''} réussi{done > 1 ? 's' : ''}</div>
          {comment && <div className="whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>{comment}</div>}
        </div>
      );
    }
    case 'mental_checkin': {
      const ratings = Array.isArray((r as { ratings?: unknown }).ratings) ? (r as { ratings: unknown[] }).ratings : [];
      const prompts = Array.isArray(step.config.prompts) ? (step.config.prompts as unknown[]).filter(p => typeof p === 'string') as string[] : [];
      return (
        <div className="text-xs flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: 'var(--s-text)' }}>
          {ratings.map((n, i) => (
            <span key={i}>
              <span style={{ color: 'var(--s-text-dim)' }}>{prompts[i] ?? `#${i + 1}`}: </span>
              <span style={{ color: 'var(--s-gold)', fontWeight: 700 }}>{String(n)}/5</span>
            </span>
          ))}
        </div>
      );
    }
    case 'workshop_map': {
      const result = typeof (r as { result?: unknown }).result === 'string'
        ? (r as { result: string }).result : '';
      return <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--s-text)' }}>{result || '(vide)'}</p>;
    }
    case 'free_play': {
      const notes = typeof (r as { notes?: unknown }).notes === 'string' ? (r as { notes: string }).notes : '';
      const actual = typeof (r as { actualMinutes?: unknown }).actualMinutes === 'number'
        ? (r as { actualMinutes: number }).actualMinutes : null;
      return (
        <div className="text-xs space-y-0.5" style={{ color: 'var(--s-text)' }}>
          {actual !== null && <div><span style={{ color: 'var(--s-text-dim)' }}>Temps réel : </span><span style={{ color: 'var(--s-gold)', fontWeight: 700 }}>{actual} min</span></div>}
          {notes && <div className="whitespace-pre-wrap">{notes}</div>}
        </div>
      );
    }
    default:
      return null;
  }
}
