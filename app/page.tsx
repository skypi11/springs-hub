import Link from 'next/link';
import { Trophy, Users, Gamepad2, ArrowRight, Zap, Calendar, ChevronRight } from 'lucide-react';

const stats = [
  { label: 'Compétitions actives', value: '2', icon: Trophy, color: '#FFB800' },
  { label: 'Structures', value: 'Bientôt', icon: Users, color: '#7B2FBE' },
  { label: 'Joueurs inscrits', value: 'Bientôt', icon: Gamepad2, color: '#22c55e' },
];

const activeComps = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    name: 'Springs League Series S2',
    status: 'En cours',
    statusColor: '#22c55e',
    date: 'Saison 2026',
    tag: 'RL',
    tagColor: '#0081FF',
    href: 'https://springs-esport.vercel.app/rocket-league/',
  },
  {
    id: 'tm-monthly',
    game: 'Trackmania',
    name: 'Monthly Cup',
    status: 'Mensuel',
    statusColor: '#00D936',
    date: 'Chaque mois',
    tag: 'TM',
    tagColor: '#00D936',
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden px-8 pt-14 pb-12">
        <div className="absolute top-0 right-0 w-[700px] h-[500px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(123,47,190,0.1) 0%, transparent 65%)' }} />
        <div className="absolute -top-20 -left-20 w-[400px] h-[400px] pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,184,0,0.04) 0%, transparent 70%)' }} />

        <div className="relative max-w-4xl animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-semibold uppercase tracking-wider"
            style={{ background: 'rgba(123,47,190,0.12)', border: '1px solid rgba(123,47,190,0.25)', color: '#c084fc' }}>
            <Zap size={11} />
            Hub Communautaire
          </div>

          <h1 className="text-6xl font-black mb-5 leading-none tracking-tight">
            <span style={{ color: '#f0f0f8' }}>La plateforme</span><br />
            <span className="gradient-text">Springs E-Sport</span>
          </h1>
          <p className="text-lg mb-8 max-w-xl leading-relaxed" style={{ color: 'rgba(160,160,192,0.75)' }}>
            Gère ta structure, suis les compétitions, recrute des joueurs.
            Rejoins la communauté officielle Springs.
          </p>

          <div className="flex items-center gap-4 flex-wrap">
            <Link href="/community"
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-[1.03] active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #7B2FBE, #9d4fe0)', color: '#fff', boxShadow: '0 4px 28px rgba(123,47,190,0.45)' }}>
              Rejoindre la communauté
              <ArrowRight size={15} />
            </Link>
            <Link href="/competitions"
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-[1.02]"
              style={{ background: 'rgba(255,184,0,0.07)', color: '#FFB800', border: '1px solid rgba(255,184,0,0.2)' }}>
              <Trophy size={15} />
              Compétitions
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="px-8 pb-10">
        <div className="grid grid-cols-3 gap-4 max-w-4xl">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-2xl p-5 card-hover"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(123,47,190,0.12)' }}>
              <div className="p-2 rounded-lg w-fit mb-3" style={{ background: `${color}15` }}>
                <Icon size={17} style={{ color }} />
              </div>
              <p className="text-2xl font-black mb-1" style={{ color: '#f0f0f8' }}>{value}</p>
              <p className="text-xs" style={{ color: 'rgba(160,160,192,0.55)' }}>{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="px-8 mb-8">
        <div className="h-px max-w-4xl" style={{ background: 'linear-gradient(90deg, rgba(123,47,190,0.25), transparent)' }} />
      </div>

      {/* Compétitions */}
      <section className="px-8 pb-10">
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold" style={{ color: '#f0f0f8' }}>Compétitions actives</h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(160,160,192,0.45)' }}>Suis et participe aux événements Springs</p>
            </div>
            <Link href="/competitions" className="flex items-center gap-1 text-xs font-medium hover:text-purple-400 transition-colors"
              style={{ color: '#9d4fe0' }}>
              Tout voir <ChevronRight size={13} />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {activeComps.map((comp) => (
              <a key={comp.id} href={comp.href} target="_blank" rel="noopener noreferrer"
                className="group block rounded-2xl overflow-hidden card-hover"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))', border: '1px solid rgba(123,47,190,0.13)' }}>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider"
                      style={{ background: `${comp.tagColor}15`, color: comp.tagColor, border: `1px solid ${comp.tagColor}28` }}>
                      {comp.tag}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: comp.statusColor }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: comp.statusColor }} />
                      {comp.status}
                    </span>
                  </div>
                  <h3 className="text-base font-bold mb-1 group-hover:text-purple-300 transition-colors" style={{ color: '#f0f0f8' }}>
                    {comp.name}
                  </h3>
                  <p className="text-sm mb-5" style={{ color: 'rgba(160,160,192,0.45)' }}>{comp.game}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(160,160,192,0.4)' }}>
                      <Calendar size={11} />
                      {comp.date}
                    </div>
                    <div className="flex items-center gap-1 text-xs font-medium transition-all group-hover:gap-2" style={{ color: '#9d4fe0' }}>
                      Voir <ArrowRight size={11} />
                    </div>
                  </div>
                </div>
                <div className="h-0.5 w-0 group-hover:w-full transition-all duration-500"
                  style={{ background: `linear-gradient(90deg, ${comp.tagColor}, transparent)` }} />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Community CTA */}
      <section className="px-8 pb-16">
        <div className="max-w-4xl">
          <div className="rounded-2xl p-8 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(123,47,190,0.12), rgba(255,184,0,0.04))', border: '1px solid rgba(123,47,190,0.22)' }}>
            <div className="absolute right-0 top-0 w-72 h-72 pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(255,184,0,0.07) 0%, transparent 70%)' }} />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <Users size={18} style={{ color: '#FFB800' }} />
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#FFB800' }}>
                  Espace Structures
                </span>
              </div>
              <h2 className="text-2xl font-black mb-2" style={{ color: '#f0f0f8' }}>
                Tu as une structure esport ?
              </h2>
              <p className="mb-6 max-w-lg text-sm leading-relaxed" style={{ color: 'rgba(160,160,192,0.65)' }}>
                Gère ton roster, organise tes entraînements, inscris-toi aux compétitions Springs.
                Fais une demande pour accéder à l&apos;outil de gestion.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <Link href="/community"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.02]"
                  style={{ background: 'linear-gradient(135deg, #FFB800, #cc9400)', color: '#07070f' }}>
                  Découvrir la communauté
                  <ArrowRight size={14} />
                </Link>
                <Link href="/community/structures"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-[1.02]"
                  style={{ background: 'rgba(255,255,255,0.04)', color: '#f0f0f8', border: '1px solid rgba(255,255,255,0.08)' }}>
                  Voir les structures
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
