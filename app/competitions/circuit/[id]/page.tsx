'use client';

// Fiche publique d'un CIRCUIT (Legends Springs Cup) — la vitrine : le parcours
// (Qualifs + LAN), la règle de qualification, le barème, le format et le
// classement. L'inscription se fait ICI, dirigée vers la Qualif ouverte (le
// wizard d'inscription reste par-Qualif). Gating : un circuit en brouillon
// (dont le circuit de test) est 404 pour le public, servi aux testeurs.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, Trophy, ArrowRight, ScrollText, Users2, EyeOff, ChevronRight } from 'lucide-react';
import { api, apiPublic, ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import GameTag from '@/components/games/GameTag';
import { Skeleton } from '@/components/ui/Skeleton';
import { getGameColor, getGameColorRgb, getGameBannerUrl } from '@/lib/games-registry';
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
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch { return null; }
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
    // Fetch authentifié dès qu'un compte est connecté : un circuit masqué
    // (brouillon / test) n'est servi qu'aux testeurs autorisés — sans Bearer, le
    // serveur renvoie 404 même à un admin. On attend la fin du chargement auth.
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
        <Skeleton className="h-40 w-full" />
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

  const { circuit, events, formatSample, standings, registrationTargetId, registrationTargetName, registrationTargetOpen } = data;
  const color = getGameColor(circuit.game);
  const colorRgb = getGameColorRgb(circuit.game);
  const banner = getGameBannerUrl(circuit.game);
  const prize = fmtPrize(circuit.prizePool);
  const qualifCount = events.length;
  const reglementHref = registrationTargetId
    ? `/competitions/${registrationTargetId}/reglement`
    : events[0]
      ? `/competitions/${events[0].id}/reglement`
      : null;
  const eligibility = formatSample?.eligibility ?? null;
  const format = formatSample?.format ?? null;
  const roster = formatSample?.roster ?? null;
  const scaleEntries = Object.entries(circuit.pointsScale)
    .map(([place, pts]) => [Number(place), pts] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 animate-fade-in">
      {/* ── Hero (niveau 1) ── */}
      <div className="panel bevel relative overflow-hidden">
        {banner && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local /public, décoratif */}
            <img src={banner} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.14 }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, var(--s-surface) 35%, rgba(${colorRgb},0.06) 100%)` }} />
          </>
        )}
        <div className="h-[3px] relative" style={{ background: `linear-gradient(90deg, ${color}, rgba(${colorRgb},0.3), transparent 70%)` }} />
        <div className="relative p-6 lg:p-8 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <GameTag gameId={circuit.game} size="sm" />
            <span className="tag tag-neutral">Circuit</span>
            {circuit.isDev && (
              <span className="tag tag-neutral flex items-center gap-1" style={{ color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)' }}>
                <EyeOff size={12} /> Test · masqué du public
              </span>
            )}
          </div>
          <h1 className="font-display text-4xl lg:text-5xl" style={{ letterSpacing: '0.03em' }}>
            {circuit.name.toUpperCase()}
          </h1>
          <p className="t-body max-w-2xl" style={{ color: 'var(--s-text-dim)', fontSize: '15px' }}>
            {qualifCount > 0
              ? `${qualifCount} Qualif${qualifCount > 1 ? 's' : ''} online. Les ${circuit.lanTeamCount} meilleures équipes du classement rejoignent la LAN finale.`
              : `Les ${circuit.lanTeamCount} meilleures équipes du classement rejoignent la LAN finale.`}
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm pt-1" style={{ color: 'var(--s-text-dim)' }}>
            <span className="flex items-center gap-1.5"><Users2 size={14} /> {circuit.lanTeamCount} places pour la LAN</span>
            {prize && (
              <span className="flex items-center gap-1.5">
                <Trophy size={14} style={{ color: 'var(--s-text-dim)' }} />
                <span style={{ color: 'var(--s-gold)' }}>{prize}</span>
                {circuit.prizePool?.note ? <span>· {circuit.prizePool.note}</span> : null}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {registrationTargetId && user && (
              <Link href={`/competitions/${registrationTargetId}/inscription`} className="btn-springs btn-primary bevel-sm flex items-center gap-1.5">
                Inscrire une équipe <ArrowRight size={14} />
              </Link>
            )}
            {registrationTargetId && !user && registrationTargetOpen && (
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Connecte-toi avec Discord pour inscrire ton équipe.
              </span>
            )}
            {!registrationTargetId && (
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Aucune inscription ouverte pour le moment.
              </span>
            )}
            {reglementHref && (
              <Link href={reglementHref} className="btn-springs btn-ghost text-sm flex items-center gap-1.5">
                <ScrollText size={14} /> Règlement
              </Link>
            )}
          </div>
          {registrationTargetId && registrationTargetName && (
            <p className="text-xs pt-1" style={{ color: 'var(--s-text-muted)' }}>
              {registrationTargetOpen
                ? `Inscription ouverte : ${registrationTargetName}.`
                : `Accès test : ${registrationTargetName}.`}
            </p>
          )}
        </div>
      </div>

      {/* ── Le parcours (niveau 2 · lignes niveau 3) ── */}
      <div className="panel bevel">
        <div className="panel-header"><span className="t-sub">Le parcours</span></div>
        <div className="panel-body p-0">
          {events.map((e, i) => {
            const range = fmtRange(e.startDate, e.endDate);
            const canRegisterHere = e.registrationOpen || (e.hidden && registrationTargetId === e.id);
            return (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
                <span className="t-mono flex-shrink-0" style={{ color: 'var(--s-text-muted)', width: 24, fontSize: '13px' }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">{e.name}</span>
                    <span className="tag tag-neutral" style={{
                      ...(e.registrationOpen ? { color: color, borderColor: `rgba(${colorRgb},0.4)` } : {}),
                    }}>{EVENT_STATUS[e.status] ?? e.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                    {range && <span className="flex items-center gap-1"><CalendarDays size={12} /> {range}</span>}
                    <span>{e.approvedCount}{e.maxTeams ? ` / ${e.maxTeams}` : ''} équipes</span>
                  </div>
                </div>
                {canRegisterHere && user ? (
                  <Link href={`/competitions/${e.id}/inscription`} className="btn-springs btn-secondary bevel-sm text-sm flex-shrink-0">
                    S&apos;inscrire
                  </Link>
                ) : (
                  <Link href={`/competitions/${e.id}`} className="text-sm flex items-center gap-0.5 flex-shrink-0" style={{ color: 'var(--s-text-dim)' }}>
                    Voir <ChevronRight size={14} />
                  </Link>
                )}
              </div>
            );
          })}
          {/* Destination du circuit — pas un event : la LAN a son propre format (spec §1). */}
          <div className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--s-border)', background: 'var(--s-elevated)' }}>
            <Trophy size={16} className="flex-shrink-0" style={{ color: 'var(--s-text-dim)', marginLeft: 4 }} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold">LAN finale</span>
              <div className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                {circuit.lanTeamCount} équipes qualifiées{prize ? ` · ${prize}` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Comment se qualifier (niveau 2) ── */}
      <div className="panel bevel">
        <div className="panel-header"><span className="t-sub">Comment se qualifier</span></div>
        <div className="panel-body space-y-4">
          <p className="text-sm max-w-2xl" style={{ color: 'var(--s-text-dim)', lineHeight: 1.7 }}>
            Chaque Qualif classe les équipes et distribue des points selon le placement final.
            Seuls tes <strong style={{ color: 'var(--s-text)' }}>{circuit.bestResultsCount} meilleurs résultats</strong> comptent
            au classement du circuit. À la fin, les <strong style={{ color: 'var(--s-text)' }}>{circuit.lanTeamCount} équipes</strong> en
            tête rejoignent la LAN finale.
          </p>
          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Départage à la cutline : meilleur placement du circuit, puis delta de buts cumulé, puis résultat du Qualif le plus récent.
          </p>
          {scaleEntries.length > 0 && (
            <details className="group">
              <summary className="text-sm cursor-pointer select-none flex items-center gap-1.5" style={{ color: 'var(--s-text)' }}>
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

      {/* ── Format (niveau 2) ── */}
      {formatSample && (
        <div className="panel bevel">
          <div className="panel-header"><span className="t-sub">Format des Qualifs</span></div>
          <div className="panel-body">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p style={{ color: 'var(--s-text-muted)' }}>Bracket</p>
                <p className="font-semibold">Double élimination</p>
              </div>
              <div>
                <p style={{ color: 'var(--s-text-muted)' }}>Matchs</p>
                <p className="font-semibold">BO{format?.bo?.default ?? 5} · finales BO{format?.bo?.grandFinal ?? 7}</p>
              </div>
              <div>
                <p style={{ color: 'var(--s-text-muted)' }}>Roster</p>
                <p className="font-semibold">{roster?.starters ?? 3} titulaires + {roster?.subsMax ?? 2} subs</p>
              </div>
              <div>
                <p style={{ color: 'var(--s-text-muted)' }}>Équipes / Qualif</p>
                <p className="font-semibold">{format?.maxTeams ?? 32} max</p>
              </div>
            </div>
            {(eligibility?.requireVerifiedAccounts || eligibility?.minAge != null || eligibility?.mmr) && (
              <>
                <div className="divider my-4" />
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
                  {eligibility?.requireVerifiedAccounts && <span>Comptes vérifiés obligatoires</span>}
                  {eligibility?.minAge != null && <span>{eligibility.minAge} ans minimum (dérogation possible)</span>}
                  {eligibility?.mmr && (
                    <span>MMR 2v2 : moyenne ≤ {eligibility.mmr.maxAvg} · écart ≤ {eligibility.mmr.maxGap} · plafond {eligibility.mmr.maxPlayer}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Classement du circuit (niveau 2 · tableau niveau 3) ── */}
      <div className="panel bevel">
        <div className="panel-header"><span className="t-sub">Classement du circuit</span></div>
        <div className="panel-body p-0">
          {standings.length === 0 ? (
            <p className="text-sm px-4 py-6" style={{ color: 'var(--s-text-dim)' }}>
              Le classement s&apos;affiche après la première Qualif jouée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--s-border)' }}>
                    <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--s-text-muted)', width: 48 }}>#</th>
                    <th className="text-left px-2 py-2 font-medium" style={{ color: 'var(--s-text-muted)' }}>Équipe</th>
                    <th className="text-right px-2 py-2 font-medium" style={{ color: 'var(--s-text-muted)' }}>Pts</th>
                    <th className="text-right px-2 py-2 font-medium hidden sm:table-cell" style={{ color: 'var(--s-text-muted)' }}>Joués</th>
                    <th className="text-right px-4 py-2 font-medium hidden sm:table-cell" style={{ color: 'var(--s-text-muted)' }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, i) => {
                    const cutline = i === circuit.lanTeamCount - 1;
                    return (
                      <tr key={row.teamId} style={{
                        borderBottom: cutline ? `2px solid ${color}` : '1px solid var(--s-border)',
                      }}>
                        <td className="px-4 py-2 t-mono" style={{ color: 'var(--s-text-muted)' }}>{row.rank}</td>
                        <td className="px-2 py-2">
                          <span className="font-semibold">{row.name}</span>
                          {row.tag && <span style={{ color: 'var(--s-text-muted)' }}> [{row.tag}]</span>}
                          {row.qualifiedForLan && (
                            <span className="tag tag-neutral ml-2">LAN</span>
                          )}
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
                <p className="text-xs px-4 py-2" style={{ color: 'var(--s-text-muted)' }}>
                  La ligne colorée marque la cutline : {circuit.lanTeamCount} équipes qualifiées pour la LAN.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
