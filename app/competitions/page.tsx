import { Trophy, Calendar, ExternalLink, Gamepad2, Users, Award } from 'lucide-react';

const competitions = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    gameColor: '#0081FF',
    tag: 'RL',
    name: 'SPRINGS LEAGUE SERIES',
    edition: 'Saison 2 — 2026',
    status: 'active',
    statusLabel: 'En cours',
    statusColor: '#22c55e',
    format: 'Ligue · 2 Poules · Round Robin · BO7',
    teams: 32,
    prize: '1 600€',
    bgFrom: '#001f4d',
    bgMid: '#000d2a',
    bgTo: '#07070f',
    href: 'https://springs-esport.vercel.app/rocket-league/',
    description: '32 équipes réparties en 2 poules. Top 8 de chaque poule qualifié pour la LAN finale. Format 3v3.',
  },
  {
    id: 'tm-monthly',
    game: 'Trackmania',
    gameColor: '#00D936',
    tag: 'TM',
    name: 'MONTHLY CUP',
    edition: 'Mensuel',
    status: 'active',
    statusLabel: 'Mensuel',
    statusColor: '#00D936',
    format: 'Cup · Solo · Qualifications + Finale',
    teams: null,
    prize: null,
    bgFrom: '#003311',
    bgMid: '#001a09',
    bgTo: '#07070f',
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
    description: 'Compétition mensuelle en solo. Qualifications sur plusieurs maps officielles Springs puis finale.',
  },
];

