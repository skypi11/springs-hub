import Link from 'next/link';
import { Trophy, Calendar, ExternalLink, Gamepad2, ChevronRight } from 'lucide-react';

const competitions = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    gameColor: '#0081FF',
    name: 'Springs League Series',
    edition: 'Saison 2 — 2026',
    status: 'active',
    statusLabel: 'En cours',
    statusColor: '#22c55e',
    format: 'Ligue · 2 Poules · Round Robin · BO7',
    teams: 32,
    prize: '1 600€',
    href: 'https://springs-esport.vercel.app/rocket-league/',
    external: true,
    description: '32 équipes réparties en 2 poules. Top 8 de chaque poule qualifié pour la LAN finale.',
  },
  {
    id: 'tm-monthly',
    game: 'Trackmania',
    gameColor: '#00D936',
    name: 'Monthly Cup',
    edition: 'Mensuel',
    status: 'active',
    statusLabel: 'Mensuel',
    statusColor: '#00D936',
    format: 'Cup · Solo · Qualifications + Finale',
    teams: null,
    prize: null,
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
    external: true,
    description: 'Compétition mensuelle en solo. Qualifications sur plusieurs maps puis finale.',
  },
];

const statusBg: Record<string, string> = {
  active: 'rgba(34,197,94,0.08)',
  upcoming: 'rgba(255,184,0,0.08)',
  finished: 'rgba(160,160,192,0.08)',
};

export default function CompetitionsPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <section className="relative overflow-hidden px-8 pt-14 pb-12">
        <div className="absolute top-0 right-0 w-[500px] h-[400px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(255,184,0,0.07) 0%, transparent 65%)' }} />

        <div className="relative max-w-4xl animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-semibold uppercase tracking-wider"
            style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.2)', color: '#FFB800' }}>
            <Trophy size={11} />
            Compétitions
          </div>
          <h1 className="text-5xl font-black mb-4 leading-tight tracking-tight">
            <span style={{ color: '#f0f0f8' }}>Toutes les </span>
            <span style={{ background: 'linear-gradient(135deg, #FFB800, #ff8c00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Compétitions
            </span>
          </h1>
          <p className="text-lg max-w-xl leading-relaxed" style={{ color: 'rgba(160,160,192,0.7)' }}>
            Toutes les compétitions organisées par Springs E-Sport.
            Rocket League, Trackmania, et plus à venir.
          </p>
        </div>
      </section>

      {/* Filters */}
      <section className="px-8 pb-6">
        <div className="max-w-4xl flex items-center gap-3">
          {['Tous', 'Rocket League', 'Trackmania', 'En cours', 'Passées'].map((f, i) => (
            <button key={f}
              className="px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200"
              style={{
                background: i === 0 ? 'rgba(123,47,190,0.2)' : 'rgba(255,255,255,0.04)',
                color: i === 0 ? '#c084fc' : 'rgba(160,160,192,0.6)',
                border: i === 0 ? '1px solid rgba(123,47,190,0.3)' : '1px solid rgba(255,255,255,0.06)',
              }}>
              {f}
            </button>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="px-8 mb-6">
        <div className="h-px max-w-4xl" style={{ background: 'linear-gradient(90deg, rgba(123,47,190,0.2), transparent)' }} />
      </div>

      {/* Competition cards */}
      <section className="px-8 pb-16">
        <div className="max-w-4xl space-y-4">
          {competitions.map((comp) => (
            <div key={comp.id} className="rounded-2xl overflow-hidden card-hover"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(123,47,190,0.13)' }}>
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Game + status */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
                        style={{ background: `${comp.gameColor}12`, color: comp.gameColor, border: `1px solid ${comp.gameColor}25` }}>
                        <Gamepad2 size={10} />
                        {comp.game}
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ background: statusBg[comp.status], color: comp.statusColor }}>
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: comp.statusColor }} />
                        {comp.statusLabel}
                      </div>
                    </div>

                    {/* Name + edition */}
                    <h2 className="text-2xl font-black mb-0.5" style={{ color: '#f0f0f8' }}>{comp.name}</h2>
                    <p className="text-sm mb-3" style={{ color: 'rgba(160,160,192,0.5)' }}>{comp.edition}</p>
                    <p className="text-sm mb-5 max-w-lg leading-relaxed" style={{ color: 'rgba(160,160,192,0.65)' }}>
                      {comp.description}
                    </p>

                    {/* Meta */}
                    <div className="flex items-center gap-5 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(160,160,192,0.5)' }}>
                        <Trophy size={11} />
                        {comp.format}
                      </div>
                      {comp.teams && (
                        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(160,160,192,0.5)' }}>
                          <Calendar size={11} />
                          {comp.teams} équipes
                        </div>
                      )}
                      {comp.prize && (
                        <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: '#FFB800' }}>
                          🏆 {comp.prize} de dotation
                        </div>
                      )}
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="flex flex-col items-end gap-2 ml-6">
                    <a href={comp.href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-[1.02] whitespace-nowrap"
                      style={{ background: 'linear-gradient(135deg, #7B2FBE, #9d4fe0)', color: '#fff', boxShadow: '0 4px 16px rgba(123,47,190,0.35)' }}>
                      Voir la compétition
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              </div>
              {/* Bottom bar */}
              <div className="h-0.5"
                style={{ background: `linear-gradient(90deg, ${comp.gameColor}60, transparent)` }} />
            </div>
          ))}

          {/* Coming soon */}
          <div className="rounded-2xl p-6 text-center"
            style={{ background: 'rgba(255,255,255,0.015)', border: '1px dashed rgba(123,47,190,0.15)' }}>
            <Trophy size={28} className="mx-auto mb-3" style={{ color: 'rgba(255,184,0,0.25)' }} />
            <p className="font-semibold mb-1" style={{ color: 'rgba(160,160,192,0.4)' }}>Nouvelles compétitions à venir</p>
            <p className="text-sm" style={{ color: 'rgba(160,160,192,0.25)' }}>
              Restez connectés pour les prochains événements Springs.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
