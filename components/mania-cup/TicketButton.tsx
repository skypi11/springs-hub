'use client';

import { Ticket, ExternalLink } from 'lucide-react';
import { useManiaCupSettings } from './useManiaCupSettings';

// Bouton vers la billetterie HelloAsso.
//
// Les liens sont renseignés par l'organisateur depuis la console : tant qu'ils
// sont vides, le bouton reste visible mais désactivé, avec la raison affichée.
// Le masquer serait pire — un joueur qui ne voit aucun bouton de paiement croit
// que le site est cassé, là où « billetterie bientôt ouverte » se comprend.

export default function TicketButton({
  kind,
  label,
  variant = 'primary',
  className = '',
}: {
  kind: 'player' | 'spectator' | 'companion';
  label: string;
  variant?: 'primary' | 'outline';
  className?: string;
}) {
  const settings = useManiaCupSettings();
  const url =
    kind === 'player'
      ? settings.ticketingPlayerUrl
      : kind === 'spectator'
        ? settings.ticketingSpectatorUrl
        : settings.ticketingCompanionUrl;

  const base = 'inline-flex items-center gap-2 px-6 py-3 font-bold transition-transform';
  const style =
    variant === 'primary'
      ? 'bg-[#00D936] text-[#07050b] hover:scale-[1.03]'
      : 'border border-[#a364d9]/50 text-white hover:bg-[#7B2FBE]/20';

  if (!url) {
    return (
      <span className={`${base} cursor-not-allowed bg-white/10 text-[#8d89a8] ${className}`}>
        <Ticket size={18} aria-hidden />
        {label} — billetterie bientôt ouverte
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`${base} ${style} ${className}`}
    >
      <Ticket size={18} aria-hidden />
      {label}
      <ExternalLink size={16} aria-hidden />
    </a>
  );
}
