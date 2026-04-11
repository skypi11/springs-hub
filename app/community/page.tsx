import Link from 'next/link';
import { Users, Trophy, Search, ArrowRight, Shield, Clock, UserPlus, ChevronRight } from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'GESTION DE STRUCTURE',
    desc: 'Roster, membres, sous-équipes, planning — tout au même endroit pour les fondateurs.',
    accent: '#FFB800',
    tag: 'Disponible',
    tagClass: 'tag-gold',
    soon: false,
  },
  {
    icon: Search,
    title: 'RECRUTEMENT',
    desc: 'Trouve des joueurs libres ou mets-toi en disponibilité pour être repéré par une structure.',
    accent: '#00D936',
    tag: 'Bientôt',
    tagClass: 'tag-green',
    soon: true,
  },
  {
    icon: Trophy,
    title: 'INSCRIPTIONS',
    desc: 'Inscris ta structure aux compétitions Springs directement depuis ton espace.',
    accent: '#0081FF',
    tag: 'Bientôt',
    tagClass: 'tag-blue',
    soon: true,
  },
];

export default function CommunityPage() {
  return (
    <div className="min-h-screen px-8 py-8 space-y-10">

      {/* ─── HEADER ───────────────────────────────────────────────────────── */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold-dim), transparent 80%)' }} />

        {/* Glow */}
        <div className="absolute top-0 left-0 w-[400px] h-[300px] pointer-events-none opacity-[0.06]"
          style={{ background: 'radial-gradient(ellipse at top left, var(--s-gold), transparent 70%)' }} />

        <div className="relative z-[1] p-10">
          <div className="flex items-center gap-3 mb-5">
            <span className="tag tag-gold">Communauté</span>
            <span className="tag tag-neutral">Springs E-Sport</span>
          </div>

          <h1 className="t-display mb-4">
            ESPACE<br />
            <span style={{ color: 'var(--s-gold)' }}>COMMUNAUTAIRE</span>
          </h1>

          <p className="t-body max-w-xl" style={{ fontSize: '15px' }}>
            La plateforme de gestion pour les structures esport de l&apos;écosystème Springs.
            Rocket League, Trackmania, et plus à venir.
          </p>
        </div>
      </header>

      {/* ─── FEATURES ─────────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d1">
        <div className="section-label">
          <span className="t-label">Fonctionnalités</span>
        </div>

        <div className="grid grid-cols-3 gap-5">
          {features.map(({ icon: Icon, title, desc, accent, tag, tagClass, soon }) => (
            <div key={title}
              className="pillar-card panel group relative overflow-hidden transition-all duration-200">

              <div className="h-[3px]"
                style={{ background: `linear-gradient(90deg, ${accent}, ${accent}50, transparent 70%)` }} />

              <div className="absolute top-0 right-0 w-[180px] h-[180px] pointer-events-none opacity-[0.07]"
                style={{ background: `radial-gradient(circle at top right, ${accent}, transparent 70%)` }} />

              <div className="relative z-[1]">
                <div className="panel-header">
                  <div className="flex items-center gap-2">
                    <Icon size={13} style={{ color: accent }} />
                    <span className="t-label" style={{ color: 'var(--s-text)' }}>{title}</span>
                  </div>
                  <span className={`tag ${tagClass}`}>
                    {soon && <Clock size={9} />}
                    {tag}
                  </span>
                </div>

                <div className="p-5">
                  <div className="p-3.5 w-fit mb-5" style={{ background: `${accent}10`, border: `1px solid ${accent}25` }}>
                    <Icon size={28} style={{ color: accent }} />
                  </div>

                  <h3 className="font-display text-2xl mb-2" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>{title}</h3>
                  <p className="t-body">{desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── REJOINDRE ────────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d2">
        <div className="section-label">
          <span className="t-label">Rejoindre la communauté</span>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* Fondateur */}
          <div className="pillar-card panel group relative overflow-hidden transition-all duration-200">
            <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
            <div className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none opacity-[0.07]"
              style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />

            <div className="relative z-[1] p-7">
              <div className="flex items-center gap-2 mb-5">
                <div className="p-2.5" style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)' }}>
                  <Shield size={18} style={{ color: 'var(--s-gold)' }} />
                </div>
                <span className="t-label" style={{ color: 'var(--s-gold)' }}>Fondateur</span>
              </div>

              <h3 className="font-display text-3xl mb-3" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>
                CRÉER TA STRUCTURE
              </h3>
              <p className="t-body mb-6">
                Tu gères une orga ou une équipe esport ? Fais une demande à l&apos;équipe Springs pour obtenir les droits fondateur.
              </p>

              <Link href="/community/create-structure" className="btn-springs btn-primary bevel-sm">
                Faire une demande <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          {/* Joueur */}
          <div className="pillar-card panel group relative overflow-hidden transition-all duration-200">
            <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.05), transparent 70%)' }} />

            <div className="relative z-[1] p-7">
              <div className="flex items-center gap-2 mb-5">
                <div className="p-2.5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--s-border)' }}>
                  <UserPlus size={18} style={{ color: 'var(--s-text-dim)' }} />
                </div>
                <span className="t-label">Joueur</span>
              </div>

              <h3 className="font-display text-3xl mb-3" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>
                REJOINDRE UNE STRUCTURE
              </h3>
              <p className="t-body mb-6">
                Consulte l&apos;annuaire des structures actives et postule à celles qui recrutent des joueurs.
              </p>

              <Link href="/community/structures" className="btn-springs btn-secondary bevel-sm">
                Voir les structures <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── STRUCTURES ACTIVES ───────────────────────────────────────────── */}
      <section className="animate-fade-in-d3">
        <div className="section-label">
          <span className="t-label">Structures actives</span>
        </div>

        <div className="panel p-14 text-center">
          <div className="p-3 w-fit mx-auto mb-4" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            <Users size={22} style={{ color: 'var(--s-text-muted)' }} />
          </div>
          <p className="t-sub mb-1.5" style={{ color: 'var(--s-text-dim)' }}>
            Aucune structure pour le moment
          </p>
          <p className="t-body">
            La section communautaire est en cours de construction.
          </p>
        </div>
      </section>

    </div>
  );
}
