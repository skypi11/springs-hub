'use client';

// Panneau SEEDING de la console admin (design §10c) — le cycle seeding →
// publication pilotable SANS script (il n'existait AUCUNE UI avant ce
// panneau). Stratégies : aléatoire / par MMR (compo la plus forte, calculée
// serveur au submit) / par classement du circuit. Réordonnancement manuel
// ↑/↓ par-dessus. DA sobre niveau 2 — le polish visuel = passe Opus.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import TeamCrest from '@/components/competitions/TeamCrest';
import { ArrowDown, ArrowUp } from 'lucide-react';

interface SeedRow {
  registrationId: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  seed: number;
  mmrSeed: number;
  circuitRank: number | null;
}

interface BracketState {
  status: string;
  approvedCount: number;
  minTeams: number;
  maxTeams: number;
  seeding: SeedRow[];
  strategies: { random: boolean; mmr: boolean; circuit: boolean };
  canOpenSeeding: boolean;
  canEditSeeding: boolean;
  canPublish: boolean;
  /** Le seeding stocké diverge des validées — re-seed requis avant publication. */
  seedingStale: boolean;
  feasibilityError: string | null;
  materialized: boolean;
}

export default function SeedingPanel({ competitionId, onPublished }: {
  competitionId: string;
  /** Bracket publié → la console recharge (le panneau disparaît, la salle de
   *  contrôle prend le relais). */
  onPublished: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<BracketState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<BracketState>(`/api/admin/competitions/${competitionId}/bracket`));
      setLoadFailed(false);
    } catch {
      // On garde le dernier état s'il existe ; sinon état d'erreur visible
      // avec bouton Recharger (review : jamais un panneau silencieusement
      // absent).
      setLoadFailed(true);
    }
  }, [competitionId]);
  useEffect(() => { load(); }, [load]);

  const action = useCallback(async (body: Record<string, unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await api(`/api/admin/competitions/${competitionId}/bracket`, { method: 'POST', body });
      if (okMsg) toast.info(okMsg);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Action impossible.');
      // Un 409 signifie que l'état serveur a bougé (c'est la raison du
      // refus) : recharger, sinon le panneau reste sur une liste périmée.
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  }, [competitionId, load, toast]);

  if (!state) {
    if (!loadFailed) return null;
    return (
      <div className="panel bevel">
        <div className="panel-body flex items-center justify-between gap-3">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Le seeding n&apos;a pas pu être chargé.</p>
          <button className="btn-springs btn-secondary bevel-sm text-sm" onClick={load}>Recharger</button>
        </div>
      </div>
    );
  }
  const editable = state.canEditSeeding && !state.materialized;

  // Réordonnancement manuel ↑/↓ — l'API exige la permutation complète.
  const move = (index: number, delta: -1 | 1) => {
    const order = state.seeding.map(r => r.registrationId);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    action({ action: 'reorder', order });
  };

  return (
    <div className="panel bevel">
      <div className="panel-header flex flex-wrap items-center justify-between gap-3">
        <span className="t-sub">Seeding — {state.approvedCount} équipes validées</span>
        {state.canOpenSeeding && (
          <button className="btn-springs btn-secondary bevel-sm text-sm" disabled={busy}
            onClick={() => action({ action: 'open_seeding' }, 'Seeding ouvert — ordre aléatoire de départ.')}>
            Ouvrir le seeding
          </button>
        )}
      </div>
      <div className="panel-body space-y-4">
        {state.feasibilityError && (
          <p className="text-sm" style={{ color: 'var(--s-text)' }}>{state.feasibilityError}</p>
        )}
        {state.seedingStale && (
          <p className="text-sm" style={{ color: 'var(--s-text)' }}>
            Les équipes validées ont changé depuis le dernier seeding — ré-ordonne (Par MMR ou Aléatoire) avant de publier.
          </p>
        )}
        {!editable && !state.canOpenSeeding && (
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Le seeding s&apos;ouvre une fois assez d&apos;équipes validées ({state.minTeams} minimum).
          </p>
        )}

        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-label-soft">Ordonner</span>
            <button className="btn-springs btn-ghost bevel-sm text-sm" disabled={busy}
              onClick={() => action({ action: 'seed_by', strategy: 'mmr' }, 'Seeding par MMR — compo la plus forte en tête.')}>
              Par MMR
            </button>
            {state.strategies.circuit && (
              <button className="btn-springs btn-ghost bevel-sm text-sm" disabled={busy}
                onClick={() => action({ action: 'seed_by', strategy: 'circuit' }, 'Seeding par classement du circuit.')}>
                Par classement du circuit
              </button>
            )}
            <button className="btn-springs btn-ghost bevel-sm text-sm" disabled={busy}
              onClick={() => action({ action: 'seed_by', strategy: 'random' }, 'Seeding aléatoire retiré.')}>
              Aléatoire
            </button>
          </div>
        )}

        {state.seeding.length > 0 && (
          <div>
            {state.seeding.map((r, i) => (
              <div key={r.registrationId} className="flex items-center gap-3 py-1.5"
                style={{ borderBottom: '1px solid var(--s-border)' }}>
                <span className="t-mono" style={{ width: 26, fontSize: 13, color: 'var(--s-text-dim)' }}>#{r.seed}</span>
                <TeamCrest url={r.logoUrl} tag={r.tag} name={r.name} size={22} />
                <span className="truncate flex-1 text-sm" style={{ color: 'var(--s-text)' }}>{r.name}</span>
                {r.circuitRank !== null && (
                  <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
                    circuit #{r.circuitRank}
                  </span>
                )}
                <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
                  {r.mmrSeed > 0 ? `${r.mmrSeed} MMR` : 'MMR inconnu'}
                </span>
                {editable && (
                  <span className="flex items-center gap-1">
                    <button className="quiet-link" aria-label={`Monter ${r.name}`} disabled={busy || i === 0}
                      onClick={() => move(i, -1)}>
                      <ArrowUp size={14} />
                    </button>
                    <button className="quiet-link" aria-label={`Descendre ${r.name}`} disabled={busy || i === state.seeding.length - 1}
                      onClick={() => move(i, 1)}>
                      <ArrowDown size={14} />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {editable && (
          <div className="flex items-center justify-end">
            <button className="btn-springs btn-primary bevel-sm" disabled={busy || !state.canPublish}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Publier le bracket',
                  message: `Le bracket sera généré avec ce seeding (${state.seeding.length} équipes) et la compétition passe en jeu. Le seeding est figé à la publication.`,
                  confirmLabel: 'Publier',
                });
                if (ok && await action({ action: 'publish' }, 'Bracket publié — la compétition est en jeu.')) {
                  onPublished();
                }
              }}>
              Publier le bracket
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
