'use client';

// Formulaire de création/édition d'un circuit (Lot 0 Legends Cup).
// Le barème est saisi place par place (grille compacte), le préréglage Legends
// remplit tout d'un clic. Validation partagée avec le serveur
// (lib/competitions/validate.ts — mêmes messages des deux côtés).

import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { validateCircuitPayload } from '@/lib/competitions/validate';
import { LEGENDS_POINTS_SCALE, LEGENDS_CIRCUIT, LEGENDS_TIE_BREAKERS } from '@/lib/competitions/defaults';
import type { AdminCircuit } from './types';

const TIE_BREAKER_LABELS: Record<string, string> = {
  best_placement: 'Meilleur placement du circuit',
  goal_diff_total: 'Délta de buts cumulé',
  latest_event: 'Résultat du Qualif le plus récent',
};

export default function CircuitForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: AdminCircuit | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initial?.name ?? '');
  const [bestResultsCount, setBestResultsCount] = useState(initial?.bestResultsCount ?? LEGENDS_CIRCUIT.bestResultsCount);
  const [lanTeamCount, setLanTeamCount] = useState(initial?.lanTeamCount ?? LEGENDS_CIRCUIT.lanTeamCount);
  const [scale, setScale] = useState<Record<string, number>>(
    initial && Object.keys(initial.pointsScale).length > 0 ? initial.pointsScale : { ...LEGENDS_POINTS_SCALE },
  );

  const places = Object.keys(scale).length;

  function setPlaces(n: number) {
    const clamped = Math.max(2, Math.min(64, n));
    setScale(prev => {
      const next: Record<string, number> = {};
      for (let p = 1; p <= clamped; p++) {
        next[String(p)] = prev[String(p)] ?? 0;
      }
      return next;
    });
  }

  function applyLegendsPreset() {
    setScale({ ...LEGENDS_POINTS_SCALE });
    setBestResultsCount(LEGENDS_CIRCUIT.bestResultsCount);
    setLanTeamCount(LEGENDS_CIRCUIT.lanTeamCount);
    toast.success('Préréglage Legends appliqué.');
  }

  async function save() {
    const payload = {
      name,
      game: 'rocket_league',
      pointsScale: scale,
      bestResultsCount,
      lanTeamCount,
      tieBreakers: [...LEGENDS_TIE_BREAKERS],
      status: 'draft',
    };
    const check = validateCircuitPayload(payload);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await api(`/api/admin/circuits/${initial.id}`, { method: 'PATCH', body: payload });
        toast.success('Circuit enregistré.');
      } else {
        await api('/api/admin/circuits', { method: 'POST', body: payload });
        toast.success('Circuit créé.');
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel bevel">
      <div className="panel-header flex items-center justify-between">
        <span className="t-sub">{initial ? `Éditer — ${initial.name}` : 'Nouveau circuit'}</span>
        <button type="button" className="btn-springs btn-secondary bevel-sm text-sm" onClick={applyLegendsPreset}>
          Préréglage Legends
        </button>
      </div>
      <div className="panel-body space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <label className="t-label block mb-2">Nom du circuit</label>
            <input
              className="settings-input w-full"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Legends Springs Cup 2026"
              maxLength={80}
            />
          </div>
          <div>
            <label className="t-label block mb-2">Résultats comptés par équipe</label>
            <input
              type="number" min={1} max={20}
              className="settings-input w-full"
              value={bestResultsCount}
              onChange={e => setBestResultsCount(Number(e.target.value))}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
              3 = seuls les 3 meilleurs Qualifs comptent au classement.
            </p>
          </div>
          <div>
            <label className="t-label block mb-2">Équipes qualifiées LAN</label>
            <input
              type="number" min={2} max={64}
              className="settings-input w-full"
              value={lanTeamCount}
              onChange={e => setLanTeamCount(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="divider" />

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="t-label">Barème de points (place → points)</label>
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Places</span>
              <input
                type="number" min={2} max={64}
                className="settings-input w-20"
                value={places}
                onChange={e => setPlaces(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--s-text-dim)' }}>
            Lu sur la place compressée 1→N : avec moins d&apos;équipes, les places vides
            décalent les suivantes. Les points doivent décroître.{' '}
            <a
              href="/legends/bareme-scenarios.html"
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: 'var(--s-text)' }}
            >
              Scénarios simulés
            </a>
          </p>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {Array.from({ length: places }, (_, i) => {
              const place = String(i + 1);
              return (
                <div key={place}>
                  <label className="block text-xs mb-1" style={{ color: 'var(--s-text-muted)' }}>
                    {place}
                    {i === 0 ? 'er' : 'e'}
                  </label>
                  <input
                    type="number" min={0}
                    className="settings-input w-full"
                    value={scale[place] ?? 0}
                    onChange={e => setScale(prev => ({ ...prev, [place]: Number(e.target.value) }))}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="divider" />

        <div>
          <label className="t-label block mb-2">Départage cutline</label>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {LEGENDS_TIE_BREAKERS.map(t => TIE_BREAKER_LABELS[t] ?? t).join(' → ')}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            className="btn-springs btn-primary bevel-sm"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Enregistrement…' : initial ? 'Enregistrer' : 'Créer le circuit'}
          </button>
          <button type="button" className="btn-springs btn-ghost" onClick={onCancel} disabled={saving}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
