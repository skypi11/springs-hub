'use client';

// FEUILLE DE MATCH — extension du langage « Le Dossier » (spec panel design
// 12/07). Trois plans : l'AFFICHE (héros public unique, cohérente avec le hero
// de la fiche), le puits « TON MATCH » (un seul bloc-action lifted, piloté par
// la machine d'états — check-in → room → saisie), les ALIGNEMENTS en rangées
// quiet. Le statut n'existe qu'à UN endroit (ligne dot + libellé de
// l'affiche) ; les manches passent par GameRow (jamais de « 3-1 · 1-2 »
// cryptique) ; les équipes sont nommées en NOM COMPLET partout.
// Budget or : le CTA du bloc-action + le countdown urgent (<2 min) accolé.

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPublic, apiForm, ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { getGameColor, getGameColorRgb, getGameBannerUrl } from '@/lib/games-registry';
import TeamCrest from '@/components/competitions/TeamCrest';
import GameRow from '@/components/competitions/GameRow';
import { useWorkerInterval } from '@/components/competitions/useWorkerInterval';
import { normalizeGameRows, isScoreValid } from '@/lib/competitions/match-score';
import { mergeThread, threadPostSide } from '@/lib/competitions/match-thread';
import { Skeleton } from '@/components/ui/Skeleton';
import { ChevronLeft, Copy, Radio, ShieldAlert, ShieldCheck } from 'lucide-react';

type Side = { name: string; tag: string; logoUrl: string | null } | null;
interface Game { a: number; b: number }
interface RosterPlayer {
  displayName: string;
  role: 'titulaire' | 'remplacant';
  isCaptain: boolean;
  verified: boolean;
  trackerUrl: string | null;
}

interface MatchPayload {
  match: {
    id: string;
    bracket: 'winners' | 'losers' | 'grand_final';
    round: number;
    bo: number;
    status: string;
    teamA: string | null;
    teamB: string | null;
    voidA: boolean;
    voidB: boolean;
    teamAInfo: Side;
    teamBInfo: Side;
    roomHost: 'a' | 'b';
    checkin: { deadline: string | null; a: { done: boolean }; b: { done: boolean } } | null;
    scores: {
      a: Game[]; b: Game[];
      aSubmittedAt: string | null; bSubmittedAt: string | null;
      counterDeadline: string | null;
      final: Game[] | null;
      validatedBy: 'auto' | 'admin' | null;
    };
    dispute: { auto: boolean; resolvedBy: 'admin' | null; resolution: string | null } | null;
    forfeit: { team: 'a' | 'b' | 'both'; reason: string | null } | null;
    cast: { featured: boolean; streamUrl: string | null } | null;
    winner: 'a' | 'b' | null;
  };
  access: { side: 'a' | 'b' | null; isCaptain: boolean; isStaff: boolean; canCheckin: boolean; canSubmitScores: boolean };
  isAdmin: boolean;
  room: { name: string; password: string } | null;
  rosters: { a: RosterPlayer[] | null; b: RosterPlayer[] | null };
}

const STATUS_FR: Record<string, string> = {
  pending: 'À venir',
  checkin: 'Check-in en cours',
  ready: 'Prêt à jouer',
  live: 'En cours',
  awaiting_scores: 'En attente des scores',
  score_review: 'Contre-saisie en cours',
  disputed: 'Score contesté',
  awaiting_forfeit_validation: 'En attente de décision admin',
  completed: 'Terminé',
  walkover: "Qualifié d'office",
  cancelled: 'Non joué',
};

function bracketLabel(bracket: string, round: number, single: boolean): string {
  // Round robin : le round est une JOURNÉE de poule — jamais un tour d'arbre
  // (le libellé « Losers · tour N » serait mensonger).
  if (bracket === 'round_robin') return `Journée ${round}`;
  if (bracket === 'grand_final') return round === 2 ? 'Belle (reset)' : 'Grande finale';
  if (single) {
    // Simple élim : un seul arbre (pas de préfixe Winners) ; le bracket
    // `losers` n'y porte que la petite finale.
    return bracket === 'losers' ? 'Petite finale' : `Tour ${round}`;
  }
  return `${bracket === 'winners' ? 'Winners' : 'Losers'} · tour ${round}`;
}

function gamesWon(final: Game[] | null): { a: number; b: number } {
  const w = { a: 0, b: 0 };
  for (const g of final ?? []) {
    if (g.a > g.b) w.a++;
    else if (g.b > g.a) w.b++;
  }
  return w;
}

// Compte à rebours — l'horloge vit dans un effet (règle react-hooks/purity).
function useCountdown(deadline: string | null): { label: string; seconds: number } | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- abonnement à l'horloge
       (système externe) : valeur initiale immédiate puis tick 1 s. */
    if (!deadline) { setRemaining(null); return; }
    const target = Date.parse(deadline);
    if (Number.isNaN(target)) { setRemaining(null); return; }
    const update = () => setRemaining(Math.max(0, target - Date.now()));
    update();
    /* eslint-enable react-hooks/set-state-in-effect */
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (remaining === null) return null;
  const s = Math.floor(remaining / 1000);
  return { label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, seconds: s };
}

