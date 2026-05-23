'use client';

import { useEffect, useState } from 'react';
import {
  Loader2, AlertTriangle, X, Trophy, Target, Hand, Crosshair,
  Zap, Gauge, MapPin, Skull,
} from 'lucide-react';
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
  shootingPct?: number;
  shotsAgainst?: number;
  goalsAgainst?: number;
  boost?: {
    bpm: number; bcpm: number; avgAmount: number;
    amountCollected: number; amountStolen: number;
    amountCollectedBig: number; amountCollectedSmall: number;
    amountOverfill: number;
    timeZeroBoost: number; timeFullBoost: number;
    percentZeroBoost?: number; percentFullBoost?: number;
  };
  movement?: {
    avgSpeed: number; totalDistance: number;
    timeSupersonic: number; timeBoostSpeed: number; timeSlowSpeed: number;
    timeGround: number; timeLowAir: number; timeHighAir: number;
    powerslideCount: number; avgPowerslideDuration: number;
    percentSupersonic?: number; percentGround?: number;
  };
  positioning?: {
    avgDistanceToBall: number;
    avgDistanceToBallPossession: number;
    avgDistanceToBallNoPossession: number;
    timeDefensiveHalf: number; timeOffensiveHalf: number;
    timeBehindBall: number; timeInfrontBall: number;
    timeMostBack: number; timeMostForward: number;
    timeClosestToBall: number; timeFarthestFromBall: number;
    percentBehindBall?: number; percentDefensiveHalf?: number;
  };
  demo?: { inflicted: number; taken: number };
}

