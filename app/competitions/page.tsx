'use client';

// Liste des compétitions — porte d'entrée du module (visiteurs inclus). Refonte
// « Le Dossier » : le circuit Aedral natif en HÉROS (identité + stat-décision
// « inscriptions ouvertes / prochaine Qualif » + CTA), puis les compétitions
// Springs E-Sport (SLS terminée, Monthly Cup mensuelle active) démotées en
// rangées — plus le circuit phare noyé au milieu de cards équivalentes. Les
// circuits sont chargés via l'API gatée (un testeur voit les brouillons/tests).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ExternalLink, Trophy, ArrowRight, EyeOff, Users2 } from 'lucide-react';
import { api, apiPublic } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import GameTag from '@/components/games/GameTag';
import GlanceStat from '@/components/competitions/GlanceStat';
import OrganizerCredit from '@/components/competitions/OrganizerCredit';
import { getGameColor, getGameColorRgb, getGameBannerUrl, getGameLogoUrl } from '@/lib/games-registry';
import { ACTIVE_LEGACY_COMPETITIONS, FINISHED_LEGACY_COMPETITIONS, type LegacyCompetition } from '@/lib/legacy-competitions';

interface CircuitFocus {
  mode: string;
  registrationOpen: boolean;
  targetId: string | null;
  eventName: string | null;
  closesAt: string | null;
  startDate: string | null;
  approvedCount: number;
  maxTeams: number | null;
}

interface CircuitSummary {
  id: string;
  name: string;
  game: string;
  status: string;
  hidden: boolean;
  eventCount: number;
  lanTeamCount: number;
  prizePool: { amount: number; currency: string } | number | null;
  organizer: { name: string; logoUrl?: string | null } | null;
  focus: CircuitFocus;
}

const CIRCUIT_STATUS: Record<string, string> = {
  draft: 'Brouillon', active: 'En cours', finished: 'Terminé', archived: 'Archivé',
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
  catch { return null; }
}

function fmtPrize(p: CircuitSummary['prizePool']): string | null {
  if (p == null) return null;
  if (typeof p === 'number') return p > 0 ? `${p} €` : null;
  if (p.amount > 0) return `${p.amount} ${p.currency === 'EUR' ? '€' : p.currency}`;
  return null;
}

