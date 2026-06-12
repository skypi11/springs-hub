'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  UserCircle, Shield, Users, CalendarClock, Search,
  Film, ClipboardList, MessageCircle, Lock, BookOpen, ChevronRight,
  Gamepad2, CheckCircle2, XCircle,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import { ALL_GAME_DEFS } from '@/lib/games-registry';

// Page Guide / Découvrir Aedral, validée Matt 2026-05-25.
// Texte d'abord (screenshots V2 selon retour). Ton pro/clean style Linear/Notion.
// Bénéfices user-facing, pas de mentions techno (ballchasing/R2/firestore).

type Section = {
  id: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
  title: string;
  intro: string;
  items: string[];
};

const SECTIONS: Section[] = [
  {
    id: 'profil',
    icon: UserCircle,
    title: 'Profil & comptes liés',
    intro: "Ton profil Aedral te suit partout : pseudo, drapeau, jeux pratiqués, comptes vérifiés.",
    items: [
      "Connexion en 1 clic avec ton compte Discord",
      "Lier tes comptes de jeu officiels (Epic, Steam, Riot selon le jeu) pour authentifier ton identité et bloquer les usurpations",
      "Lien tracker public sur ton profil quand ton compte de jeu est vérifié : n'importe qui peut contrôler ton rang en 1 clic",
      "Rang selon le jeu : déclaré avec compte vérifié et signalable si tu mens (Rocket League), ou synchronisé automatiquement depuis ton compte officiel donc infalsifiable (Valorant) — voir Spécificités par jeu",
      "Badge ✓ Vérifié visible publiquement quand un compte de jeu est confirmé",
      "Connexions Discord (Twitch, YouTube, Instagram, etc.) sync automatique avec toggle visibilité par compte",
      "Choix d'être disponible au recrutement avec rôle visé (joueur / coach / manager)",
      "Pour la liste précise des comptes vérifiables par jeu, voir la section Spécificités par jeu plus bas",
    ],
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
      "Multi-jeux : une seule structure peut gérer plusieurs jeux en parallèle, chaque équipe étant attachée à un jeu précis",
      "Liaison Discord : installe le bot Aedral sur ton serveur Discord pour les notifs",
    ],
  },
  {
    id: 'equipes',
    icon: Users,
    title: 'Équipes & roster',
    intro: "Organise tes équipes compétitives au sein de ta structure.",
    items: [
      "Créer des équipes par jeu, le format roster (titulaires + remplaçants) suit le standard du jeu (voir Spécificités par jeu plus bas)",
      "Désigner un capitaine (joueur qui gère le calendrier de son équipe)",
      "Ajouter du staff par équipe (manager ou coach) avec droits spécifiques",
      "Logo et identité par équipe + groupe d'équipes (ex: « Académie », « Sénior »)",
      "Salon Discord lié à chaque équipe pour les notifs ciblées",
      "Un joueur ne peut être que dans 1 équipe par jeu (toutes structures confondues)",
    ],
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
  },
  {
    id: 'recrutement',
    icon: Search,
    title: 'Recrutement',
    intro: "Trouve tes prochains coéquipiers ou ta prochaine structure.",
    items: [
      "Annuaire public des joueurs (filtrable par jeu, pays, rang, statut recrutement)",
      "Annuaire public des structures (filtrable par jeu, statut)",
      "Cartes joueur format trading card : avatar, drapeau, rang déclaré + badge ✓ si compte vérifié, structure(s) actuelle(s)",
      "Activer le mode « disponible au recrutement » avec rôle recherché et message libre",
      "Shortlist privée par structure : suivre les joueurs qui t'intéressent",
      "Suggestions automatiques basées sur les positions ouvertes de ta structure",
      "Envoi d'invitations directes (joueur vers structure ou inverse)",
    ],
  },
  {
    id: 'replays',
    icon: Film,
    title: 'Replays & analyses',
    intro: "Upload tes replays et accède aux stats détaillées de chaque match. Pour l'instant, le parsing automatique des stats est disponible uniquement sur Rocket League.",
    items: [
      "Upload multi-fichiers depuis un événement (match, scrim, training)",
      "Stats automatiques parsées : buts, saves, assists, démos, possession, boost (Rocket League uniquement)",
      "Lien direct entre un événement et ses replays (1 clic pour les retrouver)",
      "Téléchargement sécurisé (URL valide 60 secondes)",
      "Quota stockage par structure (extensible à mesure que la plateforme grandit)",
      "Joueurs : accès aux replays de leur équipe + leurs exercices replay review",
      "Staff : suppression des replays + accès aux stats agrégées par event",
      "Voir la section Spécificités par jeu pour la liste des jeux supportant le parsing",
    ],
  },
  {
    id: 'exercices',
    icon: ClipboardList,
    title: 'Exercices & feedback',
    intro: "Le coaching dans la durée : assigne des exercices et points à travailler à tes joueurs.",
    items: [
      "Templates d'exercices réutilisables (personnels ou partagés structure)",
      "5 types : entraînement libre, replay à analyser, lecture, défi, autre",
      "Assigner un exercice à un joueur précis lié à un événement (ex: post-debrief de scrim)",
      "Replay review : assigner un replay précis à analyser, avec questions/objectifs",
      "Suivi par joueur : exercices à faire, terminés, en retard",
      "Compte rendu commun (event) + points à travailler perso (exercices) : séparation propre",
    ],
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
  },
  {
    id: 'roles',
    icon: Lock,
    title: 'Rôles & permissions',
    intro: "Chaque rôle a son périmètre, du fondateur tout-puissant au capitaine d'équipe.",
    items: [
      "7 rôles distincts : Fondateur, Co-fondateur, Responsable, Coach structure, Manager d'équipe, Coach d'équipe, Capitaine",
      "Hiérarchie claire : qui peut promouvoir qui, qui voit quoi",
      "Détail complet accessible aux dirigeants depuis le dashboard de leur structure (bouton « Rôles & permissions »)",
      "Modal explicatif au moment de promouvoir quelqu'un (tu vois ce que tu donnes avant de valider)",
      "Documents staff (contrats, sensibles) accessibles uniquement aux fondateurs et co-fondateurs",
    ],
  },
];

