'use client';

import { X } from 'lucide-react';
import {
  DEFAULT_MENTAL_PROMPTS,
  type TodoType,
} from '@/lib/todos';

// Rend les champs de config spécifiques à un type de devoir dans un formulaire.
// Utilisé par NewTodoForm (création) et TemplateEditForm (édition de template).
export function TodoConfigFields({
  type,
  config,
  onChange,
}: {
  type: TodoType;
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  if (type === 'free') return null;

  if (type === 'replay_review') {
    return (
      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Points à regarder</label>
        <textarea rows={2} className="settings-input w-full text-sm"
          placeholder="Ex: les 2 minutes après 3-1, notre rotation défensive"
          maxLength={500}
          value={String(config.replayNote ?? '')}
          onChange={e => onChange({ replayNote: e.target.value })} />
        <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
          Le picker replay (bibliothèque équipe) arrive dans la prochaine étape.
        </p>
      </div>
    );
  }

  if (type === 'training_pack') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Code du pack *</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="A503-264B-9D4C-E4F7"
            maxLength={50}
            value={String(config.packCode ?? '')}
            onChange={e => onChange({ packCode: e.target.value })} />
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Objectif</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="80% sans rater de reset"
            maxLength={500}
            value={String(config.objective ?? '')}
            onChange={e => onChange({ objective: e.target.value })} />
        </div>
      </div>
    );
  }

  if (type === 'vod_review') {
    return (
      <div className="space-y-2">
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Lien VOD *</label>
          <input type="url" className="settings-input w-full text-sm"
            placeholder="https://www.youtube.com/watch?v=..."
            maxLength={500}
            value={String(config.url ?? '')}
            onChange={e => onChange({ url: e.target.value })} />
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Focus</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Rotations, positionnement sur corner..."
            maxLength={500}
            value={String(config.focus ?? '')}
            onChange={e => onChange({ focus: e.target.value })} />
        </div>
      </div>
    );
  }

  if (type === 'scouting') {
    return (
      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Adversaire *</label>
        <input type="text" className="settings-input w-full text-sm"
          placeholder="Team Nova"
          maxLength={120}
          value={String(config.opponent ?? '')}
          onChange={e => onChange({ opponent: e.target.value })} />
      </div>
    );
  }

  if (type === 'watch_party') {
    return (
      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Lieu / salle</label>
        <input type="text" className="settings-input w-full text-sm"
          placeholder="Discord #watch-room"
          maxLength={200}
          value={String(config.location ?? '')}
          onChange={e => onChange({ location: e.target.value })} />
        <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
          La liaison event calendrier arrive dans la prochaine étape.
        </p>
      </div>
    );
  }

  if (type === 'mental_checkin') {
    const prompts = Array.isArray(config.prompts)
      ? (config.prompts as unknown[]).map(p => (typeof p === 'string' ? p : ''))
      : DEFAULT_MENTAL_PROMPTS;
    function setPrompt(i: number, v: string) {
      const next = [...prompts];
      next[i] = v;
      onChange({ prompts: next });
    }
    function removePrompt(i: number) {
      onChange({ prompts: prompts.filter((_, idx) => idx !== i) });
    }
    function addPrompt() {
      if (prompts.length >= 6) return;
      onChange({ prompts: [...prompts, ''] });
    }
    return (
      <div>
        <label className="t-label block mb-1.5" style={{ fontSize: '12px' }}>
          Items à auto-évaluer (/5 chacun, max 6)
        </label>
        <div className="space-y-1.5">
          {prompts.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="text" className="settings-input flex-1 text-sm"
                placeholder={DEFAULT_MENTAL_PROMPTS[i] ?? 'Item à évaluer'}
                maxLength={60}
                value={p}
                onChange={e => setPrompt(i, e.target.value)} />
              <button type="button" onClick={() => removePrompt(i)}
                className="p-1 transition-opacity"
                style={{ color: '#ff5555', opacity: 0.5, cursor: 'pointer' }}
                aria-label="Retirer">
                <X size={12} />
              </button>
            </div>
          ))}
          {prompts.length < 6 && (
            <button type="button" onClick={addPrompt}
              className="text-xs" style={{ color: 'var(--s-violet-light)', cursor: 'pointer' }}>
              + Ajouter un item
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
