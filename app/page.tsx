'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { Trophy, Users, ArrowRight, ExternalLink, Calendar, Gamepad2, UserPlus, Shield, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import { SkeletonText } from '@/components/ui/Skeleton';
import ConnectedDashboard from '@/components/home/ConnectedDashboard';

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
  tag: string;
  tagClass: string;
  accent: string;
  iconColor: string;
  desc: string;
  features: string[];
  href: string;
  statLabel: string;
  /** Optional partner attribution displayed at bottom-left of the card. Defaults to "Aedral". */
  partnerLabel?: string;
};

const pillars: Pillar[] = [
  {
    id: 'structures',
    icon: Shield,
    title: 'STRUCTURES',
    tag: 'Gestion',
    tagClass: 'tag-gold',
    accent: '#FFB800',
    iconColor: 'var(--s-gold)',
    desc: 'Crée ta structure, gère ton roster et tes sous-équipes. Inscris-toi aux compétitions Springs.',
    features: ['Roster', 'Sous-équipes', 'Planning', 'Inscriptions'],
    href: '/community/structures',
    statLabel: 'Structures',
  },
  {
    id: 'players',
    icon: UserPlus,
    title: 'VIVIER JOUEURS',
    tag: 'Recrutement',
    tagClass: 'tag-neutral',
    accent: '#EAEAF0',
    iconColor: 'var(--s-text)',
    desc: 'Annuaire des joueurs de l\'écosystème. Profils, rangs, disponibilité pour le recrutement.',
    features: ['Profils', 'Rangs', 'Recrutement', 'Disponibilité'],
    href: '/community/players',
    statLabel: 'Joueurs',
  },
  {
    id: 'competitions',
    icon: Trophy,
    title: 'COMPÉTITIONS',
    tag: 'Événements',
    tagClass: 'tag-violet',
    accent: '#7B2FBE',
    iconColor: 'var(--s-violet-light)',
    desc: 'Saisons, cups, tournois Springs E-Sport. Classements, résultats, inscriptions connectées aux structures.',
    features: ['Rocket League', 'Trackmania'],
    href: '/competitions',
    statLabel: 'Actives',
    partnerLabel: 'Springs E-Sport',
  },
];

