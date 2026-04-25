import { Trophy, Calendar, ExternalLink, Gamepad2, Users, Award } from 'lucide-react';

const competitions = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    tag: 'RL',
    tagClass: 'tag-blue',
    name: 'SPRINGS LEAGUE SERIES',
    edition: 'Saison 2 — 2026',
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

export default function CompetitionsPage() {
  return (
    <div className="min-h-screen px-8 py-8 space-y-10">

      {/* ─── HEADER ───────────────────────────────────────────────────────── */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold), transparent 80%)' }} />

        <div className="absolute top-0 right-0 w-[400px] h-[300px] pointer-events-none opacity-[0.05]"
          style={{ background: 'radial-gradient(ellipse at top right, var(--s-gold), transparent 70%)' }} />

        <div className="relative z-[1] p-10">
          <div className="flex items-center gap-3 mb-5">
            <span className="tag tag-gold">Compétitions</span>
            <span className="tag tag-violet">Springs E-Sport</span>
          </div>

          <h1 className="t-display mb-4">
            TOUTES LES<br />
            <span style={{ color: 'var(--s-gold)' }}>COMPÉTITIONS</span>
          </h1>

          <p className="t-body max-w-xl" style={{ fontSize: '15px' }}>
            Toutes les compétitions organisées par Springs E-Sport.
            Rocket League, Trackmania, et plus à venir.
          </p>
        </div>
      </header>

      {/* ─── FILTRES ──────────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d1">
        <div className="flex items-center gap-2">
          {[
            { label: 'Tous', active: true },
            { label: 'Rocket League', active: false },
            { label: 'Trackmania', active: false },
          ].map(({ label, active }) => (
            <button key={label}
              className="tag transition-all duration-150"
              style={{
                background: active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
                color: active ? 'var(--s-text)' : 'var(--s-text-dim)',
                borderColor: active ? 'rgba(255,255,255,0.15)' : 'var(--s-border)',
                padding: '6px 14px',
                fontSize: '11px',
                cursor: 'pointer',
              }}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* ─── LISTE ────────────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d2 space-y-6">
        <div className="section-label">
          <span className="t-label">Compétitions actives</span>
        </div>

        {competitions.map((comp) => (
          <a key={comp.id} href={comp.href} target="_blank" rel="noopener noreferrer"
            className="comp-card bevel group block" style={{ minHeight: '300px' }}>

            {/* Background image */}
            <div className="comp-card-bg" style={{ backgroundImage: `url(${comp.bgImage})` }} />
            <div className="comp-card-overlay" />

            {/* Accent bar */}
            <div className="absolute top-0 left-0 right-0 h-[3px] z-[2]"
              style={{ background: `linear-gradient(90deg, ${comp.accent}, ${comp.accent}60, transparent 70%)` }} />

            {/* Content */}
            <div className="comp-card-content p-8 flex flex-col h-full" style={{ minHeight: '300px' }}>
              {/* Top row */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className={`tag ${comp.tagClass}`}>{comp.tag}</span>
                  <span className="t-label" style={{ color: 'rgba(255,255,255,0.5)' }}>{comp.game}</span>
                </div>
                <span className="status status-live">{comp.status}</span>
              </div>

              {/* Title */}
              <h2 className="font-display mb-2" style={{ fontSize: '2.8rem', letterSpacing: '0.03em', color: '#fff' }}>
                {comp.name}
              </h2>
              <p className="t-body mb-6" style={{ color: 'rgba(255,255,255,0.45)', maxWidth: '600px' }}>
                {comp.description}
              </p>

              {/* Meta */}
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

              {/* Separator + CTA */}
              <div className="divider mb-4 mt-6" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <div className="flex items-center justify-between">
                <span className="t-label" style={{ color: 'rgba(255,255,255,0.25)' }}>Springs E-Sport</span>
                <span className="btn-springs btn-secondary bevel-sm transition-all group-hover:border-[rgba(255,255,255,0.4)]"
                  style={{ padding: '8px 20px', fontSize: '12px', borderColor: 'rgba(255,255,255,0.2)' }}>
                  Voir la compétition <ExternalLink size={12} />
                </span>
              </div>
            </div>
          </a>
        ))}

        {/* Coming soon */}
        <div className="panel p-12 text-center">
          <div className="p-3 w-fit mx-auto mb-4" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            <Trophy size={22} style={{ color: 'var(--s-text-muted)' }} />
          </div>
          <p className="t-sub mb-1.5" style={{ color: 'var(--s-text-dim)' }}>
            Nouvelles compétitions à venir
          </p>
          <p className="t-body">
            Restez connectés pour les prochains événements Springs.
          </p>
        </div>
      </section>

    </div>
  );
}