export default function CompetitionsPage() {
  return (
    <div className="min-h-screen">

      {/* ─── HEADER ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden section-cut">

        {/* Lighting */}
        <div className="absolute top-0 left-[30%] w-[500px] h-[300px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(255,184,0,0.05) 0%, transparent 70%)' }} />

        {/* Geometric decorations */}
        <svg className="absolute -top-10 -right-10 w-[280px] h-[280px] opacity-[0.04] animate-float" viewBox="0 0 200 200">
          <polygon points="100,5 195,52 195,148 100,195 5,148 5,52" fill="none" stroke="#FFB800" strokeWidth="0.6"/>
          <polygon points="100,25 175,62 175,138 100,175 25,138 25,62" fill="none" stroke="#FFB800" strokeWidth="0.3"/>
        </svg>
        <div className="geo-accent cross absolute top-[25%] right-[20%] w-4 h-4" />
        <div className="geo-accent cross absolute top-[55%] right-[30%] w-3 h-3" />

        <div className="relative px-10 pt-16 pb-20 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-xs font-bold uppercase tracking-widest"
            style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.15)', color: '#FFB800' }}>
            <Trophy size={10} />
            Compétitions
          </div>
          <h1 className="font-display leading-none mb-2" style={{ fontSize: 'clamp(52px, 6vw, 90px)', color: '#f0f0f8' }}>
            TOUTES LES
          </h1>
          <h1 className="font-display gradient-text-gold leading-none mb-6" style={{ fontSize: 'clamp(52px, 6vw, 90px)' }}>
            COMPÉTITIONS
          </h1>
          <p className="text-base max-w-xl leading-relaxed" style={{ color: 'rgba(160,160,192,0.65)' }}>
            Toutes les compétitions organisées par Springs E-Sport.
            Rocket League, Trackmania, et plus à venir.
          </p>
        </div>
      </section>

      {/* ─── FILTRES ──────────────────────────────────────────────────────── */}
      <section className="px-10 py-6">
        <div className="flex items-center gap-3">
          {['Tous', 'Rocket League', 'Trackmania', 'En cours', 'Passées'].map((f, i) => (
            <button key={f}
              className="px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-200"
              style={{
                background: i === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                color: i === 0 ? '#f0f0f8' : 'rgba(160,160,192,0.55)',
                border: i === 0 ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.06)',
              }}>
              {f}
            </button>
          ))}
        </div>
      </section>

      {/* ─── LISTE ────────────────────────────────────────────────────────── */}
      <section className="px-10 pb-16 space-y-6">
        {competitions.map((comp) => (
          <div key={comp.id} className="rounded-2xl overflow-hidden border transition-all duration-300"
            style={{ borderColor: 'rgba(255,255,255,0.07)', background: '#07070f' }}>

            {/* Visual header */}
            <div className="h-32 relative overflow-hidden"
              style={{ background: `linear-gradient(160deg, ${comp.bgFrom} 0%, ${comp.bgMid} 50%, ${comp.bgTo} 100%)` }}>

              {/* Hex decorations */}
              <svg className="absolute -top-4 -right-4 w-[140px] h-[140px] opacity-[0.07]" viewBox="0 0 200 200">
                <polygon points="100,5 195,52 195,148 100,195 5,148 5,52" fill="none" stroke={comp.gameColor} strokeWidth="1.2"/>
              </svg>
              <svg className="absolute bottom-2 left-[30%] w-[70px] h-[70px] opacity-[0.04]" viewBox="0 0 200 200">
                <polygon points="100,5 195,52 195,148 100,195 5,148 5,52" fill="none" stroke="white" strokeWidth="1"/>
              </svg>

              {/* Colored beam */}
              <div className="absolute inset-0 pointer-events-none"
                style={{ background: `radial-gradient(ellipse at 10% 80%, ${comp.gameColor}25 0%, transparent 55%)` }} />

              {/* Watermark */}
              <span className="absolute -bottom-3 right-6 font-display select-none pointer-events-none"
                style={{ fontSize: '6rem', color: comp.gameColor, opacity: 0.07, lineHeight: 1 }}>
                {comp.tag}
              </span>

              {/* Tag + status */}
              <div className="absolute top-5 left-6 right-6 flex items-center justify-between">
                <span className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider backdrop-blur-sm"
                  style={{ background: `${comp.gameColor}20`, color: comp.gameColor, border: `1px solid ${comp.gameColor}35` }}>
                  {comp.tag} — {comp.game}
                </span>
                <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: comp.statusColor }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: comp.statusColor }} />
                  {comp.statusLabel}
                </span>
              </div>

              {/* Neon bottom line */}
              <div className="absolute bottom-0 left-0 right-0 h-[2px]"
                style={{ background: `linear-gradient(90deg, ${comp.gameColor}, ${comp.gameColor}40, transparent)`, boxShadow: `0 0 10px ${comp.gameColor}30` }} />
            </div>

            {/* Content */}
            <div className="p-8" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <div className="flex items-start gap-8">
                <div className="flex-1">
                  <h2 className="font-display mb-1" style={{ fontSize: '2.4rem', color: '#f0f0f8', lineHeight: 1 }}>
                    {comp.name}
                  </h2>
                  <p className="text-sm mb-4" style={{ color: 'rgba(160,160,192,0.45)' }}>{comp.edition}</p>
                  <p className="text-sm mb-7 max-w-2xl leading-relaxed" style={{ color: 'rgba(160,160,192,0.6)' }}>
                    {comp.description}
                  </p>

                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(160,160,192,0.45)' }}>
                      <Gamepad2 size={12} />
                      {comp.format}
                    </div>
                    {comp.teams && (
                      <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(160,160,192,0.45)' }}>
                        <Users size={12} />
                        {comp.teams} équipes
                      </div>
                    )}
                    {comp.prize && (
                      <div className="flex items-center gap-2 text-xs font-bold" style={{ color: '#FFB800' }}>
                        <Award size={12} />
                        {comp.prize} de dotation
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(160,160,192,0.45)' }}>
                      <Calendar size={12} />
                      {comp.edition}
                    </div>
                  </div>
                </div>

                <div className="flex-shrink-0">
                  <a href={comp.href} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.03] glow-white whitespace-nowrap"
                    style={{ background: '#ffffff', color: '#07070f' }}>
                    Voir la compétition
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Coming soon */}
        <div className="rounded-2xl p-12 text-center relative overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.015)', border: '1px dashed rgba(255,255,255,0.07)' }}>
          <div className="geo-accent cross absolute top-6 right-10 w-3 h-3" />
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Trophy size={22} style={{ color: 'rgba(255,184,0,0.3)' }} />
          </div>
          <p className="font-semibold mb-1.5" style={{ color: 'rgba(160,160,192,0.4)' }}>
            Nouvelles compétitions à venir
          </p>
          <p className="text-sm" style={{ color: 'rgba(160,160,192,0.25)' }}>
            Restez connectés pour les prochains événements Springs.
          </p>
        </div>
      </section>

    </div>
  );
}