const quickLinks = [
  { label: 'Créer une structure', desc: 'Demande de création → validation par Springs', href: '/community/create-structure', icon: Shield, accent: '#FFB800' },
  { label: 'Mon profil', desc: 'Jeux pratiqués, rang, disponibilité recrutement', href: '/settings', icon: Users, accent: '#FFB800' },
  { label: 'Annuaire structures', desc: 'Toutes les structures actives de l\'écosystème', href: '/community/structures', icon: UserPlus, accent: '#0081FF' },
  { label: 'Classements', desc: 'Scores, résultats et statistiques des compétitions', href: '/competitions', icon: Trophy, accent: '#00D936' },
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

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-10">
      <div className="relative z-[1] space-y-10">

        {/* Mode connecté : dashboard perso en haut */}
        {isConnected && user && <ConnectedDashboard user={user} />}

        {/* Mode visiteur : hero marketing */}
        {!isConnected && <VisitorHero stats={stats ?? null} />}

        {/* Compétitions — visible pour tous */}
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
                  <div className="divider mb-4 mt-6" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  <div className="flex items-center justify-between">
                    <span className="t-label" style={{ color: 'rgba(255,255,255,0.25)' }}>Springs E-Sport</span>
                    <span className="btn-springs btn-secondary bevel-sm transition-all group-hover:border-[rgba(255,255,255,0.4)]"
                      style={{ padding: '7px 16px', fontSize: '11px', borderColor: 'rgba(255,255,255,0.2)' }}>
                      Ouvrir <ExternalLink size={11} />
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Explorer l'écosystème — 3 piliers plus compacts en mode connecté */}
        <section className="animate-fade-in-d3">
          <div className="section-label">
            <span className="t-label">{isConnected ? 'Explorer l\'écosystème' : 'L\'écosystème Springs'}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {pillars.map(({ id, icon: Icon, title, tag, tagClass, accent, iconColor, desc, features, href, statLabel, partnerLabel }) => {
              const stat = statsByPillar[id];
              return (
              <Link key={title} href={href}
                className="pillar-card panel group block relative overflow-hidden transition-all duration-200"
                style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="h-[3px]"
                  style={{ background: `linear-gradient(90deg, ${accent}, ${accent}50, transparent 70%)` }} />
                <div className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none opacity-[0.07] transition-opacity duration-300 group-hover:opacity-[0.12]"
                  style={{ background: `radial-gradient(circle at top right, ${accent}, transparent 70%)` }} />
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <Icon size={13} style={{ color: iconColor }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>{title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {partnerLabel && <span className="tag tag-violet">{partnerLabel}</span>}
                      <span className={`tag ${tagClass}`}>{tag}</span>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3" style={{ background: `${accent}10`, border: `1px solid ${accent}25` }}>
                        <Icon size={22} style={{ color: iconColor }} />
                      </div>
                      <div className="text-right">
                        {stat === null ? (
                          <div className="ml-auto" style={{ width: 48, height: 30 }}>
                            <SkeletonText width={48} height={30} />
                          </div>
                        ) : (
                          <span className="font-display text-3xl block" style={{ color: accent, letterSpacing: '0.02em', lineHeight: 1 }}>{stat}</span>
                        )}
                        <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>{statLabel}</span>
                      </div>
                    </div>
                    <h3 className="font-display text-xl mb-2" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>{title}</h3>
                    <p className="text-sm mb-4" style={{ color: 'var(--s-text-dim)' }}>{desc}</p>
                    <div className="flex items-center gap-2 flex-wrap mb-4">
                      {features.map(f => (
                        <span key={f} className="tag tag-neutral">{f}</span>
                      ))}
                    </div>
                    <div className="divider mb-3" />
                    <div className="flex items-center justify-between">
                      <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>{partnerLabel ?? 'Aedral'}</span>
                      <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider transition-colors group-hover:text-white"
                        style={{ color: iconColor }}>
                        Explorer <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
              );
            })}
          </div>
        </section>

        {/* Accès rapides — visiteur uniquement (le dashboard connecté a déjà ses CTA) */}
        {!isConnected && (
          <section className="animate-fade-in-d3">
            <div className="section-label">
              <span className="t-label">Accès rapides</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {quickLinks.map(({ label, desc, href, icon: Icon, accent }) => (
                <Link key={label} href={href}
                  className="quick-link panel group block relative overflow-hidden transition-all duration-150"
                  style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] transition-all duration-200 group-hover:w-[3px]"
                    style={{ background: accent }} />
                  <div className="p-5 pl-6 flex items-start gap-4">
                    <div className="p-2.5 flex-shrink-0" style={{ background: `${accent}10`, border: `1px solid ${accent}20` }}>
                      <Icon size={18} style={{ color: accent }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold mb-1 transition-colors group-hover:text-white" style={{ color: 'var(--s-text)' }}>{label}</p>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--s-text-muted)' }}>{desc}</p>
                    </div>
                    <ChevronRight size={14} className="flex-shrink-0 mt-1 transition-all opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0"
                      style={{ color: accent }} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}

function VisitorHero({ stats }: { stats: PublicStats | null }) {
  return (
    <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold), transparent 80%)' }} />
      <div className="absolute top-0 left-0 w-[500px] h-[400px] pointer-events-none opacity-[0.06]"
        style={{ background: 'radial-gradient(ellipse at top left, var(--s-gold), transparent 70%)' }} />
      <div className="absolute bottom-0 right-[300px] w-[400px] h-[300px] pointer-events-none opacity-[0.04]"
        style={{ background: 'radial-gradient(ellipse at bottom, var(--s-gold), transparent 70%)' }} />
      <div className="relative z-[1] p-10 flex items-start justify-between gap-10 flex-wrap">
        <div className="flex-1 min-w-[300px]">
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <span className="tag tag-gold">Plateforme communautaire esport</span>
            <span className="status status-live ml-2">En ligne</span>
          </div>
          <h1 className="t-display mb-4">
            STRUCTURES · JOUEURS<br />
            <span style={{ color: 'var(--s-gold)' }}>COMPÉTITIONS</span>
          </h1>
          <p className="t-body max-w-xl mb-6" style={{ fontSize: '15px' }}>
            La plateforme communautaire pour les structures et joueurs de l&apos;écosystème
            esport amateur. Gère ta structure, recrute des joueurs, participe aux compétitions.
            En partenariat avec Springs E-Sport.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/community" className="btn-springs btn-primary bevel-sm">
              Rejoindre la communauté <ArrowRight size={14} />
            </Link>
            <Link href="/competitions" className="btn-springs btn-secondary bevel-sm">
              <Trophy size={14} /> Compétitions
            </Link>
          </div>
        </div>
        <div className="flex-shrink-0 w-[280px] hidden lg:block">
          <div className="panel accent-top-violet">
            <div className="panel-header">
              <span className="t-label">Activité Springs</span>
              <span className="status status-live">Live</span>
            </div>
            <div className="panel-body space-y-4">
              <div className="flex items-center justify-between">
                <span className="t-body">Compétitions actives</span>
                <span className="font-display text-3xl" style={{ color: 'var(--s-violet-light)', letterSpacing: '0.02em' }}>{competitions.length}</span>
              </div>
              <div className="divider" />
              <div className="flex items-center justify-between">
                <span className="t-body">Jeux couverts</span>
                <div className="flex gap-2">
                  <span className="tag tag-blue" style={{ fontSize: '9px', padding: '2px 6px' }}>RL</span>
                  <span className="tag tag-green" style={{ fontSize: '9px', padding: '2px 6px' }}>TM</span>
                </div>
              </div>
              {competitions.map(c => (
                <Fragment key={c.id}>
                  <div className="divider" />
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-body truncate" title={c.name} style={{ fontSize: '13px', lineHeight: 1.3 }}>{c.name}</span>
                    <span className={`tag ${c.tagClass}`} style={{ fontSize: '9px', padding: '2px 6px', flexShrink: 0 }}>{c.tag}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
