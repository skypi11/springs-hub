'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertTriangle, X, Trophy, Target, Hand, Crosshair,
  Zap, Gauge, MapPin, Skull, Sigma, BarChart3,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import Portal from '@/components/ui/Portal';
import {
  aggregateByPlayer,
  aggregateByTeam,
  type AggregationMode,
  type PlayerStatsLite,
} from '@/lib/ballchasing-aggregate';

type PlayerStats = PlayerStatsLite;

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

interface AggResponse {
  totalCount: number;
  parsedCount: number;
  replays: { replayId: string; title: string; stats: CachedStats }[];
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
  eventId,
  onClose,
}: {
  structureId: string;
  replayId: string;
  replayTitle: string;
  eventId: string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [aggregated, setAggregated] = useState<AggResponse | null>(null);

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

  // Fetch des stats agrégées sur l'event (si on a un eventId). Indépendant
  // du state du replay courant — la section "Moyenne du match" peut s'afficher
  // même si le replay courant n'est pas encore parsé (cas edge).
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    api<AggResponse>(`/api/structures/${structureId}/events/${eventId}/replay-stats-agg`)
      .then(res => { if (!cancelled) setAggregated(res); })
      .catch(() => { /* silencieux : section moyenne ne s'affichera juste pas */ });
    return () => { cancelled = true; };
  }, [structureId, eventId]);

  // ESC pour fermer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Portal>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="animate-overlay-in"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9600,
        }}
      />
      {/* Drawer — z-index au-dessus de TeamDetailDrawer/TodoDetailDrawer (9500)
          pour s'afficher par-dessus la modal event. */}
      <aside
        className="animate-slide-in-right"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(720px, 100vw)',
          background: 'var(--s-bg)',
          borderLeft: '1px solid var(--s-border)',
          zIndex: 9601,
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
          <DrawerBody state={state} aggregated={aggregated} />
        </div>
      </aside>
    </Portal>
  );
}

function DrawerBody({ state, aggregated }: { state: FetchState; aggregated: AggResponse | null }) {
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

  return (
    <div className="space-y-8">
      {/* ────── Section : REPLAY COURANT (toujours en mode sum pour la ligne TEAM,
          qui représente le total équipe sur ce match unique) ────── */}
      <StatsBlock
        title="REPLAY COURANT"
        stats={stats}
        mode="sum"
        showModeToggle={false}
      />

      {/* ────── Section : MOYENNE DU MATCH (si event ≥ 2 replays parsés) ────── */}
      {aggregated && aggregated.parsedCount >= 2 && (
        <AggregatedSection aggregated={aggregated} />
      )}
    </div>
  );
}

// Bloc de stats — utilisé à la fois pour le replay courant et pour la section
// agrégée du match. Le `mode` ne contrôle que la ligne TEAM ici, mais
// AggregatedSection le passe à ses propres aggregateByPlayer.
function StatsBlock({
  title,
  subtitle,
  stats,
  mode,
  modeToggle,
  showModeToggle: _showModeToggle = false,
}: {
  title: string;
  subtitle?: string;
  stats: CachedStats;
  mode: AggregationMode;
  modeToggle?: React.ReactNode;
  showModeToggle?: boolean;
}) {
  const winnerBlue = stats.blueGoals > stats.orangeGoals;
  const winnerOrange = stats.orangeGoals > stats.blueGoals;
  const teamAggBlue = useMemo(() => aggregateByTeam(stats.players, mode).blue, [stats.players, mode]);
  const teamAggOrange = useMemo(() => aggregateByTeam(stats.players, mode).orange, [stats.players, mode]);
  const blue = stats.players.filter(p => p.team === 'blue');
  const orange = stats.players.filter(p => p.team === 'orange');

  return (
    <div className="space-y-4">
      {/* Header bloc */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="t-label" style={{ color: 'var(--s-gold)' }}>{title}</div>
          {subtitle && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{subtitle}</div>
          )}
        </div>
        {modeToggle}
      </div>

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

      {/* Section Core — avec ligne TEAM en bas */}
      <Section icon={<Trophy size={13} />} title="CORE">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <CoreTable label={stats.blueName} accent="#0081FF" players={blue} teamRow={teamAggBlue} />
          <CoreTable label={stats.orangeName} accent="#FFB800" players={orange} teamRow={teamAggOrange} />
        </div>
      </Section>

      {stats.players.some(p => p.boost) && (
        <Section icon={<Zap size={13} />} title="BOOST">
          <BoostTable players={stats.players} teamRows={[teamAggBlue, teamAggOrange]} />
        </Section>
      )}

      {stats.players.some(p => p.movement) && (
        <Section icon={<Gauge size={13} />} title="MOUVEMENT">
          <MovementTable players={stats.players} teamRows={[teamAggBlue, teamAggOrange]} />
        </Section>
      )}

      {stats.players.some(p => p.positioning) && (
        <Section icon={<MapPin size={13} />} title="POSITIONNEMENT">
          <PositioningTable players={stats.players} teamRows={[teamAggBlue, teamAggOrange]} />
        </Section>
      )}

      {stats.players.some(p => p.demo) && (
        <Section icon={<Skull size={13} />} title="DEMOS">
          <DemoTable players={stats.players} teamRows={[teamAggBlue, teamAggOrange]} />
        </Section>
      )}
    </div>
  );
}

