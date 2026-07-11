'use client';

// Fiche publique d'un CIRCUIT (Legends Springs Cup) — la vitrine marquee du
// module. Refonte « Le Dossier » : héros verdict live-state (identité + carte
// focus prochaine étape avec stat + CTA accolé), LE PARCOURS en roadmap à nœuds
// (le geste qui dit « circuit » et pas « tournoi »), zone référence resserrée,
// classement Faceit-like (crests + zone LAN). L'inscription part d'ici, dirigée
// vers la Qualif ouverte. Gating : circuit brouillon/test = 404 public, servi
// aux testeurs. On ne touche ni au fetch ni aux gates.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, Trophy, ArrowRight, ScrollText, Users2, EyeOff, ChevronRight, Check } from 'lucide-react';
import { api, apiPublic, ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import GameTag from '@/components/games/GameTag';
import TeamCrest from '@/components/competitions/TeamCrest';
import GlanceStat from '@/components/competitions/GlanceStat';
import OrganizerCredit from '@/components/competitions/OrganizerCredit';
import { Skeleton } from '@/components/ui/Skeleton';
import { getGameColor, getGameColorRgb, getGameBannerUrl, getGameLogoUrl } from '@/lib/games-registry';
import { stageState, pickFocusEvent, type StageState } from '@/lib/competitions/circuit-timeline';
import type { CompetitionEligibility, CompetitionFormat } from '@/types/competitions';

interface CircuitEvent {
  id: string;
  name: string;
  status: string;
  hidden: boolean;
  startDate: string | null;
  endDate: string | null;
  opensAt: string | null;
  closesAt: string | null;
  registrationOpen: boolean;
  approvedCount: number;
  maxTeams: number | null;
  prizePool: { amount: number; currency: string } | number | null;
}

interface StandingRow {
  teamId: string;
  name: string;
  tag: string;
  totalPoints: number;
  playedCount: number;
  goalDiffCounted: number;
  qualifiedForLan: boolean;
  rank: number;
}

interface CircuitData {
  circuit: {
    id: string;
    name: string;
    game: string;
    status: string;
    bestResultsCount: number;
    lanTeamCount: number;
    prizePool: { amount: number; currency: string; note?: string } | null;
    organizer: { name: string; logoUrl?: string | null } | null;
    pointsScale: Record<string, number>;
    isDev: boolean;
  };
  events: CircuitEvent[];
  formatSample: {
    format: CompetitionFormat | null;
    eligibility: CompetitionEligibility | null;
    roster: { starters: number; subsMax: number } | null;
  } | null;
  standings: StandingRow[];
  registrationTargetId: string | null;
  registrationTargetName: string | null;
  registrationTargetOpen: boolean;
}

const EVENT_STATUS: Record<string, string> = {
  draft: 'Brouillon',
  registration: 'Inscriptions ouvertes',
  validation: 'Validation',
  seeding: 'Seeding',
  live: 'En cours',
  finished: 'Terminé',
  archived: 'Archivé',
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
  catch { return null; }
}

function fmtRange(start: string | null, end: string | null): string | null {
  const a = fmtDate(start);
  const b = fmtDate(end);
  if (a && b && a !== b) return `${a} – ${b}`;
  return a ?? b;
}

function fmtPrize(p: { amount: number; currency: string } | number | null): string | null {
  if (p == null) return null;
  if (typeof p === 'number') return p > 0 ? `${p} €` : null;
  if (p.amount > 0) return `${p.amount} ${p.currency === 'EUR' ? '€' : p.currency}`;
  return null;
}

export default function CircuitPage() {
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<CircuitData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const fetcher = user
      ? api<CircuitData>(`/api/competitions/circuit/${params.id}`)
      : apiPublic<CircuitData>(`/api/competitions/circuit/${params.id}`);
    fetcher
      .then(res => { if (!cancelled) { setData(res); setNotFound(false); } })
      .catch(err => { if (!cancelled) setNotFound(err instanceof ApiError && err.status === 404); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id, user, authLoading]);

  if (loading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>Circuit introuvable.</p>
      </div>
    );
  }

  const { circuit, events, formatSample, standings, registrationTargetId, registrationTargetOpen } = data;
  const color = getGameColor(circuit.game);
  const colorRgb = getGameColorRgb(circuit.game);
  const banner = getGameBannerUrl(circuit.game);
  const gameLogo = getGameLogoUrl(circuit.game);
  const prize = fmtPrize(circuit.prizePool);
  const qualifCount = events.length;
  const reglementHref = registrationTargetId
    ? `/competitions/${registrationTargetId}/reglement`
    : events[0] ? `/competitions/${events[0].id}/reglement` : null;
  const eligibility = formatSample?.eligibility ?? null;
  const format = formatSample?.format ?? null;
  const roster = formatSample?.roster ?? null;
  const scaleEntries = Object.entries(circuit.pointsScale)
    .map(([place, pts]) => [Number(place), pts] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  // ── Héros focus : l'étape mise en avant + son mode d'action ──
  const focus = pickFocusEvent(events);
  const focusEvent = events.find(e => e.id === registrationTargetId) ?? focus.event;
  const canRegister = !!registrationTargetId && !!user;
  // Or rationné à 1 occurrence : le CTA d'inscription EST l'or quand il existe ;
  // sinon la dotation devient le moment or.
  const prizeGold = !canRegister;

  const heroEyebrow = registrationTargetId
    ? (registrationTargetOpen ? 'Inscriptions ouvertes' : 'Accès test')
    : focus.mode === 'live' ? 'En cours'
    : focus.mode === 'upcoming' ? 'Prochaine étape'
    : focus.mode === 'done' ? 'Circuit terminé'
    : 'Circuit';
  const focusMeta = registrationTargetOpen && focusEvent?.closesAt
    ? `Clôture le ${fmtDate(focusEvent.closesAt)}`
    : focusEvent ? fmtRange(focusEvent.startDate, focusEvent.endDate) : null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 animate-fade-in">
      {/* ── HÉROS (niveau 1) : identité + carte focus prochaine étape ── */}
      <section className="panel bevel relative overflow-hidden">
        {banner && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local /public, décoratif */}
            <img src={banner} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.14 }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, var(--s-surface) 40%, rgba(${colorRgb},0.06) 100%)` }} />
          </>
        )}
        <div className="h-[3px] relative" style={{ background: `linear-gradient(90deg, ${color}, rgba(${colorRgb},0.3), transparent 70%)` }} />
        <div className="relative p-6 lg:p-8">
          {/* Crédit organisateur en tête — l'entité qui possède la compétition (Aedral héberge) */}
          {circuit.organizer?.name && (
            <div className="mb-5 pb-5" style={{ borderBottom: '1px solid var(--s-border)' }}>
              <OrganizerCredit organizer={circuit.organizer} height={54} showHost />
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            {/* Identité */}
            <div className="flex items-start gap-4 min-w-0">
              {gameLogo && (
                <div className="bevel-sm flex items-center justify-center flex-shrink-0" style={{ width: 56, height: 56, background: 'var(--s-elevated)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={gameLogo} alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: 'contain' }} />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {!circuit.organizer?.name && (
                    <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Circuit</span>
                  )}
                  <GameTag gameId={circuit.game} size="sm" />
                  {circuit.isDev && (
                    <span className="tag tag-neutral inline-flex items-center gap-1" style={{ color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)' }}>
                      <EyeOff size={12} /> Test · masqué
                    </span>
                  )}
                </div>
                <h1 className="font-display text-4xl lg:text-5xl" style={{ letterSpacing: '0.03em', lineHeight: 1.02 }}>
                  {circuit.name.toUpperCase()}
                </h1>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm mt-2" style={{ color: 'var(--s-text-dim)' }}>
                  <span className="inline-flex items-center gap-1.5">
                    <Users2 size={14} /> {qualifCount} Qualif{qualifCount > 1 ? 's' : ''} → LAN {circuit.lanTeamCount}
                  </span>
                  {prize && (
                    <span className="inline-flex items-center gap-1.5" style={{ color: prizeGold ? 'var(--s-gold)' : 'var(--s-text)', fontWeight: 600 }}>
                      <Trophy size={14} style={{ color: prizeGold ? 'var(--s-gold)' : 'var(--s-text-dim)' }} /> {prize}
                      {circuit.prizePool?.note ? <span style={{ color: 'var(--s-text-dim)', fontWeight: 400 }}>· {circuit.prizePool.note}</span> : null}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Carte focus : prochaine étape / statut + stat + CTA accolé */}
            <div className="bevel-sm p-4 lg:min-w-[280px]" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <p className="t-label mb-1" style={{ color: registrationTargetOpen ? color : 'var(--s-text-muted)' }}>{heroEyebrow}</p>
              {focusEvent ? (
                <>
                  <p className="font-display text-2xl" style={{ letterSpacing: '0.02em', lineHeight: 1.05 }}>{focusEvent.name.toUpperCase()}</p>
                  {focusMeta && (
                    <p className="text-sm mt-1 inline-flex items-center gap-1.5" style={{ color: registrationTargetOpen ? '#ffb46b' : 'var(--s-text-dim)' }}>
                      <CalendarDays size={13} /> {focusMeta}
                    </p>
                  )}
                  <div className="mt-3">
                    <GlanceStat mono size={22}
                      value={`${focusEvent.approvedCount}${focusEvent.maxTeams ? ` / ${focusEvent.maxTeams}` : ''}`}
                      label="équipes inscrites" />
                  </div>
                </>
              ) : focus.mode === 'done' ? (
                <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Le circuit est terminé — voir le classement final ci-dessous.</p>
              ) : (
                <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Aucune inscription ouverte pour le moment.</p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                {canRegister && (
                  <Link href={`/competitions/${registrationTargetId}/inscription`} className="btn-springs btn-primary bevel-sm text-sm inline-flex items-center gap-1.5">
                    Inscrire une équipe <ArrowRight size={14} />
                  </Link>
                )}
                {!canRegister && registrationTargetId && !user && registrationTargetOpen && (
                  <Link href={`/competitions/${registrationTargetId}`} className="btn-springs btn-secondary bevel-sm text-sm">
                    Se connecter pour s&apos;inscrire
                  </Link>
                )}
                {!canRegister && focusEvent && (
                  <Link href={`/competitions/${focusEvent.id}`} className="btn-springs btn-secondary bevel-sm text-sm">
                    Voir la Qualif
                  </Link>
                )}
                {reglementHref && (
                  <Link href={reglementHref} className="btn-springs btn-ghost text-sm inline-flex items-center gap-1.5">
                    <ScrollText size={14} /> Règlement
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── LE PARCOURS : roadmap à nœuds (le geste-signature du circuit) ── */}
      <section>
        <p className="t-label mb-3" style={{ color: 'var(--s-text-muted)' }}>Le parcours</p>
        <div className="panel bevel" style={{ background: 'var(--s-bg)' }}>
          <div className="panel-body p-0">
            <div className="relative pl-2 pr-2 py-2">
              {/* ligne de liaison verticale */}
              <div aria-hidden style={{ position: 'absolute', left: 30, top: 32, bottom: 40, width: 2, background: 'var(--s-border)' }} />
              {events.map((e, i) => {
                const st: StageState = stageState(e);
                const range = fmtRange(e.startDate, e.endDate);
                const canRegisterHere = e.registrationOpen || (e.hidden && registrationTargetId === e.id);
                const isHere = st === 'open';
                const nodeColor = st === 'played' ? 'var(--s-text-muted)'
                  : (st === 'open' || st === 'live') ? color : 'var(--s-text-dim)';
                return (
                  <div key={e.id} className="relative flex items-center gap-3 py-3 pr-2 group">
                    {/* Nœud */}
                    <div className="flex-shrink-0 flex items-center justify-center bevel-sm relative"
                      style={{
                        width: 30, height: 30, marginLeft: 15, background: st === 'upcoming' ? 'var(--s-bg)' : 'var(--s-surface)',
                        border: `1px solid ${st === 'played' ? 'var(--s-border)' : nodeColor}`,
                        boxShadow: isHere ? `0 0 0 4px rgba(${colorRgb},0.12)` : 'none', zIndex: 1,
                      }}>
                      {st === 'played'
                        ? <Check size={14} style={{ color: 'var(--s-text-muted)' }} />
                        : <span className="t-mono" style={{ fontSize: 13, fontWeight: 600, color: nodeColor }}>{i + 1}</span>}
                    </div>
                    {/* Contenu — toute la ligne mène à la fiche Qualif (hover net) */}
                    <Link href={`/competitions/${e.id}`} className="group/step flex items-center gap-3 flex-1 min-w-0 px-2 py-1.5 -my-1 transition-colors hover:bg-[var(--s-elevated)]">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold truncate group-hover/step:underline" style={{ color: 'var(--s-text)' }}>{e.name}</span>
                          <span className="tag tag-neutral" style={st === 'open' || st === 'live' ? { color, borderColor: `rgba(${colorRgb},0.4)` } : undefined}>
                            {isHere ? 'Tu es ici' : EVENT_STATUS[e.status] ?? e.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                          {range && <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {range}</span>}
                          <span>{e.approvedCount}{e.maxTeams ? ` / ${e.maxTeams}` : ''} équipes</span>
                        </div>
                      </div>
                    </Link>
                    {canRegisterHere && user ? (
                      <Link href={`/competitions/${e.id}/inscription`} className="btn-springs btn-secondary bevel-sm text-sm flex-shrink-0">
                        S&apos;inscrire
                      </Link>
                    ) : (
                      <ChevronRight size={16} className="flex-shrink-0" style={{ color: 'var(--s-text-muted)' }} />
                    )}
                  </div>
                );
              })}
              {/* Destination : la LAN (pas un event — son propre format, spec §1) */}
              <div className="relative flex items-center gap-3 py-3 pr-2">
                <div className="flex-shrink-0 flex items-center justify-center bevel-sm"
                  style={{ width: 30, height: 30, marginLeft: 15, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', zIndex: 1 }}>
                  <Trophy size={15} style={{ color: 'var(--s-text-dim)' }} />
                </div>
                <div className="flex-1 min-w-0 pl-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">LAN finale</span>
                    <span className="tag tag-neutral">Destination</span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                    {circuit.lanTeamCount} équipes qualifiées{prize ? ` · ${prize}` : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Zone RÉFÉRENCE : comment se qualifier + format (démotée, 2 colonnes) ── */}
      <section>
        <p className="t-label mb-3" style={{ color: 'var(--s-text-muted)' }}>Comment se qualifier</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel bevel">
            <div className="panel-body space-y-3">
              <p className="text-sm" style={{ color: 'var(--s-text-dim)', lineHeight: 1.7 }}>
                Chaque Qualif classe les équipes et distribue des points selon le placement.
                Seuls tes <strong style={{ color: 'var(--s-text)' }}>{circuit.bestResultsCount} meilleurs résultats</strong> comptent
                au classement. À la fin, les <strong style={{ color: 'var(--s-text)' }}>{circuit.lanTeamCount} équipes</strong> en
                tête rejoignent la LAN finale.
              </p>
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                Départage à la cutline : meilleur placement, puis delta de buts cumulé, puis Qualif la plus récente.
              </p>
              {scaleEntries.length > 0 && (
                <details className="group">
                  <summary className="text-sm cursor-pointer select-none inline-flex items-center gap-1.5" style={{ color: 'var(--s-text)' }}>
                    <ChevronRight size={14} className="transition-transform group-open:rotate-90" /> Barème de points
                  </summary>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mt-3">
                    {scaleEntries.map(([place, pts]) => (
                      <div key={place} className="bevel-sm px-2 py-1.5 text-center" style={{ background: 'var(--s-elevated)' }}>
                        <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{place}{place === 1 ? 'er' : 'e'}</div>
                        <div className="t-mono text-sm" style={{ fontWeight: 600 }}>{pts}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>

          {formatSample && (
            <div className="panel bevel">
              <div className="panel-body">
                <p className="t-label-soft mb-3">Format des Qualifs</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <p className="t-label-soft">Bracket</p>
                    <p className="font-semibold">Double élimination</p>
                  </div>
                  <div>
                    <p className="t-label-soft">Matchs</p>
                    <p className="font-semibold">BO{format?.bo?.default ?? 5} · finales BO{format?.bo?.grandFinal ?? 7}</p>
                  </div>
                  <div>
                    <p className="t-label-soft">Roster</p>
                    <p className="font-semibold">{roster?.starters ?? 3} tit. + {roster?.subsMax ?? 2} rempl.</p>
                  </div>
                  <div>
                    <p className="t-label-soft">Équipes / Qualif</p>
                    <p className="font-semibold">{format?.maxTeams ?? 32} max</p>
                  </div>
                </div>
                {(eligibility?.requireVerifiedAccounts || eligibility?.minAge != null || eligibility?.mmr) && (
                  <>
                    <div className="divider my-3" />
                    <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                      {eligibility?.requireVerifiedAccounts && <span>Comptes vérifiés obligatoires</span>}
                      {eligibility?.minAge != null && <span>{eligibility.minAge} ans minimum (dérogation possible)</span>}
                      {eligibility?.mmr && (
                        <span>MMR : moyenne ≤ {eligibility.mmr.maxAvg} · écart ≤ {eligibility.mmr.maxGap} · plafond {eligibility.mmr.maxPlayer}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Classement du circuit (crests + zone LAN) ── */}
      <section>
        <p className="t-label mb-3" style={{ color: 'var(--s-text-muted)' }}>Classement du circuit</p>
        <div className="panel bevel">
          <div className="panel-body p-0">
            {standings.length === 0 ? (
              <p className="text-sm px-4 py-6" style={{ color: 'var(--s-text-dim)' }}>
                Le classement s&apos;affiche après la première Qualif jouée.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 480 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                      <th className="text-left px-4 py-2 font-medium" style={{ width: 44 }}>#</th>
                      <th className="text-left px-2 py-2 font-medium">Équipe</th>
                      <th className="text-right px-2 py-2 font-medium">Pts</th>
                      <th className="text-right px-2 py-2 font-medium hidden sm:table-cell">Joués</th>
                      <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row, i) => {
                      const inLan = i < circuit.lanTeamCount;
                      const lastLan = i === circuit.lanTeamCount - 1 && standings.length > circuit.lanTeamCount;
                      return (
                        <tr key={row.teamId} style={{
                          borderBottom: lastLan ? `2px solid ${color}` : '1px solid var(--s-border)',
                          background: inLan ? `rgba(${colorRgb},0.04)` : 'transparent',
                        }}>
                          <td className="px-4 py-2">
                            <span className={row.rank <= 3 ? 'font-display' : 't-mono'}
                              style={{ fontSize: row.rank <= 3 ? 18 : undefined, color: row.rank <= 3 ? 'var(--s-text)' : 'var(--s-text-muted)' }}>
                              {row.rank}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <TeamCrest tag={row.tag} name={row.name} size={28} />
                              <span className="min-w-0">
                                <span className="font-semibold truncate">{row.name}</span>
                                {row.tag && <span style={{ color: 'var(--s-text-muted)' }}> [{row.tag}]</span>}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right t-mono" style={{ fontWeight: 600 }}>{row.totalPoints}</td>
                          <td className="px-2 py-2 text-right t-mono hidden sm:table-cell" style={{ color: 'var(--s-text-muted)' }}>{row.playedCount}</td>
                          <td className="px-4 py-2 text-right t-mono hidden sm:table-cell" style={{ color: 'var(--s-text-muted)' }}>
                            {row.goalDiffCounted > 0 ? '+' : ''}{row.goalDiffCounted}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {standings.length > circuit.lanTeamCount && (
                  <p className="text-xs px-4 py-2 inline-flex items-center gap-1.5" style={{ color: 'var(--s-text-muted)' }}>
                    <span style={{ width: 16, height: 2, background: color, display: 'inline-block' }} />
                    Cutline LAN — les {circuit.lanTeamCount} premières équipes sont qualifiées.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
