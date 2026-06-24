'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight, Trophy, Users, Shield, Calendar,
  MessageSquare, Gamepad2, ExternalLink,
  CheckCircle2, Zap, Target, ChevronDown,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import ScrollReveal from './ScrollReveal';
import TiltImage from '@/components/ui/TiltImage';
import DiscordIcon, { AEDRAL_DISCORD_INVITE_URL } from '@/components/icons/DiscordIcon';
import { ALL_GAME_DEFS } from '@/lib/games-registry';

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

// Dimensions réelles des captures (Guide) → ratio correct, pas de déformation
// next/image. Même pool d'images que la page /guide.
const SHOT_DIMS: Record<string, { w: number; h: number }> = {
  '/guide/structures.webp': { w: 1600, h: 1000 },
  '/guide/profil.webp': { w: 1600, h: 1000 },
  '/guide/recrutement.webp': { w: 1600, h: 1000 },
  '/guide/calendrier.webp': { w: 2272, h: 1149 },
  '/guide/equipes.webp': { w: 2285, h: 1122 },
  '/guide/exercices.webp': { w: 2287, h: 946 },
  '/guide/replays.webp': { w: 2285, h: 1256 },
};

export default function VisitorLanding({ stats }: { stats: PublicStats | null }) {
  return (
    <div className="w-full">
      <HeroSection stats={stats} />
      <PlayersSection />
      <StructuresSection />
      <HowItWorksSection />
      <CompetitionsSection />
      <FaqCtaSection />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────────────────────
// `stats` n'est plus rendu depuis le retrait de la bande de compteurs (audit
// 12/06) — la prop est conservée pour la future bande de logos de structures.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function HeroSection({ stats: _stats }: { stats: PublicStats | null }) {
  const { signInWithDiscord } = useAuth();

  return (
    <section className="relative">{/* orbes globales gérées au niveau du landing-root */}

      {/* Header simple */}
      <header className="relative z-[2] flex items-center justify-between px-6 lg:px-12 py-5">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/aedral/mark.svg" alt="Aedral" width={36} height={36} priority />
          <span className="font-display text-2xl tracking-wider hidden sm:inline" style={{ color: 'var(--s-text)' }}>AEDRAL</span>
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={AEDRAL_DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Rejoindre le Discord Aedral"
            title="Rejoindre le Discord Aedral"
            className="btn-springs btn-secondary bevel-sm flex items-center justify-center"
            style={{ padding: '8px 12px', color: '#7983F5' }}
          >
            <DiscordIcon size={14} />
          </a>
          <button onClick={() => signInWithDiscord()} type="button"
            className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
            style={{ padding: '8px 16px', fontSize: '12px' }}>
            <MessageSquare size={13} /> Se connecter avec Discord
          </button>
        </div>
      </header>

      {/* Contenu hero */}
      <div className="relative z-[1] max-w-[1200px] mx-auto px-6 lg:px-12 pt-16 lg:pt-24 pb-12 lg:pb-16">
        <div className="flex flex-col items-center text-center max-w-3xl mx-auto landing-stagger-1">
          <Image src="/aedral/mark.svg" alt="" width={140} height={140} aria-hidden
            className="aedral-logo-pulse mb-8" priority />

          <span className="tag tag-gold mb-6">Plateforme communautaire esport</span>

          <h1 className="t-display mb-6" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', lineHeight: 1.05 }}>
            L&apos;ESPORT AMATEUR,<br />
            <span style={{ color: 'var(--s-gold)' }}>ENFIN ORGANISÉ.</span>
          </h1>

          <p className="t-body mb-8 max-w-2xl" style={{ fontSize: '17px', lineHeight: 1.6, color: 'var(--s-text-dim)' }}>
            Aedral réunit structures, joueurs et compétitions de l&apos;écosystème
            amateur en un seul endroit : recrutement, gestion d&apos;équipe, calendrier,
            tournois.
          </p>

          <SupportedGamesStrip />

          <div className="flex items-center gap-3 flex-wrap justify-center">
            <button onClick={() => signInWithDiscord()} type="button"
              className="btn-springs btn-primary bevel-sm flex items-center gap-2"
              style={{ padding: '14px 28px', fontSize: '14px' }}>
              <MessageSquare size={15} /> Rejoindre avec Discord
            </button>
            <a href="#features" className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
              style={{ padding: '14px 28px', fontSize: '14px' }}>
              Découvrir <ChevronDown size={15} />
            </a>
          </div>
        </div>

        {/* Capture produit en grand : montrer le vrai site dès le hero. */}
        <ScrollReveal delay={150}>
          <HeroShot />
        </ScrollReveal>
      </div>
    </section>
  );
}

// Capture hero : page publique d'une structure. Tilt 3D souris + lightbox
// (TiltImage partagé), bordure or, ombre profonde au repos, fondu bas.
function HeroShot() {
  const d = SHOT_DIMS['/guide/structures.webp'];
  return (
    <div className="relative w-full max-w-[960px] mx-auto mt-14 lg:mt-20">
      <TiltImage
        src="/guide/structures.webp"
        alt="Page publique d'une structure sur Aedral"
        width={d.w}
        height={d.h}
        priority
        maxTilt={6}
        accentBorder="rgba(255,184,0,0.22)"
        restElevated
        sizes="(max-width: 1024px) 100vw, 960px"
      />
      <div className="absolute -bottom-1 left-0 right-0 h-28 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, transparent, var(--s-bg))' }} />
    </div>
  );
}

// Bande de jeux supportés, alimentée par la Game Registry. Ajouter un nouveau
// jeu dans lib/games-registry.ts le fait apparaître ici sans toucher au landing.
function SupportedGamesStrip() {
  return (
    <div className="flex items-center gap-3 sm:gap-5 flex-wrap justify-center mb-10">
      <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>
        Jeux supportés
      </span>
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
        {ALL_GAME_DEFS.map(g => (
          <div key={g.id}
            className="flex items-center gap-2 bevel-sm transition-colors"
            style={{
              padding: '5px 10px 5px 6px',
              background: 'var(--s-elevated)',
              border: `1px solid rgba(${g.colorRgb}, 0.25)`,
            }}>
            <Image src={g.logoUrl} alt={g.label}
              width={22} height={22}
              style={{ objectFit: 'cover' }} />
            <span className="font-display" style={{
              fontSize: 13, letterSpacing: '0.04em', color: g.color,
            }}>
              {g.label.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PRODUCT ROW : capture inclinée + texte, alternée gauche/droite
// ─────────────────────────────────────────────────────────────────────────
function ProductRow({
  src, alt, tag, title, desc, flip,
}: {
  src: string;
  alt: string;
  tag: string;
  title: string;
  desc: string;
  flip: boolean;
}) {
  const d = SHOT_DIMS[src] ?? { w: 1600, h: 1000 };
  return (
    <ScrollReveal delay={50}>
      <div className={`flex flex-col gap-10 lg:gap-16 items-center ${flip ? 'lg:flex-row-reverse' : 'lg:flex-row'}`}>
        {/* Image, 58% */}
        <div className="w-full lg:w-[58%] flex-shrink-0">
          <TiltImage src={src} alt={alt} width={d.w} height={d.h} sizes="(max-width: 1024px) 100vw, 640px" />
        </div>
        {/* Texte, 42% */}
        <div className="w-full lg:w-[42%]">
          <span className="tag tag-gold mb-4 inline-block" style={{ fontSize: 12 }}>{tag}</span>
          <h3 className="font-display mb-4" style={{ fontSize: 'clamp(1.5rem, 2.8vw, 2.25rem)', letterSpacing: '0.02em', lineHeight: 1.1, color: 'var(--s-text)' }}>
            {title}
          </h3>
          <p className="t-body" style={{ fontSize: '15px', color: 'var(--s-text-dim)', lineHeight: 1.65 }}>
            {desc}
          </p>
        </div>
      </div>
    </ScrollReveal>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// JOUEURS — narration screenshot-led (vraies captures du site)
// ─────────────────────────────────────────────────────────────────────────
function PlayersSection() {
  const rows = [
    {
      src: '/guide/profil.webp',
      alt: 'Profil joueur sur Aedral',
      tag: 'Profil',
      title: 'TON IDENTITÉ ESPORT, VÉRIFIÉE.',
      desc: 'Pseudo, jeux, comptes Epic / Steam / Riot vérifiés, rang importé du tracker. Une page publique que les structures consultent avant de recruter.',
    },
    {
      src: '/guide/recrutement.webp',
      alt: 'Mercato : annuaire des joueurs disponibles',
      tag: 'Mercato',
      title: 'TROUVE UNE STRUCTURE.',
      desc: "L'annuaire des joueurs dispos : rang, jeux, rôle recherché, filtres par jeu. Candidate en un clic, ou laisse les structures venir à toi.",
    },
    {
      src: '/guide/calendrier.webp',
      alt: "Calendrier d'équipe et heatmap des disponibilités",
      tag: 'Calendrier & dispos',
      title: 'PLUS JAMAIS DE DOODLE.',
      desc: "Chaque joueur coche ses créneaux. La heatmap de consensus montre instantanément quand l'équipe est dispo. Trainings, scrims et matchs au même endroit.",
    },
  ];

  return (
    <section id="features" className="relative py-20 lg:py-28 px-6 lg:px-12">
      <div className="max-w-[1200px] mx-auto">
        <ScrollReveal>
          <div className="text-center mb-16 lg:mb-20">
            <span className="tag tag-blue mb-4 inline-block">Pour les joueurs</span>
            <h2 className="t-display mb-4" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
              JOUE, PROGRESSE, REJOINS.
            </h2>
            <p className="t-body max-w-2xl mx-auto" style={{ fontSize: '15px', color: 'var(--s-text-dim)' }}>
              Que tu cherches une structure, que tu veuilles afficher ton niveau ou suivre tes compétitions,
              Aedral te donne les outils.
            </p>
          </div>
        </ScrollReveal>

        <div className="space-y-24 lg:space-y-32">
          {rows.map((r, i) => (
            <ProductRow key={r.src} {...r} flip={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURES — narration screenshot-led + bande Discord
// ─────────────────────────────────────────────────────────────────────────
function StructuresSection() {
  const rows = [
    {
      src: '/guide/equipes.webp',
      alt: 'Gestion du roster et des équipes',
      tag: 'Roster',
      title: 'GÈRE TON ROSTER.',
      desc: "Plusieurs équipes par jeu, titulaires / remplaçants, staff coach et manager. Tout le roster d'un coup d'œil, avec alertes sur les équipes incomplètes.",
    },
    {
      src: '/guide/exercices.webp',
      alt: "Exercices et suivi de coaching d'une structure",
      tag: 'Coaching',
      title: 'COACHE COMME UN PRO.',
      desc: 'Exercices multi-étapes assignés par joueur, deadlines, rappels Discord, suivi de progression. Le suivi qu\'utilisaient seulement les structures pros.',
    },
    {
      src: '/guide/replays.webp',
      alt: 'Bibliothèque de replays cross-équipes',
      tag: 'Replays',
      title: 'CENTRALISE TES REPLAYS.',
      desc: 'Bibliothèque cross-équipes, stats Rocket League parsées automatiquement, replays rattachés aux matchs. Plus rien ne se perd dans les DM.',
    },
  ];

  return (
    <section className="relative py-20 lg:py-28 px-6 lg:px-12" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="max-w-[1200px] mx-auto">
        <ScrollReveal>
          <div className="text-center mb-16 lg:mb-20">
            <span className="tag tag-gold mb-4 inline-block">Pour les structures</span>
            <h2 className="t-display mb-4" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
              GÈRE TA STRUCTURE,<br />
              <span style={{ color: 'var(--s-gold)' }}>SANS T&apos;ARRACHER LES CHEVEUX.</span>
            </h2>
            <p className="t-body max-w-2xl mx-auto" style={{ fontSize: '15px', color: 'var(--s-text-dim)' }}>
              Recrutement, organisation interne, planning, coaching, communication Discord :
              tous les outils pour faire vivre une structure sérieuse.
            </p>
          </div>
        </ScrollReveal>

        <div className="space-y-24 lg:space-y-32">
          {rows.map((r, i) => (
            <ProductRow key={r.src} {...r} flip={i % 2 === 1} />
          ))}
        </div>

        {/* Bande Discord : capture embed à taille naturelle (pas de tilt agressif) */}
        <ScrollReveal delay={50}>
          <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-16 mt-24 lg:mt-32">
            <div className="w-full lg:w-1/2 order-2 lg:order-1">
              <span className="tag mb-4 inline-block" style={{ fontSize: 12, color: '#7983F5', background: 'rgba(88,101,242,0.1)', borderColor: 'rgba(88,101,242,0.3)' }}>Discord</span>
              <h3 className="font-display mb-4" style={{ fontSize: 'clamp(1.5rem, 2.8vw, 2.25rem)', letterSpacing: '0.02em', lineHeight: 1.1, color: 'var(--s-text)' }}>
                TON SERVEUR DISCORD, AU COURANT DE TOUT.
              </h3>
              <p className="t-body" style={{ fontSize: '15px', color: 'var(--s-text-dim)', lineHeight: 1.65 }}>
                Le bot Aedral poste candidatures, événements et exercices directement
                dans le Discord de ta structure. Tes joueurs reçoivent un ping là où
                ils sont déjà, sans copier-coller manuel.
              </p>
            </div>
            <div className="w-full lg:w-1/2 order-1 lg:order-2 flex justify-center">
              <div className="bevel overflow-hidden" style={{ border: '1px solid var(--s-border)', maxWidth: 480, width: '100%' }}>
                <Image
                  src="/guide/bot-discord.webp"
                  alt="Notification du bot Aedral dans Discord"
                  width={555}
                  height={485}
                  className="w-full h-auto block"
                />
              </div>
            </div>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={100}>
          <div className="text-center mt-20">
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
      desc: 'Cherche une structure qui recrute, candidate, ou demande à créer la tienne. L\'équipe Aedral valide les fondateurs.',
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
              Les compétitions Springs E-Sport (partenaire historique d&apos;Aedral) tournent
              actuellement sur leur site dédié. La gestion native depuis Aedral arrive bientôt.
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
                  <span className="t-label flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    <ExternalLink size={10} /> springs-esport.vercel.app
                  </span>
                  <span className="btn-springs btn-secondary bevel-sm transition-all group-hover:border-[rgba(255,255,255,0.4)]"
                    style={{ padding: '7px 16px', fontSize: '12px', borderColor: 'rgba(255,255,255,0.2)' }}>
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
    a: 'Tu te connectes, tu fais une demande de création, et un admin Aedral valide après un court échange. C\'est gratuit et rapide.',
  },
  {
    q: 'Aedral est-il géré par Springs E-Sport ?',
    a: 'Non. Aedral est un projet personnel ouvert à tout l\'écosystème esport amateur. Springs E-Sport est partenaire privilégié (historique du projet, premières compétitions hébergées) mais n\'est pas propriétaire de la plateforme.',
  },
  {
    q: 'Quels jeux sont supportés ?',
    a: `Aujourd'hui : ${ALL_GAME_DEFS.map(g => g.label).join(', ')}. La plateforme est conçue pour s'étendre à d'autres titres en fonction des demandes communautaires. Chaque ajout passe par une seule entrée de configuration côté code, le reste suit (équipes, calendrier, recrutement, exercices).`,
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
              TROUVE TON ÉQUIPE OU MONTE LA TIENNE.
            </h2>
            <p className="t-body mb-8 max-w-lg mx-auto" style={{ fontSize: '15px', color: 'var(--s-text-dim)' }}>
              Connexion Discord en 30 secondes. Gratuit.
            </p>
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <button onClick={() => signInWithDiscord()} type="button"
                className="btn-springs btn-primary bevel-sm flex items-center gap-2"
                style={{ padding: '14px 28px', fontSize: '14px' }}>
                <MessageSquare size={15} /> Connexion Discord <ArrowRight size={14} />
              </button>
              <Link href="/community/structures" className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
                style={{ padding: '14px 28px', fontSize: '14px' }}>
                <CheckCircle2 size={15} /> Voir les structures
              </Link>
            </div>
            <p className="t-body mt-6" style={{ fontSize: '13px', color: 'var(--s-text-muted)' }}>
              Pas encore prêt à t&apos;inscrire ?{' '}
              <a
                href={AEDRAL_DISCORD_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-semibold transition-colors"
                style={{ color: '#7983F5' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#a3aaf8'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#7983F5'; }}
              >
                <DiscordIcon size={13} /> Rejoins le Discord communauté
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