// Section agrégée sur tous les replays parsés d'un event.
// - Toggle Somme/Moyenne pour les counts (les rates restent toujours en mean)
// - Joueurs groupés par platformId (un joueur = 1 ligne même s'il est dans N replays)
// - Ligne TEAM = agrégat des joueurs Blue / Orange
function AggregatedSection({ aggregated }: { aggregated: AggResponse }) {
  const [mode, setMode] = useState<AggregationMode>('sum');

  // Concatène tous les players de tous les replays parsés.
  const allPlayers = useMemo(() => {
    const out: PlayerStats[] = [];
    for (const r of aggregated.replays) {
      for (const p of r.stats.players) out.push(p);
    }
    return out;
  }, [aggregated.replays]);

  // 1 entrée par joueur unique, agrégée selon `mode`.
  const playersAgg = useMemo(() => aggregateByPlayer(allPlayers, mode), [allPlayers, mode]);

  // Synthétise un CachedStats "virtuel" pour réutiliser le rendu existant.
  const synth: CachedStats = useMemo(() => {
    const first = aggregated.replays[0]?.stats;
    // Score équipe = somme des goals/orangeGoals sur les replays (utile pour le bandeau)
    let blueGoals = 0, orangeGoals = 0;
    for (const r of aggregated.replays) {
      blueGoals += r.stats.blueGoals;
      orangeGoals += r.stats.orangeGoals;
    }
    return {
      status: 'ok',
      statsVersion: 2,
      mapName: 'Cumul du match',
      mapCode: '',
      durationSec: aggregated.replays.reduce((s, r) => s + (r.stats.durationSec || 0), 0),
      blueGoals,
      orangeGoals,
      blueName: first?.blueName ?? 'Blue',
      orangeName: first?.orangeName ?? 'Orange',
      date: first?.date ?? null,
      players: playersAgg,
    };
  }, [aggregated, playersAgg]);

  return (
    <StatsBlock
      title="MOYENNE DU MATCH"
      subtitle={`Sur ${aggregated.parsedCount} replays parsés${aggregated.totalCount > aggregated.parsedCount ? ` (${aggregated.totalCount - aggregated.parsedCount} pas encore prêts)` : ''}`}
      stats={synth}
      mode={mode}
      showModeToggle
      modeToggle={<ModeToggle mode={mode} onChange={setMode} />}
    />
  );
}

