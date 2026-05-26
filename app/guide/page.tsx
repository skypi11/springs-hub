'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  UserCircle, Shield, Users, CalendarClock, Search,
  Film, ClipboardList, MessageCircle, Lock, BookOpen, ChevronRight, Camera,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';

// Page Guide / Découvrir Aedral — validée Matt 2026-05-25.
// Texte d'abord (screenshots V2 selon retour). Ton pro/clean style Linear/Notion.
// Bénéfices user-facing — pas de mentions techno (ballchasing/R2/firestore).

type Section = {
  id: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
  title: string;
  intro: string;
  items: string[];
  screenshot: {
    page: string;
    caption: string;
    focus: string;
  };
};

const SECTIONS: Section[] = [
  {
    id: 'profil',
    icon: UserCircle,
    title: 'Profil & comptes liés',
    intro: "Ton profil Aedral te suit partout — pseudo, drapeau, jeux pratiqués, comptes vérifiés.",
    items: [
      "Connexion en 1 clic avec ton compte Discord",
      "Lier ton compte Steam (SteamID immuable) pour authentifier ton pseudo Rocket League",
      "Vérifier ton compte Rocket League (Epic ou Steam) — le lien tracker.gg apparaît sur ton profil et n'importe qui peut vérifier ton rang en 1 clic",
      "Ton rang RL reste auto-déclaré, mais comme le compte est vérifié, les autres peuvent te signaler si tu mens",
      "Badge ✓ Vérifié visible publiquement quand ton compte de jeu est confirmé",
      "Connexions Discord (Twitch, YouTube, Instagram, etc.) sync automatique avec toggle visibilité par compte",
      "Choix d'être disponible au recrutement avec rôle visé (joueur / coach / manager)",
    ],
    screenshot: {
      page: '/profile/[ton uid]',
      caption: 'Ta page profil publique',
      focus: 'Cadre complet : avatar + drapeau + pseudo + badge vérifié + rang RL + bouton tracker.gg + liste structures + comptes liés visibles.',
    },
  },
  {
    id: 'structures',
    icon: Shield,
    title: 'Structures',
    intro: "Une structure regroupe joueurs, staff et équipes autour d'une identité commune.",
    items: [
      "Créer ta propre structure (demande validée par un admin Aedral)",
      "Rejoindre une structure existante via lien d'invitation ou demande",
      "Maximum 2 structures par jeu (un joueur peut être fondateur d'une et responsable d'une autre)",
      "Identité personnalisable : nom, tag, logo, bannière, description",
      "Multi-jeux : une structure peut couvrir Rocket League ET Trackmania",
      "Liaison Discord — installe le bot Aedral sur ton serveur Discord pour les notifs",
    ],
    screenshot: {
      page: '/community/structure/[id]',
      caption: 'Page publique d\'une structure (idéalement une grosse — ARAN ou TTC)',
      focus: 'Header avec bannière + logo + tag + description + tags multi-jeux + nombre de membres et d\'équipes. Cadrer pour bien voir la bannière et l\'en-tête.',
    },
  },
  {
    id: 'equipes',
    icon: Users,
    title: 'Équipes & roster',
    intro: "Organise tes équipes compétitives au sein de ta structure.",
    items: [
      "Créer des équipes par jeu (RL : max 3 titulaires + 2 remplaçants)",
      "Désigner un capitaine (joueur qui gère le calendrier de son équipe)",
      "Ajouter du staff par équipe (manager ou coach) avec droits spécifiques",
      "Logo et identité par équipe + groupe d'équipes (ex: « Académie », « Sénior »)",
      "Salon Discord lié à chaque équipe pour les notifs ciblées",
      "Un joueur ne peut être que dans 1 équipe par jeu (toutes structures confondues)",
    ],
    screenshot: {
      page: '/community/my-structure → onglet Équipes',
      caption: 'Vue gestion des équipes côté staff',
      focus: 'Liste des équipes d\'une structure avec roster visible (titulaires + remplaçants + capitaine ★). Si possible, montrer 2-3 équipes pour donner l\'impression de structure organisée.',
    },
  },
  {
    id: 'calendrier',
    icon: CalendarClock,
    title: 'Calendrier & disponibilités',
    intro: "Planifie événements, training, scrims et matchs avec un système de consensus intelligent.",
    items: [
      "4 vues : Mois (vue d'ensemble), Semaine (heatmap), Liste (recherche), Staff (pour les dirigeants)",
      "Déclare tes disponibilités par créneau de 30 min sur 2 semaines glissantes",
      "Heatmap consensus : voit en un coup d'œil les créneaux où ton équipe peut jouer ensemble",
      "Sélection visuelle du staff à afficher (pastilles colorées : qui est dispo et quand)",
      "5 types d'événements : training, scrim, match, tournoi, autre",
      "Système de présence : chaque invité répond (présent / absent / peut-être)",
      "Notifications Discord automatiques quand un event est créé",
      "Le manager d'équipe configure le minimum de joueurs requis pour un match",
    ],
    screenshot: {
      page: '/community/my-structure → onglet Calendrier → vue Semaine',
      caption: 'Heatmap consensus dispos avec overlay staff',
      focus: 'Vue Semaine avec la heatmap colorée (gris/vert/or) bien visible, panneau dispos latéral à droite, et idéalement 2-3 staff cochés pour montrer les pastilles colorées sur les slots.',
    },
  },
  {
    id: 'recrutement',
    icon: Search,
    title: 'Recrutement',
    intro: "Trouve tes prochains coéquipiers ou ta prochaine structure.",
    items: [
      "Annuaire public des joueurs (filtrable par jeu, pays, rang, statut recrutement)",
      "Annuaire public des structures (filtrable par jeu, statut)",
      "Cartes joueur format trading card : avatar, drapeau, rang RL déclaré + badge ✓ si compte vérifié, structure(s) actuelle(s)",
      "Activer le mode « disponible au recrutement » avec rôle recherché et message libre",
      "Shortlist privée par structure : suivre les joueurs qui t'intéressent",
      "Suggestions automatiques basées sur les positions ouvertes de ta structure",
      "Envoi d'invitations directes (joueur vers structure ou inverse)",
    ],
    screenshot: {
      page: '/community/players',
      caption: 'Annuaire joueurs vue grille (trading cards)',
      focus: 'Cadrage qui montre 2-3 lignes de cards joueur en grille (5-6 par ligne). Bien voir l\'effet trading card portrait avec avatars + drapeaux + rang RL + tags rôle. Si possible, avoir au moins 1 fondateur visible (halo or).',
    },
  },
  {
    id: 'replays',
    icon: Film,
    title: 'Replays & analyses',
    intro: "Upload tes replays Rocket League et accède aux stats détaillées de chaque match.",
    items: [
      "Upload multi-fichiers depuis un événement (match, scrim, training)",
      "Stats automatiques parsées : buts, saves, assists, démos, possession, boost",
      "Lien direct entre un événement et ses replays (1 clic pour les retrouver)",
      "Téléchargement sécurisé (URL valide 60 secondes)",
      "Quota stockage par structure (extensible à mesure que la plateforme grandit)",
      "Joueurs : accès aux replays de leur équipe + leurs exercices replay review",
      "Staff : suppression des replays + accès aux stats agrégées par event",
    ],
    screenshot: {
      page: 'Event scrim/match avec replays uploadés → modal Stats',
      caption: 'Stats parsées d\'un replay RL',
      focus: 'Modal ou panneau stats d\'un replay avec les chiffres bien visibles : buts/saves/assists/démos par joueur + score d\'équipe. Cadrer assez serré pour que les chiffres soient lisibles sur le screenshot affiché en miniature.',
    },
  },
  {
    id: 'exercices',
    icon: ClipboardList,
    title: 'Exercices & feedback',
    intro: "Le coaching dans la durée — assigne des exercices et points à travailler à tes joueurs.",
    items: [
      "Templates d'exercices réutilisables (personnels ou partagés structure)",
      "5 types : entraînement libre, replay à analyser, lecture, défi, autre",
      "Assigner un exercice à un joueur précis lié à un événement (ex: post-debrief de scrim)",
      "Replay review : assigner un replay précis à analyser, avec questions/objectifs",
      "Suivi par joueur : exercices à faire, terminés, en retard",
      "Compte rendu commun (event) + points à travailler perso (exercices) — séparation propre",
    ],
    screenshot: {
      page: 'Event scrim → Debrief / Points à travailler',
      caption: 'Debrief post-scrim avec todos assignés par joueur',
      focus: 'Vue debrief d\'un événement avec le compte rendu commun en haut et la liste des points à travailler ciblés par joueur en bas (avec les avatars + intitulés). Si tu n\'as pas d\'exemple, montre l\'écran "Mes exercices" d\'un joueur.',
    },
  },
  {
    id: 'bot-discord',
    icon: MessageCircle,
    title: 'Bot Discord',
    intro: "Le bot Aedral s'installe sur ton serveur Discord pour rester synchronisé.",
    items: [
      "Installation en 1 clic depuis les paramètres de structure",
      "Notifications automatiques : nouvel événement, invitation reçue, demande à traiter",
      "Embed des événements dans le canal de l'équipe (configurable)",
      "Annonces officielles Aedral diffusables par les admins du site (templates pré-rédigées)",
      "Sync nocturne : ton pseudo Discord et tes connexions tierces se mettent à jour automatiquement",
      "Rôles Discord auto : le bot peut attribuer des rôles selon ton statut (fondateur, joueur, etc.)",
    ],
    screenshot: {
      page: 'Discord — salon où le bot Aedral poste une notif d\'event',
      caption: 'Embed Discord d\'un événement publié par le bot',
      focus: 'Capture Discord d\'un embed d\'événement créé par le bot Aedral : titre, type, date/heure, équipe concernée, participants. Si possible, montrer aussi le bouton de RSVP. Bon screenshot "wow" — donne envie d\'installer le bot.',
    },
  },
  {
    id: 'roles',
    icon: Lock,
    title: 'Rôles & permissions',
    intro: "Chaque rôle a son périmètre — du fondateur tout-puissant au capitaine d'équipe.",
    items: [
      "7 rôles distincts : Fondateur, Co-fondateur, Responsable, Coach structure, Manager d'équipe, Coach d'équipe, Capitaine",
      "Hiérarchie claire : qui peut promouvoir qui, qui voit quoi",
      "Détail complet accessible aux dirigeants depuis le dashboard de leur structure (bouton « Rôles & permissions »)",
      "Modal explicatif au moment de promouvoir quelqu'un (tu vois ce que tu donnes avant de valider)",
      "Documents staff (contrats, sensibles) accessibles uniquement aux fondateurs et co-fondateurs",
    ],
    screenshot: {
      page: '/community/my-structure → bouton "Rôles & permissions"',
      caption: 'Modal Rôles & permissions',
      focus: 'Modal RolesHelpModal grand ouvert qui montre la hiérarchie complète des 7 rôles avec leurs permissions. Si le modal est trop grand pour tout afficher, prends 2 screenshots (haut + bas) — sinon zoome juste en haut.',
    },
  },
];

