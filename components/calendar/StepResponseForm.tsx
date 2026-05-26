'use client';

// Formulaire de réponse d'un step (ou d'un exo legacy single-type).
//
// Centralise les champs spécifiques à chaque TodoType (textarea analysis,
// checkboxes training pack, sliders mental_checkin, etc.) + validation via
// validateTodoResponse de lib/todos.
//
// Utilisé par :
//   - TodoDetailDrawer (un form par step dans la checklist v3)
//   - MyTodosSection (mode legacy single-step pour les vieux exos)

import { useRef, useState } from 'react';
import Image from 'next/image';
import { X, Check, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import {
  TODO_RESPONSE_MAX,
  normalizeTrainingPacks,
  validateTodoResponse,
  type TodoType,
} from '@/lib/todos';

export function StepResponseForm({
  type,
  config,
  initialResponse,
  onCancel,
  onSubmit,
  submitLabel = 'Valider & terminer',
  // v3 — props pour permettre l'upload de capture d'écran (optionnel).
  // Si non fourni, le bloc upload n'apparaît pas.
  uploadUrl,
  stepId,
}: {
  type: TodoType;
  config: Record<string, unknown>;
  /** Réponse pré-existante (édition d'une réponse déjà saisie). */
  initialResponse?: Record<string, unknown> | null;
  onCancel: () => void;
  onSubmit: (response: Record<string, unknown>) => void;
  submitLabel?: string;
  /** URL de l'endpoint d'upload screenshot (ex: `/api/structures/[id]/todos/[id]/screenshot`). */
  uploadUrl?: string;
  /** Identifiant du step (envoyé au serveur pour cibler la clé de stockage). */
  stepId?: string;
}) {
  const toast = useToast();

  // Init analysis/notes depuis initialResponse si fourni — permet l'édition.
  const init = (initialResponse ?? {}) as Record<string, unknown>;
  const [analysis, setAnalysis] = useState<string>(
    typeof init.analysis === 'string' ? init.analysis : '',
  );
  const [notes, setNotes] = useState<string>(
    typeof init.notes === 'string' ? init.notes : '',
  );
  // v3 — nouveaux types
  const [workshopResult, setWorkshopResult] = useState<string>(
    typeof init.result === 'string' ? init.result : '',
  );
  const [freeplayActualMinutes, setFreeplayActualMinutes] = useState<string>(
    typeof init.actualMinutes === 'number' ? String(init.actualMinutes) : '',
  );
  // Capture d'écran (optionnelle, partagée par tous les types).
  // Init depuis initialResponse.attachmentUrl si édition.
  const [attachmentUrl, setAttachmentUrl] = useState<string>(
    typeof init.attachmentUrl === 'string' ? init.attachmentUrl : '',
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileUpload(file: File) {
    if (!uploadUrl || !stepId) {
      toast.error('Upload indisponible.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image trop lourde (max 5 MB).');
      return;
    }
    if (file.type && !file.type.startsWith('image/')) {
      toast.error('Format non supporté — utilise une image.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('stepId', stepId);
      const res = await fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur upload');
      setAttachmentUrl(data.attachmentUrl as string);
      toast.success('Capture ajoutée');
    } catch (err) {
      toast.error((err as Error).message || 'Erreur upload');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const promptsRaw = Array.isArray(config.prompts) ? config.prompts as unknown[] : [];
  const prompts: string[] = promptsRaw
    .map(p => typeof p === 'string' ? p : '')
    .filter(p => p.length > 0);
  const [ratings, setRatings] = useState<number[]>(() => {
    const initRatings = Array.isArray(init.ratings) ? init.ratings as unknown[] : [];
    return prompts.map((_, i) => {
      const v = initRatings[i];
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : 3;
    });
  });

  // Training pack : 1 case à cocher par pack + commentaire global.
  const packs = normalizeTrainingPacks(config).filter(p => p.code);
  const [packResults, setPackResults] = useState<boolean[]>(() => {
    const initResults = Array.isArray(init.results) ? init.results as unknown[] : [];
    return packs.map((_, i) => {
      const r = initResults[i];
      return !!(r && typeof r === 'object' && (r as Record<string, unknown>).done === true);
    });
  });
  const [packComment, setPackComment] = useState<string>(
    typeof init.comment === 'string' ? init.comment : '',
  );

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
      case 'workshop_map':
        return { result: workshopResult };
      case 'free_play': {
        const payload: Record<string, unknown> = { notes };
        const m = Number(freeplayActualMinutes);
        if (Number.isFinite(m) && m > 0) payload.actualMinutes = Math.round(m);
        return payload;
      }
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
    // v3 : attache l'attachmentUrl si présent (passe-plat, pas validé côté serveur).
    const finalPayload: Record<string, unknown> = attachmentUrl
      ? { ...check.value, attachmentUrl }
      : check.value;
    onSubmit(finalPayload);
  }

  const fieldLabel: Record<TodoType, string> = {
    free: '',
    watch_party: '',
    replay_review: 'Ton analyse *',
    vod_review: 'Ton analyse *',
    training_pack: 'Ton résultat *',
    scouting: 'Tes notes *',
    mental_checkin: '',
    workshop_map: 'Ton résultat *',
    free_play: 'Ce que tu as travaillé *',
  };

  return (
    <div className="mt-3 p-3 space-y-3" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-center justify-between">
        <span className="t-label" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
          {initialResponse ? 'MODIFIER LA RÉPONSE' : 'VALIDER CETTE ÉTAPE'}
        </span>
        <button type="button" onClick={onCancel}
          className="p-0.5" style={{ color: 'var(--s-text-muted)', cursor: 'pointer' }}
          aria-label="Annuler">
          <X size={12} />
        </button>
      </div>

      {(type === 'replay_review' || type === 'vod_review') && (
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>{fieldLabel[type]}</label>
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
                      <div className="text-xs truncate" style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}>
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
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>{fieldLabel[type]}</label>
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

      {type === 'workshop_map' && (
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>{fieldLabel[type]}</label>
          <textarea rows={3} className="settings-input w-full text-sm"
            placeholder="Ex: 9/10 wall reads consécutifs réussis, j'ai galéré sur les double resets"
            maxLength={TODO_RESPONSE_MAX}
            value={workshopResult} onChange={e => setWorkshopResult(e.target.value)} />
        </div>
      )}

      {type === 'free_play' && (
        <div className="space-y-2">
          <div>
            <label className="t-label block mb-1" style={{ fontSize: '12px' }}>{fieldLabel[type]}</label>
            <textarea rows={3} className="settings-input w-full text-sm"
              placeholder="Ce que tu as travaillé concrètement, ce qui a marché ou pas"
              maxLength={TODO_RESPONSE_MAX}
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div>
            <label className="t-label block mb-1" style={{ fontSize: '12px' }}>
              Temps réel passé (min, optionnel)
            </label>
            <input type="number" min={1} max={600}
              className="settings-input text-sm"
              style={{ width: '90px' }}
              placeholder="30"
              value={freeplayActualMinutes}
              onChange={e => setFreeplayActualMinutes(e.target.value)} />
          </div>
        </div>
      )}

      {/* Capture d'écran — visible uniquement si l'upload est branché (uploadUrl + stepId) */}
      {uploadUrl && stepId && (
        <div>
          <label className="t-label block mb-1.5" style={{ fontSize: '12px' }}>
            Capture d&apos;écran (optionnel)
          </label>
          {attachmentUrl ? (
            <div className="flex items-start gap-2">
              <a href={attachmentUrl} target="_blank" rel="noopener noreferrer"
                className="block relative bevel-sm overflow-hidden flex-shrink-0"
                style={{
                  width: '120px', height: '80px',
                  background: 'var(--s-elevated)',
                  border: '1px solid var(--s-border)',
                }}
                title="Cliquer pour ouvrir en grand">
                <Image src={attachmentUrl} alt="Capture d'écran" fill className="object-cover" unoptimized />
              </a>
              <button type="button" onClick={() => setAttachmentUrl('')}
                disabled={uploading}
                className="flex items-center gap-1 px-2 py-1 transition-colors"
                style={{
                  fontSize: '11px', fontWeight: 700,
                  background: 'transparent',
                  border: '1px solid rgba(255,85,85,0.35)',
                  color: '#ff8a8a',
                  cursor: uploading ? 'wait' : 'pointer',
                }}>
                <Trash2 size={11} /> Retirer
              </button>
            </div>
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
                style={{ display: 'none' }}
              />
              <button type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-3 py-2 bevel-sm transition-colors"
                style={{
                  fontSize: '12px', fontWeight: 600,
                  background: 'var(--s-surface)',
                  border: '1px dashed var(--s-border)',
                  color: 'var(--s-text-dim)',
                  cursor: uploading ? 'wait' : 'pointer',
                }}>
                {uploading
                  ? <Loader2 size={13} className="animate-spin" />
                  : <ImageIcon size={13} />}
                <span>{uploading ? 'Upload en cours…' : 'Ajouter une capture'}</span>
              </button>
              <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                Preuve visuelle (score training pack, temps workshop…). Max 5 MB, compressée automatiquement.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={submit}
          disabled={uploading}
          className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
          style={{ opacity: uploading ? 0.5 : 1 }}>
          <Check size={12} />
          <span>{submitLabel}</span>
        </button>
        <button type="button" onClick={onCancel}
          className="text-xs" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
