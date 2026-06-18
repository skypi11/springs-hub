'use client';

import Link from 'next/link';
import { Trophy, ExternalLink, Calendar, Gamepad2, UserPlus, Shield, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import { SkeletonText } from '@/components/ui/Skeleton';
import ConnectedDashboard from '@/components/home/ConnectedDashboard';
import VisitorLanding from '@/components/landing/VisitorLanding';

type PublicStats = {
  structures: number;
  players: number;
  recruitingPlayers: number;
};

const competitions = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    tag: 'RL',
    tagClass: 'tag-blue',
    name: 'SPRINGS LEAGUE SERIES S2',
    format: 'Ligue · 3v3 · Round Robin · BO7',
    status: 'En cours',
    date: 'Saison 2026',
    teams: '32 équipes',
    prize: '1 600€',
    accent: '#0081FF',
    bgImage: '/rocket-league.webp',
    href: 'https://springs-esport.vercel.app/rocket-league/',
  },
  {
    id: 'tm-monthly',
    game: 'Trackmania',
    tag: 'TM',
    tagClass: 'tag-green',
    name: 'MONTHLY CUP',
    format: 'Cup · Solo · Qualifications + Finale',
    status: 'Mensuel',
    date: 'Chaque mois',
    teams: 'Solo',
    prize: null,
    accent: '#00D936',
    bgImage: '/tm.webp',
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
  },
];

type PillarId = 'structures' | 'players' | 'competitions';
type Pillar = {
  id: PillarId;
  icon: typeof Shield;
  title: string;
  accent: string;
  iconColor: string;
  desc: string;
  href: string;
  statLabel: string;
};

const pillars: Pillar[] = [
  {
    id: 'structures',
    icon: Shield,
    title: 'STRUCTURES',
    accent: '#FFB800',
    iconColor: 'var(--s-gold)',
    desc: 'Crée ta structure, gère ton roster et tes équipes.',
    href: '/community/structures',
    statLabel: 'Structures',
  },
  {
    id: 'players',
    icon: UserPlus,
    title: 'MERCATO',
    accent: '#EAEAF0',
    iconColor: 'var(--s-text)',
    desc: 'Annuaire des joueurs : profils, rangs, LFT.',
    href: '/community/players',
    statLabel: 'Joueurs',
  },
  {
    id: 'competitions',
    icon: Trophy,
    title: 'COMPÉTITIONS',
    accent: '#7B2FBE',
    iconColor: 'var(--s-violet-light)',
    desc: 'Saisons, cups et tournois Springs E-Sport. Inscriptions connectées aux structures.',
    href: '/competitions',
    statLabel: 'Actives',
  },
];

export default function HomePage() {
  const { user, loading } = useAuth();
  const isConnected = !loading && !!user;

  // Stats publiques pour les piliers + visitor hero. Endpoint cache CDN 5 min,
  // donc lecture quasi-gratuite à l'échelle du site.
  const statsQuery = useQuery({
    queryKey: ['public-stats'] as const,
    queryFn: () => api<PublicStats>('/api/public/stats'),
  });
  const stats = statsQuery.data;
  const statsByPillar: Record<PillarId, number | null> = {
    structures: stats?.structures ?? null,
    players: stats?.players ?? null,
    competitions: competitions.length,
  };

  // Mode visiteur : landing full-bleed dédiée
  if (!isConnected) {
    return <VisitorLanding stats={stats ?? null} />;
  }

  // Mode connecté : dashboard + écosystème + comps
  return (
    <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-10">
      <div className="relative z-[1] space-y-10">

        {user && <ConnectedDashboard user={user} />}

        {/* Compétitions, visible pour tous */}
        <section className="animate-fade-in-d2">
          <div className="section-label">
            <span className="t-label">Compétitions actives</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {competitions.map((comp) => (
              <a key={comp.id} href={comp.href} target="_blank" rel="noopener noreferrer"
                className="comp-card bevel group block" style={{ minHeight: '240px' }}>
                <div className="comp-card-bg" style={{ backgroundImage: `url(${comp.bgImage})` }} />
                <div className="comp-card-overlay" />
                <div className="absolute top-0 left-0 right-0 h-[3px] z-[2]"
                  style={{ background: `linear-gradient(90deg, ${comp.accent}, ${comp.accent}60, transparent 70%)` }} />
                <div className="comp-card-content p-7 flex flex-col h-full" style={{ minHeight: '240px' }}>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <span className={`tag ${comp.tagClass}`}>{comp.tag}</span>
                      <span className="t-label" style={{ color: 'rgba(255,255,255,0.5)' }}>{comp.game}</span>
                    </div>
                    <span className="status status-live">{comp.status}</span>
                  </div>
                  <h3 className="font-display mb-5" style={{ fontSize: '2rem', letterSpacing: '0.03em', color: '#fff' }}>
                    {comp.name}
                  </h3>
                  <div className="flex items-center gap-5 mb-auto flex-wrap">
                    <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <Gamepad2 size={11} /> {comp.format}
                    </span>
                    <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <Users size={11} /> {comp.teams}
                    </span>
                    <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <Calendar size={11} /> {comp.date}
                    </span>
                    {comp.prize && (
                      <span className="t-mono flex items-center gap-1.5 font-bold" style={{ color: 'var(--s-gold)' }}>
                        <Trophy size={11} /> {comp.prize}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-end mt-6">
                    <span className="btn-springs btn-secondary bevel-sm transition-all group-hover:border-[rgba(255,255,255,0.4)]"
                      style={{ padding: '7px 16px', fontSize: '12px', borderColor: 'rgba(255,255,255,0.2)' }}>
                      Ouvrir <ExternalLink size={11} />
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Explorer l'écosystème, 3 piliers plus compacts en mode connecté */}
        <section className="animate-fade-in-d3">
          <div className="section-label">
            <span className="t-label">Explorer l&apos;écosystème</span>
          </div>

          {/* Cards niveau 2 (audit anti-slop 12/06) : titre dit UNE fois, ni
              tag catégorie, ni chips marketing, ni footer attribution. Le hover
              .pillar-card reste : ce sont de vrais liens. */}
          {/* md:2 colonnes, xl:3 — en 3 colonnes dès md, le titre Bebas insécable
              + le bloc stat débordaient sur iPad/laptops 1024-1200px (review 12/06). */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {pillars.map(({ id, icon: Icon, title, accent, iconColor, desc, href, statLabel }) => {
              const stat = statsByPillar[id];
              return (
              <Link key={title} href={href}
                className="pillar-card panel group block relative overflow-hidden transition-all duration-200"
                style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="p-5 flex items-start gap-4">
                  <div className="p-3 flex-shrink-0" style={{ background: `${accent}10`, border: `1px solid ${accent}25` }}>
                    <Icon size={22} style={{ color: iconColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* items-start (pas baseline) : le skeleton sans baseline faisait
                        sauter le titre de ~15px au chargement de la stat. */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <h3 className="font-display text-xl" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>{title}</h3>
                      <div className="text-right flex-shrink-0">
                        {stat === null ? (
                          <SkeletonText width={40} height={24} />
                        ) : (
                          <span className="font-display text-2xl" style={{ color: accent, letterSpacing: '0.02em', lineHeight: 1 }}>{stat}</span>
                        )}
                        <span className="t-label-soft block" style={{ color: 'var(--s-text-muted)' }}>{statLabel}</span>
                      </div>
                    </div>
                    <p className="text-sm mt-1.5" style={{ color: 'var(--s-text-dim)' }}>{desc}</p>
                  </div>
                </div>
              </Link>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
