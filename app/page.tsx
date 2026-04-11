import Link from 'next/link';
import { Trophy, Users, ArrowRight, ExternalLink, Calendar, Gamepad2, UserPlus, Shield, ChevronRight } from 'lucide-react';

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

const pillars = [
  {
    icon: Shield,
    title: 'STRUCTURES',
    tag: 'Gestion',
    tagClass: 'tag-gold',
    accent: '#FFB800',
    iconColor: 'var(--s-gold)',
    desc: 'Crée ta structure, gère ton roster et tes sous-équipes. Inscris-toi aux compétitions Springs.',
    features: ['Roster', 'Sous-équipes', 'Planning', 'Inscriptions'],
    href: '/community',
    stat: '0',
    statLabel: 'Structures',
  },
  {
    icon: UserPlus,
    title: 'VIVIER JOUEURS',
    tag: 'Recrutement',
    tagClass: 'tag-violet',
    accent: '#7B2FBE',
    iconColor: 'var(--s-violet-light)',
    desc: 'Annuaire des joueurs de l\'écosystème. Profils, rangs, disponibilité pour le recrutement.',
    features: ['Profils', 'Rangs', 'Recrutement', 'Disponibilité'],
    href: '/community/players',
    stat: '—',
    statLabel: 'Joueurs',
  },
  {
    icon: Trophy,
    title: 'COMPÉTITIONS',
    tag: 'Événements',
    tagClass: 'tag-blue',
    accent: '#0081FF',
    iconColor: '#4da6ff',
    desc: 'Saisons, cups, tournois Springs. Classements, résultats, inscriptions connectées aux structures.',
    features: ['Rocket League', 'Trackmania'],
    href: '/competitions',
    stat: '2',
    statLabel: 'Actives',
  },
];