export default function CompetitionsPage() {
  const { user, loading: authLoading } = useAuth();
  const [circuits, setCircuits] = useState<CircuitSummary[]>([]);

  useEffect(() => {
    if (authLoading) return;
    const fetcher = user
      ? api<{ circuits: CircuitSummary[] }>('/api/competitions/circuits')
      : apiPublic<{ circuits: CircuitSummary[] }>('/api/competitions/circuits');
    fetcher.then(r => setCircuits(r.circuits ?? [])).catch(() => setCircuits([]));
  }, [user, authLoading]);

  return (
    <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8 animate-fade-in">
      {/* ── Header dégraissé ── */}
      <header>
        <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>Compétitions</p>
        <h1 className="font-display text-4xl lg:text-5xl mt-1" style={{ letterSpacing: '0.03em' }}>COMPÉTITIONS</h1>
        <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--s-text-dim)' }}>
          Les compétitions en direct sur Aedral et celles encore hébergées sur le site
          Springs E-Sport, notre partenaire.
        </p>
      </header>

      {/* ── Circuits en direct sur Aedral (héros) ── */}
      {circuits.length > 0 && (
        <section className="space-y-4">
          <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>Circuits</p>
          {circuits.map(c => (
            <FlagshipCircuit key={c.id} c={c} canRegister={!!(c.focus.registrationOpen && c.focus.targetId && user)} />
          ))}
        </section>
      )}

      {/* ── Sur l'ancien site Springs (actives : récurrentes / joignables) ── */}
      {ACTIVE_LEGACY_COMPETITIONS.length > 0 && (
        <section className="space-y-4">
          <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>Sur l&apos;ancien site Springs</p>
          <div className="panel bevel">
            <div className="panel-body p-0">
              {ACTIVE_LEGACY_COMPETITIONS.map((comp, i) => (
                <LegacyRow key={comp.id} comp={comp} first={i === 0} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Compétitions passées (terminées) ── */}
      {FINISHED_LEGACY_COMPETITIONS.length > 0 && (
        <section className="space-y-4">
          <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>Compétitions passées</p>
          <div className="panel bevel">
            <div className="panel-body p-0">
              {FINISHED_LEGACY_COMPETITIONS.map((comp, i) => (
                <LegacyRow key={comp.id} comp={comp} first={i === 0} finished />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// Rangée d'une compétition legacy (lien sortant vers l'ancien site Springs).
function LegacyRow({ comp, first, finished }: { comp: LegacyCompetition; first: boolean; finished?: boolean }) {
  return (
    <a href={comp.href} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--s-elevated)] group"
      style={{ borderTop: first ? 'none' : '1px solid var(--s-border)', opacity: finished ? 0.8 : 1 }}>
      <GameTag gameId={comp.gameId} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate group-hover:underline">{comp.name}</span>
          <span className="tag tag-neutral">{comp.statusLabel}</span>
        </div>
        <div className="flex items-center gap-x-3 gap-y-0.5 text-xs mt-0.5 flex-wrap" style={{ color: 'var(--s-text-muted)' }}>
          <span>{comp.format}</span>
          <span>· {comp.edition}</span>
          {comp.prize && <span>· {comp.prize}</span>}
        </div>
      </div>
      <span className="text-xs hidden sm:inline-flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>
        <ExternalLink size={11} /> springs-esport
      </span>
      <ExternalLink size={15} className="flex-shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--s-text-muted)' }} />
    </a>
  );
}

// ── Circuit Aedral en héros : identité + carte focus (stat-décision + CTA) ──
function FlagshipCircuit({ c, canRegister }: { c: CircuitSummary; canRegister: boolean }) {
  const color = getGameColor(c.game);
  const colorRgb = getGameColorRgb(c.game);
  const banner = getGameBannerUrl(c.game);
  const gameLogo = getGameLogoUrl(c.game);
  const prize = fmtPrize(c.prizePool);
  const prizeGold = !canRegister;
  const f = c.focus;

  const focusEyebrow = f.registrationOpen ? 'Inscriptions ouvertes'
    : f.mode === 'live' ? 'En cours'
    : f.mode === 'upcoming' ? 'Prochaine Qualif'
    : f.mode === 'done' ? 'Terminé'
    : c.hidden ? 'Accès test' : 'Bientôt';
  const focusMeta = f.registrationOpen && f.closesAt ? `Clôture le ${fmtDate(f.closesAt)}`
    : f.mode === 'upcoming' && f.startDate ? `Le ${fmtDate(f.startDate)}`
    : null;

  return (
    <div className="panel bevel relative overflow-hidden">
      {banner && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- asset local /public, décoratif */}
          <img src={banner} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.13 }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, var(--s-surface) 42%, rgba(${colorRgb},0.06) 100%)` }} />
        </>
      )}
      <div className="h-[3px] relative" style={{ background: `linear-gradient(90deg, ${color}, rgba(${colorRgb},0.3), transparent 70%)` }} />
      <div className="relative p-5 lg:p-6">
        {/* Crédit organisateur en tête */}
        {c.organizer?.name && (
          <div className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <OrganizerCredit organizer={c.organizer} size="sm" />
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          {/* Identité */}
          <div className="flex items-start gap-4 min-w-0">
            {gameLogo && (
              <div className="bevel-sm flex items-center justify-center flex-shrink-0" style={{ width: 52, height: 52, background: 'var(--s-elevated)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={gameLogo} alt="" width={38} height={38} style={{ width: 38, height: 38, objectFit: 'contain' }} />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {!c.organizer?.name && (
                  <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Circuit</span>
                )}
                <GameTag gameId={c.game} size="sm" />
                {c.hidden && (
                  <span className="tag tag-neutral inline-flex items-center gap-1" style={{ color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)' }}>
                    <EyeOff size={12} /> Test
                  </span>
                )}
                {!c.hidden && c.status !== 'active' && <span className="tag tag-neutral">{CIRCUIT_STATUS[c.status] ?? c.status}</span>}
              </div>
              <Link href={`/competitions/circuit/${c.id}`} className="font-display text-3xl lg:text-4xl hover:underline block truncate"
                style={{ letterSpacing: '0.03em', lineHeight: 1.05 }}>
                {c.name.toUpperCase()}
              </Link>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm mt-2" style={{ color: 'var(--s-text-dim)' }}>
                <span className="inline-flex items-center gap-1.5">
                  <Users2 size={14} /> {c.eventCount} Qualif{c.eventCount > 1 ? 's' : ''} → LAN {c.lanTeamCount}
                </span>
                {prize && (
                  <span className="inline-flex items-center gap-1.5" style={{ color: prizeGold ? 'var(--s-gold)' : 'var(--s-text)', fontWeight: 600 }}>
                    <Trophy size={14} style={{ color: prizeGold ? 'var(--s-gold)' : 'var(--s-text-dim)' }} /> {prize}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Carte focus : stat-décision + CTA */}
          <div className="bevel-sm p-4 lg:min-w-[260px]" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            <p className="t-label mb-1" style={{ color: f.registrationOpen ? color : 'var(--s-text-muted)' }}>{focusEyebrow}</p>
            {f.eventName && f.mode !== 'done' ? (
              <>
                <p className="font-semibold text-sm truncate">{f.eventName}</p>
                {focusMeta && (
                  <p className="text-xs mt-0.5 inline-flex items-center gap-1.5" style={{ color: f.registrationOpen ? '#ffb46b' : 'var(--s-text-dim)' }}>
                    <CalendarDays size={12} /> {focusMeta}
                  </p>
                )}
                {(f.registrationOpen || f.mode === 'live') && (
                  <div className="mt-2.5">
                    <GlanceStat mono size={20}
                      value={`${f.approvedCount}${f.maxTeams ? ` / ${f.maxTeams}` : ''}`}
                      label="équipes inscrites" />
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                {f.mode === 'done' ? 'Circuit terminé' : 'Aucune inscription ouverte'}
              </p>
            )}
            <div className="mt-3">
              {canRegister ? (
                <Link href={`/competitions/${f.targetId}/inscription`} className="btn-springs btn-primary bevel-sm text-sm inline-flex items-center gap-1.5">
                  Inscrire une équipe <ArrowRight size={14} />
                </Link>
              ) : (
                <Link href={`/competitions/circuit/${c.id}`} className="btn-springs btn-secondary bevel-sm text-sm inline-flex items-center gap-1.5">
                  Voir le circuit <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
