'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, Trophy, Target, Hand, Crosshair } from 'lucide-react';
import { api } from '@/lib/api-client';

interface PlayerStats {
  name: string;
  platform: string;
  platformId: string;
  team: 'blue' | 'orange';
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  mvp: boolean;
}

interface CachedStats {
  status: string;
  mapName: string;
  mapCode: string;
  durationSec: number;
  blueGoals: number;
  orangeGoals: number;
  blueName: string;
  orangeName: string;
  date: string | null;
  players: PlayerStats[];
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'pending' }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; stats: CachedStats };

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Affiche les stats parsées par ballchasing pour un replay. Poll automatique
// toutes les 8s tant que ballchasing n'a pas fini de parser (state=pending).
export default function ReplayStatsPanel({
  structureId,
  replayId,
}: {
  structureId: string;
  replayId: string;
}) {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const res = await api<{
          state: 'disabled' | 'pending' | 'failed' | 'ready';
          stats?: CachedStats;
          error?: string;
        }>(`/api/structures/${structureId}/replays/${replayId}/stats`);
        if (cancelled) return;
        if (res.state === 'ready' && res.stats) {
          setState({ kind: 'ready', stats: res.stats });
        } else if (res.state === 'disabled') {
          setState({ kind: 'disabled' });
        } else if (res.state === 'failed') {
          setState({ kind: 'failed', error: res.error || 'Erreur ballchasing' });
        } else {
          setState({ kind: 'pending' });
          // poll
          timer = setTimeout(fetchOnce, 8000);
        }
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'failed', error: (err as Error).message || 'Erreur réseau' });
      }
    };

    fetchOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [structureId, replayId]);

  if (state.kind === 'loading' || state.kind === 'pending') {
    return (
      <div className="flex items-center gap-2 text-xs py-3 px-2" style={{ color: 'var(--s-text-muted)' }}>
        <Loader2 size={12} className="animate-spin" />
        <span>{state.kind === 'pending' ? 'Parsing en cours sur ballchasing…' : 'Chargement…'}</span>
      </div>
    );
  }

  if (state.kind === 'disabled') {
    return (
      <div className="text-xs py-3 px-2" style={{ color: 'var(--s-text-muted)' }}>
        Stats détaillées indisponibles (intégration ballchasing désactivée).
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="flex items-start gap-2 text-xs py-3 px-2" style={{ color: '#ef4444' }}>
        <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
        <span>{state.error}</span>
      </div>
    );
  }

  const { stats } = state;
  const blue = stats.players.filter(p => p.team === 'blue');
  const orange = stats.players.filter(p => p.team === 'orange');
  const winnerBlue = stats.blueGoals > stats.orangeGoals;
  const winnerOrange = stats.orangeGoals > stats.blueGoals;

  return (
    <div className="mt-3 pt-3 space-y-3" style={{ borderTop: '1px solid var(--s-border)' }}>
      {/* Bandeau match : score + map + durée */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <ScoreBlock label={stats.blueName} score={stats.blueGoals} accent="#0081FF" winner={winnerBlue} />
          <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>vs</span>
          <ScoreBlock label={stats.orangeName} score={stats.orangeGoals} accent="#FFB800" winner={winnerOrange} />
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--s-text-muted)' }}>
          <span>{stats.mapName || stats.mapCode || 'Map inconnue'}</span>
          <span>·</span>
          <span className="t-mono">{formatDuration(stats.durationSec)}</span>
        </div>
      </div>

      {/* Tables stats par équipe */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TeamTable label={stats.blueName} accent="#0081FF" players={blue} />
        <TeamTable label={stats.orangeName} accent="#FFB800" players={orange} />
      </div>
    </div>
  );
}

function ScoreBlock({ label, score, accent, winner }: { label: string; score: number; accent: string; winner: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="t-label" style={{ color: accent }}>{label}</span>
      <span className="font-display text-2xl" style={{
        color: winner ? accent : 'var(--s-text)',
        opacity: winner ? 1 : 0.6,
      }}>{score}</span>
    </div>
  );
}

function TeamTable({ label, accent, players }: { label: string; accent: string; players: PlayerStats[] }) {
  if (players.length === 0) {
    return (
      <div className="text-xs py-2 px-2" style={{ color: 'var(--s-text-muted)' }}>
        {label} : aucun joueur.
      </div>
    );
  }
  return (
    <div className="bevel-sm p-2" style={{ background: 'var(--s-surface)', border: `1px solid ${accent}30` }}>
      <div className="t-label mb-2 px-1" style={{ color: accent }}>{label}</div>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--s-text-muted)' }}>
            <th className="text-left pb-1 font-normal">Joueur</th>
            <th className="text-right pb-1 font-normal" title="Score"><Trophy size={10} className="inline" /></th>
            <th className="text-right pb-1 font-normal" title="Buts"><Target size={10} className="inline" /></th>
            <th className="text-right pb-1 font-normal" title="Passes">A</th>
            <th className="text-right pb-1 font-normal" title="Arrêts"><Hand size={10} className="inline" /></th>
            <th className="text-right pb-1 font-normal" title="Tirs"><Crosshair size={10} className="inline" /></th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, idx) => (
            <tr key={`${p.platform}-${p.platformId}-${idx}`} style={{ color: 'var(--s-text)' }}>
              <td className="py-1 truncate max-w-[120px]">
                <span style={{ color: p.mvp ? 'var(--s-gold)' : 'var(--s-text)' }}>{p.name}</span>
                {p.mvp && <span className="ml-1 t-label" style={{ color: 'var(--s-gold)' }}>MVP</span>}
              </td>
              <td className="text-right py-1 t-mono">{p.score}</td>
              <td className="text-right py-1 t-mono">{p.goals}</td>
              <td className="text-right py-1 t-mono">{p.assists}</td>
              <td className="text-right py-1 t-mono">{p.saves}</td>
              <td className="text-right py-1 t-mono">{p.shots}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
