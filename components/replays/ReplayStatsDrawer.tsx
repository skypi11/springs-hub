'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, AlertTriangle, X, Trophy, Target, Hand, Crosshair,
  Zap, Gauge, MapPin, Skull, Sigma, BarChart3, ChevronDown, ChevronRight,
  Maximize2, Minimize2,
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

export interface AggResponse {
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
      {/* Drawer — quasi plein écran sur grand moniteur (1400px) pour pouvoir
          déplier les stats détaillées et la vue match complet sans serrer.
          Reste drawer sur écran <1500px (95vw). z-index au-dessus de
          TeamDetailDrawer/TodoDetailDrawer (9500). */}
      <aside
        className="animate-slide-in-right"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(1400px, 95vw)',
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
        <div className="flex-1 overflow-y-auto p-6">
          <DrawerBody state={state} aggregated={aggregated} focusedReplayId={replayId} />
        </div>
      </aside>
    </Portal>
  );
}

function DrawerBody({
  state,
  aggregated,
  focusedReplayId,
}: {
  state: FetchState;
  aggregated: AggResponse | null;
  focusedReplayId: string;
}) {
  // Mode "all" = vue match complet (tous les replays parsés empilés + moyenne)
  // Mode "single" = juste le replay courant. Default sur "all" dès qu'on a ≥2
  // replays parsés dans l'event — sinon "single" est de toute façon le seul
  // contenu pertinent.
  const hasMultipleParsed = !!aggregated && aggregated.parsedCount >= 2;
  const [view, setView] = useState<'single' | 'all'>(hasMultipleParsed ? 'all' : 'single');
  // Si l'aggregated arrive après coup avec plusieurs replays parsés, on
  // bascule automatiquement sur la vue all (le toggle est dispo si l'user
  // veut repasser sur single).
  useEffect(() => {
    if (hasMultipleParsed) setView('all');
  }, [hasMultipleParsed]);

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
      {/* Toggle de vue — visible uniquement si event a ≥2 replays parsés */}
      {hasMultipleParsed && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="t-label" style={{ color: 'var(--s-text-muted)' }}>
            {view === 'all' ? `Tous les replays du match (${aggregated!.parsedCount})` : 'Replay courant uniquement'}
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>
      )}

      {view === 'single' && (
        <StatsBlock
          title="REPLAY COURANT"
          stats={stats}
          mode="sum"
          showModeToggle={false}
        />
      )}

      {view === 'all' && aggregated && (
        <>
          {/* Empile chaque replay parsé. Le replay correspondant au clic est
              entouré d'une bordure or et fait un scroll-into-view au mount. */}
          {aggregated.replays.map((r, idx) => (
            <ReplayCard
              key={r.replayId}
              index={idx + 1}
              total={aggregated.replays.length}
              title={r.title}
              stats={r.stats}
              focused={r.replayId === focusedReplayId}
            />
          ))}
          {/* Moyenne du match en bas */}
          <AggregatedSection aggregated={aggregated} />
        </>
      )}
    </div>
  );
}

