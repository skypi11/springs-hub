import Link from 'next/link';
import { Trophy, Users, ArrowRight, ExternalLink, Calendar, Gamepad2, UserPlus, Shield } from 'lucide-react';

const competitions = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    tag: 'RL',
    tagClass: 'tag-blue',
    accentClass: 'panel-accent-blue',
    name: 'Springs League Series S2',
    format: 'Ligue · 3v3 · Round Robin · BO7',
    status: 'En cours',
    statusClass: 'status-live',
    date: 'Saison 2026',
    teams: '32 équipes · 2 poules',
    prize: '1 600€',
    href: 'https://springs-esport.vercel.app/rocket-league/',
  },
  {
    id: 'tm-monthly',
    game: 'Trackmania',
    tag: 'TM',
    tagClass: 'tag-green',
    accentClass: 'panel-accent-green',
    name: 'Monthly Cup',
    format: 'Cup · Solo · Qualifs + Finale',
    status: 'Mensuel',
    statusClass: 'status-live',
    date: 'Chaque mois',
    teams: 'Solo — inscription individuelle',
    prize: null,
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen p-6 space-y-6">

      {/* ─── HEADER — identité + contexte, pas "hero" ────────────────────── */}
      <header className="animate-fade-in">
        <div className="panel" style={{ borderTop: '3px solid var(--s-violet)' }}>
          <div className="flex items-start justify-between p-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="tag tag-violet">Plateforme officielle</span>
                <span className="status status-live">Opérationnelle</span>
              </div>
              <h1 className="t-display" style={{ fontSize: '48px' }}>SPRINGS E-SPORT</h1>
              <p className="t-body mt-2 max-w-xl">
                Console de gestion des structures, des joueurs et des compétitions
                de l&apos;écosystème Springs E-Sport.
              </p>
            </div>
            <div className="flex gap-3 mt-1">
              <Link href="/community" className="btn-springs btn-primary">
                Rejoindre <ArrowRight size={14} />
              </Link>
              <Link href="/competitions" className="btn-springs btn-secondary">
                Compétitions
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* ─── 3 PILIERS — modules produit, pas stats ─────────────────────── */}
      <section className="grid-3 animate-fade-in-d1">

        {/* Structures */}
        <div className="panel panel-accent-gold">
          <div className="panel-header">
            <span className="t-label" style={{ color: 'var(--s-gold)' }}>
              <Shield size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '5px' }} />
              Gestion de structure
            </span>
            <span className="tag tag-gold">Pilier 1</span>
          </div>
          <div className="panel-body space-y-3">
            <p className="t-body">
              Crée ta structure, gère ton roster, tes sous-équipes et ton planning.
              Inscris-toi aux compétitions Springs.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="tag tag-neutral">Roster</span>
              <span className="tag tag-neutral">Équipes</span>
              <span className="tag tag-neutral">Planning</span>
              <span className="tag tag-neutral">Inscriptions</span>
            </div>
            <div className="divider" />
            <Link href="/community" className="btn-springs btn-ghost" style={{ padding: '6px 8px' }}>
              Accéder <ArrowRight size={12} />
            </Link>
          </div>
        </div>

        {/* Vivier joueurs */}
        <div className="panel panel-accent-violet">
          <div className="panel-header">
            <span className="t-label" style={{ color: '#a364d9' }}>
              <UserPlus size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '5px' }} />
              Vivier de joueurs
            </span>
            <span className="tag tag-violet">Pilier 2</span>
          </div>
          <div className="panel-body space-y-3">
            <p className="t-body">
              Annuaire des joueurs de l&apos;écosystème. Profils, rangs, disponibilité
              pour le recrutement. Base de talents Springs.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="tag tag-neutral">Profils</span>
              <span className="tag tag-neutral">Recrutement</span>
              <span className="tag tag-neutral">Rangs</span>
              <span className="tag tag-neutral">Disponibilité</span>
            </div>
            <div className="divider" />
            <Link href="/community/players" className="btn-springs btn-ghost" style={{ padding: '6px 8px' }}>
              Accéder <ArrowRight size={12} />
            </Link>
          </div>
        </div>

        {/* Compétitions */}
        <div className="panel">
          <div className="panel-header">
            <span className="t-label">
              <Trophy size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '5px' }} />
              Compétitions
            </span>
            <span className="tag tag-neutral">Pilier 3</span>
          </div>
          <div className="panel-body space-y-3">
            <p className="t-body">
              Événements et saisons Springs. Classements, résultats, inscriptions.
              Connecté aux structures et aux joueurs.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="tag tag-blue">Rocket League</span>
              <span className="tag tag-green">Trackmania</span>
            </div>
            <div className="divider" />
            <Link href="/competitions" className="btn-springs btn-ghost" style={{ padding: '6px 8px' }}>
              Accéder <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── COMPÉTITIONS EN COURS — fiches officielles ──────────────────── */}
      <section className="animate-fade-in-d2">
        <div className="section-title">
          <span className="t-label">Compétitions actives</span>
        </div>

        <div className="space-y-3">
          {competitions.map((comp) => (
            <div key={comp.id} className={`fiche ${comp.accentClass}`}>
              <div className="flex items-stretch">

                {/* Main content */}
                <div className="flex-1 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`tag ${comp.tagClass}`}>{comp.tag}</span>
                    <span className="t-sub" style={{ fontSize: '16px' }}>{comp.name}</span>
                    <span className={`status ${comp.statusClass} ml-auto`}>{comp.status}</span>
                  </div>

                  <div className="flex items-center gap-6 flex-wrap">
                    <span className="t-mono flex items-center gap-1.5">
                      <Gamepad2 size={12} /> {comp.format}
                    </span>
                    <span className="t-mono flex items-center gap-1.5">
                      <Users size={12} /> {comp.teams}
                    </span>
                    <span className="t-mono flex items-center gap-1.5">
                      <Calendar size={12} /> {comp.date}
                    </span>
                    {comp.prize && (
                      <span className="t-mono flex items-center gap-1.5" style={{ color: 'var(--s-gold)' }}>
                        <Trophy size={12} /> {comp.prize}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action */}
                <div className="flex items-center px-5" style={{ borderLeft: '1px solid var(--s-border)' }}>
                  <a href={comp.href} target="_blank" rel="noopener noreferrer"
                    className="btn-springs btn-secondary whitespace-nowrap">
                    Ouvrir <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── ACCÈS RAPIDES ────────────────────────────────────────────────── */}
      <section className="animate-fade-in-d3">
        <div className="section-title">
          <span className="t-label">Accès rapides</span>
        </div>

        <div className="grid-4">
          {[
            { label: 'Créer une structure', desc: 'Demande de création → validation Springs', href: '/community/create-structure', icon: Shield },
            { label: 'Mon profil', desc: 'Jeux, rang, disponibilité recrutement', href: '/settings', icon: Users },
            { label: 'Annuaire structures', desc: 'Structures actives de l\'écosystème', href: '/community/structures', icon: UserPlus },
            { label: 'Classements', desc: 'Scores et résultats des compétitions', href: '/competitions', icon: Trophy },
          ].map(({ label, desc, href, icon: Icon }) => (
            <Link key={label} href={href} className="fiche p-4 block group">
              <div className="flex items-start gap-3">
                <div className="p-2" style={{ background: 'var(--s-elevated)', borderRadius: 'var(--s-radius)', border: '1px solid var(--s-border)' }}>
                  <Icon size={15} style={{ color: 'var(--s-text-dim)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="t-sub text-sm group-hover:text-white transition-colors">{label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{desc}</p>
                </div>
                <ArrowRight size={14} className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--s-text-dim)' }} />
              </div>
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}
