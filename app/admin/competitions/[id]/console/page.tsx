'use client';

// CONSOLE LIVE ADMIN — « Le Dossier ouvert » (spec panel design 12/07).
// Le jour de match est un dossier ouvert sur la table de l'admin : une BARRE
// DE SITUATION sticky (l'état du jour en 2 secondes au retour d'alt-tab), UN
// héros lifted « À trancher » (litiges, forfaits, titre — le seul or de
// l'écran), les phases en puits recessés avec rangées denses à colonnes
// fixes, la périphérie (équipes) en quiet. Les matchs terminés se replient.
//
// REGISTRE COULEUR (règle codée) :
// - OR = « une décision admin est requise » : compteur « À trancher » de la
//   barre + intérieur de la zone héros. Zéro décision ⇒ zéro pixel d'or.
// - BLEU (--s-blue) = ça joue (live/awaiting_scores, compteur « En jeu »,
//   chiffre vainqueur de manche).
// - NEUTRE = on attend les joueurs. VERT = fait. DIM = archive.

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import TeamCrest from '@/components/competitions/TeamCrest';
import GlanceStat from '@/components/competitions/GlanceStat';
import GameRow from '@/components/competitions/GameRow';
import TournamentBracket from '@/components/competitions/TournamentBracket';
import { useWorkerInterval } from '@/components/competitions/useWorkerInterval';
import { winsOf, normalizeGameRows, isScoreValid, winsNeeded } from '@/lib/competitions/match-score';
import type { PublicBracketMatch } from '@/lib/competitions/brackets-viewer-adapter';
import { getGameColor } from '@/lib/games-registry';
import { ChevronDown, ChevronLeft, Copy, GripVertical, Radio } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Game { a: number; b: number }
type Side = { name: string; tag: string; logoUrl: string | null } | null;

interface ConsoleMatch {
  id: string;
  bracket: string;
  round: number;
  slot: number;
  phase: number | null;
  bo: number;
  status: string;
  teamA: string | null;
  teamB: string | null;
  voidA: boolean;
  voidB: boolean;
  teamAInfo: Side;
  teamBInfo: Side;
  sourceA: { type: string; ref: number | string | null } | null;
  sourceB: { type: string; ref: number | string | null } | null;
  roomHost: 'a' | 'b';
  checkin: { deadline: string | null; a: { done: boolean }; b: { done: boolean } } | null;
  scores: { a: Game[]; b: Game[]; counterDeadline: string | null; final: Game[] | null; validatedBy: string | null };
  dispute: { openedBy: string; auto: boolean; resolvedBy: string | null } | null;
  forfeit: { team: 'a' | 'b' | 'both'; reason: string | null } | null;
  cast: { featured: boolean; streamUrl: string | null } | null;
  winner: 'a' | 'b' | null;
}

interface ConsoleRegistration {
  registrationId: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  status: 'approved' | 'waitlisted' | 'withdrawn';
  seed: number | null;
  generalCheckin: { done: boolean; at: string | null } | null;
}

interface TiebreakGroup {
  group: string;
  teams: Array<{ registrationId: string; tied: boolean; goalDiff: number; goalsFor: number }>;
}

interface FinalPlacementRow {
  registrationId: string; name: string; tag: string;
  placement: number; points: number | null; goalDiff: number; goalsFor: number;
}

interface ConsoleData {
  competition: {
    id: string; name: string; status: string;
    game: string;
    phasePlan: Array<{ phase: number; day: number; label: string }>;
    checkinMinutes: number;
    generalCheckinMinutes: number;
    withdrawn: string[];
  };
  matches: ConsoleMatch[];
  rooms: Record<string, { name: string; password: string }>;
  registrations: ConsoleRegistration[];
  finished: boolean;
  needsAdminDecision: boolean;
  placements: Array<{ registrationId: string; placement: number | null; group: string }> | null;
  unresolvedTiebreaks: TiebreakGroup[];
  finalPlacements: FinalPlacementRow[] | null;
}

const STATUS_FR: Record<string, string> = {
  pending: 'À venir',
  checkin: 'Check-in',
  ready: 'Prêt',
  live: 'En cours',
  awaiting_scores: 'Attente scores',
  score_review: 'Contre-saisie',
  disputed: 'Litige',
  awaiting_forfeit_validation: 'Décision requise',
  completed: 'Terminé',
  walkover: "Qualifié d'office",
  cancelled: 'Non joué',
};

const COMP_STATUS_FR: Record<string, string> = {
  draft: 'Brouillon',
  registration: 'Inscriptions',
  validation: 'Validation',
  seeding: 'Seeding',
  live: 'En cours',
  finished: 'Terminée',
  archived: 'Archivée',
};

// Dots : bleu = ça joue ; blanc plein = décision (le héros porte l'alarme,
// pas l'or) ; vert = terminé ; neutre = attente/archive.
const STATUS_DOT: Record<string, string> = {
  live: 'var(--s-blue)',
  awaiting_scores: 'var(--s-blue)',
  disputed: 'var(--s-text)',
  awaiting_forfeit_validation: 'var(--s-text)',
  completed: 'var(--s-green)',
};

const EN_JEU = new Set(['checkin', 'ready', 'live', 'awaiting_scores', 'score_review']);
const TERMINAL = new Set(['completed', 'walkover', 'cancelled']);

const disputeOpen = (m: ConsoleMatch) => !!m.dispute && m.dispute.resolvedBy === null;
const isDecision = (m: ConsoleMatch) => disputeOpen(m) || m.status === 'awaiting_forfeit_validation';
const nameOf = (m: ConsoleMatch, side: 'a' | 'b') => {
  const info = side === 'a' ? m.teamAInfo : m.teamBInfo;
  const isVoid = side === 'a' ? m.voidA : m.voidB;
  if (isVoid) return 'BYE';
  return info?.name ?? 'À déterminer';
};
const matchOrder = (a: ConsoleMatch, b: ConsoleMatch) => {
  const rank: Record<string, number> = { winners: 0, losers: 1, grand_final: 2 };
  return (rank[a.bracket] ?? 3) - (rank[b.bracket] ?? 3) || a.round - b.round || a.slot - b.slot;
};
// Décompte vivant (check-in, contre-saisie) — l'horloge vit dans un effet
// (règle react-hooks/purity, même pattern que useCountdown de la page match).
// Registre neutre : JAMAIS d'or dans la console hors « À trancher ».
function ConsoleCountdown({ deadline, label }: { deadline: string | null; label: string }) {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- abonnement à l'horloge
       (système externe) : valeur immédiate puis tick 1 s. */
    if (!deadline) { setMs(null); return; }
    const target = Date.parse(deadline);
    if (Number.isNaN(target)) { setMs(null); return; }
    const update = () => setMs(Math.max(0, target - Date.now()));
    update();
    /* eslint-enable react-hooks/set-state-in-effect */
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (ms === null) return null;
  const s = Math.floor(ms / 1000);
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="t-label-soft" style={{ color: 'var(--s-text-muted)' }}>{label}</span>
      <span className="t-mono" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--s-text)' }}>
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      </span>
    </span>
  );
}

