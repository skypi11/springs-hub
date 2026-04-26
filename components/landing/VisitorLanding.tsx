'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight, Trophy, Users, Shield, UserPlus, Calendar,
  MessageSquare, Search, Gamepad2, ExternalLink,
  CheckCircle2, Zap, Target, ChevronDown, BarChart3,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  PlayerProfileMockup, StructuresListMockup, CalendarMockup,
  RecruitmentMockup, RosterMockup, PlanningMockup, DiscordMockup,
} from './LandingMockups';
import ScrollReveal from './ScrollReveal';

type PublicStats = {
  structures: number;
  players: number;
  recruitingPlayers: number;
};

const competitions = [
  {
    id: 'rl-s2',
    game: 'Rocket League',
    tag: 'RL',
    tagClass: 'tag-blue',
    name: 'SPRINGS LEAGUE SERIES S2',
    format: 'Ligue · 3v3 · Round Robin · BO7',
    status: 'En cours',
    date: 'Saison 2026',
    teams: '32 équipes',
    prize: '1 600€',
    accent: '#0081FF',
    bgImage: '/rocket-league.webp',
    href: 'https://springs-esport.vercel.app/rocket-league/',
  },
  {
    id: 'tm-monthly',
    game: 'Trackmania',
    tag: 'TM',
    tagClass: 'tag-green',
    name: 'MONTHLY CUP',
    format: 'Cup · Solo · Qualifications + Finale',
    status: 'Mensuel',
    date: 'Chaque mois',
    teams: 'Solo',
    prize: null,
    accent: '#00D936',
    bgImage: '/tm.webp',
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
  },
];