interface CachedStats {
  status: string;
  statsVersion?: number;
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
function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtPct(n: number | undefined): string {
  if (typeof n !== 'number') return '—';
  return `${Math.round(n)}%`;
}
function fmtTime(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${String(s).padStart(2, '0')}`;
}

// Drawer plein écran à droite affichant les stats détaillées d'un replay.
// Z-index supérieur à n'importe quel modal/drawer existant pour pouvoir
// s'ouvrir par-dessus la modal event sans collision.
export default function ReplayStatsDrawer({
  structureId,
  replayId,
  replayTitle,
  onClose,
}: {
  structureId: string;
  replayId: string;
  replayTitle: string;
  onClose: () => void;
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
          timer = setTimeout(fetchOnce, 8000);
        }
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'failed', error: (err as Error).message || 'Erreur réseau' });
      }
    };

    fetchOnce();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [structureId, replayId]);

  // ESC pour fermer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="animate-overlay-in"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 100,
        }}
      />
      {/* Drawer */}
      <aside
        className="animate-slide-in-right"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(720px, 100vw)',
          background: 'var(--s-bg)',
          borderLeft: '1px solid var(--s-border)',
          zIndex: 101,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header sticky */}
        <header className="px-5 py-4 flex items-center justify-between gap-3"
          style={{ borderBottom: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
          <div className="min-w-0">
            <div className="t-label" style={{ color: 'var(--s-gold)' }}>STATS DÉTAILLÉES</div>
            <div className="text-sm font-medium truncate" style={{ color: 'var(--s-text)' }}>
              {replayTitle}
            </div>
          </div>
          <button onClick={onClose} type="button"
            className="flex items-center justify-center transition-colors hover:bg-[var(--s-elevated)]"
            style={{ width: 32, height: 32, border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
            <X size={14} />
          </button>
        </header>

        {/* Body scroll */}
        <div className="flex-1 overflow-y-auto p-5">
          <DrawerBody state={state} />
        </div>
      </aside>
    </>
  );
}

function DrawerBody({ state }: { state: FetchState }) {
  if (state.kind === 'loading' || state.kind === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3"
        style={{ color: 'var(--s-text-muted)' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
        <span className="text-sm">
          {state.kind === 'pending'
            ? 'Ballchasing parse le replay (5-30s)…'
            : 'Chargement des stats…'}
        </span>
      </div>
    );
  }

  if (state.kind === 'disabled') {
    return (
      <div className="text-sm py-8 text-center" style={{ color: 'var(--s-text-muted)' }}>
        Stats détaillées indisponibles (intégration ballchasing désactivée côté serveur).
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="flex items-start gap-2 text-sm p-4 bevel-sm"
        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
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
    <div className="space-y-6">
      {/* Bandeau score */}
      <div className="bevel-sm p-4 flex items-center justify-between flex-wrap gap-3"
        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
        <div className="flex items-center gap-4">
          <ScoreBlock label={stats.blueName} score={stats.blueGoals} accent="#0081FF" winner={winnerBlue} />
          <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>vs</span>
          <ScoreBlock label={stats.orangeName} score={stats.orangeGoals} accent="#FFB800" winner={winnerOrange} />
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--s-text-muted)' }}>
          <span>{stats.mapName || stats.mapCode || 'Map ?'}</span>
          <span>·</span>
          <span className="t-mono">{formatDuration(stats.durationSec)}</span>
        </div>
      </div>

      {/* Section Core */}
      <Section icon={<Trophy size={13} />} title="CORE">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <CoreTable label={stats.blueName} accent="#0081FF" players={blue} />
          <CoreTable label={stats.orangeName} accent="#FFB800" players={orange} />
        </div>
      </Section>

      {/* Section Boost — affiché uniquement si au moins un joueur a les stats */}
      {stats.players.some(p => p.boost) && (
        <Section icon={<Zap size={13} />} title="BOOST">
          <BoostTable players={stats.players} />
        </Section>
      )}

      {/* Section Mouvement */}
      {stats.players.some(p => p.movement) && (
        <Section icon={<Gauge size={13} />} title="MOUVEMENT">
          <MovementTable players={stats.players} />
        </Section>
      )}

      {/* Section Positionnement */}
      {stats.players.some(p => p.positioning) && (
        <Section icon={<MapPin size={13} />} title="POSITIONNEMENT">
          <PositioningTable players={stats.players} />
        </Section>
      )}

      {/* Section Demos */}
      {stats.players.some(p => p.demo) && (
        <Section icon={<Skull size={13} />} title="DEMOS">
          <DemoTable players={stats.players} />
        </Section>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: 'var(--s-gold)' }}>{icon}</span>
        <span className="t-label" style={{ color: 'var(--s-text)' }}>{title}</span>
      </div>
      {children}
    </section>
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

function CoreTable({ label, accent, players }: { label: string; accent: string; players: PlayerStats[] }) {
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
            <th className="text-right pb-1 font-normal" title="% tir">%</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, idx) => (
            <tr key={`${p.platform}-${p.platformId}-${idx}`} style={{ color: 'var(--s-text)' }}>
              <td className="py-1 truncate max-w-[110px]">
                <span style={{ color: p.mvp ? 'var(--s-gold)' : 'var(--s-text)' }}>{p.name}</span>
                {p.mvp && <span className="ml-1 t-label" style={{ color: 'var(--s-gold)' }}>MVP</span>}
              </td>
              <td className="text-right py-1 t-mono">{p.score}</td>
              <td className="text-right py-1 t-mono">{p.goals}</td>
              <td className="text-right py-1 t-mono">{p.assists}</td>
              <td className="text-right py-1 t-mono">{p.saves}</td>
              <td className="text-right py-1 t-mono">{p.shots}</td>
              <td className="text-right py-1 t-mono" style={{ color: 'var(--s-text-muted)' }}>
                {typeof p.shootingPct === 'number' ? Math.round(p.shootingPct) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoostTable({ players }: { players: PlayerStats[] }) {
  return (
    <div className="bevel-sm p-2 overflow-x-auto" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--s-text-muted)' }}>
            <th className="text-left pb-1 font-normal">Joueur</th>
            <th className="text-right pb-1 font-normal" title="Boost per minute">BPM</th>
            <th className="text-right pb-1 font-normal" title="Boost collecté par min">BCPM</th>
            <th className="text-right pb-1 font-normal" title="Boost moyen">Avg</th>
            <th className="text-right pb-1 font-normal" title="Volé à l'adversaire">Volé</th>
            <th className="text-right pb-1 font-normal" title="Gros pads">Big</th>
            <th className="text-right pb-1 font-normal" title="Petits pads">Sm</th>
            <th className="text-right pb-1 font-normal" title="% temps à 0 boost">%0</th>
            <th className="text-right pb-1 font-normal" title="% temps à 100 boost">%100</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => p.boost ? (
            <tr key={i} style={{ color: 'var(--s-text)', borderTop: '1px solid var(--s-border)' }}>
              <td className="py-1 truncate max-w-[110px]" style={{ color: teamColor(p.team) }}>{p.name}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.boost.bpm)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.boost.bcpm)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.boost.avgAmount)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.boost.amountStolen)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.boost.amountCollectedBig)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.boost.amountCollectedSmall)}</td>
              <td className="text-right py-1 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.boost.percentZeroBoost)}</td>
              <td className="text-right py-1 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.boost.percentFullBoost)}</td>
            </tr>
          ) : null)}
        </tbody>
      </table>
    </div>
  );
}

function MovementTable({ players }: { players: PlayerStats[] }) {
  return (
    <div className="bevel-sm p-2 overflow-x-auto" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--s-text-muted)' }}>
            <th className="text-left pb-1 font-normal">Joueur</th>
            <th className="text-right pb-1 font-normal" title="Vitesse moyenne">Avg km/h</th>
            <th className="text-right pb-1 font-normal" title="Distance totale">Dist</th>
            <th className="text-right pb-1 font-normal" title="Temps en supersonic">Super</th>
            <th className="text-right pb-1 font-normal" title="% supersonic">%SS</th>
            <th className="text-right pb-1 font-normal" title="% au sol">%Sol</th>
            <th className="text-right pb-1 font-normal" title="Powerslides">PS</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => p.movement ? (
            <tr key={i} style={{ color: 'var(--s-text)', borderTop: '1px solid var(--s-border)' }}>
              <td className="py-1 truncate max-w-[110px]" style={{ color: teamColor(p.team) }}>{p.name}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.movement.avgSpeed)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.movement.totalDistance / 1000, 1)}k</td>
              <td className="text-right py-1 t-mono">{fmtTime(p.movement.timeSupersonic)}</td>
              <td className="text-right py-1 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.movement.percentSupersonic)}</td>
              <td className="text-right py-1 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.movement.percentGround)}</td>
              <td className="text-right py-1 t-mono">{p.movement.powerslideCount}</td>
            </tr>
          ) : null)}
        </tbody>
      </table>
    </div>
  );
}

function PositioningTable({ players }: { players: PlayerStats[] }) {
  return (
    <div className="bevel-sm p-2 overflow-x-auto" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--s-text-muted)' }}>
            <th className="text-left pb-1 font-normal">Joueur</th>
            <th className="text-right pb-1 font-normal" title="Distance moyenne à la balle">Dist balle</th>
            <th className="text-right pb-1 font-normal" title="% en moitié défensive">%Déf</th>
            <th className="text-right pb-1 font-normal" title="% derrière la balle">%Behind</th>
            <th className="text-right pb-1 font-normal" title="Temps le plus arrière">Most back</th>
            <th className="text-right pb-1 font-normal" title="Temps le plus avancé">Most fwd</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => p.positioning ? (
            <tr key={i} style={{ color: 'var(--s-text)', borderTop: '1px solid var(--s-border)' }}>
              <td className="py-1 truncate max-w-[110px]" style={{ color: teamColor(p.team) }}>{p.name}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.positioning.avgDistanceToBall)}</td>
              <td className="text-right py-1 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.positioning.percentDefensiveHalf)}</td>
              <td className="text-right py-1 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.positioning.percentBehindBall)}</td>
              <td className="text-right py-1 t-mono">{fmtTime(p.positioning.timeMostBack)}</td>
              <td className="text-right py-1 t-mono">{fmtTime(p.positioning.timeMostForward)}</td>
            </tr>
          ) : null)}
        </tbody>
      </table>
    </div>
  );
}

function DemoTable({ players }: { players: PlayerStats[] }) {
  return (
    <div className="bevel-sm p-2" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--s-text-muted)' }}>
            <th className="text-left pb-1 font-normal">Joueur</th>
            <th className="text-right pb-1 font-normal">Infligés</th>
            <th className="text-right pb-1 font-normal">Subis</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => p.demo ? (
            <tr key={i} style={{ color: 'var(--s-text)', borderTop: '1px solid var(--s-border)' }}>
              <td className="py-1 truncate max-w-[110px]" style={{ color: teamColor(p.team) }}>{p.name}</td>
              <td className="text-right py-1 t-mono">{p.demo.inflicted}</td>
              <td className="text-right py-1 t-mono">{p.demo.taken}</td>
            </tr>
          ) : null)}
        </tbody>
      </table>
    </div>
  );
}

function teamColor(team: 'blue' | 'orange'): string {
  return team === 'blue' ? '#0081FF' : '#FFB800';
}