// Carte d'un replay dans la vue "match complet" — wrap StatsBlock + highlight
// pour le replay focused + sticky title pour repérer où on est en scrollant.
// Exportée pour réutilisation dans la page dédiée /community/event/[id]/stats.
export function ReplayCard({
  index,
  total,
  title,
  stats,
  focused,
}: {
  index: number;
  total: number;
  title: string;
  stats: CachedStats;
  focused: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused && ref.current) {
      // Scroll progressif vers le replay cliqué après l'animation du drawer.
      const t = setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 350);
      return () => clearTimeout(t);
    }
  }, [focused]);

  return (
    <div
      ref={ref}
      className="bevel p-5"
      style={{
        background: focused ? 'rgba(255,184,0,0.04)' : 'var(--s-surface)',
        border: `1px solid ${focused ? 'var(--s-gold)' : 'var(--s-border)'}`,
      }}
    >
      <StatsBlock
        title={`REPLAY ${index} / ${total}${focused ? ' · CLIQUÉ' : ''}`}
        stats={stats}
        mode="sum"
        showModeToggle={false}
      />
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: 'single' | 'all'; onChange: (v: 'single' | 'all') => void }) {
  return (
    <div className="inline-flex bevel-sm overflow-hidden" style={{ border: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
      <button type="button" onClick={() => onChange('single')}
        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors"
        style={{
          background: view === 'single' ? 'var(--s-gold)' : 'transparent',
          color: view === 'single' ? '#000' : 'var(--s-text-dim)',
        }}>
        Replay courant
      </button>
      <button type="button" onClick={() => onChange('all')}
        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors"
        style={{
          background: view === 'all' ? 'var(--s-gold)' : 'transparent',
          color: view === 'all' ? '#000' : 'var(--s-text-dim)',
        }}>
        Vue match complet
      </button>
    </div>
  );
}

// Bloc de stats — utilisé à la fois pour le replay courant et pour la section
// agrégée du match. Le `mode` ne contrôle que la ligne TEAM ici, mais
// AggregatedSection le passe à ses propres aggregateByPlayer.
// Clés des 5 sections collapsibles d'un StatsBlock.
type SectionKey = 'core' | 'boost' | 'movement' | 'positioning' | 'demos';
// Default : seule la section Core est dépliée pour limiter le scroll.
const DEFAULT_SECTIONS_OPEN: Record<SectionKey, boolean> = {
  core: true, boost: false, movement: false, positioning: false, demos: false,
};

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

  const [open, setOpen] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS_OPEN);
  const toggleSection = (k: SectionKey) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const expandAll = () => setOpen({ core: true, boost: true, movement: true, positioning: true, demos: true });
  const collapseAll = () => setOpen({ core: false, boost: false, movement: false, positioning: false, demos: false });

  // Résumés en mode replié — formulés courts, sur 1 ligne, pour qu'on capte
  // l'essentiel sans déplier. Tous calculés depuis les agrégats équipe.
  const mvp = stats.players.find(p => p.mvp);
  const summaries: Record<SectionKey, string> = {
    core: `Score : ${stats.blueGoals}-${stats.orangeGoals}${mvp ? ` · MVP : ${mvp.name}` : ''}`,
    boost: teamAggBlue.boost && teamAggOrange.boost
      ? `BPM moy. : ${stats.blueName} ${fmtNum(teamAggBlue.boost.bpm)} · ${stats.orangeName} ${fmtNum(teamAggOrange.boost.bpm)}`
      : '—',
    movement: teamAggBlue.movement && teamAggOrange.movement
      ? `Vitesse moy. : ${stats.blueName} ${fmtNum(teamAggBlue.movement.avgSpeed)} · ${stats.orangeName} ${fmtNum(teamAggOrange.movement.avgSpeed)} km/h`
      : '—',
    positioning: teamAggBlue.positioning && teamAggOrange.positioning
      ? `% derrière balle : ${stats.blueName} ${fmtPct(teamAggBlue.positioning.percentBehindBall)} · ${stats.orangeName} ${fmtPct(teamAggOrange.positioning.percentBehindBall)}`
      : '—',
    demos: teamAggBlue.demo && teamAggOrange.demo
      ? `Demos infligés : ${stats.blueName} ${fmtNum(teamAggBlue.demo.inflicted)} · ${stats.orangeName} ${fmtNum(teamAggOrange.demo.inflicted)}`
      : '—',
  };

  const hasBoost = stats.players.some(p => p.boost);
  const hasMovement = stats.players.some(p => p.movement);
  const hasPositioning = stats.players.some(p => p.positioning);
  const hasDemos = stats.players.some(p => p.demo);

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
        <div className="flex items-center gap-2 flex-wrap">
          {modeToggle}
          <div className="inline-flex bevel-sm overflow-hidden" style={{ border: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
            <button type="button" onClick={expandAll}
              title="Tout déplier"
              className="px-2 py-1.5 text-xs flex items-center gap-1 transition-colors hover:bg-[var(--s-hover)]"
              style={{ color: 'var(--s-text-dim)' }}>
              <Maximize2 size={11} />
            </button>
            <button type="button" onClick={collapseAll}
              title="Tout replier"
              className="px-2 py-1.5 text-xs flex items-center gap-1 transition-colors hover:bg-[var(--s-hover)]"
              style={{ color: 'var(--s-text-dim)', borderLeft: '1px solid var(--s-border)' }}>
              <Minimize2 size={11} />
            </button>
          </div>
        </div>
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

      <Section icon={<Trophy size={14} />} title="CORE" summary={summaries.core} open={open.core} onToggle={() => toggleSection('core')}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <CoreTable label={stats.blueName} accent="#0081FF" players={blue} teamRow={teamAggBlue} />
          <CoreTable label={stats.orangeName} accent="#FFB800" players={orange} teamRow={teamAggOrange} />
        </div>
      </Section>

      {hasBoost && (
        <Section icon={<Zap size={14} />} title="BOOST" summary={summaries.boost} open={open.boost} onToggle={() => toggleSection('boost')}>
          <BoostTable players={stats.players} teamRows={[teamAggBlue, teamAggOrange]} />
        </Section>
      )}

      {hasMovement && (
        <Section icon={<Gauge size={14} />} title="MOUVEMENT" summary={summaries.movement} open={open.movement} onToggle={() => toggleSection('movement')}>
          <MovementTable players={stats.players} teamRows={[teamAggBlue, teamAggOrange]} />
        </Section>
      )}

      {hasPositioning && (
        <Section icon={<MapPin size={14} />} title="POSITIONNEMENT" summary={summaries.positioning} open={open.positioning} onToggle={() => toggleSection('positioning')}>
          <PositioningTable players={stats.players} teamRows={[teamAggBlue, teamAggOrange]} />
        </Section>
      )}

      {hasDemos && (
        <Section icon={<Skull size={14} />} title="DEMOS" summary={summaries.demos} open={open.demos} onToggle={() => toggleSection('demos')}>
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
// Exportée pour réutilisation dans la page dédiée /community/event/[id]/stats.
export function AggregatedSection({ aggregated }: { aggregated: AggResponse }) {
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

function Section({
  icon, title, summary, open, onToggle, children,
}: {
  icon: React.ReactNode;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="bevel-sm" style={{ border: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--s-hover)]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: 'var(--s-gold)' }}>{icon}</span>
          <span className="t-label" style={{ color: 'var(--s-text)' }}>{title}</span>
          {!open && summary && (
            <span className="text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
              <span className="mx-2" style={{ opacity: 0.5 }}>·</span>
              {summary}
            </span>
          )}
        </div>
        <span style={{ color: 'var(--s-text-dim)' }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1">
          {children}
        </div>
      )}
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
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--s-text-muted)' }}>
            <th className="text-left pb-1 font-normal">Joueur</th>
            <th className="text-right pb-1 font-normal" title="Score"><Trophy size={12} className="inline" /></th>
            <th className="text-right pb-1 font-normal" title="Buts"><Target size={12} className="inline" /></th>
            <th className="text-right pb-1 font-normal" title="Passes">A</th>
            <th className="text-right pb-1 font-normal" title="Arrêts"><Hand size={12} className="inline" /></th>
            <th className="text-right pb-1 font-normal" title="Tirs"><Crosshair size={12} className="inline" /></th>
            <th className="text-right pb-1 font-normal" title="% tir">%</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, idx) => (
            <tr key={`${p.platform}-${p.platformId}-${idx}`} style={{ color: 'var(--s-text)' }}>
              <td className="py-2 truncate max-w-[160px]">
                <span style={{ color: p.mvp ? 'var(--s-gold)' : 'var(--s-text)' }}>{p.name}</span>
                {p.mvp && <span className="ml-1 t-label" style={{ color: 'var(--s-gold)' }}>MVP</span>}
              </td>
              <td className="text-right py-2 t-mono">{fmtNum(p.score)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.goals)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.assists)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.saves)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.shots)}</td>
              <td className="text-right py-2 t-mono" style={{ color: 'var(--s-text-muted)' }}>
                {typeof p.shootingPct === 'number' ? Math.round(p.shootingPct) : '—'}
              </td>
            </tr>
          ))}
          {teamRow && (
            <tr style={{ ...TEAM_ROW_STYLE, color: accent }}>
              <td className="py-2.5 t-label">TEAM</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(teamRow.score)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(teamRow.goals)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(teamRow.assists)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(teamRow.saves)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(teamRow.shots)}</td>
              <td className="text-right py-2.5 t-mono">{typeof teamRow.shootingPct === 'number' ? Math.round(teamRow.shootingPct) : '—'}</td>
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
      <table className="w-full text-sm">
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
              <td className="py-2 truncate max-w-[160px]" style={{ color: teamColor(p.team) }}>{p.name}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.boost.bpm)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.boost.bcpm)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.boost.avgAmount)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.boost.amountStolen)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.boost.amountCollectedBig)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.boost.amountCollectedSmall)}</td>
              <td className="text-right py-2 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.boost.percentZeroBoost)}</td>
              <td className="text-right py-2 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.boost.percentFullBoost)}</td>
            </tr>
          ) : null)}
          {teamRows?.map((t, i) => t.boost ? (
            <tr key={`team-${i}`} style={{ ...TEAM_ROW_STYLE, color: teamColor(t.team) }}>
              <td className="py-2.5 t-label">{t.name}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.boost.bpm)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.boost.bcpm)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.boost.avgAmount)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.boost.amountStolen)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.boost.amountCollectedBig)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.boost.amountCollectedSmall)}</td>
              <td className="text-right py-2.5 t-mono">{fmtPct(t.boost.percentZeroBoost)}</td>
              <td className="text-right py-2.5 t-mono">{fmtPct(t.boost.percentFullBoost)}</td>
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
      <table className="w-full text-sm">
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
              <td className="py-2 truncate max-w-[160px]" style={{ color: teamColor(p.team) }}>{p.name}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.movement.avgSpeed)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.movement.totalDistance / 1000, 1)}k</td>
              <td className="text-right py-2 t-mono">{fmtTime(p.movement.timeSupersonic)}</td>
              <td className="text-right py-2 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.movement.percentSupersonic)}</td>
              <td className="text-right py-2 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.movement.percentGround)}</td>
              <td className="text-right py-2 t-mono">{p.movement.powerslideCount}</td>
            </tr>
          ) : null)}
          {teamRows?.map((t, i) => t.movement ? (
            <tr key={`team-${i}`} style={{ ...TEAM_ROW_STYLE, color: teamColor(t.team) }}>
              <td className="py-2.5 t-label">{t.name}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.movement.avgSpeed)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.movement.totalDistance / 1000, 1)}k</td>
              <td className="text-right py-2.5 t-mono">{fmtTime(t.movement.timeSupersonic)}</td>
              <td className="text-right py-2.5 t-mono">{fmtPct(t.movement.percentSupersonic)}</td>
              <td className="text-right py-2.5 t-mono">{fmtPct(t.movement.percentGround)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.movement.powerslideCount)}</td>
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
      <table className="w-full text-sm">
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
              <td className="py-2 truncate max-w-[160px]" style={{ color: teamColor(p.team) }}>{p.name}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.positioning.avgDistanceToBall)}</td>
              <td className="text-right py-2 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.positioning.percentDefensiveHalf)}</td>
              <td className="text-right py-2 t-mono" style={{ color: 'var(--s-text-muted)' }}>{fmtPct(p.positioning.percentBehindBall)}</td>
              <td className="text-right py-2 t-mono">{fmtTime(p.positioning.timeMostBack)}</td>
              <td className="text-right py-2 t-mono">{fmtTime(p.positioning.timeMostForward)}</td>
            </tr>
          ) : null)}
          {teamRows?.map((t, i) => t.positioning ? (
            <tr key={`team-${i}`} style={{ ...TEAM_ROW_STYLE, color: teamColor(t.team) }}>
              <td className="py-2.5 t-label">{t.name}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.positioning.avgDistanceToBall)}</td>
              <td className="text-right py-2.5 t-mono">{fmtPct(t.positioning.percentDefensiveHalf)}</td>
              <td className="text-right py-2.5 t-mono">{fmtPct(t.positioning.percentBehindBall)}</td>
              <td className="text-right py-2.5 t-mono">{fmtTime(t.positioning.timeMostBack)}</td>
              <td className="text-right py-2.5 t-mono">{fmtTime(t.positioning.timeMostForward)}</td>
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
      <table className="w-full text-sm">
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
              <td className="py-2 truncate max-w-[160px]" style={{ color: teamColor(p.team) }}>{p.name}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.demo.inflicted)}</td>
              <td className="text-right py-2 t-mono">{fmtNum(p.demo.taken)}</td>
            </tr>
          ) : null)}
          {teamRows?.map((t, i) => t.demo ? (
            <tr key={`team-${i}`} style={{ ...TEAM_ROW_STYLE, color: teamColor(t.team) }}>
              <td className="py-2.5 t-label">{t.name}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.demo.inflicted)}</td>
              <td className="text-right py-2.5 t-mono">{fmtNum(t.demo.taken)}</td>
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