export default function VisitorLanding({ stats }: { stats: PublicStats | null }) {
  return (
    <div className="w-full">
      <HeroSection stats={stats} />
      <PlayersSection />
      <StructuresSection />
      <ShowcaseSection />
      <HowItWorksSection />
      <CompetitionsSection />
      <FaqCtaSection />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────────────────────
function HeroSection({ stats }: { stats: PublicStats | null }) {
  const { signInWithDiscord } = useAuth();

  return (
    <section className="relative">{/* orbes globales gérées au niveau du landing-root */}

      {/* Header simple */}
      <header className="relative z-[2] flex items-center justify-between px-6 lg:px-12 py-5">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/aedral/mark.svg" alt="Aedral" width={36} height={36} priority />
          <span className="font-display text-2xl tracking-wider hidden sm:inline" style={{ color: 'var(--s-text)' }}>AEDRAL</span>
        </Link>
        <button onClick={signInWithDiscord} type="button"
          className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
          style={{ padding: '8px 16px', fontSize: '12px' }}>
          <MessageSquare size={13} /> Se connecter avec Discord
        </button>
      </header>

      {/* Contenu hero */}
      <div className="relative z-[1] max-w-[1200px] mx-auto px-6 lg:px-12 py-16 lg:py-24">
        <div className="flex flex-col items-center text-center max-w-3xl mx-auto landing-stagger-1">
          <Image src="/aedral/mark.svg" alt="" width={160} height={160} aria-hidden
            className="aedral-logo-pulse mb-10" priority />

          <span className="tag tag-gold mb-6">Plateforme communautaire esport</span>

          <h1 className="t-display mb-6" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', lineHeight: 1.05 }}>
            L&apos;ESPORT AMATEUR,<br />
            <span style={{ color: 'var(--s-gold)' }}>ENFIN ORGANISÉ.</span>
          </h1>

          <p className="t-body mb-10 max-w-2xl" style={{ fontSize: '17px', lineHeight: 1.6, color: 'var(--s-text-dim)' }}>
            Aedral réunit structures, joueurs et compétitions de l&apos;écosystème
            amateur en un seul endroit. Recrutement, gestion d&apos;équipe, calendrier,
            tournois — tout ce qu&apos;il faut pour faire vivre ta passion.
          </p>

          <div className="flex items-center gap-3 flex-wrap justify-center mb-16">
            <button onClick={signInWithDiscord} type="button"
              className="btn-springs btn-primary bevel-sm flex items-center gap-2"
              style={{ padding: '14px 28px', fontSize: '14px' }}>
              <MessageSquare size={15} /> Rejoindre avec Discord
            </button>
            <a href="#features" className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
              style={{ padding: '14px 28px', fontSize: '14px' }}>
              Découvrir <ChevronDown size={15} />
            </a>
          </div>

          <div className="grid grid-cols-3 gap-6 lg:gap-12 w-full max-w-2xl">
            <StatBlock value={stats?.structures ?? null} label="Structures" />
            <StatBlock value={stats?.players ?? null} label="Joueurs" />
            <StatBlock value={competitions.length} label="Compétitions" />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatBlock({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="text-center">
      <div className={`font-display mb-1 ${value !== null ? 'stat-value' : ''}`}
        style={{ fontSize: 'clamp(2rem, 4vw, 2.75rem)', color: 'var(--s-gold)', letterSpacing: '0.02em' }}>
        {value === null ? '—' : value}
      </div>
      <div className="t-label" style={{ color: 'var(--s-text-muted)' }}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FEATURE CARD : mockup en haut + texte en bas, hauteur uniforme
// ─────────────────────────────────────────────────────────────────────────
function FeatureCard({
  icon: Icon, title, desc, accent, mockup,
}: {
  icon: typeof Shield;
  title: string;
  desc: string;
  accent: string;
  mockup: React.ReactNode;
}) {
  return (
    <div className="feature-card-v2 bevel relative h-full flex flex-col overflow-hidden"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] z-[2]"
        style={{ background: `linear-gradient(90deg, ${accent}aa, ${accent}30, transparent 70%)` }} />
      <div className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none opacity-[0.04] transition-opacity duration-500 group-hover:opacity-[0.08]"
        style={{ background: `radial-gradient(circle at top right, ${accent}, transparent 70%)` }} />

      {/* Mockup zone (240px fixed) */}
      {mockup}

      {/* Texte zone */}
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start gap-3 mb-2">
          <div className="p-2 flex-shrink-0"
            style={{ background: `${accent}15`, border: `1px solid ${accent}30` }}>
            <Icon size={16} style={{ color: accent }} />
          </div>
          <h3 className="t-sub flex-1" style={{ fontSize: '15px', color: 'var(--s-text)', lineHeight: 1.3 }}>{title}</h3>
        </div>
        <p className="t-body" style={{ fontSize: '13px', color: 'var(--s-text-dim)', lineHeight: 1.55 }}>{desc}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// JOUEURS
// ─────────────────────────────────────────────────────────────────────────
function PlayersSection() {
  const features = [
    {
      icon: UserPlus,
      title: 'Profil joueur complet',
      desc: 'Pseudo, jeux, rangs auto-importés depuis les trackers. Visible publiquement aux structures qui recrutent.',
      accent: '#0081FF',
      mockup: <PlayerProfileMockup />,
    },
    {
      icon: Search,
      title: 'Trouve une structure',
      desc: 'Annuaire public, recherche par jeu et par tag, candidature directe ou réponse à un poste recherché.',
      accent: '#FFB800',
      mockup: <StructuresListMockup />,
    },
    {
      icon: Calendar,
      title: 'Calendrier d\'équipe',
      desc: 'Trainings, scrims, matchs. Vue partagée avec ton équipe et tes coachs. Notifications automatiques.',
      accent: '#00D936',
      mockup: <CalendarMockup />,
    },
  ];

  return (
    <section id="features" className="relative py-20 lg:py-28 px-6 lg:px-12">
      <div className="max-w-[1200px] mx-auto">
        <ScrollReveal>
          <div className="text-center mb-16">
            <span className="tag tag-blue mb-4 inline-block">Pour les joueurs</span>
            <h2 className="t-display mb-4" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
              JOUE, PROGRESSE, REJOINS.
            </h2>
            <p className="t-body max-w-2xl mx-auto" style={{ fontSize: '15px', color: 'var(--s-text-dim)' }}>
              Que tu cherches une structure, que tu veuilles afficher ton niveau ou suivre les compétitions —
              Aedral te donne les outils.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 auto-rows-fr">
          {features.map((f, i) => (
            <ScrollReveal key={f.title} delay={i * 100}>
              <FeatureCard {...f} />
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURES
// ─────────────────────────────────────────────────────────────────────────
function StructuresSection() {
  const features = [
    {
      icon: UserPlus,
      title: 'Recrutement par poste',
      desc: 'Publie tes postes ouverts (jeu, rôle, rang min). Reçois candidatures et propose des invitations.',
      accent: '#FFB800',
      mockup: <RecruitmentMockup />,
    },
    {
      icon: Shield,
      title: 'Roster + sous-équipes',
      desc: 'Plusieurs équipes par jeu, titulaires/remplaçants, rôles coach et manager attribués finement.',
      accent: '#FFB800',
      mockup: <RosterMockup />,
    },
    {
      icon: BarChart3,
      title: 'Planning multi-équipes',
      desc: 'Vue d\'ensemble structure : qui s\'entraîne quand, qui joue où. Coachs voient tout en un coup d\'œil.',
      accent: '#0081FF',
      mockup: <PlanningMockup />,
    },
    {
      icon: MessageSquare,
      title: 'Discord intégré',
      desc: 'Webhooks pour notifier ton serveur Discord des candidatures, events, changements de roster.',
      accent: '#5865F2',
      mockup: <DiscordMockup />,
    },
  ];

  return (
    <section className="relative py-20 lg:py-28 px-6 lg:px-12" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="max-w-[1200px] mx-auto">
        <ScrollReveal>
          <div className="text-center mb-16">
            <span className="tag tag-gold mb-4 inline-block">Pour les structures</span>
            <h2 className="t-display mb-4" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
              GÈRE TA STRUCTURE,<br />
              <span style={{ color: 'var(--s-gold)' }}>SANS T&apos;ARRACHER LES CHEVEUX.</span>
            </h2>
            <p className="t-body max-w-2xl mx-auto" style={{ fontSize: '15px', color: 'var(--s-text-dim)' }}>
              Recrutement, organisation interne, planning, communication Discord —
              tous les outils pour faire vivre une structure professionnelle.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 auto-rows-fr">
          {features.map((f, i) => (
            <ScrollReveal key={f.title} delay={i * 100}>
              <FeatureCard {...f} />
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal delay={200}>
          <div className="text-center mt-12">
            <Link href="/community/create-structure" className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2"
              style={{ padding: '14px 28px', fontSize: '14px' }}>
              <Shield size={15} /> Demander une structure <ArrowRight size={14} />
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SHOWCASE — captures du vrai produit, en grand, alternées L/R
// ─────────────────────────────────────────────────────────────────────────
const showcaseShots = [
  {
    src: '/landing/structure-public.webp',
    alt: 'Page publique d\'une structure sur Aedral',
    tag: 'Structure publique',
    title: 'La vitrine de chaque structure',
    desc: 'Page publique complète : direction, équipes, palmarès, liens Discord. Ce que tout le monde voit avant de candidater.',
  },
  {
    src: '/landing/joueurs.webp',
    alt: 'Annuaire des joueurs',
    tag: 'Vivier joueurs',
    title: 'Tout le vivier en un coup d\'œil',
    desc: 'Cards des joueurs avec rang, jeux, dispo recrutement. Filtres par jeu, par tag. Recrute sans avoir à passer 3h sur Discord.',
  },
  {
    src: '/landing/dispos-matching.webp',
    alt: 'Heatmap des disponibilités',
    tag: 'Dispos & matching',
    title: 'Heatmap des dispos : fini les Doodle',
    desc: 'Chaque joueur déclare ses créneaux. La heatmap consensus te montre instantanément les fenêtres où ton équipe est dispo. Suggestions automatiques de slots ≥ 2 joueurs.',
  },
  {
    src: '/landing/match.webp',
    alt: 'Page d\'un match',
    tag: 'Suivi des matchs',
    title: 'Chaque match, son histoire',
    desc: 'Présences (présent / peut-être / absent), score, compte rendu, points à travailler, replays attachés. Tout centralisé, plus rien ne se perd.',
  },
  {
    src: '/landing/devoirs.webp',
    alt: 'Modal création d\'un devoir',
    tag: 'Devoirs & coaching',
    title: 'Coach ta structure comme un pro',
    desc: 'Templates check-in, training, VOD, scouting. Items à auto-évaluer sur 5, deadlines, rappels Discord automatiques. Le suivi qu\'utilisaient seulement les structures pros.',
  },
  {
    src: '/landing/stockage.webp',
    alt: 'Tab documents d\'une structure',
    tag: 'Documents',
    title: 'Stockage R2 par structure',
    desc: 'Stratégies, replays, contrats, charte interne. Organisés en dossiers, accessibles à toute l\'équipe. Hosted sur Cloudflare R2, jamais perdu.',
  },
];

function ShowcaseSection() {
  return (
    <section className="relative py-20 lg:py-32 px-6 lg:px-12 overflow-hidden">
      <div className="max-w-[1200px] mx-auto">
        <ScrollReveal>
          <div className="text-center mb-20">
            <span className="tag tag-gold mb-4 inline-block">Le produit en images</span>
            <h2 className="t-display mb-4" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
              VOILÀ À QUOI <span style={{ color: 'var(--s-gold)' }}>ÇA RESSEMBLE.</span>
            </h2>
            <p className="t-body max-w-2xl mx-auto" style={{ fontSize: '15px', color: 'var(--s-text-dim)' }}>
              Pas de slides marketing. Des captures du vrai site, en production.
            </p>
          </div>
        </ScrollReveal>

        <div className="space-y-24 lg:space-y-32">
          {showcaseShots.map((shot, i) => (
            <ScrollReveal key={shot.src} delay={50}>
              <div className={`flex flex-col gap-10 lg:gap-16 items-center ${i % 2 === 1 ? 'lg:flex-row-reverse' : 'lg:flex-row'}`}>
                {/* Image — 60% */}
                <div className="w-full lg:w-[58%] flex-shrink-0">
                  <ShowcaseTilted src={shot.src} alt={shot.alt} flip={i % 2 === 1} />
                </div>
                {/* Texte — 40% */}
                <div className="w-full lg:w-[42%]">
                  <span className="tag tag-gold mb-4 inline-block" style={{ fontSize: 9 }}>{shot.tag}</span>
                  <h3 className="font-display mb-4" style={{ fontSize: 'clamp(1.5rem, 2.8vw, 2.25rem)', letterSpacing: '0.02em', lineHeight: 1.1, color: 'var(--s-text)' }}>
                    {shot.title}
                  </h3>
                  <p className="t-body" style={{ fontSize: '15px', color: 'var(--s-text-dim)', lineHeight: 1.65 }}>
                    {shot.desc}
                  </p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShowcaseTilted({ src, alt, flip }: { src: string; alt: string; flip: boolean }) {
  return (
    <div className="showcase-tilt-frame group">
      <div className="showcase-tilt-stage" style={{
        transform: flip
          ? 'perspective(2400px) rotateY(14deg) rotateX(4deg) translateZ(0)'
          : 'perspective(2400px) rotateY(-14deg) rotateX(4deg) translateZ(0)',
      }}>
        <div className="showcase-tilt-image-wrapper">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="showcase-tilt-image" />
          {/* Reflection subtile en haut */}
          <div className="showcase-tilt-highlight" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// COMMENT ÇA MARCHE
// ─────────────────────────────────────────────────────────────────────────
function HowItWorksSection() {
  const steps = [
    {
      num: '01',
      icon: MessageSquare,
      title: 'Connecte-toi avec Discord',
      desc: 'Un clic. Pas de mot de passe à retenir, pas de formulaire long. Tu utilises ton Discord.',
    },
    {
      num: '02',
      icon: Target,
      title: 'Complète ton profil',
      desc: 'Ajoute tes jeux, ton pseudo en jeu, lien tracker. Les rangs s\'importent automatiquement.',
    },
    {
      num: '03',
      icon: Zap,
      title: 'Rejoins ou crée',
      desc: 'Cherche une structure qui recrute, candidate, ou demande à créer la tienne — Springs valide les fondateurs.',
    },
  ];

  return (
    <section className="relative py-20 lg:py-28 px-6 lg:px-12">
      <div className="max-w-[1200px] mx-auto">
        <ScrollReveal>
          <div className="text-center mb-16">
            <span className="tag tag-neutral mb-4 inline-block">Comment ça marche</span>
            <h2 className="t-display mb-4" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
              TROIS ÉTAPES, <span style={{ color: 'var(--s-gold)' }}>C&apos;EST TOUT.</span>
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          <div className="hidden md:block absolute top-[60px] left-[16.66%] right-[16.66%] h-px pointer-events-none"
            style={{ background: 'repeating-linear-gradient(90deg, var(--s-border) 0 6px, transparent 6px 12px)' }} />

          {steps.map(({ num, icon: Icon, title, desc }, i) => (
            <ScrollReveal key={num} delay={i * 130}>
              <div className="relative text-center">
              <div className="step-icon relative inline-flex items-center justify-center w-[120px] h-[120px] mb-6"
                style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <Icon size={40} style={{ color: 'var(--s-gold)' }} />
                <span className="absolute -top-3 -right-3 font-display text-3xl px-3 py-1"
                  style={{ background: 'var(--s-gold)', color: '#000', letterSpacing: '0.05em' }}>
                  {num}
                </span>
              </div>
              <h3 className="t-sub mb-2" style={{ fontSize: '17px', color: 'var(--s-text)' }}>{title}</h3>
              <p className="t-body max-w-xs mx-auto" style={{ fontSize: '14px', color: 'var(--s-text-dim)', lineHeight: 1.55 }}>{desc}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// COMPÉTITIONS ACTIVES
// ─────────────────────────────────────────────────────────────────────────
function CompetitionsSection() {
  return (
    <section className="relative py-20 lg:py-28 px-6 lg:px-12" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="max-w-[1200px] mx-auto">
        <ScrollReveal>
          <div className="text-center mb-12">
            <span className="tag tag-violet mb-4 inline-block">Springs E-Sport</span>
          <h2 className="t-display mb-4" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
            COMPÉTITIONS <span style={{ color: 'var(--s-gold)' }}>EN DIRECT</span>
          </h2>
            <p className="t-body max-w-2xl mx-auto" style={{ fontSize: '15px', color: 'var(--s-text-dim)' }}>
              Aedral héberge les compétitions Springs E-Sport — partenaire historique
              de la plateforme. Saisons RL, Monthly Cup TM, et plus à venir.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {competitions.map((comp, i) => (
            <ScrollReveal key={comp.id} delay={i * 120}>
            <a href={comp.href} target="_blank" rel="noopener noreferrer"
              className="comp-card bevel group block" style={{ minHeight: '240px' }}>
              <div className="comp-card-bg" style={{ backgroundImage: `url(${comp.bgImage})` }} />
              <div className="comp-card-overlay" />
              <div className="absolute top-0 left-0 right-0 h-[3px] z-[2]"
                style={{ background: `linear-gradient(90deg, ${comp.accent}, ${comp.accent}60, transparent 70%)` }} />
              <div className="comp-card-content p-7 flex flex-col h-full" style={{ minHeight: '240px' }}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <span className={`tag ${comp.tagClass}`}>{comp.tag}</span>
                    <span className="t-label" style={{ color: 'rgba(255,255,255,0.5)' }}>{comp.game}</span>
                  </div>
                  <span className="status status-live">{comp.status}</span>
                </div>
                <h3 className="font-display mb-5" style={{ fontSize: '2rem', letterSpacing: '0.03em', color: '#fff' }}>
                  {comp.name}
                </h3>
                <div className="flex items-center gap-5 mb-auto flex-wrap">
                  <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <Gamepad2 size={11} /> {comp.format}
                  </span>
                  <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <Users size={11} /> {comp.teams}
                  </span>
                  <span className="t-mono flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <Calendar size={11} /> {comp.date}
                  </span>
                  {comp.prize && (
                    <span className="t-mono flex items-center gap-1.5 font-bold" style={{ color: 'var(--s-gold)' }}>
                      <Trophy size={11} /> {comp.prize}
                    </span>
                  )}
                </div>
                <div className="divider mb-4 mt-6" style={{ background: 'rgba(255,255,255,0.1)' }} />
                <div className="flex items-center justify-between">
                  <span className="t-label" style={{ color: 'rgba(255,255,255,0.25)' }}>Springs E-Sport</span>
                  <span className="btn-springs btn-secondary bevel-sm transition-all group-hover:border-[rgba(255,255,255,0.4)]"
                    style={{ padding: '7px 16px', fontSize: '11px', borderColor: 'rgba(255,255,255,0.2)' }}>
                    Ouvrir <ExternalLink size={11} />
                  </span>
                </div>
              </div>
            </a>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FAQ + CTA FINAL
// ─────────────────────────────────────────────────────────────────────────
const faq = [
  {
    q: 'Est-ce que c\'est gratuit ?',
    a: 'Oui, à 100 %. Toutes les fonctionnalités sont accessibles librement. Une couche premium pour structures pourra apparaître dans le futur, mais la base restera toujours gratuite.',
  },
  {
    q: 'Comment je crée ma structure ?',
    a: 'Tu te connectes, tu fais une demande de création, et un admin Springs valide après un court échange. C\'est gratuit et rapide.',
  },
  {
    q: 'Aedral est-il géré par Springs E-Sport ?',
    a: 'Non. Aedral est un projet personnel ouvert à tout l\'écosystème esport amateur. Springs E-Sport est partenaire privilégié (historique du projet, premières compétitions hébergées) mais n\'est pas propriétaire de la plateforme.',
  },
  {
    q: 'Quels jeux sont supportés ?',
    a: 'Aujourd\'hui : Rocket League et Trackmania. La plateforme est conçue pour s\'étendre à d\'autres titres en fonction des demandes communautaires.',
  },
];

function FaqCtaSection() {
  const { signInWithDiscord } = useAuth();
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section className="relative py-20 lg:py-28 px-6 lg:px-12">
      <div className="max-w-[800px] mx-auto">
        <ScrollReveal>
          <div className="text-center mb-12">
            <span className="tag tag-neutral mb-4 inline-block">Questions fréquentes</span>
            <h2 className="t-display mb-4" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
              BESOIN D&apos;EN <span style={{ color: 'var(--s-gold)' }}>SAVOIR PLUS</span> ?
            </h2>
          </div>
        </ScrollReveal>

        <div className="space-y-3 mb-16">
          {faq.map((item, i) => (
            <div key={item.q} className="bevel-sm overflow-hidden"
              style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
              <button onClick={() => setOpenIdx(openIdx === i ? null : i)} type="button"
                className="w-full flex items-center justify-between p-5 text-left hover:bg-[var(--s-elevated)] transition-colors">
                <span className="t-sub" style={{ fontSize: '15px', color: 'var(--s-text)' }}>{item.q}</span>
                <ChevronDown size={18} className="transition-transform flex-shrink-0 ml-4"
                  style={{
                    color: 'var(--s-text-dim)',
                    transform: openIdx === i ? 'rotate(180deg)' : 'rotate(0)',
                  }} />
              </button>
              {openIdx === i && (
                <div className="px-5 pb-5 pt-1">
                  <p className="t-body" style={{ fontSize: '14px', color: 'var(--s-text-dim)', lineHeight: 1.6 }}>
                    {item.a}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* CTA final */}
        <div className="bevel relative overflow-hidden p-10 lg:p-14 text-center"
          style={{ background: 'linear-gradient(135deg, var(--s-surface), var(--s-elevated))', border: '1px solid var(--s-border)' }}>
          <div className="cta-shimmer-bar absolute top-0 left-0 right-0 h-[3px]" />
          <div className="absolute top-0 right-0 w-[300px] h-[300px] pointer-events-none opacity-[0.08]"
            style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />

          <div className="relative z-[1]">
            <h2 className="t-display mb-4" style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)' }}>
              REJOINS L&apos;ÉCOSYSTÈME.
            </h2>
            <p className="t-body mb-8 max-w-lg mx-auto" style={{ fontSize: '15px', color: 'var(--s-text-dim)' }}>
              Crée ton profil en 30 secondes avec Discord. Pas de carte bancaire,
              pas d&apos;engagement, juste l&apos;esport.
            </p>
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <button onClick={signInWithDiscord} type="button"
                className="btn-springs btn-primary bevel-sm flex items-center gap-2"
                style={{ padding: '14px 28px', fontSize: '14px' }}>
                <MessageSquare size={15} /> Connexion Discord <ArrowRight size={14} />
              </button>
              <Link href="/community/structures" className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
                style={{ padding: '14px 28px', fontSize: '14px' }}>
                <CheckCircle2 size={15} /> Voir les structures
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
