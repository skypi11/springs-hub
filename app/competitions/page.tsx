'use client';

// Liste des compétitions : les circuits Aedral natifs (moteur de compétitions,
// ex. Legends Springs Cup) en tête, puis les compétitions historiques encore
// hébergées sur le site Springs E-Sport. Les circuits sont chargés via l'API
// gatée : un visiteur ne voit que les circuits publiés, un testeur voit aussi
// les brouillons / circuits de test.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar, ExternalLink, Gamepad2, Users, Award, Trophy, ArrowRight } from 'lucide-react';
import { api, apiPublic } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import GameTag from '@/components/games/GameTag';
import { getGameColor, getGameColorRgb, getGameBannerUrl } from '@/lib/games-registry';

interface CircuitSummary {
  id: string;
  name: string;
  game: string;
  status: string;
  hidden: boolean;
  eventCount: number;
  lanTeamCount: number;
  prizePool: { amount: number; currency: string } | number | null;
}

const legacyCompetitions = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    tag: 'RL',
    tagClass: 'tag-blue',
    name: 'SPRINGS LEAGUE SERIES',
    edition: 'Saison 2, 2026',
    status: 'En cours',
    format: 'Ligue · 2 Poules · Round Robin · BO7',
    teams: '32 équipes',
    prize: '1 600€',
    accent: '#0081FF',
    bgImage: '/rocket-league.webp',
    href: 'https://springs-esport.vercel.app/rocket-league/',
    description: '32 équipes réparties en 2 poules. Top 8 de chaque poule qualifié pour la LAN finale. Format 3v3.',
  },
  {
    id: 'tm-monthly',
    game: 'Trackmania',
    tag: 'TM',
    tagClass: 'tag-green',
    name: 'MONTHLY CUP',
    edition: 'Mensuel',
    status: 'Mensuel',
    format: 'Cup · Solo · Qualifications + Finale',
    teams: null,
    prize: null,
    accent: '#00D936',
    bgImage: '/tm.webp',
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
    description: 'Compétition mensuelle en solo. Qualifications sur plusieurs maps officielles Springs puis finale.',
  },
];

