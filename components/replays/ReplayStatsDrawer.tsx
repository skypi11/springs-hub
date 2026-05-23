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
  // Mode "single" = juste le replay courant. Mode "all" = empilage de tous
  // les replays parsés + moyenne. Default = 'single' : le drawer est pour la
  // consultation rapide d'UN replay (clic sur son bouton stats). La vue
  // match complet est dispo via le toggle, ou via le bouton "Stats du match"
  // qui ouvre la page dédiée /community/event/[id]/stats dans un nouvel onglet.
  const hasMultipleParsed = !!aggregated && aggregated.parsedCount >= 2;
  const [view, setView] = useState<'single' | 'all'>('single');

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
        <TwoTeamTables
          blueLabel={stats.blueName} orangeLabel={stats.orangeName}
          blue={blue} orange={orange}
          teamRowBlue={teamAggBlue} teamRowOrange={teamAggOrange}
          columns={COLUMNS_CORE}
        />
      </Section>

      {hasBoost && (
        <Section icon={<Zap size={14} />} title="BOOST" summary={summaries.boost} open={open.boost} onToggle={() => toggleSection('boost')}>
          <TwoTeamTables
            blueLabel={stats.blueName} orangeLabel={stats.orangeName}
            blue={blue} orange={orange}
            teamRowBlue={teamAggBlue} teamRowOrange={teamAggOrange}
            columns={COLUMNS_BOOST}
          />
        </Section>
      )}

      {hasMovement && (
        <Section icon={<Gauge size={14} />} title="MOUVEMENT" summary={summaries.movement} open={open.movement} onToggle={() => toggleSection('movement')}>
          <TwoTeamTables
            blueLabel={stats.blueName} orangeLabel={stats.orangeName}
            blue={blue} orange={orange}
            teamRowBlue={teamAggBlue} teamRowOrange={teamAggOrange}
            columns={COLUMNS_MOVEMENT}
          />
        </Section>
      )}

      {hasPositioning && (
        <Section icon={<MapPin size={14} />} title="POSITIONNEMENT" summary={summaries.positioning} open={open.positioning} onToggle={() => toggleSection('positioning')}>
          <TwoTeamTables
            blueLabel={stats.blueName} orangeLabel={stats.orangeName}
            blue={blue} orange={orange}
            teamRowBlue={teamAggBlue} teamRowOrange={teamAggOrange}
            columns={COLUMNS_POSITIONING}
          />
        </Section>
      )}

      {hasDemos && (
        <Section icon={<Skull size={14} />} title="DEMOS" summary={summaries.demos} open={open.demos} onToggle={() => toggleSection('demos')}>
          <TwoTeamTables
            blueLabel={stats.blueName} orangeLabel={stats.orangeName}
            blue={blue} orange={orange}
            teamRowBlue={teamAggBlue} teamRowOrange={teamAggOrange}
            columns={COLUMNS_DEMOS}
          />
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

// Style des lignes TEAM en bas des tables. Couleur d'accent appliquée dynamiquement.
const TEAM_ROW_STYLE: React.CSSProperties = {
  borderTop: '2px solid var(--s-border)',
  background: 'var(--s-elevated)',
  fontWeight: 600,
};

// ── Système unifié de table de stats ──────────────────────────────────────
// Une colonne décrit son label/title, son accessor (lit la valeur du joueur),
// son renderer (formate l'affichage), et `better: 'high'|'low'|null` (pour
// l'étoile best au sein de l'équipe).

interface ColDef {
  label: React.ReactNode;
  title?: string;
  accessor: (p: PlayerStats) => number | undefined;
  render: (v: number | undefined) => React.ReactNode;
  better: 'high' | 'low' | null; // null = pas de comparatif (ex: nom)
  bar?: 'pct'; // mini-barre 0-100% si défini
  muted?: boolean;
}

const COLUMNS_CORE: ColDef[] = [
  { label: <Trophy size={12} className="inline" />, title: 'Score', accessor: p => p.score, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: <Target size={12} className="inline" />, title: 'Buts', accessor: p => p.goals, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: 'A', title: 'Passes', accessor: p => p.assists, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: <Hand size={12} className="inline" />, title: 'Arrêts', accessor: p => p.saves, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: <Crosshair size={12} className="inline" />, title: 'Tirs', accessor: p => p.shots, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: '%', title: '% de tir cadré', accessor: p => p.shootingPct, render: v => typeof v === 'number' ? `${Math.round(v)}` : '—', better: 'high', muted: true, bar: 'pct' },
];

const COLUMNS_BOOST: ColDef[] = [
  { label: 'BPM', title: 'Boost per minute', accessor: p => p.boost?.bpm, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: 'BCPM', title: 'Boost collecté par minute', accessor: p => p.boost?.bcpm, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: 'Avg', title: 'Boost moyen', accessor: p => p.boost?.avgAmount, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: 'Volé', title: 'Boost volé à l\'adversaire', accessor: p => p.boost?.amountStolen, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: 'Big', title: 'Gros pads collectés', accessor: p => p.boost?.amountCollectedBig, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: 'Sm', title: 'Petits pads collectés', accessor: p => p.boost?.amountCollectedSmall, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: '%0', title: '% du temps à 0 boost (low = mieux)', accessor: p => p.boost?.percentZeroBoost, render: v => fmtPct(v), better: 'low', muted: true, bar: 'pct' },
  { label: '%100', title: '% du temps à 100 boost (low = mieux, signe de greedy)', accessor: p => p.boost?.percentFullBoost, render: v => fmtPct(v), better: 'low', muted: true, bar: 'pct' },
];

const COLUMNS_MOVEMENT: ColDef[] = [
  { label: 'Avg km/h', title: 'Vitesse moyenne', accessor: p => p.movement?.avgSpeed, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: 'Dist', title: 'Distance parcourue totale', accessor: p => p.movement?.totalDistance, render: v => `${fmtNum((v ?? 0) / 1000, 1)}k`, better: 'high' },
  { label: 'Super', title: 'Temps passé en supersonic', accessor: p => p.movement?.timeSupersonic, render: v => fmtTime(v ?? 0), better: 'high' },
  { label: '%SS', title: '% du temps en supersonic', accessor: p => p.movement?.percentSupersonic, render: v => fmtPct(v), better: 'high', muted: true, bar: 'pct' },
  { label: '%Sol', title: '% du temps au sol', accessor: p => p.movement?.percentGround, render: v => fmtPct(v), better: null, muted: true, bar: 'pct' },
  { label: 'PS', title: 'Nombre de powerslides', accessor: p => p.movement?.powerslideCount, render: v => fmtNum(v ?? 0), better: 'high' },
];

const COLUMNS_POSITIONING: ColDef[] = [
  { label: 'Dist balle', title: 'Distance moyenne à la balle', accessor: p => p.positioning?.avgDistanceToBall, render: v => fmtNum(v ?? 0), better: null },
  { label: '%Déf', title: '% du temps en moitié défensive', accessor: p => p.positioning?.percentDefensiveHalf, render: v => fmtPct(v), better: null, muted: true, bar: 'pct' },
  { label: '%Behind', title: '% du temps derrière la balle', accessor: p => p.positioning?.percentBehindBall, render: v => fmtPct(v), better: null, muted: true, bar: 'pct' },
  { label: 'Most back', title: 'Temps en tant que dernier défenseur', accessor: p => p.positioning?.timeMostBack, render: v => fmtTime(v ?? 0), better: null },
  { label: 'Most fwd', title: 'Temps en tant que plus avancé', accessor: p => p.positioning?.timeMostForward, render: v => fmtTime(v ?? 0), better: null },
];

const COLUMNS_DEMOS: ColDef[] = [
  { label: 'Infligés', title: 'Demos infligés', accessor: p => p.demo?.inflicted, render: v => fmtNum(v ?? 0), better: 'high' },
  { label: 'Subis', title: 'Demos subis (low = mieux)', accessor: p => p.demo?.taken, render: v => fmtNum(v ?? 0), better: 'low' },
];

// ── Sub-table par équipe ─────────────────────────────────────────────────
// Affiche les joueurs d'UNE équipe + sa ligne TEAM en bas. Header sépare le
// nom de l'équipe en t-label de couleur accent. Lignes joueur ont un fond
// très subtil de la couleur de l'équipe (cohérence visuelle).
function TeamSubTable({
  label,
  accent,
  players,
  teamRow,
  columns,
  showName = true,
}: {
  label: string;
  accent: string;
  players: PlayerStats[];
  teamRow?: PlayerStats;
  columns: ColDef[];
  showName?: boolean;
}) {
  // Pour chaque colonne, on calcule l'index du meilleur joueur (selon better:
  // 'high'/'low') au sein de CETTE équipe — l'étoile signale le standout local.
  const bestIndexByCol: Record<number, number | null> = useMemo(() => {
    const out: Record<number, number | null> = {};
    columns.forEach((col, ci) => {
      if (!col.better || players.length === 0) { out[ci] = null; return; }
      let bestI = -1;
      let bestV = col.better === 'high' ? -Infinity : Infinity;
      players.forEach((p, pi) => {
        const v = col.accessor(p);
        if (typeof v !== 'number') return;
        if (col.better === 'high' && v > bestV) { bestV = v; bestI = pi; }
        if (col.better === 'low' && v < bestV) { bestV = v; bestI = pi; }
      });
      out[ci] = bestI >= 0 ? bestI : null;
    });
    return out;
  }, [players, columns]);

  // Bg subtil par équipe sur les lignes joueur — renforce l'identité visuelle
  // sans nuire à la lisibilité (alpha 04).
  const rowBg = accent + '08';

  return (
    <div className="bevel-sm overflow-hidden" style={{ background: 'var(--s-surface)', border: `1px solid ${accent}40` }}>
      {showName && (
        <div className="px-3 py-2 t-label flex items-center gap-2" style={{ color: accent, background: accent + '10', borderBottom: `1px solid ${accent}30` }}>
          <span style={{ width: 8, height: 8, background: accent, borderRadius: '50%' }} />
          {label}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--s-text-muted)' }}>
              <th className="text-left pb-1 px-3 pt-2 font-normal">Joueur</th>
              {columns.map((c, i) => (
                <th key={i} className="text-right pb-1 pt-2 px-2 font-normal whitespace-nowrap" title={c.title}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p, pi) => (
              <tr key={`${p.platform}-${p.platformId}-${pi}`}
                style={{ color: 'var(--s-text)', background: rowBg, borderTop: '1px solid var(--s-border)' }}>
                <td className="py-2 px-3 truncate max-w-[200px]">
                  <span style={{ color: p.mvp ? 'var(--s-gold)' : 'var(--s-text)' }}>{p.name}</span>
                  {p.mvp && <span className="ml-1 t-label" style={{ color: 'var(--s-gold)' }}>MVP</span>}
                </td>
                {columns.map((col, ci) => (
                  <StatCell key={ci} value={col.accessor(p)} col={col} isBest={bestIndexByCol[ci] === pi} accent={accent} />
                ))}
              </tr>
            ))}
            {teamRow && (
              <tr style={{ ...TEAM_ROW_STYLE, color: accent }}>
                <td className="py-2.5 px-3 t-label">TEAM</td>
                {columns.map((col, ci) => (
                  <td key={ci} className="text-right py-2.5 px-2 t-mono whitespace-nowrap">
                    {col.render(col.accessor(teamRow))}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Cellule de valeur avec étoile (best) et mini-barre (si col.bar='pct').
function StatCell({ value, col, isBest, accent }: { value: number | undefined; col: ColDef; isBest: boolean; accent: string }) {
  const display = col.render(value);
  const showBar = col.bar === 'pct' && typeof value === 'number';
  const pctValue = showBar ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <td className="text-right py-2 px-2 t-mono whitespace-nowrap" style={{ color: col.muted && !isBest ? 'var(--s-text-muted)' : undefined }}>
      <div className="flex items-center justify-end gap-1">
        {isBest && (
          <span title="Top du joueur dans cette équipe" style={{ color: 'var(--s-gold)', fontSize: 10, lineHeight: 1 }}>★</span>
        )}
        <span style={isBest ? { color: 'var(--s-gold)', fontWeight: 600 } : undefined}>{display}</span>
      </div>
      {showBar && (
        <div style={{ height: 2, background: 'var(--s-border)', marginTop: 2, marginLeft: 'auto', width: '60px' }}>
          <div style={{ height: '100%', width: `${pctValue}%`, background: accent, opacity: 0.7 }} />
        </div>
      )}
    </td>
  );
}

// Wrapper haut niveau : rend Blue + Orange côte à côte avec leur sub-table.
function TwoTeamTables({
  blueLabel, orangeLabel, blue, orange, teamRowBlue, teamRowOrange, columns,
}: {
  blueLabel: string; orangeLabel: string;
  blue: PlayerStats[]; orange: PlayerStats[];
  teamRowBlue?: PlayerStats; teamRowOrange?: PlayerStats;
  columns: ColDef[];
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <TeamSubTable label={blueLabel} accent="#0081FF" players={blue} teamRow={teamRowBlue} columns={columns} />
      <TeamSubTable label={orangeLabel} accent="#FFB800" players={orange} teamRow={teamRowOrange} columns={columns} />
    </div>
  );
}

function teamColor(team: 'blue' | 'orange'): string {
  return team === 'blue' ? '#0081FF' : '#FFB800';
}