function ModeToggle({ mode, onChange }: { mode: AggregationMode; onChange: (m: AggregationMode) => void }) {
  return (
    <div className="inline-flex bevel-sm overflow-hidden" style={{ border: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
      <ToggleBtn active={mode === 'sum'} onClick={() => onChange('sum')} icon={<Sigma size={11} />} label="SOMME" />
      <ToggleBtn active={mode === 'mean'} onClick={() => onChange('mean')} icon={<BarChart3 size={11} />} label="MOYENNE" />
    </div>
  );
}
function ToggleBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
      style={{
        background: active ? 'var(--s-gold)' : 'transparent',
        color: active ? '#000' : 'var(--s-text-dim)',
      }}>
      {icon}{label}
    </button>
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

// Style appliqué aux lignes TEAM en bas des tables.
const TEAM_ROW_STYLE: React.CSSProperties = {
  borderTop: '2px solid var(--s-border)',
  background: 'var(--s-elevated)',
  fontWeight: 600,
};

function CoreTable({ label, accent, players, teamRow }: { label: string; accent: string; players: PlayerStats[]; teamRow?: PlayerStats }) {
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
              <td className="text-right py-1 t-mono">{fmtNum(p.score)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.goals)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.assists)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.saves)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.shots)}</td>
              <td className="text-right py-1 t-mono" style={{ color: 'var(--s-text-muted)' }}>
                {typeof p.shootingPct === 'number' ? Math.round(p.shootingPct) : '—'}
              </td>
            </tr>
          ))}
          {teamRow && (
            <tr style={{ ...TEAM_ROW_STYLE, color: accent }}>
              <td className="py-1.5 t-label">TEAM</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(teamRow.score)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(teamRow.goals)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(teamRow.assists)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(teamRow.saves)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(teamRow.shots)}</td>
              <td className="text-right py-1.5 t-mono">{typeof teamRow.shootingPct === 'number' ? Math.round(teamRow.shootingPct) : '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BoostTable({ players, teamRows }: { players: PlayerStats[]; teamRows?: PlayerStats[] }) {
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
          {teamRows?.map((t, i) => t.boost ? (
            <tr key={`team-${i}`} style={{ ...TEAM_ROW_STYLE, color: teamColor(t.team) }}>
              <td className="py-1.5 t-label">{t.name}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.boost.bpm)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.boost.bcpm)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.boost.avgAmount)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.boost.amountStolen)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.boost.amountCollectedBig)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.boost.amountCollectedSmall)}</td>
              <td className="text-right py-1.5 t-mono">{fmtPct(t.boost.percentZeroBoost)}</td>
              <td className="text-right py-1.5 t-mono">{fmtPct(t.boost.percentFullBoost)}</td>
            </tr>
          ) : null)}
        </tbody>
      </table>
    </div>
  );
}

function MovementTable({ players, teamRows }: { players: PlayerStats[]; teamRows?: PlayerStats[] }) {
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
          {teamRows?.map((t, i) => t.movement ? (
            <tr key={`team-${i}`} style={{ ...TEAM_ROW_STYLE, color: teamColor(t.team) }}>
              <td className="py-1.5 t-label">{t.name}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.movement.avgSpeed)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.movement.totalDistance / 1000, 1)}k</td>
              <td className="text-right py-1.5 t-mono">{fmtTime(t.movement.timeSupersonic)}</td>
              <td className="text-right py-1.5 t-mono">{fmtPct(t.movement.percentSupersonic)}</td>
              <td className="text-right py-1.5 t-mono">{fmtPct(t.movement.percentGround)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.movement.powerslideCount)}</td>
            </tr>
          ) : null)}
        </tbody>
      </table>
    </div>
  );
}

function PositioningTable({ players, teamRows }: { players: PlayerStats[]; teamRows?: PlayerStats[] }) {
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
          {teamRows?.map((t, i) => t.positioning ? (
            <tr key={`team-${i}`} style={{ ...TEAM_ROW_STYLE, color: teamColor(t.team) }}>
              <td className="py-1.5 t-label">{t.name}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.positioning.avgDistanceToBall)}</td>
              <td className="text-right py-1.5 t-mono">{fmtPct(t.positioning.percentDefensiveHalf)}</td>
              <td className="text-right py-1.5 t-mono">{fmtPct(t.positioning.percentBehindBall)}</td>
              <td className="text-right py-1.5 t-mono">{fmtTime(t.positioning.timeMostBack)}</td>
              <td className="text-right py-1.5 t-mono">{fmtTime(t.positioning.timeMostForward)}</td>
            </tr>
          ) : null)}
        </tbody>
      </table>
    </div>
  );
}

function DemoTable({ players, teamRows }: { players: PlayerStats[]; teamRows?: PlayerStats[] }) {
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
              <td className="text-right py-1 t-mono">{fmtNum(p.demo.inflicted)}</td>
              <td className="text-right py-1 t-mono">{fmtNum(p.demo.taken)}</td>
            </tr>
          ) : null)}
          {teamRows?.map((t, i) => t.demo ? (
            <tr key={`team-${i}`} style={{ ...TEAM_ROW_STYLE, color: teamColor(t.team) }}>
              <td className="py-1.5 t-label">{t.name}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.demo.inflicted)}</td>
              <td className="text-right py-1.5 t-mono">{fmtNum(t.demo.taken)}</td>
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