export default function CompetitionConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { firebaseUser, isAdmin, isCompetitionAdmin } = useAuth();
  const authorized = isAdmin || isCompetitionAdmin;
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<ConsoleData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [phaseOverride, setPhaseOverride] = useState<Map<string, boolean>>(new Map());
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [forceScoreFor, setForceScoreFor] = useState<ConsoleMatch | null>(null);
  const [forfeitFor, setForfeitFor] = useState<{ m: ConsoleMatch; preset?: 'a' | 'b' | 'both' } | null>(null);
  const [castFor, setCastFor] = useState<ConsoleMatch | null>(null);
  const [replaceFor, setReplaceFor] = useState<ConsoleRegistration | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [bracketOpen, setBracketOpen] = useState(true);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<ConsoleData>(`/api/admin/competitions/${id}/console`);
      setData(d);
    } catch { /* blip réseau : on garde le dernier état */ }
  }, [id]);

  const active = !!firebaseUser && authorized;
  useEffect(() => {
    if (active) load();
  }, [active, load]);
  // Cadence via Web Worker (archi §5) : le polling ET le tick des échéances
  // continuent à pleine vitesse quand l'admin est alt-tabbé (Discord, stream) —
  // un setInterval du thread principal serait étranglé à 1/min en arrière-plan.
  useWorkerInterval(load, 10_000, active);
  useWorkerInterval(() => {
    api(`/api/competitions/${id}/tick`, { method: 'POST' }).catch(() => null);
  }, 30_000, active);

  async function action(body: Record<string, unknown>, okMsg: string) {
    setBusy(String(body.action));
    try {
      await api(`/api/admin/competitions/${id}/console`, { method: 'POST', body });
      toast.success(okMsg);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Action impossible.');
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  }

  const phases = useMemo(() => {
    if (!data) return [];
    const byPhase = new Map<number | null, ConsoleMatch[]>();
    for (const m of data.matches) {
      const k = m.phase;
      if (!byPhase.has(k)) byPhase.set(k, []);
      byPhase.get(k)!.push(m);
    }
    const list = (data.competition.phasePlan ?? [])
      .map(p => ({ phase: p.phase as number | null, label: p.label, matches: (byPhase.get(p.phase) ?? []).sort(matchOrder) }))
      .filter(p => p.matches.length > 0);
    const rest = byPhase.get(null);
    if (rest && rest.length > 0) list.push({ phase: null, label: 'Hors plan', matches: rest.sort(matchOrder) });
    return list;
  }, [data]);

  const decisions = useMemo(() => {
    if (!data) return [] as Array<{ kind: 'title' | 'dispute' | 'forfeit'; m: ConsoleMatch | null }>;
    const out: Array<{ kind: 'title' | 'dispute' | 'forfeit'; m: ConsoleMatch | null }> = [];
    if (data.needsAdminDecision) out.push({ kind: 'title', m: null });
    const sorted = [...data.matches].sort(matchOrder);
    for (const m of sorted) if (disputeOpen(m)) out.push({ kind: 'dispute', m });
    for (const m of sorted) if (m.status === 'awaiting_forfeit_validation') out.push({ kind: 'forfeit', m });
    return out;
  }, [data]);

  // Matchs du bracket (PublicBracketMatch) dérivés des matchs console — même
  // topologie + sources ; le viewer déduplique ses re-renders par JSON.
  const bracketMatches = useMemo<PublicBracketMatch[]>(() => (data?.matches ?? []).map(m => ({
    id: m.id,
    bracket: m.bracket as 'winners' | 'losers' | 'grand_final',
    round: m.round, slot: m.slot, bo: m.bo,
    teamA: m.teamA, teamB: m.teamB, voidA: m.voidA, voidB: m.voidB,
    teamAInfo: m.teamAInfo, teamBInfo: m.teamBInfo,
    // Sources du serveur = union discriminée conforme au runtime (produites par
    // l'adaptateur) ; le type transporté est large → cast au point de mapping.
    sourceA: (m.sourceA ?? undefined) as PublicBracketMatch['sourceA'],
    sourceB: (m.sourceB ?? undefined) as PublicBracketMatch['sourceB'],
    status: m.status, winner: m.winner,
    scores: m.scores.final ? { final: m.scores.final } : { final: null },
    forfeit: m.forfeit ? { team: m.forfeit.team } : null,
    cast: m.cast,
  })), [data?.matches]);

  // Défilement doux vers le panneau de détail à la sélection d'un match.
  useEffect(() => {
    if (selectedMatchId) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedMatchId]);

  if (!firebaseUser || !authorized) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Console réservée aux admins de compétition.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="animate-pulse" style={{ height: 64, background: 'var(--s-elevated)' }} />
        <div className="animate-pulse" style={{ height: 96, background: 'var(--s-elevated)' }} />
        <div className="animate-pulse" style={{ height: 240, background: 'var(--s-elevated)' }} />
        <div className="animate-pulse" style={{ height: 240, background: 'var(--s-elevated)' }} />
      </div>
    );
  }

  const approved = data.registrations.filter(r => r.status === 'approved');
  const waitlisted = data.registrations.filter(r => r.status === 'waitlisted');
  const withdrawn = data.registrations.filter(r => r.status === 'withdrawn');
  const generalOpened = approved.some(r => r.generalCheckin !== null);
  const confirmed = approved.filter(r => r.generalCheckin?.done);
  const missing = approved.filter(r => r.generalCheckin && !r.generalCheckin.done);
  const enJeuCount = data.matches.filter(m => EN_JEU.has(m.status)).length;
  const doneCount = data.matches.filter(m => TERMINAL.has(m.status)).length;
  const livePhase = phases.find(p => p.matches.some(m => EN_JEU.has(m.status) || isDecision(m)));
  // Match sélectionné dans le bracket — relu FRAIS à chaque poll (statut à jour).
  const selectedMatch = selectedMatchId ? data.matches.find(m => m.id === selectedMatchId) ?? null : null;

  const scrollToId = (anchor: string) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
  };

  const launchMatches = async (ms: ConsoleMatch[], label: string) => {
    const ok = await confirm({
      title: ms.length === 1 ? `Lancer ${nameOf(ms[0], 'a')} vs ${nameOf(ms[0], 'b')}` : `Lancer ${ms.length} matchs`,
      message: `Check-in de ${data.competition.checkinMinutes} min ouvert, rooms générées, équipes notifiées (in-app + Discord).`,
      confirmLabel: 'Lancer',
    });
    if (ok) action({ action: 'launch_phase', matchIds: ms.map(m => m.id) }, label);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <Link href="/admin/competitions" className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            <ChevronLeft size={15} /> Compétitions
          </Link>
          <h1 className="font-display text-3xl truncate" style={{ letterSpacing: '0.03em' }}>
            CONSOLE — {data.competition.name.toUpperCase()}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="tag tag-neutral">{COMP_STATUS_FR[data.competition.status] ?? data.competition.status}</span>
          <button className="btn-springs btn-secondary bevel-sm text-sm" disabled={busy !== null}
            onClick={async () => {
              setBusy('tick');
              try {
                const r = await api<{ processed: unknown[] }>(`/api/competitions/${id}/tick`, { method: 'POST' });
                toast.info(r.processed.length > 0 ? `${r.processed.length} échéance(s) appliquée(s).` : 'Rien à appliquer.');
                await load();
              } catch { toast.error('Échéances impossibles à forcer.'); } finally { setBusy(null); }
            }}>
            Forcer les échéances
          </button>
        </div>
      </div>

      {/* Barre de situation — sticky (inline : .hex-bg > * force relative) */}
      <div className="con-bar bevel-sm" style={{ position: 'sticky', top: 0 }}>
        <BarButton onClick={() => livePhase && scrollToId(`phase-${livePhase.phase}`)}>
          <GlanceStat label="Phase en cours" size={20}
            value={<span className="truncate inline-block max-w-full" title={livePhase?.label}>{livePhase?.label ?? '—'}</span>}
            color={livePhase ? 'var(--s-text)' : 'var(--s-text-muted)'} />
        </BarButton>
        <BarButton onClick={() => scrollToId('a-trancher')}>
          <GlanceStat label="À trancher" size={22} value={decisions.length}
            color={decisions.length > 0 ? 'var(--s-gold)' : 'var(--s-text-muted)'} />
        </BarButton>
        <BarButton onClick={() => livePhase && scrollToId(`phase-${livePhase.phase}`)}>
          <GlanceStat label="En jeu" size={22} value={enJeuCount}
            color={enJeuCount > 0 ? 'var(--s-blue)' : 'var(--s-text-muted)'} />
        </BarButton>
        <BarButton onClick={() => scrollToId('equipes')}>
          <GlanceStat label="Terminés" size={18} mono value={`${doneCount}/${data.matches.length}`} color="var(--s-text-muted)" />
        </BarButton>
      </div>

      {/* Zone À TRANCHER — l'unique héros */}
      <div id="a-trancher" className="con-anchor">
        {decisions.length > 0 || data.unresolvedTiebreaks.length > 0 ? (
          <section className="con-decide bevel">
            <div className="flex items-baseline gap-2" style={{ padding: '16px 20px' }}>
              <span className="font-display" style={{ fontSize: 22, letterSpacing: '0.03em' }}>À TRANCHER</span>
              <span className="font-display" style={{ fontSize: 22, color: 'var(--s-gold)' }}>
                — {decisions.length + data.unresolvedTiebreaks.length}
              </span>
            </div>
            {decisions.map(d => (
              <DecisionRow key={d.m ? `${d.kind}-${d.m.id}` : 'title'} d={d} competitionId={id} busy={busy !== null}
                onForceScore={m => setForceScoreFor(m)}
                onForfeit={(m, preset) => setForfeitFor({ m, preset })}
                onReopen={m => action({ action: 'reopen_checkin', matchId: m.id }, `Check-in relancé — ${nameOf(m, 'a')} vs ${nameOf(m, 'b')}.`)}
                onTitle={() => {
                  const target = data.matches.find(x => (x.id === 'GFR' || x.id === 'GF') && !TERMINAL.has(x.status) && x.teamA && x.teamB)
                    ?? data.matches.find(x => !TERMINAL.has(x.status) && x.teamA && x.teamB);
                  if (target) setForceScoreFor(target);
                  else if (phases.length > 0) scrollToId(`phase-${phases[phases.length - 1].phase}`);
                }} />
            ))}
            {data.unresolvedTiebreaks.map(tb => (
              // Clé = groupe + composition : si le groupe change côté serveur
              // (retrait, correction), la carte se REMONTE avec l'ordre frais
              // au lieu de garder un état de drag périmé (review Lot 4).
              <TiebreakCard key={`${tb.group}:${tb.teams.map(t => t.registrationId).join('|')}`}
                tb={tb} registrations={data.registrations} busy={busy !== null}
                onResolve={order => action(
                  { action: 'resolve_tiebreak', group: tb.group, order },
                  'Égalité arbitrée — l\'ordre du groupe est fixé.',
                )} />
            ))}
          </section>
        ) : data.competition.status === 'finished' && data.finalPlacements ? (
          <ClosedSummary placements={data.finalPlacements} />
        ) : data.finished && data.competition.status === 'live' ? (
          <section className="con-decide bevel" style={{ padding: '16px 20px' }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-display" style={{ fontSize: 22, letterSpacing: '0.03em' }}>BRACKET RÉSOLU</p>
                <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
                  Toutes les places sont uniques. La clôture écrit le classement final
                  {data.placements ? ` (${data.placements.length} équipes)` : ''} et les points au circuit — irréversible.
                </p>
              </div>
              <button className="btn-springs btn-primary bevel-sm" disabled={busy !== null}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Clôturer le Qualif',
                    message: 'Le classement final et les points de circuit seront écrits, la compétition passe en « Terminée ». Cette action ne se rejoue pas.',
                    confirmLabel: 'Clôturer',
                  });
                  if (ok) action({ action: 'close_competition' }, 'Compétition clôturée — classement final écrit.');
                }}>
                Clôturer le Qualif
              </button>
            </div>
          </section>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>Rien en attente de décision.</p>
        )}
      </div>

      {/* SALLE DE CONTRÔLE — bracket interactif + détail du match sélectionné.
          Le bracket n'apparaît qu'une fois publié (matchs matérialisés). */}
      {bracketMatches.length > 0 && (
        <div className="space-y-4">
          <div className="panel bevel con-anchor">
            <div className="panel-header flex items-center justify-between gap-3 cursor-pointer" onClick={() => setBracketOpen(o => !o)}>
              <span className="t-sub">Bracket</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>Clique un match pour agir</span>
                <ChevronDown size={15} style={{ color: 'var(--s-text-muted)', transform: bracketOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
              </span>
            </div>
            {bracketOpen && (
              <div className="panel-body">
                <TournamentBracket matches={bracketMatches} gameColor={getGameColor(data.competition.game)}
                  onMatchClick={mid => {
                    setSelectedMatchId(mid);
                    // Éviter le dossier affiché deux fois : replie la ligne de phase du match sélectionné.
                    setExpandedRows(prev => { if (!prev.has(mid)) return prev; const n = new Set(prev); n.delete(mid); return n; });
                  }} />
              </div>
            )}
          </div>
          {selectedMatch && (
            <div ref={detailRef}>
              <ConsoleSelectedMatch m={selectedMatch} competitionId={id} room={data.rooms[selectedMatch.id] ?? null} busy={busy !== null}
                onClose={() => setSelectedMatchId(null)}
                onLaunch={() => launchMatches([selectedMatch], `${nameOf(selectedMatch, 'a')} vs ${nameOf(selectedMatch, 'b')} — lancé.`)}
                onForceScore={() => setForceScoreFor(selectedMatch)}
                onForfeit={() => setForfeitFor({ m: selectedMatch })}
                onCast={() => setCastFor(selectedMatch)}
                onReopen={() => action({ action: 'reopen_checkin', matchId: selectedMatch.id }, `Check-in relancé — ${nameOf(selectedMatch, 'a')} vs ${nameOf(selectedMatch, 'b')}.`)}
                onCopyRoom={room => {
                  navigator.clipboard?.writeText(`Salon : ${room.name} · Mot de passe : ${room.password}`)
                    .then(() => toast.info(`Room de ${nameOf(selectedMatch, 'a')} vs ${nameOf(selectedMatch, 'b')} copiée.`)).catch(() => null);
                }} />
            </div>
          )}
        </div>
      )}

      {/* Check-in général — jamais dominant */}
      <div className="panel bevel">
        <div className="panel-header flex items-center justify-between gap-3">
          <span className="t-sub">
            Check-in général{generalOpened ? ` — ${confirmed.length}/${approved.length} confirmées` : ''}
          </span>
          {!generalOpened ? (
            <button className="btn-springs btn-secondary bevel-sm text-sm" disabled={busy !== null}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Ouvrir le check-in général',
                  message: `Les capitaines des ${approved.length} équipes validées auront ${data.competition.generalCheckinMinutes} minutes pour confirmer. Notification in-app + salons Discord.`,
                  confirmLabel: 'Ouvrir',
                });
                if (ok) action({ action: 'open_general_checkin' }, 'Check-in général ouvert.');
              }}>
              Ouvrir
            </button>
          ) : missing.length === 0 ? (
            <span className="con-pip con-pip-done" />
          ) : null}
        </div>
        {generalOpened && missing.length > 0 && (
          <div className="panel-body space-y-3">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6">
              {missing.map(r => (
                <div key={r.registrationId} className="flex items-center gap-2 py-1.5 text-sm" style={{ borderBottom: '1px solid var(--s-border)' }}>
                  <TeamCrest url={r.logoUrl} tag={r.tag} name={r.name} size={22} />
                  <span className="truncate flex-1" style={{ color: 'var(--s-text)' }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--s-text)' }}>Manquante</span>
                </div>
              ))}
            </div>
            {confirmed.length > 0 && (
              <div>
                <button className="quiet-link" onClick={() => setShowConfirmed(v => !v)}>
                  {showConfirmed ? 'Masquer les confirmées' : `Voir les ${confirmed.length} confirmées`}
                </button>
                {showConfirmed && (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 mt-2">
                    {confirmed.map(r => (
                      <div key={r.registrationId} className="flex items-center gap-2 py-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
                        <span className="con-pip con-pip-done" />
                        <span className="truncate">{r.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Phases */}
      {phases.map(p => (
        <PhaseSection key={String(p.phase)} p={p} competitionId={id} rooms={data.rooms} busy={busy !== null}
          override={phaseOverride.get(String(p.phase))}
          onToggle={() => setPhaseOverride(prev => {
            const next = new Map(prev);
            const cur = next.get(String(p.phase));
            const isOpen = cur ?? defaultPhaseOpen(p.matches);
            next.set(String(p.phase), !isOpen);
            return next;
          })}
          expandedRows={expandedRows}
          onToggleRow={mid => setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(mid)) next.delete(mid); else next.add(mid);
            return next;
          })}
          onLaunchPhase={ms => launchMatches(ms, `${ms.length} match(s) lancé(s).`)}
          onLaunchOne={m => launchMatches([m], `${nameOf(m, 'a')} vs ${nameOf(m, 'b')} — lancé.`)}
          onForceScore={m => setForceScoreFor(m)}
          onForfeit={m => setForfeitFor({ m })}
          onCast={m => setCastFor(m)}
          onReopen={m => action({ action: 'reopen_checkin', matchId: m.id }, `Check-in relancé — ${nameOf(m, 'a')} vs ${nameOf(m, 'b')}.`)}
          onCopyRoom={(m, room) => {
            navigator.clipboard?.writeText(`Salon : ${room.name} · Mot de passe : ${room.password}`)
              .then(() => toast.info(`Room de ${nameOf(m, 'a')} vs ${nameOf(m, 'b')} copiée.`)).catch(() => null);
          }}
        />
      ))}

      {/* Équipes — périphérie quiet */}
      <div id="equipes" className="panel bevel con-anchor">
        <div className="panel-header"><span className="t-sub">Équipes</span></div>
        <div className="panel-body space-y-4">
          {approved.length > 0 && (
            <TeamGroup label={`Validées — ${approved.length}`}>
              {approved.map(r => (
                <TeamRowLine key={r.registrationId} r={r}>
                  <button className="quiet-link" disabled={busy !== null} onClick={() => setReplaceFor(r)}>Remplacer</button>
                  <span style={{ color: 'var(--s-text-muted)', fontSize: 12 }}>·</span>
                  <button className="quiet-link" disabled={busy !== null}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Retirer ${r.name}`,
                        message: 'Disqualification / abandon : les matchs restants passent en forfait conventionnel, le placement est figé (R5-4). Irréversible.',
                        confirmLabel: 'Retirer',
                        variant: 'danger',
                      });
                      if (ok) action({ action: 'withdraw_team', registrationId: r.registrationId, reason: 'Retrait décidé par un admin de compétition.' }, `${r.name} retirée.`);
                    }}>
                    Retirer
                  </button>
                </TeamRowLine>
              ))}
            </TeamGroup>
          )}
          {waitlisted.length > 0 && (
            <TeamGroup label={`Liste d'attente — ${waitlisted.length}`}>
              {waitlisted.map((r, i) => (
                <TeamRowLine key={r.registrationId} r={r} prefix={`n° ${i + 1}`} />
              ))}
            </TeamGroup>
          )}
          {withdrawn.length > 0 && (
            <TeamGroup label={`Retirées — ${withdrawn.length}`}>
              {withdrawn.map(r => (
                <div key={r.registrationId} className="flex items-center gap-2 py-1.5 text-sm"
                  style={{ borderBottom: '1px solid var(--s-border)', color: 'var(--s-text-dim)', textDecoration: 'line-through' }}>
                  <span className="truncate">{r.name} [{r.tag}]</span>
                </div>
              ))}
            </TeamGroup>
          )}
        </div>
      </div>

      {/* Modales */}
      {forceScoreFor && (
        <ForceScoreModal m={forceScoreFor} onClose={() => setForceScoreFor(null)}
          onSubmit={async (games, resolution) => {
            const ok = await action(
              { action: 'force_score', matchId: forceScoreFor.id, games, resolution },
              `Score imposé — ${nameOf(forceScoreFor, 'a')} vs ${nameOf(forceScoreFor, 'b')}.`,
            );
            if (ok) setForceScoreFor(null);
            return ok;
          }} />
      )}
      {forfeitFor && (
        <ForfeitModal m={forfeitFor.m} preset={forfeitFor.preset} onClose={() => setForfeitFor(null)}
          onSubmit={async (team, reason) => {
            const target = team === 'both' ? 'Double forfait' : nameOf(forfeitFor.m, team);
            const ok = await action(
              { action: 'validate_forfeit', matchId: forfeitFor.m.id, team, reason },
              `Forfait validé — ${target}.`,
            );
            if (ok) setForfeitFor(null);
          }} />
      )}
      {castFor && (
        <CastModal m={castFor} onClose={() => setCastFor(null)}
          onSubmit={async (featured, streamUrl) => {
            const ok = await action(
              { action: 'set_cast', matchId: castFor.id, featured, streamUrl },
              featured ? `${nameOf(castFor, 'a')} vs ${nameOf(castFor, 'b')} en stream.` : 'Cast retiré.',
            );
            if (ok) setCastFor(null);
          }} />
      )}
      {replaceFor && (
        <ReplaceModal team={replaceFor} waitlisted={waitlisted} onClose={() => setReplaceFor(null)}
          onSubmit={async newRegistrationId => {
            const newName = newRegistrationId ? waitlisted.find(w => w.registrationId === newRegistrationId)?.name : null;
            const ok = await action(
              { action: 'replace_team', oldRegistrationId: replaceFor.registrationId, newRegistrationId },
              newName ? `${replaceFor.name} remplacée par ${newName}.` : `${replaceFor.name} retirée — le siège devient un bye.`,
            );
            if (ok) setReplaceFor(null);
          }} />
      )}
    </div>
  );
}

// ── Barre de situation ───────────────────────────────────────────────────────

function BarButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-left min-w-0"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

// ── Zone À trancher ──────────────────────────────────────────────────────────

function DecisionRow({ d, competitionId, busy, onForceScore, onForfeit, onReopen, onTitle }: {
  d: { kind: 'title' | 'dispute' | 'forfeit'; m: ConsoleMatch | null };
  competitionId: string;
  busy: boolean;
  onForceScore: (m: ConsoleMatch) => void;
  onForfeit: (m: ConsoleMatch, preset?: 'a' | 'b' | 'both') => void;
  onReopen: (m: ConsoleMatch) => void;
  onTitle: () => void;
}) {
  const m = d.m;
  const kicker = d.kind === 'dispute' ? 'Litige' : d.kind === 'forfeit' ? 'Forfait' : 'Titre';

  let motif: React.ReactNode = null;
  let cta: React.ReactNode = null;
  let preset: 'a' | 'b' | 'both' | undefined;

  if (d.kind === 'title') {
    motif = <span>Fin de bracket sans vainqueur mécanique — le titre doit être tranché.</span>;
    cta = <button className="btn-springs btn-primary bevel-sm text-sm" disabled={busy} onClick={onTitle}>Trancher le titre</button>;
  } else if (m && d.kind === 'dispute') {
    const opener = m.dispute?.openedBy === 'a' ? nameOf(m, 'a') : m.dispute?.openedBy === 'b' ? nameOf(m, 'b') : null;
    const wa = winsOf(m.scores.a);
    const wb = winsOf(m.scores.b);
    motif = (
      <>
        <span>
          Litige {opener ? `ouvert par ${opener}` : 'automatique'}{m.dispute?.auto && opener ? ' (automatique)' : ''} — saisies divergentes.
        </span>
        <span className="block t-mono" style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
          Saisie {nameOf(m, 'a')} : {m.scores.a.length > 0 ? `${wa.a}–${wa.b}` : 'aucune'} · Saisie {nameOf(m, 'b')} : {m.scores.b.length > 0 ? `${wb.a}–${wb.b}` : 'aucune'}
        </span>
      </>
    );
    cta = <button className="btn-springs btn-primary bevel-sm text-sm" disabled={busy} onClick={() => onForceScore(m)}>Trancher le score</button>;
  } else if (m) {
    const missing: Array<'a' | 'b'> = [];
    if (m.checkin && !m.checkin.a.done) missing.push('a');
    if (m.checkin && !m.checkin.b.done) missing.push('b');
    preset = m.forfeit?.team ?? (missing.length === 2 ? 'both' : missing[0]);
    motif = missing.length === 2
      ? <span>Double forfait proposé — les deux équipes absentes au check-in.</span>
      : <span>Forfait proposé — {preset && preset !== 'both' ? nameOf(m, preset) : 'équipe'} absente au check-in.</span>;
    cta = <button className="btn-springs btn-primary bevel-sm text-sm" disabled={busy} onClick={() => onForfeit(m, preset)}>Statuer sur le forfait</button>;
  }

  return (
    <div className="con-decide-row">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-label-soft">{kicker}</span>
          {m && (
            <>
              <span className="text-[15px] font-semibold truncate" style={{ color: 'var(--s-text)' }} title={`${nameOf(m, 'a')} vs ${nameOf(m, 'b')}`}>
                {nameOf(m, 'a')} vs {nameOf(m, 'b')}
              </span>
              <Link href={`/competitions/${competitionId}/match/${m.id}`} className="t-mono hover:underline"
                style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
                {m.id}
              </Link>
            </>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--s-text)' }}>{motif}</div>
      </div>
      <div className="flex flex-col items-start sm:items-end gap-1.5">
        {cta}
        {m && (
          <span className="flex items-center gap-2">
            <Link href={`/competitions/${competitionId}/match/${m.id}`} className="quiet-link">Ouvrir la page du match</Link>
            {d.kind === 'forfeit' && (
              <button className="quiet-link" disabled={busy} onClick={() => onReopen(m)}>Relancer le check-in</button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Phases ───────────────────────────────────────────────────────────────────

function defaultPhaseOpen(matches: ConsoleMatch[]): boolean {
  const allDone = matches.every(m => TERMINAL.has(m.status));
  if (allDone) return false;
  const anyAlive = matches.some(m => EN_JEU.has(m.status) || isDecision(m));
  const anyLaunchable = matches.some(m => m.status === 'pending' && m.teamA && m.teamB && !m.voidA && !m.voidB);
  return anyAlive || anyLaunchable;
}

function PhaseSection({ p, competitionId, rooms, busy, override, onToggle, expandedRows, onToggleRow, onLaunchPhase, onLaunchOne, onForceScore, onForfeit, onCast, onReopen, onCopyRoom }: {
  p: { phase: number | null; label: string; matches: ConsoleMatch[] };
  competitionId: string;
  rooms: Record<string, { name: string; password: string }>;
  busy: boolean;
  override: boolean | undefined;
  onToggle: () => void;
  expandedRows: Set<string>;
  onToggleRow: (mid: string) => void;
  onLaunchPhase: (ms: ConsoleMatch[]) => void;
  onLaunchOne: (m: ConsoleMatch) => void;
  onForceScore: (m: ConsoleMatch) => void;
  onForfeit: (m: ConsoleMatch) => void;
  onCast: (m: ConsoleMatch) => void;
  onReopen: (m: ConsoleMatch) => void;
  onCopyRoom: (m: ConsoleMatch, room: { name: string; password: string }) => void;
}) {
  const open = override ?? defaultPhaseOpen(p.matches);
  const allDone = p.matches.every(m => TERMINAL.has(m.status));
  const launchable = p.matches.filter(m => m.status === 'pending' && m.teamA && m.teamB && !m.voidA && !m.voidB);
  const inPlay = p.matches.filter(m => EN_JEU.has(m.status)).length;
  const waiting = p.matches.filter(m => !TERMINAL.has(m.status) && !EN_JEU.has(m.status)).length;

  return (
    <div id={`phase-${p.phase}`} className="panel bevel con-anchor">
      <div className="panel-header flex items-center justify-between gap-3 cursor-pointer" onClick={onToggle}>
        <span className="flex items-baseline gap-2 min-w-0">
          <span className={allDone && !open ? 'text-sm' : 't-sub'} style={allDone && !open ? { color: 'var(--s-text-dim)' } : undefined}>
            {p.label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
            {allDone ? `${p.matches.length} matchs · terminée` : `${inPlay} en cours · ${waiting} en attente`}
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {launchable.length > 0 && (
            <button className="btn-springs btn-secondary bevel-sm text-sm" disabled={busy}
              onClick={e => { e.stopPropagation(); onLaunchPhase(launchable); }}>
              Lancer ({launchable.length})
            </button>
          )}
          <ChevronDown size={15} style={{ color: 'var(--s-text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
        </span>
      </div>
      {open && (
        <div className="con-well">
          {p.matches.map(m => (
            <ConsoleRow key={m.id} m={m} competitionId={competitionId} room={rooms[m.id] ?? null} busy={busy}
              expanded={expandedRows.has(m.id)}
              onToggle={() => onToggleRow(m.id)}
              onLaunch={() => onLaunchOne(m)}
              onForceScore={() => onForceScore(m)}
              onForfeit={() => onForfeit(m)}
              onCast={() => onCast(m)}
              onReopen={() => onReopen(m)}
              onCopyRoom={room => onCopyRoom(m, room)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConsoleRow({ m, competitionId, room, busy, expanded, onToggle, onLaunch, onForceScore, onForfeit, onCast, onReopen, onCopyRoom }: {
  m: ConsoleMatch;
  competitionId: string;
  room: { name: string; password: string } | null;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onLaunch: () => void;
  onForceScore: () => void;
  onForfeit: () => void;
  onCast: () => void;
  onReopen: () => void;
  onCopyRoom: (room: { name: string; password: string }) => void;
}) {
  const terminal = TERMINAL.has(m.status);
  const launchable = m.status === 'pending' && m.teamA && m.teamB && !m.voidA && !m.voidB;
  const wins = winsOf(m.scores.final ?? []);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const showRoomChip = room && ['checkin', 'ready', 'live'].includes(m.status);

  const statusLabel = m.forfeit
    ? (m.forfeit.team === 'both' ? 'Double forfait' : `Forfait — ${nameOf(m, m.forfeit.team)}`)
    : STATUS_FR[m.status] ?? m.status;

  return (
    <>
      <div className={`con-row ${terminal ? 'con-row-quiet' : ''}`} onClick={onToggle}>
        <Link href={`/competitions/${competitionId}/match/${m.id}`} onClick={stop}
          className="con-col-lg t-mono hover:underline" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
          {m.id}
        </Link>
        <span className="rounded-none" style={{ width: 7, height: 7, background: STATUS_DOT[m.status] ?? 'var(--s-text-muted)' }} />
        <span className="flex items-center justify-end gap-2 min-w-0 text-right">
          <span className="truncate text-sm" title={nameOf(m, 'a')} style={{
            color: m.winner === 'a' ? 'var(--s-text)' : terminal ? 'var(--s-text-dim)' : 'var(--s-text)',
            fontWeight: m.winner === 'a' ? 700 : 400,
            fontStyle: !m.teamAInfo || m.voidA ? 'italic' : undefined,
          }}>{nameOf(m, 'a')}</span>
          {m.teamAInfo && !m.voidA && <TeamCrest url={m.teamAInfo.logoUrl} tag={m.teamAInfo.tag} name={m.teamAInfo.name} size={20} />}
        </span>
        <span className="text-center flex items-center justify-center gap-1.5">
          {m.scores.final ? (
            <span className="font-display" style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{wins.a}–{wins.b}</span>
          ) : m.status === 'walkover' ? (
            <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>W.O.</span>
          ) : m.status === 'cancelled' ? (
            <span style={{ color: 'var(--s-text-muted)' }}>—</span>
          ) : (
            <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>vs</span>
          )}
          {m.cast?.featured && <Radio size={13} style={{ color: 'var(--s-text-dim)' }} aria-label="Casté" />}
        </span>
        <span className="flex items-center gap-2 min-w-0">
          {m.teamBInfo && !m.voidB && <TeamCrest url={m.teamBInfo.logoUrl} tag={m.teamBInfo.tag} name={m.teamBInfo.name} size={20} />}
          <span className="truncate text-sm" title={nameOf(m, 'b')} style={{
            color: m.winner === 'b' ? 'var(--s-text)' : terminal ? 'var(--s-text-dim)' : 'var(--s-text)',
            fontWeight: m.winner === 'b' ? 700 : 400,
            fontStyle: !m.teamBInfo || m.voidB ? 'italic' : undefined,
          }}>{nameOf(m, 'b')}</span>
        </span>
        <span className="con-col-lg t-label-soft" style={isDecision(m) ? { color: 'var(--s-text)' } : undefined}>
          <span className="block">{statusLabel}</span>
          {m.status === 'checkin' && m.checkin?.deadline && (
            <span className="block mt-0.5"><ConsoleCountdown deadline={m.checkin.deadline} label="reste" /></span>
          )}
          {m.status === 'score_review' && m.scores.counterDeadline && (
            <span className="block mt-0.5"><ConsoleCountdown deadline={m.scores.counterDeadline} label="contre-saisie" /></span>
          )}
        </span>
        {/* Check-in : deux pastilles (A gauche, B droite) — pas de tag inline
            qui débordait sur la colonne room (retour Matt). Détail nommé au dépli. */}
        <span className="con-col-xl flex items-center gap-1.5 overflow-hidden">
          {m.checkin && !terminal && (['a', 'b'] as const).map(s => (
            <span key={s} className={`con-pip ${m.checkin![s].done ? 'con-pip-done' : 'con-pip-wait'}`}
              title={`${nameOf(m, s)} — check-in ${m.checkin![s].done ? 'fait' : 'attendu'}`} />
          ))}
        </span>
        <span className="con-col-xl min-w-0" onClick={stop}>
          {showRoomChip && (
            <button className="con-chip bevel-sm" onClick={() => onCopyRoom(room!)}
              title={`Salon : ${room!.name} · Mot de passe : ${room!.password}`}
              aria-label={`Copier la room de ${nameOf(m, 'a')} vs ${nameOf(m, 'b')}`}>
              <span className="truncate">{room!.name}</span>
              <span className="flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>· {room!.password}</span>
              <Copy size={12} style={{ flexShrink: 0 }} />
            </button>
          )}
        </span>
        <span className="con-col-lg" onClick={stop}>
          {launchable && !busy && (
            <button className="btn-springs btn-ghost text-sm" onClick={onLaunch}>Lancer</button>
          )}
        </span>
        <button className="flex items-center justify-center" aria-expanded={expanded} aria-label="Détail du match"
          style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer' }} onClick={e => { stop(e); onToggle(); }}>
          <ChevronDown size={14} style={{ color: 'var(--s-text-muted)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
        </button>
      </div>
      {expanded && (
        <RowDossier m={m} competitionId={competitionId} room={room} busy={busy}
          onForceScore={onForceScore} onForfeit={onForfeit} onCast={onCast} onReopen={onReopen} onCopyRoom={onCopyRoom} />
      )}
    </>
  );
}

function RowDossier({ m, competitionId, room, busy, onForceScore, onForfeit, onCast, onReopen, onCopyRoom }: {
  m: ConsoleMatch;
  competitionId: string;
  room: { name: string; password: string } | null;
  busy: boolean;
  onForceScore: () => void;
  onForfeit: () => void;
  onCast: () => void;
  onReopen: () => void;
  onCopyRoom: (room: { name: string; password: string }) => void;
}) {
  const terminal = TERMINAL.has(m.status);

  const entryCol = (side: 'a' | 'b') => {
    const games = m.scores[side];
    const info = side === 'a' ? m.teamAInfo : m.teamBInfo;
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2 pb-1.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
          {info && <TeamCrest url={info.logoUrl} tag={info.tag} name={info.name} size={20} />}
          <span className="font-semibold truncate" style={{ fontSize: 13, color: 'var(--s-text)' }}>
            Saisie {nameOf(m, side)}
          </span>
        </div>
        {games.length > 0 ? (
          <div className="match-rows">
            {games.map((g, i) => (
              <GameRow key={i} index={i} game={g} teamAName={nameOf(m, 'a')} teamBName={nameOf(m, 'b')} color="var(--s-blue)" />
            ))}
          </div>
        ) : (
          <p className="pt-2" style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>Aucune saisie.</p>
        )}
      </div>
    );
  };

  return (
    <div className="con-card bevel-sm my-2">
      <div className="grid md:grid-cols-3 gap-4">
        {terminal && m.scores.final ? (
          <div className="md:col-span-2 min-w-0">
            <p className="t-label-soft pb-1.5" style={{ borderBottom: '1px solid var(--s-border)' }}>Résultat</p>
            <div className="match-rows">
              {m.scores.final.map((g, i) => (
                <GameRow key={i} index={i} game={g} teamAName={nameOf(m, 'a')} teamBName={nameOf(m, 'b')} color="var(--s-blue)" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {entryCol('a')}
            {entryCol('b')}
          </>
        )}
        <div className="space-y-3 text-sm min-w-0" style={{ color: 'var(--s-text-dim)' }}>
          {room && (
            <div className="space-y-1.5">
              {([['Salon', room.name], ['Mot de passe', room.password]] as const).map(([lbl, val]) => (
                <div key={lbl} className="flex items-baseline gap-2">
                  <span className="t-label-soft flex-shrink-0" style={{ width: 88 }}>{lbl}</span>
                  <span className="t-mono truncate" style={{ fontSize: 14, color: 'var(--s-text)' }}>{val}</span>
                </div>
              ))}
              <button className="con-chip bevel-sm" onClick={() => onCopyRoom(room)}>
                <Copy size={12} style={{ flexShrink: 0 }} />
                <span>Copier salon + mot de passe</span>
              </button>
              <p style={{ fontSize: 12 }}>Room créée par {nameOf(m, m.roomHost)}</p>
            </div>
          )}
          {/* Check-in nommé — compense l'absence de tag dans la rangée dense. */}
          {m.checkin && !terminal && ['checkin', 'ready', 'live', 'awaiting_forfeit_validation'].includes(m.status) && (
            <div className="space-y-1">
              {(['a', 'b'] as const).map(s => (
                <div key={s} className="flex items-center gap-2">
                  <span className={`con-pip ${m.checkin![s].done ? 'con-pip-done' : 'con-pip-wait'}`} />
                  <span className="truncate" style={{ fontSize: 12.5, color: 'var(--s-text)' }}>{nameOf(m, s)}</span>
                  <span className="ml-auto flex-shrink-0" style={{ fontSize: 12, color: m.checkin![s].done ? 'var(--s-green)' : 'var(--s-text-muted)' }}>
                    {m.checkin![s].done ? 'Présente' : 'Attendue'}
                  </span>
                </div>
              ))}
              {m.status === 'checkin' && m.checkin.deadline && (
                <ConsoleCountdown deadline={m.checkin.deadline} label="Check-in — reste" />
              )}
            </div>
          )}
          {m.status === 'score_review' && m.scores.counterDeadline && (
            <ConsoleCountdown deadline={m.scores.counterDeadline} label="Contre-saisie — reste" />
          )}
          <p className="t-mono" style={{ fontSize: 12 }}>BO{m.bo}</p>
          {m.cast?.featured && (
            m.cast.streamUrl
              ? <a href={m.cast.streamUrl} target="_blank" rel="noopener noreferrer" className="hover:underline block truncate">En stream — {m.cast.streamUrl}</a>
              : <p>En stream.</p>
          )}
          {disputeOpen(m) && (
            <p>Litige ouvert{m.dispute?.openedBy === 'a' || m.dispute?.openedBy === 'b' ? ` par ${nameOf(m, m.dispute.openedBy)}` : ''}{m.dispute?.auto ? ' (automatique)' : ''}.</p>
          )}
          {m.forfeit && (
            <p>Forfait — {m.forfeit.team === 'both' ? 'les deux équipes' : nameOf(m, m.forfeit.team)}{m.forfeit.reason ? ` · ${m.forfeit.reason}` : ''}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-3 mt-3" style={{ borderTop: '1px solid var(--s-border)' }}>
        {!terminal && m.teamA && m.teamB && (
          <>
            <button className="quiet-link" disabled={busy} onClick={onForceScore}>Imposer un score</button>
            <span style={{ color: 'var(--s-text-muted)', fontSize: 12 }}>·</span>
            <button className="quiet-link" disabled={busy} onClick={onForfeit}>Déclarer un forfait</button>
            <span style={{ color: 'var(--s-text-muted)', fontSize: 12 }}>·</span>
          </>
        )}
        {!terminal && (
          <>
            <button className="quiet-link" disabled={busy} onClick={onCast}>Mettre en stream</button>
            <span style={{ color: 'var(--s-text-muted)', fontSize: 12 }}>·</span>
          </>
        )}
        {m.status === 'awaiting_forfeit_validation' && (
          <>
            <button className="quiet-link" disabled={busy} onClick={onReopen}>Relancer le check-in</button>
            <span style={{ color: 'var(--s-text-muted)', fontSize: 12 }}>·</span>
          </>
        )}
        <Link href={`/competitions/${competitionId}/match/${m.id}`} className="quiet-link">Ouvrir la page du match</Link>
      </div>
    </div>
  );
}

// Panneau « match sélectionné » (Lot 2) — en-tête faceoff + lancer/fermer, puis
// le dossier complet réutilisé (RowDossier). Sélection depuis le bracket.
function ConsoleSelectedMatch({ m, competitionId, room, busy, onClose, onLaunch, onForceScore, onForfeit, onCast, onReopen, onCopyRoom }: {
  m: ConsoleMatch;
  competitionId: string;
  room: { name: string; password: string } | null;
  busy: boolean;
  onClose: () => void;
  onLaunch: () => void;
  onForceScore: () => void;
  onForfeit: () => void;
  onCast: () => void;
  onReopen: () => void;
  onCopyRoom: (room: { name: string; password: string }) => void;
}) {
  const launchable = m.status === 'pending' && !!m.teamA && !!m.teamB && !m.voidA && !m.voidB;
  const statusLabel = m.forfeit
    ? (m.forfeit.team === 'both' ? 'Double forfait' : `Forfait — ${nameOf(m, m.forfeit.team)}`)
    : STATUS_FR[m.status] ?? m.status;
  return (
    <div className="panel bevel">
      <div className="panel-header flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <span className="flex items-center gap-1.5 flex-shrink-0">
            {m.teamAInfo && !m.voidA && <TeamCrest url={m.teamAInfo.logoUrl} tag={m.teamAInfo.tag} name={m.teamAInfo.name} size={28} />}
            {m.teamBInfo && !m.voidB && <TeamCrest url={m.teamBInfo.logoUrl} tag={m.teamBInfo.tag} name={m.teamBInfo.name} size={28} />}
          </span>
          <div className="min-w-0">
            <p className="font-display line-clamp-1" style={{ fontSize: 18, letterSpacing: '0.03em' }}>
              {nameOf(m, 'a').toUpperCase()} <span style={{ color: 'var(--s-text-muted)' }}>vs</span> {nameOf(m, 'b').toUpperCase()}
            </p>
            {/* BO vit déjà dans le dossier ci-dessous — pas de doublon ici. */}
            <p className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>{m.id} · {statusLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {launchable && (
            // Neutre (pas d'or) : l'or console est réservé à « À trancher ».
            <button className="btn-springs btn-secondary bevel-sm text-sm" disabled={busy} onClick={onLaunch}>Lancer</button>
          )}
          <button onClick={onClose} className="quiet-link">Fermer</button>
        </div>
      </div>
      <RowDossier m={m} competitionId={competitionId} room={room} busy={busy}
        onForceScore={onForceScore} onForfeit={onForfeit} onCast={onCast} onReopen={onReopen} onCopyRoom={onCopyRoom} />
    </div>
  );
}

// ── Équipes ──────────────────────────────────────────────────────────────────

function TeamGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="t-label-soft mb-1">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function TeamRowLine({ r, prefix, children }: { r: ConsoleRegistration; prefix?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 text-sm" style={{ borderBottom: '1px solid var(--s-border)' }}>
      {prefix && <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>{prefix}</span>}
      <TeamCrest url={r.logoUrl} tag={r.tag} name={r.name} size={26} />
      <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--s-text)' }}>
        {r.name} <span style={{ color: 'var(--s-text-muted)' }}>[{r.tag}]{r.seed ? ` · seed ${r.seed}` : ''}</span>
      </span>
      {children && <span className="flex items-center gap-2 flex-shrink-0">{children}</span>}
    </div>
  );
}

// ── Arbitrage d'égalité + clôture (Lot 4) ────────────────────────────────────

/** Carte « égalité à arbitrer » : l'admin fixe l'ordre COMPLET du groupe par
 *  glisser-déposer (spec §11 — le départage automatique a épuisé ses critères).
 *  L'ordre proposé au départ est celui du moteur (stats à l'appui). */
function TiebreakCard({ tb, registrations, busy, onResolve }: {
  tb: TiebreakGroup;
  registrations: ConsoleRegistration[];
  busy: boolean;
  onResolve: (order: string[]) => void;
}) {
  const [order, setOrder] = useState<string[]>(() => tb.teams.map(t => t.registrationId));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(tb.teams.map(t => [t.registrationId, t]));
  const regOf = (rid: string) => registrations.find(r => r.registrationId === rid);
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder(prev => arrayMove(prev, prev.indexOf(String(active.id)), prev.indexOf(String(over.id))));
  };
  return (
    <div className="con-decide-row" style={{ display: 'block' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <p className="t-sub">Égalité à arbitrer — groupe {tb.group}</p>
          <p style={{ fontSize: 12.5, color: 'var(--s-text-dim)' }}>
            Délta, buts et face-à-face n&apos;ont pas suffi : fixe l&apos;ordre du groupe (glisser-déposer),
            la clôture attribuera les places dans cet ordre.
          </p>
        </div>
        <button className="btn-springs btn-primary bevel-sm text-sm" disabled={busy}
          onClick={() => onResolve(order)}>
          Valider cet ordre
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div>
            {order.map((rid, i) => {
              const t = byId.get(rid);
              const reg = regOf(rid);
              return (
                <SortableTeamRow key={rid} id={rid}>
                  <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)', width: 18 }}>{i + 1}.</span>
                  <TeamCrest url={reg?.logoUrl ?? null} tag={reg?.tag ?? '?'} name={reg?.name ?? rid} size={24} />
                  <span className="flex-1 min-w-0 truncate text-sm">{reg?.name ?? rid}</span>
                  {t?.tied && <span className="tag tag-gold" style={{ fontSize: 9 }}>ex aequo</span>}
                  <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}
                    title="Différence de buts moyenne par match · buts marqués">
                    {t ? `${t.goalDiff >= 0 ? '+' : ''}${t.goalDiff}/match · ${t.goalsFor} buts` : ''}
                  </span>
                </SortableTeamRow>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableTeamRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.6 : 1,
        borderBottom: '1px solid var(--s-border)',
        background: isDragging ? 'var(--s-elevated)' : 'transparent',
      }}
      className="flex items-center gap-3 py-2">
      <button type="button" {...attributes} {...listeners} className="flex-shrink-0 cursor-grab"
        style={{ color: 'var(--s-text-muted)' }} aria-label="Réordonner">
        <GripVertical size={15} />
      </button>
      {children}
    </div>
  );
}

/** Compétition clôturée : le classement final écrit, tel quel. */
function ClosedSummary({ placements }: { placements: FinalPlacementRow[] }) {
  const anyPoints = placements.some(p => p.points !== null);
  return (
    <div className="panel bevel">
      <div className="panel-header"><span className="t-sub">Classement final{anyPoints ? ' — points écrits au circuit' : ''}</span></div>
      <div className="panel-body" style={{ paddingTop: 8 }}>
        {/* Labels : le delta est une diff. de buts MOYENNE par match (départage). */}
        <div className="flex items-center gap-3 py-1.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
          <span className="flex-shrink-0" style={{ width: 26 }} />
          <span className="flex-1 t-label-soft">Équipe</span>
          {anyPoints && <span className="t-label-soft flex-shrink-0" style={{ width: 48, textAlign: 'right' }}>Points</span>}
          <span className="t-label-soft flex-shrink-0" style={{ width: 72, textAlign: 'right' }}
            title="Différence de buts moyenne par match (critère de départage)">Diff/match</span>
        </div>
        {placements.map(p => (
          <div key={p.registrationId} className="flex items-center gap-3 py-1.5 text-sm"
            style={{ borderBottom: '1px solid var(--s-border)' }}>
            <span className="t-mono flex-shrink-0 text-right" style={{ width: 26, color: p.placement <= 3 ? 'var(--s-gold)' : 'var(--s-text-dim)' }}>
              {p.placement}.
            </span>
            <span className="flex-1 min-w-0 truncate">{p.name} <span style={{ color: 'var(--s-text-muted)' }}>[{p.tag}]</span></span>
            {anyPoints && (
              <span className="t-mono flex-shrink-0" style={{ width: 48, textAlign: 'right', fontSize: 12.5, color: p.points ? 'var(--s-text)' : 'var(--s-text-muted)' }}>
                {p.points ?? 0} pts
              </span>
            )}
            <span className="t-mono flex-shrink-0" style={{ width: 72, textAlign: 'right', fontSize: 12, color: 'var(--s-text-muted)' }}
              title="Différence de buts moyenne par match">
              {p.goalDiff >= 0 ? '+' : ''}{p.goalDiff}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Modales v2 — en-tête d'identité faceoff ──────────────────────────────────

function ModalShell({ heading, m, onClose, children }: {
  heading?: string;
  m?: ConsoleMatch;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.72)' }} onClick={onClose}>
      <div className="panel bevel w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="panel-header flex items-start justify-between gap-3">
          {m ? (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {m.teamAInfo && !m.voidA && <TeamCrest url={m.teamAInfo.logoUrl} tag={m.teamAInfo.tag} name={m.teamAInfo.name} size={28} />}
                {m.teamBInfo && !m.voidB && <TeamCrest url={m.teamBInfo.logoUrl} tag={m.teamBInfo.tag} name={m.teamBInfo.name} size={28} />}
                <span className="font-display line-clamp-2" style={{ fontSize: 20, letterSpacing: '0.03em' }}>
                  {nameOf(m, 'a').toUpperCase()} vs {nameOf(m, 'b').toUpperCase()}
                </span>
              </div>
              <p className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>{m.id} · BO{m.bo}</p>
            </div>
          ) : (
            <span className="t-sub">{heading}</span>
          )}
          <button onClick={onClose} className="quiet-link flex-shrink-0">Fermer</button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}

function ForceScoreModal({ m, onClose, onSubmit }: {
  m: ConsoleMatch; onClose: () => void; onSubmit: (games: Game[], resolution: string | null) => Promise<boolean>;
}) {
  const needed = winsNeeded(m.bo);
  // Rangées AUTO-GÉRÉES (helper pur) : impossible de construire un 4-0 en BO5,
  // et un 2-1 fait apparaître la manche suivante tout seul.
  const [games, setGames] = useState<Game[]>(() => normalizeGameRows([], m.bo));
  const [resolution, setResolution] = useState('');
  const [sent, setSent] = useState(false);   // anti double-submit (review Lot 4)
  const wins = winsOf(games);
  const valid = isScoreValid(games, m.bo);
  const clamp = (v: string) => Math.max(0, Math.min(99, Number(v) || 0));
  const editCell = (i: number, side: 'a' | 'b', raw: string) =>
    setGames(gs => normalizeGameRows(gs.map((x, j) => j === i ? { ...x, [side]: clamp(raw) } : x), m.bo));

  return (
    <ModalShell m={m} onClose={onClose}>
      <div className="space-y-4">
        {m.dispute && m.dispute.resolvedBy === null && (
          <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>Résout le litige en cours.</p>
        )}
        {/* Colonnes NOMMÉES — saisie A · Manche N centré · saisie B (retour Matt) */}
        <div className="grid grid-cols-[1fr_72px_1fr] items-end gap-2">
          <div className="flex items-center gap-2 min-w-0 justify-end">
            {m.teamAInfo && !m.voidA && <TeamCrest url={m.teamAInfo.logoUrl} tag={m.teamAInfo.tag} name={m.teamAInfo.name} size={24} />}
            <span className="font-semibold line-clamp-2 text-right" style={{ fontSize: 13, color: 'var(--s-text)' }}>{nameOf(m, 'a')}</span>
          </div>
          <span />
          <div className="flex items-center gap-2 min-w-0 justify-start">
            {m.teamBInfo && !m.voidB && <TeamCrest url={m.teamBInfo.logoUrl} tag={m.teamBInfo.tag} name={m.teamBInfo.name} size={24} />}
            <span className="font-semibold line-clamp-2" style={{ fontSize: 13, color: 'var(--s-text)' }}>{nameOf(m, 'b')}</span>
          </div>
        </div>
        {games.map((g, i) => (
          <div key={i} className="grid grid-cols-[1fr_72px_1fr] items-center gap-2">
            <div className="flex justify-end">
              <input type="number" min={0} max={99} value={g.a} className="settings-input bevel-sm" style={{ width: 64, textAlign: 'center' }}
                aria-label={`Buts ${nameOf(m, 'a')}, manche ${i + 1}`}
                onChange={e => editCell(i, 'a', e.target.value)} />
            </div>
            <span className="t-label-soft text-center">Manche {i + 1}</span>
            <div className="flex justify-start">
              <input type="number" min={0} max={99} value={g.b} className="settings-input bevel-sm" style={{ width: 64, textAlign: 'center' }}
                aria-label={`Buts ${nameOf(m, 'b')}, manche ${i + 1}`}
                onChange={e => editCell(i, 'b', e.target.value)} />
            </div>
          </div>
        ))}
        {/* Totaux live */}
        <p className="text-center font-display" style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: wins.a > wins.b ? 'var(--s-blue)' : 'var(--s-text-dim)' }}>{wins.a}</span>
          <span style={{ color: 'var(--s-text-muted)' }}> — </span>
          <span style={{ color: wins.b > wins.a ? 'var(--s-blue)' : 'var(--s-text-dim)' }}>{wins.b}</span>
        </p>
        <textarea className="settings-input bevel-sm w-full" rows={2}
          placeholder="Résolution visible des équipes (ex. captures vérifiées)"
          value={resolution} onChange={e => setResolution(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-springs btn-primary bevel-sm" disabled={!valid || sent}
            onClick={async () => {
              setSent(true);
              // On ne réinitialise `sent` QUE si l'imposition échoue (le toast d'erreur
              // s'affiche déjà via action()) : sinon le bouton restait grisé à vie et
              // le refus paraissait « silencieux » (retour Matt 21/07).
              const ok = await onSubmit(games, resolution.trim() || null);
              if (!ok) setSent(false);
            }}>
            Imposer le score
          </button>
          {!valid && <span style={{ fontSize: 13, color: 'var(--s-text-muted)' }}>Vainqueur net à {needed} manches requis.</span>}
        </div>
      </div>
    </ModalShell>
  );
}

function ForfeitModal({ m, preset, onClose, onSubmit }: {
  m: ConsoleMatch; preset?: 'a' | 'b' | 'both'; onClose: () => void; onSubmit: (team: 'a' | 'b' | 'both', reason: string | null) => void;
}) {
  const [team, setTeam] = useState<'a' | 'b' | 'both'>(preset ?? 'a');
  const [sent, setSent] = useState(false);   // anti double-submit (review Lot 4)
  const [reason, setReason] = useState('');
  return (
    <ModalShell m={m} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={{ color: 'var(--s-text-dim)' }}>
          Score conventionnel {Math.ceil(m.bo / 2)}-0, compté dans le délta. Le double forfait élimine les deux équipes.
        </p>
        <div className="flex flex-col gap-2">
          {(['a', 'b', 'both'] as const).map(v => {
            const info = v === 'a' ? m.teamAInfo : v === 'b' ? m.teamBInfo : null;
            const label = v === 'both' ? 'Double forfait — les deux équipes absentes' : `Forfait de ${nameOf(m, v)}`;
            return (
              <label key={v} className="con-option bevel-sm" data-checked={team === v}>
                <input type="radio" name="forfeit-team" className="sr-only" checked={team === v} onChange={() => setTeam(v)} />
                {info && <TeamCrest url={info.logoUrl} tag={info.tag} name={info.name} size={20} />}
                <span style={{ color: 'var(--s-text)' }}>{label}</span>
              </label>
            );
          })}
        </div>
        <textarea className="settings-input bevel-sm w-full" rows={2}
          placeholder="Motif (visible des équipes)"
          value={reason} onChange={e => setReason(e.target.value)} />
        <button className="btn-springs btn-primary bevel-sm" disabled={sent}
          onClick={() => { setSent(true); onSubmit(team, reason.trim() || null); }}>
          Valider le forfait
        </button>
      </div>
    </ModalShell>
  );
}

function CastModal({ m, onClose, onSubmit }: {
  m: ConsoleMatch; onClose: () => void; onSubmit: (featured: boolean, streamUrl: string | null) => void;
}) {
  const [streamUrl, setStreamUrl] = useState(m.cast?.streamUrl ?? '');
  const [sent, setSent] = useState(false);   // anti double-submit (review Lot 4)
  return (
    <ModalShell m={m} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={{ color: 'var(--s-text-dim)' }}>
          1 match casté par phase : le précédent match casté de la phase est automatiquement remplacé.
        </p>
        <input className="settings-input bevel-sm w-full" placeholder="https://twitch.tv/…"
          value={streamUrl} onChange={e => setStreamUrl(e.target.value)} />
        <div className="flex items-center gap-3">
          <button className="btn-springs btn-secondary bevel-sm" disabled={sent}
            onClick={() => { setSent(true); onSubmit(true, streamUrl.trim() || null); }}>
            Mettre en stream
          </button>
          {m.cast?.featured && (
            <button className="btn-springs btn-ghost text-sm" disabled={sent}
              onClick={() => { setSent(true); onSubmit(false, null); }}>
              Retirer le cast
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function ReplaceModal({ team, waitlisted, onClose, onSubmit }: {
  team: ConsoleRegistration;
  waitlisted: ConsoleRegistration[];
  onClose: () => void;
  onSubmit: (newRegistrationId: string | null) => void;
}) {
  const [choice, setChoice] = useState<string | null>(waitlisted[0]?.registrationId ?? null);
  const [sent, setSent] = useState(false);   // anti double-submit (review Lot 4)
  return (
    <ModalShell heading={`Remplacer ${team.name}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={{ color: 'var(--s-text-dim)' }}>
          Possible uniquement avant le premier match joué. Sans équipe en liste d&apos;attente, le siège devient un bye.
        </p>
        <div className="flex flex-col gap-2">
          {waitlisted.map((w, i) => (
            <label key={w.registrationId} className="con-option bevel-sm" data-checked={choice === w.registrationId}>
              <input type="radio" name="replace-with" className="sr-only" checked={choice === w.registrationId}
                onChange={() => setChoice(w.registrationId)} />
              <TeamCrest url={w.logoUrl} tag={w.tag} name={w.name} size={20} />
              <span style={{ color: 'var(--s-text)' }}>{w.name}</span>
              <span className="t-mono ml-auto" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>n° {i + 1} liste d&apos;attente</span>
            </label>
          ))}
          <label className="con-option bevel-sm" data-checked={choice === null}>
            <input type="radio" name="replace-with" className="sr-only" checked={choice === null} onChange={() => setChoice(null)} />
            <span style={{ color: 'var(--s-text-dim)' }}>Personne — le siège devient un bye</span>
          </label>
        </div>
        <button className="btn-springs btn-primary bevel-sm" disabled={sent}
          onClick={() => { setSent(true); onSubmit(choice); }}>
          Remplacer
        </button>
      </div>
    </ModalShell>
  );
}
