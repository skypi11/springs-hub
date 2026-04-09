import Link from 'next/link';
import { Trophy, Users, Gamepad2, ArrowRight, Zap, Calendar, ChevronRight, Shield } from 'lucide-react';

const activeComps = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    name: 'Springs League\nSeries S2',
    status: 'En cours',
    statusColor: '#22c55e',
    date: 'Saison 2026',
    tag: 'RL',
    tagColor: '#0081FF',
    href: 'https://springs-esport.vercel.app/rocket-league/',
    description: 'Ligue compétitive 3v3. Round-robin par poule, top 8 qualifiés pour la LAN finale.',
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
    description: 'Compétition mensuelle solo sur les maps officielles Springs.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">

      {/* ─── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ minHeight: '400px' }}>
        <div className="absolute top-0 right-0 w-[800px] h-[500px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 80% 0%, rgba(123,47,190,0.1) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 left-0 w-[400px] h-[300px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 0% 100%, rgba(255,184,0,0.04) 0%, transparent 65%)' }} />

        <div className="relative px-10 pt-14 pb-14 flex items-start gap-14">
          {/* Left */}
          <div className="flex-1 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-xs font-semibold uppercase tracking-widest"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(192,132,252,0.9)' }}>
              <Zap size={10} />
              Hub Communautaire
            </div>

            <h1 className="font-display leading-none mb-2" style={{ fontSize: 'clamp(60px, 7vw, 105px)', color: '#f0f0f8' }}>
              LA PLATEFORME
            </h1>
            <h1 className="font-display gradient-text leading-none mb-7"
              style={{ fontSize: 'clamp(60px, 7vw, 105px)' }}>
              SPRINGS E-SPORT
            </h1>

            <p className="text-base mb-9 max-w-lg leading-relaxed" style={{ color: 'rgba(160,160,192,0.65)' }}>
              Gère ta structure, suis les compétitions, recrute des joueurs.
              Rejoins la communauté officielle Springs E-Sport.
            </p>

            <div className="flex items-center gap-4 flex-wrap">
              <Link href="/community"
                className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.03] active:scale-[0.98] glow-violet"
                style={{ background: 'linear-gradient(135deg, #7B2FBE, #9d4fe0)', color: '#fff' }}>
                Rejoindre la communauté
                <ArrowRight size={15} />
              </Link>
              <Link href="/competitions"
                className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.02]"
                style={{ background: 'rgba(255,184,0,0.07)', color: '#FFB800', border: '1px solid rgba(255,184,0,0.2)' }}>
                <Trophy size={15} />
                Compétitions
              </Link>
            </div>
          </div>

          {/* Right — card compétitions */}
          <div className="w-[320px] flex-shrink-0 animate-fade-in-delay hidden lg:block">
            <div className="rounded-2xl overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="h-0.5" style={{ background: 'linear-gradient(90deg, #7B2FBE, #FFB800)' }} />
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(160,160,192,0.45)' }}>
                    En direct
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#22c55e' }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#22c55e' }} />
                    2 actives
                  </span>
                </div>
                {activeComps.map((comp) => (
                  <a key={comp.id} href={comp.href} target="_blank" rel="noopener noreferrer"
                    className="block mb-2.5 last:mb-0 p-4 rounded-xl group transition-all duration-200 hover:scale-[1.02]"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="px-2 py-0.5 rounded text-xs font-black"
                        style={{ background: `${comp.tagColor}18`, color: comp.tagColor }}>
                        {comp.tag}
                      </span>
                      <span className="text-sm font-semibold group-hover:text-purple-300 transition-colors truncate" style={{ color: '#f0f0f8' }}>
                        {comp.name.replace('\n', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'rgba(160,160,192,0.4)' }}>{comp.game}</span>
                      <span className="text-xs font-medium flex items-center gap-1" style={{ color: '#9d4fe0' }}>
                        Voir <ArrowRight size={10} />
                      </span>
                    </div>
                  </a>
                ))}
                <Link href="/competitions"
                  className="mt-3 block text-center text-xs font-semibold py-2.5 rounded-xl transition-all hover:opacity-80"
                  style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(160,160,192,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  Toutes les compétitions →
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }} />
      </section>

      {/* ─── STATS ────────────────────────────────────────────────────────── */}
      <section className="px-10 py-8">
        <div className="grid grid-cols-3 gap-5">
          {[
            { label: 'Compétitions actives', value: '2', sub: 'Rocket League + Trackmania', icon: Trophy, color: '#FFB800' },
            { label: 'Structures', value: 'Bientôt', sub: 'Fonctionnalité en développement', icon: Shield, color: '#7B2FBE' },
            { label: 'Joueurs inscrits', value: 'Bientôt', sub: 'Annuaire en développement', icon: Gamepad2, color: '#22c55e' },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="card p-6">
              <div className="p-2.5 rounded-xl w-fit mb-4" style={{ background: `${color}12`, border: `1px solid ${color}20` }}>
                <Icon size={20} style={{ color }} />
              </div>
              <p className="font-display mb-1" style={{ fontSize: '2.8rem', color, lineHeight: 1 }}>{value}</p>
              <p className="text-sm font-semibold mb-1" style={{ color: '#f0f0f8' }}>{label}</p>
              <p className="text-xs" style={{ color: 'rgba(160,160,192,0.4)' }}>{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── COMPÉTITIONS ─────────────────────────────────────────────────── */}
      <section className="px-10 pb-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="font-display" style={{ fontSize: '2rem', color: '#f0f0f8' }}>
              COMPÉTITIONS ACTIVES
            </h2>
            <p className="text-sm mt-1" style={{ color: 'rgba(160,160,192,0.45)' }}>
              Suis et participe aux événements Springs
            </p>
          </div>
          <Link href="/competitions" className="flex items-center gap-1.5 text-sm font-semibold mb-1 hover:opacity-80 transition-opacity"
            style={{ color: '#9d4fe0' }}>
            Tout voir <ChevronRight size={15} />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {activeComps.map((comp) => (
            <a key={comp.id} href={comp.href} target="_blank" rel="noopener noreferrer"
              className="group block card overflow-hidden">
              <div className="p-7">
                <div className="flex items-center justify-between mb-6">
                  <span className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider"
                    style={{ background: `${comp.tagColor}15`, color: comp.tagColor, border: `1px solid ${comp.tagColor}28` }}>
                    {comp.tag} — {comp.game}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: comp.statusColor }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: comp.statusColor }} />
                    {comp.status}
                  </span>
                </div>
                <h3 className="font-display mb-3 group-hover:text-purple-300 transition-colors"
                  style={{ fontSize: '1.9rem', color: '#f0f0f8', lineHeight: 1.1, whiteSpace: 'pre-line' }}>
                  {comp.name}
                </h3>
                <p className="text-sm mb-6 leading-relaxed" style={{ color: 'rgba(160,160,192,0.5)' }}>{comp.description}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(160,160,192,0.35)' }}>
                    <Calendar size={11} />
                    {comp.date}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-bold transition-all group-hover:gap-2.5"
                    style={{ color: '#9d4fe0' }}>
                    Voir <ArrowRight size={13} />
                  </div>
                </div>
              </div>
              <div className="h-0.5 w-0 group-hover:w-full transition-all duration-500"
                style={{ background: `linear-gradient(90deg, ${comp.tagColor}, transparent)` }} />
            </a>
          ))}
        </div>
      </section>

      {/* ─── CTA STRUCTURES ───────────────────────────────────────────────── */}
      <section className="px-10 pb-14">
        <div className="rounded-2xl relative overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
            style={{ background: 'linear-gradient(180deg, #7B2FBE, #FFB800)' }} />
          <div className="absolute right-0 top-0 bottom-0 w-[400px] pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 100% 50%, rgba(255,184,0,0.05) 0%, transparent 65%)' }} />

          <div className="relative pl-12 pr-10 py-10 flex items-center justify-between gap-12">
            <div className="flex-1">
              <div className="flex items-center gap-2.5 mb-4">
                <Users size={16} style={{ color: '#FFB800' }} />
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#FFB800' }}>
                  Espace Structures
                </span>
              </div>
              <h2 className="font-display mb-3" style={{ fontSize: '2.6rem', color: '#f0f0f8', lineHeight: 1 }}>
                TU AS UNE STRUCTURE ESPORT ?
              </h2>
              <p className="text-sm leading-relaxed max-w-lg" style={{ color: 'rgba(160,160,192,0.6)' }}>
                Gère ton roster, organise tes entraînements, inscris-toi aux compétitions Springs.
                Fais une demande pour accéder à l&apos;outil de gestion.
              </p>
            </div>
            <div className="flex flex-col gap-3 flex-shrink-0">
              <Link href="/community"
                className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.03] glow-gold"
                style={{ background: 'linear-gradient(135deg, #FFB800, #cc9400)', color: '#07070f' }}>
                Découvrir la communauté <ArrowRight size={15} />
              </Link>
              <Link href="/community/structures"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-sm transition-all hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(240,240,248,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
                Voir les structures
              </Link>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
