'use client';

// Fiche publique d'une compétition (Lot 2) : hero + format + BRACKET LIVE
// (quand publié, onSnapshot) + équipes. Gating : brouillon ou compét de test
// (isDev) = 404 public, servie aux admins compét / comptes du bac à sable.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, Users2, ScrollText, ArrowRight, Trophy, EyeOff } from 'lucide-react';
import { api, apiPublic, ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import GameTag from '@/components/games/GameTag';
import BracketView from '@/components/competitions/BracketView';
import { Skeleton } from '@/components/ui/Skeleton';
import { getGameColor, getGameColorRgb, getGameBannerUrl } from '@/lib/games-registry';
import type { CompetitionEligibility, CompetitionFormat, CompetitionSchedule } from '@/types/competitions';

interface PublicCompetition {
  competition: {
    id: string;
    name: string;
    game: string;
    status: string;
    circuitName: string | null;
    format: CompetitionFormat | null;
    roster: { starters: number; subsMax: number } | null;
    eligibility: CompetitionEligibility | null;
    registration: { opensAt: string | null; closesAt: string | null; waitlist: boolean };
    schedule: CompetitionSchedule | null;
    bracketMaterializedAt: string | null;
    prizePool: { amount?: number; currency?: string } | number | null;
    isDev: boolean;
  };
  teams: Array<{ name: string; tag: string; logoUrl: string | null }>;
  waitlistedCount: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  registration: 'Inscriptions ouvertes',
  validation: 'Validation en cours',
  seeding: 'Seeding',
  live: 'En cours',
  finished: 'Terminé',
  archived: 'Archivé',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  } catch { return '—'; }
}

function fmtPrize(p: PublicCompetition['competition']['prizePool']): string | null {
  if (p == null) return null;
  if (typeof p === 'number') return p > 0 ? `${p} €` : null;
  if (typeof p.amount === 'number' && p.amount > 0) return `${p.amount} ${p.currency ?? '€'}`;
  return null;
}