const CIRCUIT_STATUS: Record<string, string> = {
  draft: 'Brouillon',
  active: 'En cours',
  finished: 'Terminé',
  archived: 'Archivé',
};

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
    <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-10">

      {/* ─── HEADER ───────────────────────────────────────────────────────── */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold), transparent 80%)' }} />
        <div className="absolute top-0 right-0 w-[400px] h-[300px] pointer-events-none opacity-[0.05]"
          style={{ background: 'radial-gradient(ellipse at top right, var(--s-gold), transparent 70%)' }} />
        <div className="relative z-[1] p-10">
          <div className="flex items-center gap-3 mb-5">
            <span className="tag tag-gold">Compétitions</span>
          </div>
          <h1 className="t-display mb-4">
            <span style={{ color: 'var(--s-gold)' }}>COMPÉTITIONS</span>
          </h1>
          <p className="t-body max-w-xl" style={{ fontSize: '15px' }}>
            Les circuits Aedral et les compétitions historiques hébergées sur le
            site Springs E-Sport, notre partenaire.
          </p>
        </div>
      </header>

      {/* ─── CIRCUITS AEDRAL ──────────────────────────────────────────────── */}
      {circuits.length > 0 && (
        <section className="animate-fade-in-d1 space-y-6">
          <div className="section-label"><span className="t-label">Circuits Aedral</span></div>
          {circuits.map((c) => {
            const accent = getGameColor(c.game);
            const accentRgb = getGameColorRgb(c.game);
            const bg = getGameBannerUrl(c.game);
            const prize = fmtPrize(c.prizePool);
            return (
              <Link key={c.id} href={`/competitions/circuit/${c.id}`}
                className="comp-card bevel group block" style={{ minHeight: '300px' }}>
                {bg && <div className="comp-card-bg" style={{ backgroundImage: `url(${bg})` }} />}
                <div className="comp-card-overlay" />
                <div className="absolute top-0 left-0 right-0 h-[3px] z-[2]"
                  style={{ background: `linear-gradient(90deg, ${accent}, rgba(${accentRgb},0.4), transparent 70%)` }} />
                <div className="comp-card-content p-8 flex flex-col h-full" style={{ minHeight: '300px' }}>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <GameTag gameId={c.game} size="sm" />
                      <span className="t-label" style={{ color: 'rgba(255,255,255,0.5)' }}>Circuit</span>
                    </div>
                    <span className="tag tag-neutral"
                      style={c.hidden ? { color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)' } : undefined}>
                      {c.hidden ? 'Test' : (CIRCUIT_STATUS[c.status] ?? c.status)}
                    </span>
                  </div>
                  <h2 className="font-display mb-2" style={{ fontSize: '2.8rem', letterSpacing: '0.03em', color: '#fff' }}>
                    {c.name.toUpperCase()}
                  </h2>
                  <p className="t-body mb-6" style={{ color: 'rgba(255,255,255,0.45)', maxWidth: '600px' }}>
                    Qualifs online puis LAN finale. Les {c.lanTeamCount} meilleures équipes du circuit rejoignent la LAN.
                  </p>
                  <div className="flex items-center gap-6 mb-auto flex-wrap">
                    {c.eventCount > 0 && (
                      <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        <Gamepad2 size={12} /> {c.eventCount} Qualif{c.eventCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <Users size={12} /> {c.lanTeamCount} places LAN
                    </span>
                    {prize && (
                      <span className="t-mono flex items-center gap-1.5 font-bold" style={{ color: 'var(--s-gold)' }}>
                        <Trophy size={12} /> {prize}
                      </span>
                    )}
                  </div>
                  <div className="divider mb-4 mt-6" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  <div className="flex items-center justify-end">
                    <span className="btn-springs btn-secondary bevel-sm transition-all group-hover:border-[rgba(255,255,255,0.4)]"
                      style={{ padding: '8px 20px', fontSize: '12px', borderColor: 'rgba(255,255,255,0.2)' }}>
                      Voir le circuit <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      )}

      {/* ─── COMPÉTITIONS SPRINGS E-SPORT (historique) ────────────────────── */}
      <section className="animate-fade-in-d2 space-y-6">
        <div className="section-label">
          <span className="t-label">Sur Springs E-Sport</span>
        </div>

        {legacyCompetitions.map((comp) => (
          <a key={comp.id} href={comp.href} target="_blank" rel="noopener noreferrer"
            className="comp-card bevel group block" style={{ minHeight: '300px' }}>
            <div className="comp-card-bg" style={{ backgroundImage: `url(${comp.bgImage})` }} />
            <div className="comp-card-overlay" />
            <div className="absolute top-0 left-0 right-0 h-[3px] z-[2]"
              style={{ background: `linear-gradient(90deg, ${comp.accent}, ${comp.accent}60, transparent 70%)` }} />
            <div className="comp-card-content p-8 flex flex-col h-full" style={{ minHeight: '300px' }}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className={`tag ${comp.tagClass}`}>{comp.tag}</span>
                  <span className="t-label" style={{ color: 'rgba(255,255,255,0.5)' }}>{comp.game}</span>
                </div>
                <span className="status status-live">{comp.status}</span>
              </div>
              <h2 className="font-display mb-2" style={{ fontSize: '2.8rem', letterSpacing: '0.03em', color: '#fff' }}>
                {comp.name}
              </h2>
              <p className="t-body mb-6" style={{ color: 'rgba(255,255,255,0.45)', maxWidth: '600px' }}>
                {comp.description}
              </p>
              <div className="flex items-center gap-6 mb-auto flex-wrap">
                <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  <Gamepad2 size={12} /> {comp.format}
                </span>
                {comp.teams && (
                  <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <Users size={12} /> {comp.teams}
                  </span>
                )}
                <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  <Calendar size={12} /> {comp.edition}
                </span>
                {comp.prize && (
                  <span className="t-mono flex items-center gap-1.5 font-bold" style={{ color: 'var(--s-gold)' }}>
                    <Award size={12} /> {comp.prize}
                  </span>
                )}
              </div>
              <div className="divider mb-4 mt-6" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <div className="flex items-center justify-between">
                <span className="t-label flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <ExternalLink size={10} /> Hébergée sur springs-esport.vercel.app
                </span>
                <span className="btn-springs btn-secondary bevel-sm transition-all group-hover:border-[rgba(255,255,255,0.4)]"
                  style={{ padding: '8px 20px', fontSize: '12px', borderColor: 'rgba(255,255,255,0.2)' }}>
                  Voir la compétition <ExternalLink size={12} />
                </span>
              </div>
            </div>
          </a>
        ))}
      </section>

    </div>
  );
}