export default function MatchPage({ params }: { params: Promise<{ id: string; matchId: string }> }) {
  const { id, matchId } = use(params);
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: compData } = useQuery({
    queryKey: ['competition', id, !!user],
    queryFn: async () => {
      const res = await (user ? api : apiPublic)<{ competition: {
        name: string; game: string;
        format?: { kind?: string } | null;
        schedule?: { days?: Array<{ date?: string; startsAt?: string }> } | null;
      } }>(`/api/competitions/${id}`);
      return res.competition;
    },
    staleTime: 60_000,
  });
  const { data, isError } = useQuery({
    queryKey: ['competition-match', id, matchId, !!user],
    queryFn: () => (user ? api : apiPublic)<MatchPayload>(`/api/competitions/${id}/matches/${matchId}`),
    staleTime: 5_000,
  });
  // Rafraîchissement cadencé par Web Worker (archi §5) plutôt que
  // refetchInterval : React Query met son intervalle en pause quand l'onglet
  // est en arrière-plan — or le capitaine est alt-tabbé DANS Rocket League
  // pendant tout le match, et doit retrouver un état frais en revenant.
  useWorkerInterval(() => {
    queryClient.invalidateQueries({ queryKey: ['competition-match', id, matchId] });
  }, 10_000, true);

  const m = data?.match;
  const access = data?.access;
  const involved = !!access?.side || data?.isAdmin === true;
  const game = compData?.game ?? 'rocket_league';
  const color = getGameColor(game);
  const colorRgb = getGameColorRgb(game);
  const banner = getGameBannerUrl(game);

  // Jour courant du planning : aujourd'hui si présent, sinon le prochain,
  // sinon le premier — affiché à la place d'un « VS » mort.
  const matchDay = useMemo(() => {
    const days = compData?.schedule?.days ?? [];
    if (days.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const day = days.find(d => d.date === today)
      ?? days.find(d => (d.date ?? '') >= today)
      ?? days[0];
    if (!day?.date) return null;
    const date = new Date(`${day.date}T12:00:00`);
    const label = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
    return { label, time: day.startsAt ?? null };
  }, [compData]);

  // Tick opportuniste : tient les deadlines vivantes même console fermée —
  // cadencé par Web Worker pour survivre à l'onglet en arrière-plan (le
  // capitaine est en jeu, pas sur la page, pile quand la deadline tombe).
  const tickActive = !!user && (m?.status === 'checkin' || m?.status === 'score_review');
  useWorkerInterval(() => {
    api(`/api/competitions/${id}/tick`, { method: 'POST' }).catch(() => null);
  }, 30_000, tickActive);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competition-match', id, matchId] });

  async function act(body: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    try {
      await api(`/api/competitions/${id}/matches/${matchId}`, { method: 'POST', body });
      if (okMsg) toast.success(okMsg);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Action impossible.');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const checkinCd = useCountdown(m?.status === 'checkin' ? m.checkin?.deadline ?? null : null);
  const counterCd = useCountdown(m?.status === 'score_review' ? m.scores.counterDeadline : null);

  if (isError && !data) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Match introuvable.</p>
      </div>
    );
  }
  if (!m) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  const nameA = m.teamAInfo?.name ?? (m.voidA ? 'BYE' : 'À déterminer');
  const nameB = m.teamBInfo?.name ?? (m.voidB ? 'BYE' : 'À déterminer');
  const wins = gamesWon(m.scores.final);
  const done = m.status === 'completed' || m.status === 'walkover' || m.status === 'cancelled';
  const disputeOpen = !!m.dispute && m.dispute.resolvedBy === null;
  const mySide = access?.side ?? null;
  const needed = Math.ceil(m.bo / 2);
  const myEntry = mySide ? m.scores[mySide] : [];
  const otherEntry = mySide ? m.scores[mySide === 'a' ? 'b' : 'a'] : [];
  // Camp d'écriture dans le fil (helper pur, miroir exact de la logique serveur).
  const postSideForThread = threadPostSide(access ?? null, data?.isAdmin === true);

  // Manche décisive : celle où le vainqueur atteint `needed`.
  const decisiveIndex = (() => {
    if (!m.winner || !m.scores.final) return -1;
    let count = 0;
    for (let i = 0; i < m.scores.final.length; i++) {
      const g = m.scores.final[i];
      if ((m.winner === 'a' && g.a > g.b) || (m.winner === 'b' && g.b > g.a)) {
        count++;
        if (count === needed) return i;
      }
    }
    return -1;
  })();

  // ── Bloc-action : un seul, choisi par la machine d'états ──────────────────
  type ActionKind = 'checkin' | 'admin_decision' | 'room' | 'entry' | 'submitted' | 'frozen' | null;
  const actionKind: ActionKind = (() => {
    if (done) return null;
    if (disputeOpen) return 'frozen';
    switch (m.status) {
      case 'checkin': return 'checkin';
      case 'awaiting_forfeit_validation': return 'admin_decision';
      case 'ready': return 'room';
      case 'live': return 'room';
      case 'awaiting_scores': return 'entry';
      case 'score_review': return myEntry.length > 0 ? 'submitted' : 'entry';
      default: return data?.room ? 'room' : null;   // pending avec room déjà servie
    }
  })();
  const showWell = involved && !done && (actionKind !== null || !!data?.room);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 animate-fade-in">
      <h1 className="sr-only">{nameA} vs {nameB} — {compData?.name ?? 'Compétition'}</h1>

      {/* A — Rail de contexte */}
      <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link href={`/competitions/${id}`} className="inline-flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
          <ChevronLeft size={15} /> {compData?.name ?? 'Compétition'}
        </Link>
        <span style={{ color: 'var(--s-text-muted)' }}>·</span>
        <span style={{ color: 'var(--s-text-dim)' }}>{bracketLabel(m.bracket, m.round, compData?.format?.kind === 'single_elim')}</span>
        <span style={{ color: 'var(--s-text-muted)' }}>·</span>
        <span className="t-mono" style={{ fontSize: 13, color: 'var(--s-text-muted)' }}>BO{m.bo}</span>
        {matchDay && (
          <span className="ml-auto t-mono" style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
            {matchDay.label}{matchDay.time ? ` · dès ${matchDay.time}` : ''}
          </span>
        )}
      </nav>

      {/* B — L'AFFICHE (héros public unique) */}
      <div className="panel bevel relative overflow-hidden">
        {banner && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local /public, décoratif */}
            <img src={banner} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.14 }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, var(--s-surface) 30%, rgba(${colorRgb},0.06) 100%)` }} />
          </>
        )}
        <div className="h-[3px] relative" style={{ background: `linear-gradient(90deg, ${color}, rgba(${colorRgb},0.3), transparent 70%)` }} />

        {/* Ligne de statut — l'UNIQUE emplacement du statut */}
        <div className="relative px-6 pt-5 flex items-center gap-2">
          {!done && (
            <span
              className={m.status === 'live' ? 'match-live-dot' : ''}
              style={{ width: 8, height: 8, flexShrink: 0, background: m.status === 'live' ? color : 'var(--s-text-muted)' }}
            />
          )}
          <span className="text-sm font-semibold" style={{ color: m.status === 'live' ? color : 'var(--s-text)' }}>
            {STATUS_FR[m.status] ?? m.status}
          </span>
          {m.cast?.featured && !done && (
            <span className="ml-auto">
              {m.cast.streamUrl ? (
                <a href={m.cast.streamUrl} target="_blank" rel="noopener noreferrer"
                  className="btn-springs btn-secondary bevel-sm text-sm inline-flex items-center gap-1.5">
                  <Radio size={14} /> Regarder le stream
                </a>
              ) : (
                <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
                  <Radio size={12} /> Match casté
                </span>
              )}
            </span>
          )}
        </div>

        {/* Faceoff */}
        <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-4 md:gap-6 px-6 py-6 md:py-8">
          <FaceSide info={m.teamAInfo} isVoid={m.voidA} winner={m.winner === 'a'} color={color} align="right" />
          <div className="text-center px-2">
            {m.scores.final ? (
              <p className="font-display text-5xl" style={{ letterSpacing: '0.04em', fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: m.winner === 'a' ? color : 'var(--s-text-dim)' }}>{wins.a}</span>
                <span style={{ color: 'var(--s-text-muted)' }}> – </span>
                <span style={{ color: m.winner === 'b' ? color : 'var(--s-text-dim)' }}>{wins.b}</span>
              </p>
            ) : matchDay?.time && ['pending', 'checkin', 'ready'].includes(m.status) ? (
              <div>
                <p className="font-display" style={{ fontSize: 32, color: 'var(--s-text)' }}>{matchDay.time}</p>
                <p style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>{matchDay.label}</p>
              </div>
            ) : (
              <p className="font-display" style={{ fontSize: 28, color: 'var(--s-text-muted)', letterSpacing: '0.08em' }}>VS</p>
            )}
          </div>
          <FaceSide info={m.teamBInfo} isVoid={m.voidB} winner={m.winner === 'b'} color={color} align="left" />
        </div>

        {/* Bandeau d'état (un seul, priorité litige > forfait > walkover > annulé) */}
        {(disputeOpen || m.forfeit || m.status === 'walkover' || m.status === 'cancelled') && (
          <div className="relative flex items-center gap-2 px-6 py-2.5 text-sm"
            style={{ borderTop: '1px solid var(--s-border)', background: `rgba(${colorRgb},0.06)`, color: 'var(--s-text-dim)' }}>
            {disputeOpen ? (
              <>
                <ShieldAlert size={15} style={{ color: 'var(--s-text-dim)', flexShrink: 0 }} />
                <span>Score contesté — un admin de compétition tranche et débloque le bracket.</span>
              </>
            ) : m.forfeit ? (
              <span>
                {m.forfeit.team === 'both'
                  ? 'Double forfait — les deux équipes sont éliminées.'
                  : `${m.forfeit.team === 'a' ? nameA : nameB} déclarée forfait.`}
                {m.forfeit.reason ? ` ${m.forfeit.reason}` : ''}
              </span>
            ) : m.status === 'walkover' ? (
              <span>Qualification d&apos;office — pas d&apos;adversaire sur ce match.</span>
            ) : (
              <span>Match non joué.</span>
            )}
          </div>
        )}

        {/* Registre des manches */}
        {m.scores.final && m.scores.final.length > 0 && !m.forfeit && (
          <div className="relative px-6 py-4" style={{ borderTop: '1px solid var(--s-border)' }}>
            <div className="max-w-md mx-auto w-full">
              <div className="flex items-baseline justify-between mb-1">
                <span className="t-label-soft">Manches</span>
                {m.scores.validatedBy && (
                  <span style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
                    {m.scores.validatedBy === 'auto' ? 'Validé automatiquement' : 'Validé par un admin'}
                  </span>
                )}
              </div>
              <div className="match-rows">
                {m.scores.final.map((g, i) => (
                  <GameRow key={i} index={i} game={g} teamAName={nameA} teamBName={nameB} color={color} decisive={i === decisiveIndex} />
                ))}
              </div>
              {m.dispute && m.dispute.resolvedBy && (
                <p className="mt-2" style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
                  Litige résolu{m.dispute.resolution ? ` — ${m.dispute.resolution}` : ''}.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* C — Le puits « TON MATCH » */}
      {showWell && (
        <div className="panel bevel overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <span className="t-label">{data?.isAdmin && !mySide ? 'Vue admin' : 'Ton match'}</span>
            {mySide && (
              <span className="t-label-soft">{mySide === 'a' ? nameA : nameB}</span>
            )}
          </div>
          <div className="match-well">
            <div key={`${m.status}${disputeOpen ? '-frozen' : ''}${myEntry.length > 0 ? '-submitted' : ''}`} className="animate-fade-in">
              {actionKind === 'checkin' && (
                <CheckinAction
                  m={m} mySide={mySide} canCheckin={access?.canCheckin === true} busy={busy}
                  countdown={checkinCd} color={color}
                  onCheckin={() => act({ action: 'checkin' }, 'Check-in confirmé.')}
                />
              )}
              {actionKind === 'admin_decision' && (
                <div className="match-action bevel-sm">
                  <p className="text-sm" style={{ color: 'var(--s-text)' }}>Délai écoulé.</p>
                  <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>Un admin statue — forfait ou relance du check-in.</p>
                </div>
              )}
              {actionKind === 'room' && (
                <RoomAction room={data?.room ?? null} m={m} nameA={nameA} nameB={nameB} mySide={mySide}
                  color={color} colorRgb={colorRgb}
                  onCopy={msg => toast.info(msg)} />
              )}
              {actionKind === 'entry' && (
                access?.canSubmitScores ? (
                  <div className="match-action bevel-sm">
                    <ScoreEntryForm
                      bo={m.bo}
                      teamA={{ name: nameA, tag: m.teamAInfo?.tag ?? '', logoUrl: m.teamAInfo?.logoUrl ?? null }}
                      teamB={{ name: nameB, tag: m.teamBInfo?.tag ?? '', logoUrl: m.teamBInfo?.logoUrl ?? null }}
                      mySide={mySide}
                      color={color}
                      initial={myEntry}
                      busy={busy}
                      alreadySubmitted={myEntry.length > 0}
                      otherSubmitted={otherEntry.length > 0}
                      counter={counterCd}
                      onSubmit={games => act({ action: 'submit_scores', games }, 'Score envoyé.')}
                      onDispute={() => act({ action: 'open_dispute' }, 'Litige ouvert — un admin va trancher.')}
                    />
                  </div>
                ) : (
                  <div className="match-action bevel-sm">
                    <p style={{ fontSize: 13, color: 'var(--s-text-muted)' }}>
                      La saisie est réservée au capitaine et au staff de l&apos;équipe.
                    </p>
                    {counterCd && (
                      <p className="mt-2 flex items-center gap-3">
                        <span className="t-label-soft">Contre-saisie</span>
                        <span className={`match-countdown ${counterCd.seconds < 120 ? 'is-urgent' : ''}`} style={{ fontSize: 24 }}>
                          {counterCd.label}
                        </span>
                      </p>
                    )}
                  </div>
                )
              )}
              {actionKind === 'submitted' && (
                <div className="match-action bevel-sm space-y-3">
                  <span className="t-label-soft">Ta saisie</span>
                  <div className="match-rows">
                    {myEntry.map((g, i) => (
                      <GameRow key={i} index={i} game={g} teamAName={nameA} teamBName={nameB} color={color} />
                    ))}
                  </div>
                  {otherEntry.length > 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>Les deux saisies sont là — résolution en cours.</p>
                  ) : counterCd ? (
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <span className="t-label-soft">Contre-saisie de l&apos;adversaire</span>
                        <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>Sans réponse à 0:00, ta saisie est retenue.</p>
                      </div>
                      <span className={`match-countdown ${counterCd.seconds < 120 ? 'is-urgent' : ''}`}>{counterCd.label}</span>
                    </div>
                  ) : (
                    <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>En attente de la saisie de l&apos;équipe adverse.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    {access?.canSubmitScores && (
                      <ResubmitButton m={m} mySide={mySide} color={color} busy={busy}
                        nameA={nameA} nameB={nameB}
                        onSubmit={games => act({ action: 'submit_scores', games }, 'Score corrigé.')} />
                    )}
                    {access?.canSubmitScores && (
                      <button className="quiet-link" disabled={busy}
                        onClick={() => act({ action: 'open_dispute' }, 'Litige ouvert — un admin va trancher.')}>
                        Signaler un problème
                      </button>
                    )}
                  </div>
                </div>
              )}
              {actionKind === 'frozen' && (
                <div className="match-action bevel-sm space-y-3">
                  <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text)' }}>
                    <ShieldAlert size={16} style={{ color: 'var(--s-text-dim)' }} /> Saisies gelées.
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
                    Un admin de compétition tranche et débloque le bracket. Les captures
                    d&apos;écran de chaque manche servent de preuves.
                  </p>
                  {myEntry.length > 0 && (
                    <>
                      <span className="t-label-soft">Ta saisie</span>
                      <div className="match-rows">
                        {myEntry.map((g, i) => (
                          <GameRow key={i} index={i} game={g} teamAName={nameA} teamBName={nameB} color={color} />
                        ))}
                      </div>
                    </>
                  )}
                  <DisputeScreenshots
                    competitionId={id} matchId={matchId}
                    nameA={nameA} nameB={nameB}
                    canUpload={access?.canSubmitScores === true}
                  />
                </div>
              )}
            </div>

            {/* Rangées support */}
            <div className="match-rows">
              {(m.status === 'checkin' || m.status === 'awaiting_forfeit_validation') && m.checkin && (
                <>
                  <SupportRow label={nameA} value={m.checkin.a.done ? 'Présente' : 'En attente'} strong={m.checkin.a.done} color={color} />
                  <SupportRow label={nameB} value={m.checkin.b.done ? 'Présente' : 'En attente'} strong={m.checkin.b.done} color={color} />
                </>
              )}
              {(m.status === 'ready' || m.status === 'live') && m.checkin?.a.done && m.checkin?.b.done && (
                <div className="py-2.5" style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
                  Check-in terminé — les deux équipes présentes.
                </div>
              )}
              {['awaiting_scores', 'score_review', 'disputed'].includes(m.status) && data?.room && (
                <div className="flex items-center gap-3 py-2">
                  <span className="t-label-soft">Room</span>
                  <span className="t-mono truncate" style={{ fontSize: 14, color: 'var(--s-text)' }}>{data.room.name}</span>
                  <button className="ml-auto bevel-sm flex items-center justify-center" aria-label="Copier la room"
                    style={{ width: 40, height: 40, background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                    onClick={() => {
                      navigator.clipboard?.writeText(`Room : ${data.room!.name} · Mdp : ${data.room!.password}`)
                        .then(() => toast.info('Room copiée.')).catch(() => null);
                    }}>
                    <Copy size={16} style={{ color: 'var(--s-text-dim)' }} />
                  </button>
                </div>
              )}
            </div>

            {/* Saisie à live : panel niveau 2 sous le bloc room */}
            {actionKind === 'room' && m.status === 'live' && access?.canSubmitScores && (
              <div className="panel bevel-sm">
                <div className="panel-header"><span className="t-sub">Score du match</span></div>
                <div className="panel-body">
                  <ScoreEntryForm
                    bo={m.bo}
                    teamA={{ name: nameA, tag: m.teamAInfo?.tag ?? '', logoUrl: m.teamAInfo?.logoUrl ?? null }}
                    teamB={{ name: nameB, tag: m.teamBInfo?.tag ?? '', logoUrl: m.teamBInfo?.logoUrl ?? null }}
                    mySide={mySide}
                    color={color}
                    initial={myEntry}
                    busy={busy}
                    alreadySubmitted={myEntry.length > 0}
                    otherSubmitted={otherEntry.length > 0}
                    counter={counterCd}
                    onSubmit={games => act({ action: 'submit_scores', games }, 'Score envoyé.')}
                    onDispute={() => act({ action: 'open_dispute' }, 'Litige ouvert — un admin va trancher.')}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* C bis — Fil du match (participants + admins, spec §10) */}
      {involved && (
        <MatchThread competitionId={id} matchId={matchId} active={!done}
          teamAInfo={m.teamAInfo} teamBInfo={m.teamBInfo}
          postSide={postSideForThread} myName={user?.displayName ?? 'Toi'} color={color} />
      )}

      {/* D — Alignements */}
      {(data?.rosters?.a?.length || data?.rosters?.b?.length) ? (
        <div className="panel bevel">
          <div className="panel-header"><span className="t-sub">Alignements</span></div>
          <div className="panel-body grid sm:grid-cols-2 gap-x-8 gap-y-4">
            <RosterColumn info={m.teamAInfo} roster={data?.rosters?.a ?? null} color={color} />
            <RosterColumn info={m.teamBInfo} roster={data?.rosters?.b ?? null} color={color} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Fil du match — primitive « thread attaché à un objet », 1re instance ─────

interface ThreadMessage {
  id: string;
  side: 'a' | 'b' | 'admin';
  authorName: string;
  body: string;
  createdAt: string | null;
  clientNonce?: string;
}

function MatchThread({ competitionId, matchId, teamAInfo, teamBInfo, postSide, myName, color, active }: {
  competitionId: string;
  matchId: string;
  teamAInfo: Side;
  teamBInfo: Side;
  /** Camp d'écriture du lecteur (miroir serveur) — null = lecture seule. */
  postSide: 'a' | 'b' | 'admin' | null;
  myName: string;
  color: string;
  /** Match encore vivant : cadence le polling (un match terminé ne bouge plus). */
  active: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { data } = useQuery({
    queryKey: ['match-thread', competitionId, matchId],
    queryFn: () => api<{ messages: ThreadMessage[]; canPost: boolean }>(
      `/api/competitions/${competitionId}/matches/${matchId}/thread`),
    staleTime: 4_000,
  });
  // Cadence Web Worker : le capitaine est alt-tabbé en jeu, le fil doit être
  // frais quand il revient (même logique que le reste de la page).
  useWorkerInterval(() => {
    queryClient.invalidateQueries({ queryKey: ['match-thread', competitionId, matchId] });
  }, 8_000, active);

  // Fil affiché = messages serveur + optimistes non encore confirmés (dédup par
  // nonce, helper pur partagé/testé) — plus d'attente ~2 s (retour Matt).
  const messages = useMemo(() => mergeThread(data?.messages ?? [], pending), [data?.messages, pending]);

  // Les derniers messages vivent EN BAS : coller la vue au bas du fil à chaque
  // nouveau message (review Lot 4 — sans ça le conteneur restait ancré en haut).
  const messageCount = messages.length;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !postSide) return;
    // Affichage OPTIMISTE : le message apparaît tout de suite (nonce client), puis
    // le refetch le remplace par le vrai (le serveur renvoie le nonce → pas de
    // doublon), ou on le retire en cas d'échec.
    const nonce = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const optimistic: ThreadMessage = { id: `optimistic-${nonce}`, side: postSide, authorName: myName, body, createdAt: new Date().toISOString(), clientNonce: nonce };
    setPending(p => [...p, optimistic]);
    setDraft('');
    setSending(true);
    try {
      await api(`/api/competitions/${competitionId}/matches/${matchId}/thread`, {
        method: 'POST', body: { body, clientNonce: nonce },
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Message impossible à envoyer.');
      setPending(p => p.filter(x => x.clientNonce !== nonce));       // rollback l'optimiste
      setDraft(d => (d === '' ? body : d));                          // ne pas écraser un nouveau brouillon
      setSending(false);
      return;
    }
    setSending(false);
    // POST réussi : le refetch est HORS du try qui gate le rollback — un échec de
    // rafraîchissement ne doit ni afficher d'erreur ni remettre en boîte un
    // message déjà envoyé (le prochain worker-tick rafraîchira de toute façon).
    try {
      await queryClient.invalidateQueries({ queryKey: ['match-thread', competitionId, matchId] });
    } catch { /* non bloquant */ }
    setPending(p => p.filter(x => x.clientNonce !== nonce));         // filet (la dédup nonce l'a déjà masqué)
  };

  const labelOf = (msg: ThreadMessage) =>
    msg.side === 'admin' ? 'Admin' : msg.side === 'a' ? (teamAInfo?.name ?? 'Équipe A') : (teamBInfo?.name ?? 'Équipe B');
  const hhmm = (iso: string | null) => {
    if (!iso) return '';
    const t = Date.parse(iso);
    return Number.isNaN(t) ? '' : new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(t);
  };
  // Pseudo coloré par camp : le tien à la couleur du jeu, l'adversaire en
  // neutre, l'admin en or (autorité). Le crest lève toute ambiguïté d'équipe.
  const nameColor = (msg: ThreadMessage) =>
    msg.side === 'admin' ? 'var(--s-gold)' : msg.side === postSide ? color : 'var(--s-text)';
  const crestOf = (msg: ThreadMessage) => {
    if (msg.side === 'admin') return <ShieldCheck size={16} style={{ color: 'var(--s-gold)' }} />;
    const info = msg.side === 'a' ? teamAInfo : teamBInfo;
    return info ? <TeamCrest url={info.logoUrl} tag={info.tag} name={info.name} size={16} /> : null;
  };

  return (
    <div className="panel bevel">
      <div className="panel-header"><span className="t-sub">Fil du match</span></div>
      <div className="panel-body space-y-3">
        {messages.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
            Aucun message. Visible des deux équipes et des admins — coordonnez-vous ici
            (retard, room, remplacement de dernière minute).
          </p>
        ) : (
          <div ref={listRef} className="space-y-2" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {messages.map(msg => (
              <div key={msg.id} className="flex items-start gap-2 text-sm" style={{ lineHeight: 1.45 }}>
                <span className="flex-shrink-0" style={{ marginTop: 2 }}>{crestOf(msg)}</span>
                <div className="min-w-0">
                  <span className="font-semibold" style={{ color: nameColor(msg) }}>{msg.authorName}</span>
                  <span style={{ color: 'var(--s-text-muted)', fontSize: 12 }}>
                    {' '}· {labelOf(msg)}{msg.createdAt ? ` · ${hhmm(msg.createdAt)}` : ''}
                  </span>
                  <p style={{ color: 'var(--s-text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{msg.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {data?.canPost ? (
          <div className="flex items-end gap-2">
            <textarea
              className="settings-input flex-1"
              rows={2}
              maxLength={500}
              placeholder="Message aux deux équipes et aux admins…"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                // isComposing : ne pas envoyer pendant une composition IME.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              }}
            />
            <button className="btn-springs btn-secondary bevel-sm text-sm" disabled={sending || !draft.trim()}
              onClick={send}>
              Envoyer
            </button>
          </div>
        ) : data ? (
          <p style={{ fontSize: 12.5, color: 'var(--s-text-muted)' }}>
            Lecture seule — seuls le capitaine, le staff et les admins écrivent.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────

function FaceSide({ info, isVoid, winner, color, align }: {
  info: Side; isVoid: boolean; winner: boolean; color: string; align: 'left' | 'right';
}) {
  const unknown = !info || isVoid;
  return (
    <div className={`flex items-center gap-4 min-w-0 ${align === 'right' ? 'sm:flex-row-reverse sm:text-right' : ''}`}>
      {!unknown && <TeamCrest url={info!.logoUrl} tag={info!.tag} name={info!.name} size={80} />}
      <div className="min-w-0">
        {winner && <p className="t-label-soft" style={{ color }}>Vainqueur</p>}
        <p className="font-display line-clamp-2" style={{
          fontSize: unknown ? 20 : 'clamp(22px, 3vw, 30px)',
          letterSpacing: '0.03em',
          lineHeight: 1.05,
          color: unknown ? 'var(--s-text-muted)' : winner ? color : 'var(--s-text)',
        }}>
          {isVoid ? 'BYE' : info ? info.name.toUpperCase() : 'À DÉTERMINER'}
        </p>
        {info && !isVoid && (
          <p className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>[{info.tag}]</p>
        )}
      </div>
    </div>
  );
}

function CheckinAction({ m, mySide, canCheckin, busy, countdown, color, onCheckin }: {
  m: MatchPayload['match'];
  mySide: 'a' | 'b' | null;
  canCheckin: boolean;
  busy: boolean;
  countdown: { label: string; seconds: number } | null;
  color: string;
  onCheckin: () => void;
}) {
  const myDone = mySide && m.checkin ? m.checkin[mySide].done : false;
  return (
    <div className="match-action bevel-sm">
      <div className="grid sm:grid-cols-[1fr_auto] items-center gap-4">
        <div className="space-y-2">
          <p className="font-display text-lg" style={{ letterSpacing: '0.03em' }}>Check-in</p>
          <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
            À 0:00 sans check-in, un admin statue — forfait possible.
          </p>
          {mySide && !myDone ? (
            canCheckin ? (
              <button className="btn-springs btn-primary bevel-sm w-full sm:w-auto" disabled={busy} onClick={onCheckin}>
                Check-in de mon équipe
              </button>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--s-text-muted)' }}>Seul le capitaine peut check-in.</p>
            )
          ) : mySide && myDone ? (
            <p style={{ fontSize: 13, color }}>Ton équipe est pointée.</p>
          ) : null}
        </div>
        {countdown && (
          <div className="text-center sm:text-right">
            <p className="t-label-soft" style={{ color: 'var(--s-text-muted)' }}>Temps restant</p>
            <span className={`match-countdown ${countdown.seconds < 120 ? 'is-urgent' : ''}`} style={{ fontSize: 44 }}>
              {countdown.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function RoomAction({ room, m, nameA, nameB, mySide, color, colorRgb, onCopy }: {
  room: { name: string; password: string } | null;
  m: MatchPayload['match'];
  nameA: string;
  nameB: string;
  mySide: 'a' | 'b' | null;
  color: string;
  colorRgb: string;
  onCopy: (msg: string) => void;
}) {
  if (!room) {
    return (
      <div className="match-action bevel-sm">
        <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>Identifiants de room pas encore communiqués.</p>
      </div>
    );
  }
  const hostName = m.roomHost === 'a' ? nameA : nameB;
  const iAmHost = mySide !== null && m.roomHost === mySide;
  const copy = (value: string, msg: string) => {
    navigator.clipboard?.writeText(value).then(() => onCopy(msg)).catch(() => null);
  };
  return (
    <div className="match-action bevel-sm space-y-4">
      {iAmHost ? (
        <span className="bevel-sm inline-flex px-2.5 py-1 font-semibold" style={{
          fontSize: 13, border: `1px solid ${color}`, background: `rgba(${colorRgb},0.10)`, color,
        }}>
          Ton équipe crée la room
        </span>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
          Room créée par <span className="font-semibold" style={{ color: 'var(--s-text)' }}>{hostName}</span>
        </p>
      )}
      <div className="space-y-3">
        {([['Nom', room.name, 'Nom copié.'], ['Mot de passe', room.password, 'Mot de passe copié.']] as const).map(([label, value, msg]) => (
          <div key={label} className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <p className="t-label-soft">{label}</p>
              <p className="t-mono break-all" style={{ fontSize: 17, color: 'var(--s-text)' }}>{value}</p>
            </div>
            <button className="bevel-sm flex items-center justify-center flex-shrink-0" aria-label={`Copier ${label.toLowerCase()}`}
              style={{ width: 40, height: 40, background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
              onClick={() => copy(value, msg)}>
              <Copy size={16} style={{ color: 'var(--s-text-dim)' }} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn-springs btn-secondary bevel-sm"
        onClick={() => copy(`Room : ${room.name} · Mdp : ${room.password}`, 'Room copiée.')}>
        Tout copier
      </button>
    </div>
  );
}

function SupportRow({ label, value, strong, color }: { label: string; value: string; strong: boolean; color: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm" style={{ minHeight: 40 }}>
      <span style={{ color: 'var(--s-text)' }}>{label}</span>
      <span className="font-semibold" style={{ color: strong ? color : 'var(--s-text-muted)' }}>{value}</span>
    </div>
  );
}

function RosterColumn({ info, roster, color }: { info: Side; roster: RosterPlayer[] | null; color: string }) {
  const ordered = roster
    ? [...roster].sort((a, b) => (a.role === b.role ? 0 : a.role === 'titulaire' ? -1 : 1))
    : null;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 pb-2" style={{ borderBottom: '1px solid var(--s-border)' }}>
        {info && <TeamCrest url={info.logoUrl} tag={info.tag} name={info.name} size={24} />}
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>
          {info?.name ?? 'À déterminer'}
        </span>
      </div>
      {ordered && ordered.length > 0 ? (
        <div className="match-rows">
          {ordered.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm" style={{ minHeight: 36 }}>
              <span style={{
                width: 7, height: 7, flexShrink: 0,
                background: p.role === 'titulaire' ? color : 'transparent',
                border: p.role === 'titulaire' ? 'none' : '1px solid var(--s-text-muted)',
              }} />
              <span className="truncate" style={{ color: p.role === 'titulaire' ? 'var(--s-text)' : 'var(--s-text-dim)' }}>
                {p.displayName}
              </span>
              {p.verified && <ShieldCheck size={12} style={{ color: 'var(--s-text-dim)', flexShrink: 0 }} />}
              {p.isCaptain && <span className="ml-auto t-label-soft flex-shrink-0">Capitaine</span>}
            </div>
          ))}
        </div>
      ) : (
        <p className="pt-2" style={{ fontSize: 13, color: 'var(--s-text-muted)' }}>Alignement non communiqué.</p>
      )}
    </div>
  );
}

// Correction après soumission : rouvre le formulaire dans une zone dédiée.
function ResubmitButton({ m, mySide, color, busy, nameA, nameB, onSubmit }: {
  m: MatchPayload['match'];
  mySide: 'a' | 'b' | null;
  color: string;
  busy: boolean;
  nameA: string;
  nameB: string;
  onSubmit: (games: Game[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button className="btn-springs btn-secondary bevel-sm" disabled={busy} onClick={() => setEditing(true)}>
        Corriger ma saisie
      </button>
    );
  }
  return (
    <div className="w-full">
      <ScoreEntryForm
        bo={m.bo}
        teamA={{ name: nameA, tag: m.teamAInfo?.tag ?? '', logoUrl: m.teamAInfo?.logoUrl ?? null }}
        teamB={{ name: nameB, tag: m.teamBInfo?.tag ?? '', logoUrl: m.teamBInfo?.logoUrl ?? null }}
        mySide={mySide}
        color={color}
        initial={mySide ? m.scores[mySide] : []}
        busy={busy}
        alreadySubmitted
        otherSubmitted={mySide ? m.scores[mySide === 'a' ? 'b' : 'a'].length > 0 : false}
        counter={null}
        onSubmit={onSubmit}
        onDispute={() => null}
        hideDispute
      />
    </div>
  );
}

function ScoreEntryForm({ bo, teamA, teamB, mySide, color, initial, busy, alreadySubmitted, otherSubmitted, counter, onSubmit, onDispute, hideDispute = false }: {
  bo: number;
  teamA: { name: string; tag: string; logoUrl: string | null };
  teamB: { name: string; tag: string; logoUrl: string | null };
  mySide: 'a' | 'b' | null;
  color: string;
  initial: Game[];
  busy: boolean;
  alreadySubmitted: boolean;
  otherSubmitted: boolean;
  counter: { label: string; seconds: number } | null;
  onSubmit: (games: Game[]) => void;
  onDispute: () => void;
  hideDispute?: boolean;
}) {
  const needed = Math.ceil(bo / 2);
  // Rangées AUTO-GÉRÉES (helper pur, partagé avec la console) : le formulaire
  // montre toujours le bon nombre de manches, un 2-1 ouvre la manche suivante,
  // un score impossible (4-0 en BO5) ne peut pas être construit.
  const [games, setGames] = useState<Game[]>(() => normalizeGameRows(initial, bo));

  const wins = useMemo(() => {
    const w = { a: 0, b: 0 };
    for (const g of games) { if (g.a > g.b) w.a++; else if (g.b > g.a) w.b++; }
    return w;
  }, [games]);
  const valid = isScoreValid(games, bo);

  const setVal = (i: number, side: 'a' | 'b', v: number) => {
    const clamped = Math.max(0, Math.min(99, v));
    setGames(gs => normalizeGameRows(gs.map((x, j) => (j === i ? { ...x, [side]: clamped } : x)), bo));
  };

  return (
    <div className="space-y-4">
      <p style={{ fontSize: 13, color: 'var(--s-text-dim)' }}>
        Buts de chaque manche, dans l&apos;ordre. Vainqueur à {needed} manches (BO{bo}).
      </p>

      {/* En-têtes de colonnes NOMMÉES — équipe A · Manche · équipe B (label centré) */}
      <div className="hidden sm:grid grid-cols-[1fr_88px_1fr] items-end gap-3">
        <div className="flex justify-end"><ColumnHead team={teamA} mine={mySide === 'a'} color={color} /></div>
        <span />
        <div className="flex justify-start"><ColumnHead team={teamB} mine={mySide === 'b'} color={color} /></div>
      </div>

      <div className="space-y-2">
        {games.map((g, i) => (
          <div key={i}>
            {/* sm+ : une ligne — saisie A · Manche N centré · saisie B */}
            <div className="hidden sm:grid grid-cols-[1fr_88px_1fr] items-center gap-3">
              <div className="flex justify-end">
                <Stepper value={g.a} onChange={v => setVal(i, 'a', v)} label={`Buts ${teamA.name}, manche ${i + 1}`} />
              </div>
              <span className="t-label-soft text-center whitespace-nowrap">Manche {i + 1}</span>
              <div className="flex justify-start">
                <Stepper value={g.b} onChange={v => setVal(i, 'b', v)} label={`Buts ${teamB.name}, manche ${i + 1}`} />
              </div>
            </div>
            {/* mobile : une ligne PAR équipe (nom + stepper). Deux steppers côte à
                côte (144px chacun) débordaient le puits et rognaient les boutons de
                bord à ≤390px (review) — empilés, chaque stepper est atteignable. */}
            <div className="sm:hidden space-y-2">
              <span className="t-label-soft block text-center">Manche {i + 1}</span>
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-sm" style={{ color: mySide === 'a' ? color : 'var(--s-text-dim)' }}>{teamA.name}</span>
                <Stepper value={g.a} onChange={v => setVal(i, 'a', v)} label={`Buts ${teamA.name}, manche ${i + 1}`} />
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-sm" style={{ color: mySide === 'b' ? color : 'var(--s-text-dim)' }}>{teamB.name}</span>
                <Stepper value={g.b} onChange={v => setVal(i, 'b', v)} label={`Buts ${teamB.name}, manche ${i + 1}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Total live */}
      <p className="text-center font-display" style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>
        <span className="truncate inline-block align-bottom" style={{ maxWidth: '16ch', color: wins.a >= wins.b ? 'var(--s-text)' : 'var(--s-text-dim)' }}>
          {teamA.name.toUpperCase()}
        </span>
        <span style={{ color: 'var(--s-text)' }}> {wins.a} – {wins.b} </span>
        <span className="truncate inline-block align-bottom" style={{ maxWidth: '16ch', color: wins.b >= wins.a ? 'var(--s-text)' : 'var(--s-text-dim)' }}>
          {teamB.name.toUpperCase()}
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-springs btn-primary bevel-sm" disabled={busy || !valid} onClick={() => onSubmit(games)}>
          {alreadySubmitted ? 'Corriger le score' : 'Envoyer le score'}
        </button>
        {counter && otherSubmitted && !alreadySubmitted && (
          <span className="flex items-center gap-2">
            <span className="t-label-soft">Contre-saisie</span>
            <span className={`match-countdown ${counter.seconds < 120 ? 'is-urgent' : ''}`} style={{ fontSize: 24 }}>
              {counter.label}
            </span>
          </span>
        )}
        {!hideDispute && (
          <button className="quiet-link" disabled={busy} onClick={onDispute}>Signaler un problème</button>
        )}
      </div>
      {!valid && (
        <p style={{ fontSize: 13, color: 'var(--s-text-muted)' }}>
          Il faut un vainqueur à {needed} manches, sans manche nulle.
        </p>
      )}
    </div>
  );
}