export default function GuidePage() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  // Scroll spy : met à jour la section active dans la table des matières
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          // Prend la section la plus haute visible
          const top = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
          );
          setActiveId(top.target.id);
        }
      },
      { rootMargin: '-100px 0px -60% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="hex-bg min-h-screen">
      <CompactStickyHeader icon={BookOpen} title="Guide" accent="var(--s-gold)" />
      <div className="px-4 sm:px-8 py-6 space-y-8">
        <Breadcrumbs items={[{ label: 'Accueil', href: '/' }, { label: 'Guide' }]} />

        {/* Hero */}
        <header className="bevel relative overflow-hidden animate-fade-in"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 70%)' }} />
          <div className="relative z-[1] px-6 sm:px-10 py-8">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 flex items-center justify-center bevel-sm" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}>
                <BookOpen size={18} style={{ color: 'var(--s-gold)' }} />
              </div>
              <h1 className="font-display text-3xl sm:text-4xl tracking-wider">DÉCOUVRIR AEDRAL</h1>
            </div>
            <p className="text-sm sm:text-base max-w-2xl" style={{ color: 'var(--s-text-dim)' }}>
              Tout ce que tu peux faire sur Aedral : profils vérifiés, gestion de structures et d&apos;équipes,
              calendrier collaboratif, recrutement, replays avec stats, coaching en continu, bot Discord intégré.
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              <Link href="/community/structures" className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2"
                style={{ fontSize: '13px', padding: '8px 16px' }}>
                Explorer les structures
                <ChevronRight size={14} />
              </Link>
              <Link href="/community/players" className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2"
                style={{ fontSize: '13px', padding: '8px 16px' }}>
                Voir les joueurs
                <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </header>

        {/* Body : layout 2 colonnes (TOC + contenu) */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* TOC sticky */}
          <aside className="lg:w-[260px] flex-shrink-0">
            <nav className="bevel-sm sticky top-[88px]" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--s-border)' }}>
                <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Sommaire</span>
              </div>
              <ul className="py-1">
                {SECTIONS.map(s => {
                  const Icon = s.icon;
                  const active = activeId === s.id;
                  return (
                    <li key={s.id}>
                      <a href={`#${s.id}`}
                        className="flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                        style={{
                          color: active ? 'var(--s-gold)' : 'var(--s-text-dim)',
                          background: active ? 'rgba(255,184,0,0.06)' : 'transparent',
                          borderLeft: `3px solid ${active ? 'var(--s-gold)' : 'transparent'}`,
                        }}>
                        <Icon size={13} />
                        <span className="truncate">{s.title}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          {/* Sections */}
          <div className="flex-1 space-y-10 min-w-0">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              return (
                <section key={s.id} id={s.id} className="scroll-mt-24 bevel relative overflow-hidden animate-fade-in"
                  style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                  <div className="px-5 sm:px-7 py-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 flex items-center justify-center bevel-sm flex-shrink-0"
                        style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.2)' }}>
                        <Icon size={16} style={{ color: 'var(--s-gold)' }} />
                      </div>
                      <h2 className="font-display text-xl sm:text-2xl tracking-wider">{s.title.toUpperCase()}</h2>
                    </div>
                    <p className="text-sm mb-4" style={{ color: 'var(--s-text-dim)' }}>{s.intro}</p>

                    {/* Screenshot placeholder — à remplacer par l'image réelle */}
                    <div
                      className="bevel-sm relative overflow-hidden mb-5 hex-bg"
                      style={{
                        background: 'var(--s-elevated)',
                        border: '1px dashed rgba(255,184,0,0.3)',
                        aspectRatio: '16 / 9',
                      }}
                    >
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                        <div
                          className="w-12 h-12 flex items-center justify-center bevel-sm mb-3"
                          style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}
                        >
                          <Camera size={20} style={{ color: 'var(--s-gold)' }} />
                        </div>
                        <div className="t-label mb-1" style={{ color: 'var(--s-gold)' }}>SCREENSHOT À CAPTURER</div>
                        <div className="text-sm font-semibold mb-2" style={{ color: 'var(--s-text)' }}>{s.screenshot.caption}</div>
                        <div className="text-xs mb-2" style={{ color: 'var(--s-text-muted)' }}>
                          <span className="t-mono">{s.screenshot.page}</span>
                        </div>
                        <p className="text-xs max-w-md" style={{ color: 'var(--s-text-dim)' }}>{s.screenshot.focus}</p>
                      </div>
                    </div>

                    <ul className="space-y-2">
                      {s.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--s-text)' }}>
                          <span style={{ color: 'var(--s-gold)', marginTop: 2, flexShrink: 0 }}>▸</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              );
            })}

            {/* Footer guide */}
            <section className="bevel relative overflow-hidden animate-fade-in"
              style={{ background: 'var(--s-surface)', border: '1px solid rgba(255,184,0,0.25)' }}>
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 70%)' }} />
              <div className="px-5 sm:px-7 py-5 text-center">
                <h3 className="font-display text-lg tracking-wider mb-2">PRÊT À COMMENCER ?</h3>
                <p className="text-sm mb-4" style={{ color: 'var(--s-text-dim)' }}>
                  Crée ou rejoins une structure, complète ton profil, déclare tes dispos — et tout l&apos;écosystème s&apos;active.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <Link href="/settings" className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2"
                    style={{ fontSize: '13px', padding: '8px 16px' }}>
                    Compléter mon profil
                    <ChevronRight size={14} />
                  </Link>
                  <Link href="/community" className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2"
                    style={{ fontSize: '13px', padding: '8px 16px' }}>
                    Explorer la communauté
                    <ChevronRight size={14} />
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
