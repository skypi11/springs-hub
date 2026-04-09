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
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
    description: 'Compétition mensuelle en solo. Qualifications sur plusieurs maps officielles Springs puis finale.',
  },
];

export default function CompetitionsPage() {
  return (
    <div className="min-h-screen">

      {/* ─── HEADER ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[400px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 80% 0%, rgba(255,184,0,0.07) 0%, transparent 65%)' }} />

        <div className="relative px-10 pt-14 pb-12 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-xs font-bold uppercase tracking-widest"
            style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.18)', color: '#FFB800' }}>
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

        <div className="absolute bottom-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }} />
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
      <section className="px-10 pb-14 space-y-5">
        {competitions.map((comp) => (
          <div key={comp.id} className="card overflow-hidden">
            {/* Accent bar top */}
            <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${comp.gameColor}, transparent 50%)` }} />

            <div className="p-8">
              <div className="flex items-start gap-8">
                {/* Left content */}
                <div className="flex-1">
                  {/* Tag + status */}
                  <div className="flex items-center gap-3 mb-5">
                    <span className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider"
                      style={{ background: `${comp.gameColor}15`, color: comp.gameColor, border: `1px solid ${comp.gameColor}28` }}>
                      {comp.tag} — {comp.game}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: comp.statusColor }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: comp.statusColor }} />
                      {comp.statusLabel}
                    </span>
                  </div>

                  {/* Name + edition */}
                  <h2 className="font-display mb-1" style={{ fontSize: '2.4rem', color: '#f0f0f8', lineHeight: 1 }}>
                    {comp.name}
                  </h2>
                  <p className="text-sm mb-4" style={{ color: 'rgba(160,160,192,0.45)' }}>{comp.edition}</p>
                  <p className="text-sm mb-7 max-w-2xl leading-relaxed" style={{ color: 'rgba(160,160,192,0.6)' }}>
                    {comp.description}
                  </p>

                  {/* Meta infos */}
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

                {/* CTA */}
                <div className="flex-shrink-0 flex flex-col items-end justify-between h-full gap-4">
                  <a href={comp.href} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.03] glow-violet whitespace-nowrap"
                    style={{ background: 'linear-gradient(135deg, #7B2FBE, #9d4fe0)', color: '#fff' }}>
                    Voir la compétition
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Coming soon */}
        <div className="rounded-2xl p-12 text-center"
          style={{ background: 'rgba(255,255,255,0.015)', border: '1px dashed rgba(255,255,255,0.07)' }}>
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