const quickLinks = [
  { label: 'Créer une structure', desc: 'Demande de création → validation par Springs', href: '/community/create-structure', icon: Shield, accent: '#FFB800' },
  { label: 'Mon profil', desc: 'Jeux pratiqués, rang, disponibilité recrutement', href: '/settings', icon: Users, accent: '#7B2FBE' },
  { label: 'Annuaire structures', desc: 'Toutes les structures actives de l\'écosystème', href: '/community/structures', icon: UserPlus, accent: '#0081FF' },
  { label: 'Classements', desc: 'Scores, résultats et statistiques des compétitions', href: '/competitions', icon: Trophy, accent: '#00D936' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen px-8 py-8 space-y-10">

      {/* ─── HERO HEADER ──────────────────────────────────────────────────── */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        {/* Violet accent top */}
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), var(--s-violet-light), transparent 80%)' }} />

        {/* Background glow effects */}
        <div className="absolute top-0 left-0 w-[500px] h-[400px] pointer-events-none opacity-[0.06]"
          style={{ background: 'radial-gradient(ellipse at top left, var(--s-violet), transparent 70%)' }} />
        <div className="absolute bottom-0 right-[300px] w-[400px] h-[300px] pointer-events-none opacity-[0.04]"
          style={{ background: 'radial-gradient(ellipse at bottom, var(--s-gold), transparent 70%)' }} />

        <div className="relative z-[1] p-10 flex items-start justify-between gap-10">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-5">
              <span className="tag tag-violet">Springs E-Sport</span>
              <span className="tag tag-gold">Plateforme Officielle</span>
              <span className="status status-live ml-2">En ligne</span>
            </div>

            <h1 className="t-display mb-4">
              STRUCTURES · JOUEURS<br />
              <span style={{ color: 'var(--s-gold)' }}>COMPÉTITIONS</span>
            </h1>

            <p className="t-body max-w-xl mb-6" style={{ fontSize: '15px' }}>
              Tout l&apos;écosystème Springs E-Sport réuni sur une plateforme.
              Gère ta structure, recrute des joueurs, participe aux compétitions.
            </p>

            <div className="flex items-center gap-3">
              <Link href="/community" className="btn-springs btn-primary bevel-sm">
                Rejoindre la communauté <ArrowRight size={14} />
              </Link>
              <Link href="/competitions" className="btn-springs btn-secondary bevel-sm">
                <Trophy size={14} /> Compétitions
              </Link>
            </div>
          </div>

          {/* Quick stats panel */}
          <div className="flex-shrink-0 w-[280px] hidden lg:block">
            <div className="panel accent-top-violet">
              <div className="panel-header">
                <span className="t-label">Activité Springs</span>
                <span className="status status-live" style={{ fontSize: '10px' }}>Live</span>
              </div>
              <div className="panel-body space-y-4">
                <div className="flex items-center justify-between">
                  <span className="t-body">Compétitions actives</span>
                  <span className="font-display text-3xl" style={{ color: 'var(--s-gold)', letterSpacing: '0.02em' }}>2</span>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="t-body">Jeux couverts</span>
                  <div className="flex gap-2">
                    <span className="tag tag-blue" style={{ fontSize: '9px', padding: '2px 6px' }}>RL</span>
                    <span className="tag tag-green" style={{ fontSize: '9px', padding: '2px 6px' }}>TM</span>
                  </div>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="t-body">Structures</span>
                  <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Bientôt</span>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="t-body">Joueurs inscrits</span>
                  <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Bientôt</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ─── 3 PILIERS ────────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d1">
        <div className="section-label">
          <span className="t-label">L&apos;écosystème Springs</span>
        </div>

        <div className="grid grid-cols-3 gap-5">
          {pillars.map(({ icon: Icon, title, tag, tagClass, accent, iconColor, desc, features, href, stat, statLabel }) => (
            <Link key={title} href={href}
              className="pillar-card panel group block relative overflow-hidden transition-all duration-200">

              {/* Colored accent bar top */}
              <div className="h-[3px]"
                style={{ background: `linear-gradient(90deg, ${accent}, ${accent}50, transparent 70%)` }} />

              {/* Subtle colored glow in top-right corner */}
              <div className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none opacity-[0.07] transition-opacity duration-300 group-hover:opacity-[0.12]"
                style={{ background: `radial-gradient(circle at top right, ${accent}, transparent 70%)` }} />

              {/* Content */}
              <div className="relative z-[1]">
                <div className="panel-header">
                  <div className="flex items-center gap-2">
                    <Icon size={13} style={{ color: iconColor }} />
                    <span className="t-label" style={{ color: 'var(--s-text)' }}>{title}</span>
                  </div>
                  <span className={`tag ${tagClass}`}>{tag}</span>
                </div>

                <div className="p-5">
                  {/* Icon + stat row */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="p-3.5" style={{ background: `${accent}10`, border: `1px solid ${accent}25` }}>
                      <Icon size={28} style={{ color: iconColor }} />
                    </div>
                    <div className="text-right">
                      <span className="font-display text-4xl block" style={{ color: accent, letterSpacing: '0.02em', lineHeight: 1 }}>{stat}</span>
                      <span className="t-label" style={{ color: 'var(--s-text-muted)', fontSize: '9px' }}>{statLabel}</span>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="font-display text-2xl mb-2" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>{title}</h3>

                  <p className="t-body mb-5">{desc}</p>

                  {/* Feature tags */}
                  <div className="flex items-center gap-2 flex-wrap mb-5">
                    {features.map(f => (
                      <span key={f} className="tag tag-neutral">{f}</span>
                    ))}
                  </div>

                  <div className="divider mb-4" />
                  <div className="flex items-center justify-between">
                    <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Springs Hub</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider transition-colors group-hover:text-white"
                      style={{ color: iconColor }}>
                      Accéder <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── COMPÉTITIONS ─────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d2">
        <div className="section-label">
          <span className="t-label">Compétitions actives</span>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {competitions.map((comp) => (
            <a key={comp.id} href={comp.href} target="_blank" rel="noopener noreferrer"
              className="comp-card bevel group block" style={{ minHeight: '280px' }}>

              {/* Background image */}
              <div className="comp-card-bg" style={{ backgroundImage: `url(${comp.bgImage})` }} />
              <div className="comp-card-overlay" />

              {/* Accent bar */}
              <div className="absolute top-0 left-0 right-0 h-[3px] z-[2]"
                style={{ background: `linear-gradient(90deg, ${comp.accent}, ${comp.accent}60, transparent 70%)` }} />

              {/* Content */}
              <div className="comp-card-content p-7 flex flex-col h-full" style={{ minHeight: '280px' }}>
                {/* Top row */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <span className={`tag ${comp.tagClass}`}>{comp.tag}</span>
                    <span className="t-label" style={{ color: 'rgba(255,255,255,0.5)' }}>{comp.game}</span>
                  </div>
                  <span className="status status-live">{comp.status}</span>
                </div>

                {/* Title */}
                <h3 className="font-display mb-5" style={{ fontSize: '2.2rem', letterSpacing: '0.03em', color: '#fff' }}>
                  {comp.name}
                </h3>

                {/* Meta */}
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

                {/* Separator + CTA */}
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

      {/* ─── ACCÈS RAPIDES ────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d3">
        <div className="section-label">
          <span className="t-label">Accès rapides</span>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {quickLinks.map(({ label, desc, href, icon: Icon, accent }) => (
            <Link key={label} href={href}
              className="quick-link panel group block relative overflow-hidden transition-all duration-150">
              {/* Accent line left */}
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

    </div>
  );
}
