import Link from 'next/link';
import { Users, Trophy, Search, ArrowRight, Shield, Star, Clock } from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'Gestion de structure',
    description: 'Roster, membres, sous-équipes, planning — tout au même endroit.',
    color: '#7B2FBE',
    soon: false,
  },
  {
    icon: Search,
    title: 'Recrutement',
    description: 'Trouve des joueurs libres ou mets-toi en disponibilité.',
    color: '#FFB800',
    soon: true,
  },
  {
    icon: Trophy,
    title: 'Compétitions',
    description: 'Inscris ta structure aux compétitions Springs directement.',
    color: '#22c55e',
    soon: true,
  },
];

export default function CommunityPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <section className="relative overflow-hidden px-8 pt-14 pb-12">
        <div className="absolute top-0 right-0 w-[600px] h-[400px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(123,47,190,0.1) 0%, transparent 65%)' }} />

        <div className="relative max-w-4xl animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-semibold uppercase tracking-wider"
            style={{ background: 'rgba(123,47,190,0.12)', border: '1px solid rgba(123,47,190,0.25)', color: '#c084fc' }}>
            <Users size={11} />
            Communauté
          </div>
          <h1 className="text-5xl font-black mb-4 leading-tight tracking-tight">
            <span style={{ color: '#f0f0f8' }}>Espace </span>
            <span className="gradient-text">Communautaire</span>
          </h1>
          <p className="text-lg max-w-xl leading-relaxed" style={{ color: 'rgba(160,160,192,0.7)' }}>
            La plateforme de gestion pour les structures esport de l&apos;écosystème Springs.
            Rocket League, Trackmania, et plus à venir.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="px-8 pb-10">
        <div className="grid grid-cols-3 gap-4 max-w-4xl">
          {features.map(({ icon: Icon, title, description, color, soon }) => (
            <div key={title} className="rounded-2xl p-5 relative card-hover"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(123,47,190,0.12)' }}>
              {soon && (
                <div className="absolute top-4 right-4 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                  style={{ background: 'rgba(255,184,0,0.1)', color: '#FFB800', border: '1px solid rgba(255,184,0,0.2)' }}>
                  <Clock size={10} />
                  Bientôt
                </div>
              )}
              <div className="p-2 rounded-xl w-fit mb-4" style={{ background: `${color}12` }}>
                <Icon size={20} style={{ color }} />
              </div>
              <h3 className="font-bold mb-2" style={{ color: '#f0f0f8' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(160,160,192,0.6)' }}>{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="px-8 mb-8">
        <div className="h-px max-w-4xl" style={{ background: 'linear-gradient(90deg, rgba(123,47,190,0.25), transparent)' }} />
      </div>

      {/* Créer une structure */}
      <section className="px-8 pb-10">
        <div className="max-w-4xl">
          <h2 className="text-lg font-bold mb-5" style={{ color: '#f0f0f8' }}>Rejoindre la communauté</h2>

          <div className="grid grid-cols-2 gap-4">
            {/* Créer une structure */}
            <div className="rounded-2xl p-6"
              style={{ background: 'linear-gradient(135deg, rgba(123,47,190,0.15), rgba(123,47,190,0.05))', border: '1px solid rgba(123,47,190,0.25)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Star size={16} style={{ color: '#FFB800' }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#FFB800' }}>Fondateur</span>
              </div>
              <h3 className="text-lg font-black mb-2" style={{ color: '#f0f0f8' }}>
                Créer ta structure
              </h3>
              <p className="text-sm mb-5 leading-relaxed" style={{ color: 'rgba(160,160,192,0.6)' }}>
                Tu gères une orga ou une équipe esport ? Fais une demande à l&apos;équipe Springs pour obtenir les droits fondateur.
              </p>
              <Link href="/community/create-structure"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-[1.02] w-fit"
                style={{ background: 'linear-gradient(135deg, #7B2FBE, #9d4fe0)', color: '#fff', boxShadow: '0 4px 20px rgba(123,47,190,0.35)' }}>
                Faire une demande
                <ArrowRight size={14} />
              </Link>
            </div>

            {/* Rejoindre */}
            <div className="rounded-2xl p-6"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(123,47,190,0.12)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} style={{ color: '#9d4fe0' }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#9d4fe0' }}>Joueur</span>
              </div>
              <h3 className="text-lg font-black mb-2" style={{ color: '#f0f0f8' }}>
                Rejoindre une structure
              </h3>
              <p className="text-sm mb-5 leading-relaxed" style={{ color: 'rgba(160,160,192,0.6)' }}>
                Consulte l&apos;annuaire des structures actives et postule à celles qui recrutent.
              </p>
              <Link href="/community/structures"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-[1.02] w-fit"
                style={{ background: 'rgba(123,47,190,0.12)', color: '#c084fc', border: '1px solid rgba(123,47,190,0.25)' }}>
                Voir les structures
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Annuaire placeholder */}
      <section className="px-8 pb-16">
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold" style={{ color: '#f0f0f8' }}>Structures actives</h2>
          </div>
          <div className="rounded-2xl p-12 text-center"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(123,47,190,0.2)' }}>
            <Users size={32} className="mx-auto mb-3" style={{ color: 'rgba(123,47,190,0.4)' }} />
            <p className="font-semibold mb-1" style={{ color: 'rgba(160,160,192,0.5)' }}>Aucune structure pour le moment</p>
            <p className="text-sm" style={{ color: 'rgba(160,160,192,0.3)' }}>
              La section communautaire est en cours de construction.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
