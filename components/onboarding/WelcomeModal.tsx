'use client';

// Modal "Bienvenue sur Aedral", affiché UNE seule fois après que l'user a
// finalisé son profil (onboarding wizard) au premier login. Validé Matt
// 2026-05-25. Présente les piliers du site pour que l'user sache ce qu'il
// peut faire.
//
// Versioning : si on ajoute des slides plus tard, bump la const VERSION et
// les anciens users verront le nouveau modal.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen, Shield, Film,
  ChevronLeft, ChevronRight, X, Sparkles,
} from 'lucide-react';
import Portal from '@/components/ui/Portal';
import AedralLogo from '@/components/brand/AedralLogo';

const VERSION = 'v1';
const STORAGE_KEY = `aedral_welcome_seen_${VERSION}`;

type Slide = {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  intro: string;
  bullets: string[];
};

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    title: 'BIENVENUE SUR AEDRAL',
    intro: "Roster, calendrier, scrims, recrutement : au même endroit.",
    bullets: [
      "Profil vérifié avec ton compte Discord + ton compte de jeu (Epic / Steam / Riot)",
      "Rejoins une structure existante ou crée la tienne",
    ],
  },
  {
    icon: Shield,
    title: 'TON ESPACE STRUCTURE',
    intro: "Gère ton équipe, ton roster et tes événements depuis un dashboard dédié.",
    bullets: [
      "Équipes par jeu (RL, TM, Valorant) avec titulaires, remplaçants, staff, capitaine",
      "Calendrier collaboratif avec dispos partagées et matching automatique",
      "Bot Discord intégré pour les notifications dans ton serveur",
      "Recrutement actif : shortlist, suggestions, invitations",
    ],
  },
  {
    icon: Film,
    title: 'ANALYSE & COACHING',
    intro: "Garde une trace de chaque match et progresse en continu.",
    bullets: [
      "Upload tes replays Rocket League depuis chaque événement",
      "Stats automatiques par match (buts, saves, assists, possession, boost…)",
      "Assigne des exercices à tes joueurs (training libre, replay review, défis)",
      "Compte rendu commun + points à travailler par joueur",
    ],
  },
];

export default function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    // Affiche le modal uniquement si pas déjà vu (localStorage).
    try {
      if (typeof window === 'undefined') return;
      const seen = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount guard : localStorage n'est lisible que côté client après montage
      if (!seen) setOpen(true);
    } catch { /* SSR */ }
  }, []);

  const close = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* noop */ }
    setOpen(false);
  };

  if (!open) return null;

  const slide = SLIDES[idx];
  const Icon = slide.icon;
  const isFirst = idx === 0;
  const isLast = idx === SLIDES.length - 1;

  return (
    <Portal>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}
        onClick={close}>
        <div className="w-full max-w-xl max-h-[90vh] flex flex-col bevel"
          style={{ background: 'var(--s-bg)', border: '1px solid rgba(255,184,0,0.35)', boxShadow: '0 0 40px rgba(255,184,0,0.12)' }}
          onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-2">
              {SLIDES.map((_, i) => (
                <span key={i} style={{
                  display: 'inline-block',
                  width: i === idx ? 24 : 6,
                  height: 6,
                  background: i === idx ? 'var(--s-gold)' : 'rgba(255,255,255,0.18)',
                  transition: 'all 200ms',
                }} />
              ))}
              <span className="text-xs ml-2" style={{ color: 'var(--s-text-muted)' }}>
                {idx + 1} / {SLIDES.length}
              </span>
            </div>
            <button type="button" onClick={close}
              className="w-7 h-7 flex items-center justify-center transition-colors hover:bg-[var(--s-hover)]"
              style={{ background: 'transparent', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}
              aria-label="Fermer">
              <X size={14} />
            </button>
          </div>

          {/* Slide content, slide 0 (Bienvenue) affiche le logo Aedral
              à la place de l'icône Sparkles pour renforcer l'identité. */}
          <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-8">
            {isFirst ? (
              <div className="flex flex-col items-center text-center mb-4">
                <AedralLogo variant="mark" theme="dark" height={64} className="mb-4" />
                <h2 className="font-display text-2xl sm:text-3xl tracking-wider">{slide.title}</h2>
              </div>
            ) : (
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 flex items-center justify-center bevel-sm flex-shrink-0"
                  style={{ background: 'rgba(255,184,0,0.12)', border: '1px solid rgba(255,184,0,0.35)' }}>
                  <Icon size={22} style={{ color: 'var(--s-gold)' }} />
                </div>
                <h2 className="font-display text-2xl sm:text-3xl tracking-wider">{slide.title}</h2>
              </div>
            )}
            <p className="text-sm sm:text-base mb-6" style={{ color: 'var(--s-text-dim)' }}>{slide.intro}</p>
            <ul className="space-y-3">
              {slide.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--s-text)' }}>
                  <span style={{ color: 'var(--s-gold)', marginTop: 2, flexShrink: 0 }}>▸</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer / nav */}
          <div className="px-5 py-4 flex items-center justify-between gap-2" style={{ borderTop: '1px solid var(--s-border)' }}>
            <button type="button" onClick={close}
              className="text-xs transition-colors hover:text-[var(--s-text)]"
              style={{ color: 'var(--s-text-muted)', padding: '6px 10px' }}>
              Passer
            </button>
            <div className="flex items-center gap-2">
              {!isFirst && (
                <button type="button" onClick={() => setIdx(i => Math.max(0, i - 1))}
                  className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-1.5"
                  style={{ fontSize: '12px', padding: '6px 12px' }}>
                  <ChevronLeft size={12} /> Précédent
                </button>
              )}
              {!isLast && (
                <button type="button" onClick={() => setIdx(i => Math.min(SLIDES.length - 1, i + 1))}
                  className="btn-springs btn-primary bevel-sm inline-flex items-center gap-1.5"
                  style={{ fontSize: '12px', padding: '6px 12px' }}>
                  Suivant <ChevronRight size={12} />
                </button>
              )}
              {isLast && (
                <Link href="/guide" onClick={close}
                  className="btn-springs btn-primary bevel-sm inline-flex items-center gap-1.5"
                  style={{ fontSize: '12px', padding: '6px 12px' }}>
                  <BookOpen size={12} /> Voir le guide complet
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
