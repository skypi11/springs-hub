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
    bgImage: 'https://rocketleague.media.zestyio.com/rl_home_hero-bg.jpg',
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
    bgImage: 'https://www.trackmania.com/build/images/tm2020-og.jpg',
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen p-6 space-y-6">

      {/* ─── HERO HEADER ──────────────────────────────────────────────────── */}
      <header className="bevel animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        {/* Violet accent top */}
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), var(--s-violet-light), transparent 80%)' }} />

        <div className="p-8 flex items-start justify-between gap-8">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-4">
              <span className="tag tag-violet">Springs E-Sport</span>
              <span className="tag tag-gold">Plateforme Officielle</span>
              <span className="status status-live ml-2">En ligne</span>
            </div>

            <h1 className="t-display mb-3">
              LA BASE OPÉRATIONNELLE<br />
              <span style={{ color: 'var(--s-gold)' }}>DE L&apos;ESPORT SPRINGS</span>
            </h1>

            <p className="t-body max-w-xl mb-6">
              Structures, joueurs, compétitions — tout l&apos;écosystème Springs E-Sport
              réuni sur une seule plateforme. Gère, recrute, compétitionne.
            </p>

            <div className="flex items-center gap-3">
              <Link href="/community" className="btn-springs btn-primary bevel-sm">
                Rejoindre <ArrowRight size={14} />
              </Link>
              <Link href="/competitions" className="btn-springs btn-secondary bevel-sm">
                <Trophy size={14} /> Compétitions
              </Link>
            </div>
          </div>

          {/* Quick stats panel */}
          <div className="flex-shrink-0 w-[260px] hidden lg:block">
            <div className="panel accent-top-violet">
              <div className="panel-header">
                <span className="t-label">Activité</span>
                <span className="status status-live" style={{ fontSize: '10px' }}>Live</span>
              </div>
              <div className="panel-body space-y-4">
                <div className="flex items-center justify-between">
                  <span className="t-body">Compétitions actives</span>
                  <span className="font-display text-2xl" style={{ color: 'var(--s-gold)', letterSpacing: '0.02em' }}>2</span>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="t-body">Jeux</span>
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
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ─── 3 PILIERS ────────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d1">
        <div className="section-label">
          <span className="t-label">Écosystème Springs</span>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            {
              icon: Shield, label: 'Structures', tag: 'Gestion',
              accent: 'var(--s-gold)', accentClass: 'accent-left-gold', tagClass: 'tag-gold',
              desc: 'Crée ta structure, gère ton roster et tes sous-équipes. Inscris-toi aux compétitions Springs.',
              href: '/community',
            },
            {
              icon: UserPlus, label: 'Vivier', tag: 'Recrutement',
              accent: 'var(--s-violet)', accentClass: 'accent-left-violet', tagClass: 'tag-violet',
              desc: 'Annuaire des joueurs. Profils, rangs, disponibilité. La base de talents de l\'écosystème.',
              href: '/community/players',
            },
            {
              icon: Trophy, label: 'Compétitions', tag: 'Événements',
              accent: 'var(--s-text-dim)', accentClass: '', tagClass: 'tag-neutral',
              desc: 'Saisons, cups, tournois Springs. Classements, résultats, inscriptions connectées.',
              href: '/competitions',
            },
          ].map(({ icon: Icon, label, tag, accentClass, tagClass, desc, href }, i) => (
            <Link key={label} href={href}
              className={`panel ${accentClass} group block transition-all duration-200 hover:border-[rgba(255,255,255,0.15)]`}>
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Icon size={13} style={{ color: 'var(--s-text-dim)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>{label}</span>
                </div>
                <span className={`tag ${tagClass}`}>{tag}</span>
              </div>
              <div className="panel-body">
                <p className="t-body mb-4">{desc}</p>
                <span className="btn-ghost flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors group-hover:text-white"
                  style={{ color: 'var(--s-text-dim)', padding: 0 }}>
                  Accéder <ChevronRight size={12} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── COMPÉTITIONS — fiches avec images de fond ────────────────────── */}
      <section className="animate-fade-in-d2">
        <div className="section-label">
          <span className="t-label">Compétitions actives</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {competitions.map((comp) => (
            <a key={comp.id} href={comp.href} target="_blank" rel="noopener noreferrer"
              className="comp-card bevel group block">

              {/* Background image */}
              <div className="comp-card-bg" style={{ backgroundImage: `url(${comp.bgImage})` }} />
              <div className="comp-card-overlay" />

              {/* Accent bar */}
              <div className="absolute top-0 left-0 right-0 h-[2px] z-[2]"
                style={{ background: `linear-gradient(90deg, ${comp.accent}, transparent 70%)` }} />

              {/* Content */}
              <div className="comp-card-content p-6">
                {/* Top row */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <span className={`tag ${comp.tagClass}`}>{comp.tag}</span>
                    <span className="t-label" style={{ color: 'var(--s-text-dim)' }}>{comp.game}</span>
                  </div>
                  <span className="status status-live">{comp.status}</span>
                </div>

                {/* Title */}
                <h3 className="font-display text-3xl mb-4" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>
                  {comp.name}
                </h3>

                {/* Meta */}
                <div className="flex items-center gap-5 mb-5 flex-wrap">
                  <span className="t-mono flex items-center gap-1.5">
                    <Gamepad2 size={11} /> {comp.format}
                  </span>
                  <span className="t-mono flex items-center gap-1.5">
                    <Users size={11} /> {comp.teams}
                  </span>
                  <span className="t-mono flex items-center gap-1.5">
                    <Calendar size={11} /> {comp.date}
                  </span>
                  {comp.prize && (
                    <span className="t-mono flex items-center gap-1.5" style={{ color: 'var(--s-gold)' }}>
                      <Trophy size={11} /> {comp.prize}
                    </span>
                  )}
                </div>

                {/* Separator + CTA */}
                <div className="divider mb-4" />
                <div className="flex items-center justify-between">
                  <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Springs E-Sport</span>
                  <span className="btn-springs btn-secondary bevel-sm transition-all group-hover:border-[rgba(255,255,255,0.3)]"
                    style={{ padding: '6px 14px', fontSize: '11px' }}>
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

        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Créer une structure', desc: 'Demande → validation Springs', href: '/community/create-structure', icon: Shield, accent: 'var(--s-gold)' },
            { label: 'Mon profil', desc: 'Jeux, rang, recrutement', href: '/settings', icon: Users, accent: 'var(--s-violet-light)' },
            { label: 'Annuaire', desc: 'Structures de l\'écosystème', href: '/community/structures', icon: UserPlus, accent: 'var(--s-text-dim)' },
            { label: 'Classements', desc: 'Scores et résultats', href: '/competitions', icon: Trophy, accent: 'var(--s-text-dim)' },
          ].map(({ label, desc, href, icon: Icon, accent }) => (
            <Link key={label} href={href}
              className="panel group block transition-all duration-150 hover:border-[rgba(255,255,255,0.15)]"
              style={{ padding: '14px 16px' }}>
              <div className="flex items-center gap-3">
                <Icon size={16} style={{ color: accent, flexShrink: 0 }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate transition-colors group-hover:text-white" style={{ color: 'var(--s-text)' }}>{label}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>{desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}
