'use client';

import { X, Plus } from 'lucide-react';
import {
  DEFAULT_MENTAL_PROMPTS,
  TRAINING_PACKS_MAX,
  normalizeTrainingPacks,
  type TodoType,
  type TrainingPackItem,
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
    const packs = normalizeTrainingPacks(config);
    function setPacks(next: TrainingPackItem[]) {
      onChange({ packs: next });
    }
    function updatePack(i: number, patch: Partial<TrainingPackItem>) {
      setPacks(packs.map((p, idx) => idx === i ? { ...p, ...patch } : p));
    }
    function addPack() {
      if (packs.length >= TRAINING_PACKS_MAX) return;
      setPacks([...packs, { code: '', objective: '' }]);
    }
    function removePack(i: number) {
      if (packs.length <= 1) return; // toujours au moins 1 ligne affichée
      setPacks(packs.filter((_, idx) => idx !== i));
    }
    return (
      <div>
        <label className="t-label block mb-1.5" style={{ fontSize: '12px' }}>
          Training packs (1 code requis, {TRAINING_PACKS_MAX} max)
        </label>
        <div className="space-y-1.5">
          {packs.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="text" className="settings-input text-sm"
                style={{ width: '200px', fontFamily: 'var(--s-font-mono, monospace)' }}
                placeholder="A503-264B-9D4C-E4F7"
                maxLength={50}
                value={p.code}
                onChange={e => updatePack(i, { code: e.target.value })} />
              <input type="text" className="settings-input flex-1 text-sm"
                placeholder="Objectif (ex: 80% sans rater un reset)"
                maxLength={500}
                value={p.objective}
                onChange={e => updatePack(i, { objective: e.target.value })} />
              <button type="button" onClick={() => removePack(i)}
                disabled={packs.length <= 1}
                className="p-1 transition-opacity"
                style={{
                  color: '#ff5555',
                  opacity: packs.length <= 1 ? 0.2 : 0.5,
                  cursor: packs.length <= 1 ? 'not-allowed' : 'pointer',
                }}
                aria-label="Retirer ce pack">
                <X size={12} />
              </button>
            </div>
          ))}
          {packs.length < TRAINING_PACKS_MAX && (
            <button type="button" onClick={addPack}
              className="text-xs flex items-center gap-1"
              style={{ color: 'var(--s-gold)', cursor: 'pointer' }}>
              <Plus size={11} /> Ajouter un pack
            </button>
          )}
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
              className="text-xs" style={{ color: 'var(--s-gold)', cursor: 'pointer' }}>
              + Ajouter un item
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
