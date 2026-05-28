'use client';

import { X, Plus, Film } from 'lucide-react';
import {
  DEFAULT_MENTAL_PROMPTS,
  TRAINING_PACKS_MAX,
  FREEPLAY_MIN_MINUTES,
  FREEPLAY_MAX_MINUTES,
  LINEUPS_MIN_COUNT,
  LINEUPS_MAX_COUNT,
  WARMUP_MIN_MINUTES,
  WARMUP_MAX_MINUTES,
  WARMUP_MAX_STEPS,
  normalizeTrainingPacks,
  type TodoType,
  type TrainingPackItem,
} from '@/lib/todos';

// Replay simplifié pour le picker (cf. NewTodoForm fetch /api/structures/[id]/replays).
export interface ReplayPickerItem {
  id: string;
  title: string;
  sizeBytes?: number;
  createdAt?: string | null;
}

// Rend les champs de config spécifiques à un type de exercice dans un formulaire.
// Utilisé par NewTodoForm (création) et TemplateEditForm (édition de template).
//
// `availableReplays` : liste optionnelle de replays parmi lesquels choisir
// pour le type 'replay_review' (le picker s'affiche uniquement si fourni).
// Pour les templates qui n'ont pas de contexte event/équipe, on omet la
// prop et le picker n'apparaît pas.
export function TodoConfigFields({
  type,
  config,
  onChange,
  availableReplays,
}: {
  type: TodoType;
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  availableReplays?: ReplayPickerItem[];
}) {
  if (type === 'free') return null;

  if (type === 'replay_review') {
    const replays = availableReplays ?? [];
    // Lit replayIds (nouveau format) en priorité, fallback sur replayId mono.
    const selectedIds: string[] = Array.isArray(config.replayIds)
      ? (config.replayIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : (typeof config.replayId === 'string' && config.replayId
        ? [config.replayId]
        : []);
    const toggle = (id: string) => {
      const set = new Set(selectedIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      // On clear l'ancien replayId mono pour éviter qu'il traîne en parallèle.
      onChange({ replayIds: Array.from(set), replayId: null });
    };
    return (
      <div className="space-y-3">
        {availableReplays !== undefined && (
          <div>
            <label className="t-label block mb-1 flex items-center gap-1.5" style={{ fontSize: '12px' }}>
              <Film size={11} style={{ color: 'var(--s-gold)' }} />
              Replays à regarder {replays.length === 0 ? '(aucun disponible)' : `(${selectedIds.length} sélectionné${selectedIds.length > 1 ? 's' : ''})`}
            </label>
            {replays.length === 0 ? (
              <p className="text-xs px-2 py-1.5 bevel-sm"
                style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                Aucun replay sur l&apos;event courant. Upload un .replay d&apos;abord (section Replays
                de l&apos;event), puis reviens créer cet exercice.
              </p>
            ) : (
              <div className="space-y-1.5 bevel-sm p-2"
                style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                {replays.map(r => {
                  const checked = selectedIds.includes(r.id);
                  return (
                    <label key={r.id}
                      className="flex items-center gap-2 cursor-pointer text-sm py-1 px-1 transition-colors hover:bg-[var(--s-hover)]"
                      style={{ color: 'var(--s-text)' }}>
                      <input type="checkbox"
                        checked={checked}
                        onChange={() => toggle(r.id)}
                        className="flex-shrink-0"
                        style={{ accentColor: 'var(--s-gold)' }} />
                      <span className="truncate flex-1 min-w-0">{r.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Points à regarder</label>
          <textarea rows={2} className="settings-input w-full text-sm"
            placeholder="Ex: les 2 minutes après 3-1, notre rotation défensive"
            maxLength={500}
            value={String(config.replayNote ?? '')}
            onChange={e => onChange({ replayNote: e.target.value })} />
        </div>
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

  // Deprecated 2026-05-26, gardé pour édition d'anciens exos/templates uniquement.
  // Plus créable via le picker (TODO_TYPES n'inclut plus scouting).
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

  if (type === 'workshop_map') {
    return (
      <div className="space-y-2">
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Code Workshop / URL Steam *</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="2884906763 ou https://steamcommunity.com/sharedfiles/filedetails/?id=2884906763"
            maxLength={500}
            value={String(config.code ?? '')}
            onChange={e => onChange({ code: e.target.value })}
            style={{ fontFamily: 'var(--s-font-mono, monospace)' }} />
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Objectif</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Ex: 10 wall reads consécutifs sans rater"
            maxLength={500}
            value={String(config.objective ?? '')}
            onChange={e => onChange({ objective: e.target.value })} />
        </div>
      </div>
    );
  }

  if (type === 'free_play') {
    const duration = typeof config.durationMinutes === 'number'
      ? config.durationMinutes
      : (Number(config.durationMinutes) || 30);
    return (
      <div className="space-y-2">
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>
            Durée cible (minutes), {FREEPLAY_MIN_MINUTES} à {FREEPLAY_MAX_MINUTES}
          </label>
          <div className="flex items-center gap-2">
            <input type="number" min={FREEPLAY_MIN_MINUTES} max={FREEPLAY_MAX_MINUTES}
              className="settings-input text-sm"
              style={{ width: '90px' }}
              value={duration}
              onChange={e => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  onChange({ durationMinutes: Math.max(FREEPLAY_MIN_MINUTES, Math.min(FREEPLAY_MAX_MINUTES, Math.round(n))) });
                }
              }} />
            <div className="flex flex-wrap gap-1">
              {[10, 15, 20, 30, 45, 60].map(n => (
                <button key={n} type="button"
                  onClick={() => onChange({ durationMinutes: n })}
                  className="px-2 py-0.5 transition-all"
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    background: duration === n ? 'var(--s-elevated)' : 'var(--s-surface)',
                    border: `1px solid ${duration === n ? 'var(--s-gold)' : 'var(--s-border)'}`,
                    color: duration === n ? 'var(--s-gold)' : 'var(--s-text-dim)',
                    cursor: 'pointer',
                  }}>
                  {n} min
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Focus *</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Ex: wall dribbles + recoveries, ou aerials sans boost"
            maxLength={500}
            value={String(config.focus ?? '')}
            onChange={e => onChange({ focus: e.target.value })} />
        </div>
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

  // ── FPS / Valorant ──────────────────────────────────────────────────────
  if (type === 'aim_trainer') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Logiciel *</label>
            <input type="text" className="settings-input w-full text-sm"
              placeholder="Aimlabs / Kovaak's / Range Val"
              maxLength={60}
              value={String(config.software ?? '')}
              onChange={e => onChange({ software: e.target.value })} />
          </div>
          <div>
            <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Score cible</label>
            <input type="number" className="settings-input w-full text-sm"
              placeholder="ex: 32000"
              min={0}
              value={config.targetScore === undefined ? '' : String(config.targetScore)}
              onChange={e => {
                const v = e.target.value;
                if (v === '') onChange({ targetScore: undefined });
                else {
                  const n = Number(v);
                  if (Number.isFinite(n) && n >= 0) onChange({ targetScore: Math.round(n) });
                }
              }} />
          </div>
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Scénario *</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Ex: Gridshot Ultimate, Tile Frenzy, VT 1 Wall 6 Targets Small"
            maxLength={120}
            value={String(config.scenario ?? '')}
            onChange={e => onChange({ scenario: e.target.value })} />
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Focus</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Ex: tracking long range, click timing"
            maxLength={500}
            value={String(config.focus ?? '')}
            onChange={e => onChange({ focus: e.target.value })} />
        </div>
      </div>
    );
  }

  if (type === 'lineups') {
    const count = typeof config.count === 'number'
      ? config.count
      : (Number(config.count) || LINEUPS_MIN_COUNT);
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Agent *</label>
            <input type="text" className="settings-input w-full text-sm"
              placeholder="Sage, Brimstone, Cypher…"
              maxLength={60}
              value={String(config.agent ?? '')}
              onChange={e => onChange({ agent: e.target.value })} />
          </div>
          <div>
            <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Map *</label>
            <input type="text" className="settings-input w-full text-sm"
              placeholder="Ascent, Haven, Bind…"
              maxLength={60}
              value={String(config.map ?? '')}
              onChange={e => onChange({ map: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>
            Nombre de lineups à apprendre, {LINEUPS_MIN_COUNT} à {LINEUPS_MAX_COUNT}
          </label>
          <input type="number" min={LINEUPS_MIN_COUNT} max={LINEUPS_MAX_COUNT}
            className="settings-input text-sm" style={{ width: '90px' }}
            value={count}
            onChange={e => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                onChange({ count: Math.max(LINEUPS_MIN_COUNT, Math.min(LINEUPS_MAX_COUNT, Math.round(n))) });
              }
            }} />
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Notes / source</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Ex: lineups smokes A site depuis CT, YouTube ProGuides"
            maxLength={500}
            value={String(config.notes ?? '')}
            onChange={e => onChange({ notes: e.target.value })} />
        </div>
      </div>
    );
  }

  if (type === 'custom_game') {
    const duration = typeof config.durationMinutes === 'number'
      ? config.durationMinutes
      : (Number(config.durationMinutes) || 30);
    return (
      <div className="space-y-2">
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Mode *</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Ex: 1v1 aim duels, 5v5 scrim custom, Deathmatch focus"
            maxLength={120}
            value={String(config.mode ?? '')}
            onChange={e => onChange({ mode: e.target.value })} />
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>
            Durée (minutes), {FREEPLAY_MIN_MINUTES} à {FREEPLAY_MAX_MINUTES}
          </label>
          <input type="number" min={FREEPLAY_MIN_MINUTES} max={FREEPLAY_MAX_MINUTES}
            className="settings-input text-sm" style={{ width: '90px' }}
            value={duration}
            onChange={e => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                onChange({ durationMinutes: Math.max(FREEPLAY_MIN_MINUTES, Math.min(FREEPLAY_MAX_MINUTES, Math.round(n))) });
              }
            }} />
        </div>
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Focus</label>
          <input type="text" className="settings-input w-full text-sm"
            placeholder="Ex: peek timings, utility usage, comms"
            maxLength={500}
            value={String(config.focus ?? '')}
            onChange={e => onChange({ focus: e.target.value })} />
        </div>
      </div>
    );
  }

  if (type === 'warmup_routine') {
    const duration = typeof config.durationMinutes === 'number'
      ? config.durationMinutes
      : (Number(config.durationMinutes) || 15);
    const steps = Array.isArray(config.steps)
      ? (config.steps as unknown[]).map(s => typeof s === 'string' ? s : '')
      : [];
    function setStep(i: number, v: string) {
      const next = [...steps];
      next[i] = v;
      onChange({ steps: next });
    }
    function removeStep(i: number) {
      onChange({ steps: steps.filter((_, idx) => idx !== i) });
    }
    function addStep() {
      if (steps.length >= WARMUP_MAX_STEPS) return;
      onChange({ steps: [...steps, ''] });
    }
    return (
      <div className="space-y-2">
        <div>
          <label className="t-label block mb-1" style={{ fontSize: '12px' }}>
            Durée totale (minutes), {WARMUP_MIN_MINUTES} à {WARMUP_MAX_MINUTES}
          </label>
          <input type="number" min={WARMUP_MIN_MINUTES} max={WARMUP_MAX_MINUTES}
            className="settings-input text-sm" style={{ width: '90px' }}
            value={duration}
            onChange={e => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                onChange({ durationMinutes: Math.max(WARMUP_MIN_MINUTES, Math.min(WARMUP_MAX_MINUTES, Math.round(n))) });
              }
            }} />
        </div>
        <div>
          <label className="t-label block mb-1.5" style={{ fontSize: '12px' }}>
            Étapes (max {WARMUP_MAX_STEPS}) *
          </label>
          <div className="space-y-1.5">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="text" className="settings-input flex-1 text-sm"
                  placeholder="Ex: 200 kills DM, 50 wall reads, 5 min aim trainer"
                  maxLength={200}
                  value={s}
                  onChange={e => setStep(i, e.target.value)} />
                <button type="button" onClick={() => removeStep(i)}
                  className="p-1" style={{ color: '#ff5555', opacity: 0.5, cursor: 'pointer' }}
                  aria-label="Retirer">
                  <X size={12} />
                </button>
              </div>
            ))}
            {steps.length < WARMUP_MAX_STEPS && (
              <button type="button" onClick={addStep}
                className="text-xs" style={{ color: 'var(--s-gold)', cursor: 'pointer' }}>
                + Ajouter une étape
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
