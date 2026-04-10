import Link from 'next/link';
import { Users, Trophy, Search, ArrowRight, Shield, Star, Clock, UserPlus } from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'Gestion de structure',
    description: 'Roster, membres, sous-équipes, planning — tout au même endroit pour les fondateurs.',
    color: '#FFB800',
    soon: false,
  },
  {
    icon: Search,
    title: 'Recrutement',
    description: 'Trouve des joueurs libres ou mets-toi en disponibilité pour être repéré par une structure.',
    color: '#22c55e',
    soon: true,
  },
  {
    icon: Trophy,
    title: 'Inscriptions',
    description: 'Inscris ta structure aux compétitions Springs directement depuis ton espace.',
    color: '#0081FF',
    soon: true,
  },
];

export default function CommunityPage() {
  return (
    <div className="min-h-screen">

      {/* ─── HEADER ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden section-cut">

        {/* Lighting */}
        <div className="absolute top-0 left-[20%] w-[500px] h-[300px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(255,184,0,0.05) 0%, transparent 70%)' }} />

        {/* Geometric decorations */}
        <svg className="absolute -top-10 -right-10 w-[250px] h-[250px] opacity-[0.04] animate-float" viewBox="0 0 200 200">
          <polygon points="100,5 195,52 195,148 100,195 5,148 5,52" fill="none" stroke="white" strokeWidth="0.6"/>
          <polygon points="100,25 175,62 175,138 100,175 25,138 25,62" fill="none" stroke="white" strokeWidth="0.3"/>
        </svg>
        <div className="geo-accent cross absolute top-[20%] right-[18%] w-4 h-4" />
        <div className="geo-accent diamond absolute top-[60%] right-[25%] w-3 h-3" />

        <div className="relative px-10 pt-16 pb-20 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-xs font-bold uppercase tracking-widest"
            style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.15)', color: '#FFB800' }}>
            <Users size={10} />
            Communauté
          </div>
          <h1 className="font-display leading-none mb-2" style={{ fontSize: 'clamp(52px, 6vw, 90px)', color: '#f0f0f8' }}>
            ESPACE
          </h1>
          <h1 className="font-display gradient-text leading-none mb-6" style={{ fontSize: 'clamp(52px, 6vw, 90px)' }}>
            COMMUNAUTAIRE
          </h1>
          <p className="text-base max-w-xl leading-relaxed" style={{ color: 'rgba(160,160,192,0.65)' }}>
            La plateforme de gestion pour les structures esport de l&apos;écosystème Springs.
            Rocket League, Trackmania, et plus à venir.
          </p>
        </div>
      </section>

      {/* ─── FEATURES ─────────────────────────────────────────────────────── */}
      <section className="px-10 py-10">
        <div className="grid grid-cols-3 gap-5">
          {features.map(({ icon: Icon, title, description, color, soon }, i) => (
            <div key={title} className={`card p-6 relative overflow-hidden ${i === 0 ? 'animate-fade-in' : i === 1 ? 'animate-fade-in-delay' : 'animate-fade-in-delay-2'}`}>
              {/* Colored glow */}
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full pointer-events-none"
                style={{ background: `radial-gradient(circle, ${color}10 0%, transparent 70%)` }} />
              {soon && (
                <div className="absolute top-5 right-5 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: 'rgba(255,184,0,0.08)', color: '#FFB800', border: '1px solid rgba(255,184,0,0.18)' }}>
                  <Clock size={9} />
                  Bientôt
                </div>
              )}
              <div className="relative">
                <div className="p-2.5 rounded-xl w-fit mb-4" style={{ background: `${color}12`, border: `1px solid ${color}20` }}>
                  <Icon size={20} style={{ color }} />
                </div>
                <h3 className="font-semibold mb-2" style={{ color: '#f0f0f8' }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(160,160,192,0.55)' }}>{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── NEON SEPARATOR ───────────────────────────────────────────────── */}
      <div className="mx-10 neon-line" />

      {/* ─── REJOINDRE ────────────────────────────────────────────────────── */}
      <section className="px-10 py-10">
        <h2 className="font-display mb-7" style={{ fontSize: '2rem', color: '#f0f0f8' }}>
          REJOINDRE LA COMMUNAUTÉ
        </h2>

        <div className="grid grid-cols-2 gap-6">
          {/* Fondateur */}
          <div className="rounded-2xl relative overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {/* Neon top edge */}
            <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #FFB800, rgba(255,184,0,0.1))', boxShadow: '0 0 10px rgba(255,184,0,0.2)' }} />
            <div className="absolute right-0 top-0 bottom-0 w-40 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at 100% 50%, rgba(255,184,0,0.05) 0%, transparent 70%)' }} />
            {/* Hex decoration */}
            <svg className="absolute -bottom-6 -right-6 w-[100px] h-[100px] opacity-[0.04]" viewBox="0 0 200 200">
              <polygon points="100,5 195,52 195,148 100,195 5,148 5,52" fill="none" stroke="#FFB800" strokeWidth="1.5"/>
            </svg>
            <div className="relative p-7">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg" style={{ background: 'rgba(255,184,0,0.1)' }}>
                  <Star size={16} style={{ color: '#FFB800' }} />
                </div>
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#FFB800' }}>Fondateur</span>
              </div>
              <h3 className="font-display mb-2" style={{ fontSize: '1.7rem', color: '#f0f0f8', lineHeight: 1.1 }}>
                CRÉER TA STRUCTURE
              </h3>
              <p className="text-sm mb-6 leading-relaxed" style={{ color: 'rgba(160,160,192,0.55)' }}>
                Tu gères une orga ou une équipe esport ? Fais une demande à l&apos;équipe Springs pour obtenir les droits fondateur.
              </p>
              <Link href="/community/create-structure"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.02] glow-gold"
                style={{ background: 'linear-gradient(135deg, #FFB800, #cc9400)', color: '#07070f' }}>
                Faire une demande <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          {/* Joueur */}
          <div className="rounded-2xl relative overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {/* Neon top edge */}
            <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.05))', boxShadow: '0 0 8px rgba(255,255,255,0.1)' }} />
            <div className="absolute right-0 top-0 bottom-0 w-40 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at 100% 50%, rgba(255,255,255,0.03) 0%, transparent 70%)' }} />
            <svg className="absolute -bottom-6 -right-6 w-[100px] h-[100px] opacity-[0.03]" viewBox="0 0 200 200">
              <polygon points="100,5 195,52 195,148 100,195 5,148 5,52" fill="none" stroke="white" strokeWidth="1.5"/>
            </svg>
            <div className="relative p-7">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.07)' }}>
                  <UserPlus size={16} style={{ color: 'rgba(240,240,248,0.7)' }} />
                </div>
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'rgba(240,240,248,0.7)' }}>Joueur</span>
              </div>
              <h3 className="font-display mb-2" style={{ fontSize: '1.7rem', color: '#f0f0f8', lineHeight: 1.1 }}>
                REJOINDRE UNE STRUCTURE
              </h3>
              <p className="text-sm mb-6 leading-relaxed" style={{ color: 'rgba(160,160,192,0.55)' }}>
                Consulte l&apos;annuaire des structures actives et postule à celles qui recrutent des joueurs.
              </p>
              <Link href="/community/structures"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.02] glow-white"
                style={{ background: '#ffffff', color: '#07070f' }}>
                Voir les structures <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── STRUCTURES ACTIVES ───────────────────────────────────────────── */}
      <section className="px-10 pb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display" style={{ fontSize: '2rem', color: '#f0f0f8' }}>
            STRUCTURES ACTIVES
          </h2>
        </div>

        <div className="rounded-2xl p-14 text-center relative overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)' }}>
          <div className="geo-accent cross absolute top-6 right-10 w-3 h-3" />
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Users size={22} style={{ color: 'rgba(160,160,192,0.35)' }} />
          </div>
          <p className="font-semibold mb-1.5" style={{ color: 'rgba(160,160,192,0.45)' }}>
            Aucune structure pour le moment
          </p>
          <p className="text-sm" style={{ color: 'rgba(160,160,192,0.28)' }}>
            La section communautaire est en cours de construction.
          </p>
        </div>
      </section>

    </div>
  );
}