export default function CompetitionPage() {
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<PublicCompetition | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch AUTHENTIFIÉ dès qu'un utilisateur est connecté : une compétition
    // masquée (brouillon ou test) n'est servie qu'aux admins compét et aux
    // comptes du bac à sable — sans le Bearer, le serveur renvoie 404 même aux
    // autorisés. On attend la fin du chargement auth pour ne pas figer un 404.
    if (authLoading) return;
    let cancelled = false;
    const fetcher = user
      ? api<PublicCompetition>(`/api/competitions/${params.id}`)
      : apiPublic<PublicCompetition>(`/api/competitions/${params.id}`);
    fetcher
      .then(res => { if (!cancelled) { setData(res); setNotFound(false); } })
      .catch(err => { if (!cancelled) setNotFound(err instanceof ApiError && err.status === 404); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id, user, authLoading]);

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-5xl mx-auto">
        <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>Compétition introuvable.</p>
      </div>
    );
  }

  const { competition: comp, teams, waitlistedCount } = data;
  const color = getGameColor(comp.game);
  const colorRgb = getGameColorRgb(comp.game);
  const banner = getGameBannerUrl(comp.game);
  const now = new Date();
  const opensAt = comp.registration.opensAt ? new Date(comp.registration.opensAt) : null;
  const closesAt = comp.registration.closesAt ? new Date(comp.registration.closesAt) : null;
  const registrationOpen = comp.status === 'registration' && opensAt && closesAt && now >= opensAt && now <= closesAt;
  const canRegister = registrationOpen || comp.status === 'draft';
  const maxTeams = comp.format?.maxTeams ?? null;
  const mmr = comp.eligibility?.mmr ?? null;
  const prize = fmtPrize(comp.prizePool);
  const bracketPublished = !!comp.bracketMaterializedAt;

  return (
    <div className="px-4 sm:px-8 py-8 max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Hero — niveau 1 : image du jeu en fond, accent barre couleur jeu */}
      <div className="panel bevel relative overflow-hidden">
        {banner && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local /public, décoratif */}
            <img src={banner} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: 0.14 }} />
            <div className="absolute inset-0" style={{
              background: `linear-gradient(90deg, var(--s-surface) 30%, rgba(${colorRgb},0.06) 100%)`,
            }} />
          </>
        )}
        <div className="h-[3px] relative" style={{ background: `linear-gradient(90deg, ${color}, rgba(${colorRgb},0.3), transparent 70%)` }} />
        <div className="relative p-6 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <GameTag gameId={comp.game} size="sm" />
            {comp.circuitName && (
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>{comp.circuitName}</span>
            )}
            <span className="tag tag-neutral">{STATUS_LABELS[comp.status] ?? comp.status}</span>
            {comp.isDev && (
              <span className="tag tag-neutral flex items-center gap-1" style={{ color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)' }}>
                <EyeOff size={11} /> Test · masquée du public
              </span>
            )}
          </div>
          <h1 className="font-display text-4xl" style={{ letterSpacing: '0.03em' }}>
            {comp.name.toUpperCase()}
          </h1>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {comp.schedule?.days?.length ? (
              <span className="flex items-center gap-1.5">
                <CalendarDays size={14} />
                {comp.schedule.days.map(d => fmtDate(d.date)).join(' · ')}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Users2 size={14} />
              {teams.length}{maxTeams ? ` / ${maxTeams}` : ''} équipes
              {waitlistedCount > 0 ? ` · ${waitlistedCount} en attente` : ''}
            </span>
            {prize && (
              <span className="flex items-center gap-1.5" style={{ color: 'var(--s-gold)' }}>
                <Trophy size={14} /> {prize}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {canRegister && user && (
              <Link href={`/competitions/${comp.id}/inscription`} className="btn-springs btn-primary bevel-sm flex items-center gap-1.5">
                Inscrire une équipe <ArrowRight size={14} />
              </Link>
            )}
            {registrationOpen && !user && (
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Connecte-toi avec Discord pour inscrire ton équipe.
              </span>
            )}
            {!registrationOpen && comp.status === 'registration' && opensAt && now < opensAt && (
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Inscriptions à partir du {fmtDate(comp.registration.opensAt)}.
              </span>
            )}
            <Link href={`/competitions/${comp.id}/reglement`} className="btn-springs btn-ghost text-sm flex items-center gap-1.5">
              <ScrollText size={14} /> Règlement
            </Link>
          </div>
        </div>
      </div>

      {/* Bracket live — dès qu'il est publié */}
      {bracketPublished && (
        <div className="panel bevel">
          <div className="panel-header"><span className="t-sub">Bracket</span></div>
          <div className="panel-body">
            <BracketView competitionId={comp.id} gameColor={color} />
          </div>
        </div>
      )}

      {/* Format */}
      <div className="panel bevel">
        <div className="panel-header"><span className="t-sub">Format</span></div>
        <div className="panel-body">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p style={{ color: 'var(--s-text-muted)' }}>Bracket</p>
              <p className="font-semibold">Double élimination</p>
            </div>
            <div>
              <p style={{ color: 'var(--s-text-muted)' }}>Matchs</p>
              <p className="font-semibold">
                BO{comp.format?.bo?.default ?? 5} · finales BO{comp.format?.bo?.grandFinal ?? 7}
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--s-text-muted)' }}>Roster</p>
              <p className="font-semibold">
                {comp.roster?.starters ?? 3} titulaires + {comp.roster?.subsMax ?? 2} subs max
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--s-text-muted)' }}>Inscriptions</p>
              <p className="font-semibold">
                {fmtDate(comp.registration.opensAt)} → {fmtDate(comp.registration.closesAt)}
              </p>
            </div>
          </div>
          {(mmr || comp.eligibility?.requireVerifiedAccounts || comp.eligibility?.minAge != null) && (
            <>
              <div className="divider my-4" />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
                {comp.eligibility?.requireVerifiedAccounts && <span>Comptes vérifiés obligatoires</span>}
                {comp.eligibility?.minAge != null && <span>{comp.eligibility.minAge} ans minimum (dérogation possible)</span>}
                {mmr && (
                  <span>
                    MMR 2v2 : moyenne ≤ {mmr.maxAvg} · écart ≤ {mmr.maxGap} · plafond {mmr.maxPlayer}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Équipes validées */}
      <div className="panel bevel">
        <div className="panel-header"><span className="t-sub">Équipes ({teams.length}{maxTeams ? `/${maxTeams}` : ''})</span></div>
        <div className="panel-body p-0">
          {teams.length === 0 ? (
            <p className="text-sm px-4 py-6" style={{ color: 'var(--s-text-dim)' }}>
              Aucune équipe validée pour l&apos;instant.
            </p>
          ) : teams.map((t, i) => (
            <div key={`${t.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5"
              style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
              {t.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- logos uploadés R2, taille fixe
                <img src={t.logoUrl} alt="" width={24} height={24} style={{ objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <span className="w-6 h-6 flex-shrink-0" style={{ background: 'var(--s-elevated)' }} />
              )}
              <span className="text-sm font-semibold flex-1 min-w-0 truncate">{t.name}</span>
              {t.tag && <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>[{t.tag}]</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