// Section "Spécificités par jeu", rendu custom (grid de cards), pas une liste
// d'items comme les autres sections. Métadonnées TOC séparées pour scroll spy.
const GAMES_SECTION_META = {
  id: 'jeux',
  icon: Gamepad2,
  title: 'Spécificités par jeu',
};

// Entrées TOC complètes : sections classiques + section jeux custom à la fin.
// Sert à la fois à la sidebar et au scroll spy. Le type d'icône suit celui
// utilisé par Section.icon pour rester compatible avec les forward refs Lucide
// (typeof Gamepad2, etc., sinon ComponentType est trop large).
type TocEntry = { id: string; icon: Section['icon']; title: string };
const TOC_ENTRIES: TocEntry[] = [
  ...SECTIONS.map(s => ({ id: s.id, icon: s.icon, title: s.title })),
  GAMES_SECTION_META,
];

export default function GuidePage() {
  const [activeId, setActiveId] = useState<string>(TOC_ENTRIES[0].id);

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
    for (const entry of TOC_ENTRIES) {
      const el = document.getElementById(entry.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="hex-bg min-h-screen">
      <CompactStickyHeader icon={BookOpen} title="Guide" accent="var(--s-gold)" />
      <div className="px-4 sm:px-8 py-6 space-y-8">
        {/* Breadcrumbs préfixe déjà « Accueil » tout seul — ne pas le repasser */}
        <Breadcrumbs items={[{ label: 'Guide' }]} />

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
                {TOC_ENTRIES.map(entry => {
                  const Icon = entry.icon;
                  const active = activeId === entry.id;
                  return (
                    <li key={entry.id}>
                      <a href={`#${entry.id}`}
                        className="flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                        style={{
                          color: active ? 'var(--s-gold)' : 'var(--s-text-dim)',
                          background: active ? 'rgba(255,184,0,0.06)' : 'transparent',
                          borderLeft: `3px solid ${active ? 'var(--s-gold)' : 'transparent'}`,
                        }}>
                        <Icon size={13} />
                        <span className="truncate">{entry.title}</span>
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

            {/* Section custom : grid de cards par jeu, alimentée par la registry */}
            <GameSpecificsSection />

            {/* Footer guide */}
            <section className="bevel relative overflow-hidden animate-fade-in"
              style={{ background: 'var(--s-surface)', border: '1px solid rgba(255,184,0,0.25)' }}>
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 70%)' }} />
              <div className="px-5 sm:px-7 py-5 text-center">
                <h3 className="font-display text-lg tracking-wider mb-2">PRÊT À COMMENCER ?</h3>
                <p className="text-sm mb-4" style={{ color: 'var(--s-text-dim)' }}>
                  Crée ou rejoins une structure, complète ton profil, déclare tes dispos, et tout l&apos;écosystème s&apos;active.
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

// ─── Section "Spécificités par jeu" ────────────────────────────────────────
// Rendu custom (grid de cards), alimenté par lib/games-registry.ts. Ajouter
// un nouveau jeu dans la registry le fait apparaître ici sans toucher au guide.
function GameSpecificsSection() {
  return (
    <section id={GAMES_SECTION_META.id} className="scroll-mt-24 bevel relative overflow-hidden animate-fade-in"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="px-5 sm:px-7 py-5">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 flex items-center justify-center bevel-sm flex-shrink-0"
            style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.2)' }}>
            <Gamepad2 size={16} style={{ color: 'var(--s-gold)' }} />
          </div>
          <h2 className="font-display text-xl sm:text-2xl tracking-wider">
            {GAMES_SECTION_META.title.toUpperCase()}
          </h2>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--s-text-dim)' }}>
          Chaque jeu apporte ses propres règles : taille du roster, mode de vérification
          du compte officiel, features avancées (parsing replays, sync rang). Voici ce
          que tu trouveras sur Aedral aujourd&apos;hui.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ALL_GAME_DEFS.map(g => (
            <GameSpecCard key={g.id} game={g} />
          ))}
        </div>
      </div>
    </section>
  );
}

function GameSpecCard({ game: g }: { game: typeof ALL_GAME_DEFS[number] }) {
  // Format roster en string court lisible humain
  const rosterLabel = g.roster.allowSolo
    ? `Solo (1 joueur)${g.roster.titulaires > 1 ? ` ou ${g.roster.titulaires} en équipe` : ''}`
    : `${g.roster.titulaires} titulaires + ${g.roster.remplacants} remplaçants`;

  return (
    <div className="bevel-sm relative overflow-hidden" style={{
      background: 'var(--s-elevated)',
      border: `1px solid rgba(${g.colorRgb}, 0.25)`,
    }}>
      {/* Accent top */}
      <div className="h-[2px]" style={{
        background: `linear-gradient(90deg, ${g.color}, ${g.color}40, transparent 70%)`,
      }} />
      <div className="p-4">
        {/* Header card : logo + label */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 overflow-hidden bevel-sm" style={{
            width: 40, height: 40, border: `1px solid rgba(${g.colorRgb}, 0.4)`,
          }}>
            <Image src={g.logoUrl} alt={g.label} width={40} height={40}
              style={{ objectFit: 'cover' }} />
          </div>
          <div className="min-w-0">
            <h3 className="font-display tracking-wider" style={{
              fontSize: 18, color: g.color, lineHeight: 1.1,
            }}>
              {g.label.toUpperCase()}
            </h3>
            <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
              {g.shortLabel} · /{g.slug}
            </span>
          </div>
        </div>

        {/* Specs grid */}
        <dl className="space-y-2 text-sm">
          <SpecRow label="Format roster" value={rosterLabel} />
          <SpecRow label="Vérification du compte"
            value={g.accountSourceLabel ?? 'Aucune (rang déclaratif uniquement)'} />
          <SpecFeatureRow label="Sync auto du rang" enabled={g.features.rankAutoSync} />
          <SpecFeatureRow label="Parsing replays" enabled={g.features.replayParsing} />
          <SpecFeatureRow label="Lien tracker public" enabled={g.features.trackerProfile} />
        </dl>
      </div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="flex-shrink-0 t-label" style={{ color: 'var(--s-text-muted)', minWidth: 140 }}>
        {label}
      </dt>
      <dd style={{ color: 'var(--s-text)' }}>{value}</dd>
    </div>
  );
}

function SpecFeatureRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="flex-shrink-0 t-label" style={{ color: 'var(--s-text-muted)', minWidth: 140 }}>
        {label}
      </dt>
      <dd className="flex items-center gap-1.5" style={{
        color: enabled ? '#33ff66' : 'var(--s-text-dim)',
      }}>
        {enabled ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
        <span>{enabled ? 'Oui' : 'Non'}</span>
      </dd>
    </div>
  );
}