// Captures d'écran du litige (spec §9) : preuves uploadées par les deux camps,
// visibles des membres du match + admins (URLs signées courtes).
function DisputeScreenshots({ competitionId, matchId, nameA, nameB, canUpload }: {
  competitionId: string;
  matchId: string;
  nameA: string;
  nameB: string;
  canUpload: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const { data } = useQuery({
    queryKey: ['match-screenshots', competitionId, matchId],
    queryFn: () => api<{ a: Array<{ key: string; url: string }>; b: Array<{ key: string; url: string }> }>(
      `/api/competitions/${competitionId}/matches/${matchId}/screenshots`),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const form = new FormData();
        form.append('file', file);
        await apiForm(`/api/competitions/${competitionId}/matches/${matchId}/screenshots`, form);
      }
      toast.success(files.length > 1 ? `${files.length} captures envoyées.` : 'Capture envoyée.');
      queryClient.invalidateQueries({ queryKey: ['match-screenshots', competitionId, matchId] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Envoi impossible.');
    } finally {
      setUploading(false);
    }
  }

  const sideBlock = (label: string, shots: Array<{ key: string; url: string }> | undefined) => (
    <div className="min-w-0">
      <p className="t-label-soft mb-1">{label}</p>
      {shots && shots.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {shots.map(s => (
            <a key={s.key} href={s.url} target="_blank" rel="noopener noreferrer" className="bevel-sm block"
              style={{ border: '1px solid var(--s-border)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- URL signée R2 éphémère, hors next/image */}
              <img src={s.url} alt={`Capture ${label}`} style={{ height: 72, width: 112, objectFit: 'cover', display: 'block' }} />
            </a>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--s-text-muted)' }}>Aucune capture.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-3 pt-1" style={{ borderTop: '1px solid var(--s-border)', paddingTop: 12 }}>
      <div className="flex items-center justify-between gap-3">
        <span className="t-label-soft">Captures des manches</span>
        {canUpload && (
          <label className={`btn-springs btn-secondary bevel-sm text-sm ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
            {uploading ? 'Envoi…' : 'Ajouter des captures'}
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only"
              onChange={e => { upload(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {sideBlock(nameA, data?.a)}
        {sideBlock(nameB, data?.b)}
      </div>
    </div>
  );
}

function ColumnHead({ team, mine, color }: {
  team: { name: string; tag: string; logoUrl: string | null }; mine: boolean; color: string;
}) {
  return (
    <div className="min-w-0">
      {mine && <p className="t-label-soft" style={{ color }}>Ton équipe</p>}
      <div className="flex items-center gap-2">
        <TeamCrest url={team.logoUrl} tag={team.tag} name={team.name} size={32} />
        <span className="font-display truncate" style={{ fontSize: 17, letterSpacing: '0.03em' }}>{team.name.toUpperCase()}</span>
        {team.tag && <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>[{team.tag}]</span>}
      </div>
    </div>
  );
}

function Stepper({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="match-stepper bevel-sm" disabled={value <= 0} aria-label={`${label} : moins`}
        onClick={() => onChange(value - 1)}>−</button>
      <input
        inputMode="numeric"
        className="match-score-input bevel-sm"
        aria-label={label}
        value={value}
        onChange={e => onChange(Math.max(0, Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 0)))}
      />
      <button type="button" className="match-stepper bevel-sm" disabled={value >= 99} aria-label={`${label} : plus`}
        onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}
