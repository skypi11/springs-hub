// Bouton « Signaler le rang » sur la fiche d'un joueur, Lot 5 (v2).
// Caché si non-connecté, ou si on regarde son propre profil, ou si le joueur
// cible n'a pas de rang affiché (rien à signaler).
// Ouvre ReportRankDialog qui gère le motif + message + envoi.

'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import ReportRankDialog from '@/components/players/ReportRankDialog';

export interface ReportRankButtonProps {
  targetUid: string;
  targetName?: string;
  /** Désactive si false, typiquement quand le joueur n'a pas de rang à signaler */
  enabled?: boolean;
  /** `sm` = pill compact pour les cartes ; `md` = bouton plus lisible pour les fiches */
  size?: 'sm' | 'md';
  /** Jeu dont on signale le rang ('rocket_league' | 'valorant'). Default RL. */
  game?: string;
}

export default function ReportRankButton({
  targetUid,
  targetName,
  enabled = true,
  size = 'md',
  game = 'rocket_league',
}: ReportRankButtonProps) {
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setOpen(true);
  }

  const trigger = size === 'sm' ? (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 tag transition-colors hover:bg-[var(--s-elevated)]"
      style={{
        background: 'transparent',
        color: '#ff8a8a',
        borderColor: 'rgba(255,85,85,0.35)',
        fontSize: '12px',
        padding: '2px 7px',
        cursor: 'pointer',
      }}
      title="Signaler le rang à l'admin"
    >
      <Flag size={10} />
      signaler
    </button>
  ) : (
    <button
      type="button"
      onClick={handleClick}
      className="btn-springs bevel-sm inline-flex items-center gap-1.5 transition-colors"
      style={{
        background: 'rgba(255,85,85,0.08)',
        color: '#ff8a8a',
        borderColor: 'rgba(255,85,85,0.35)',
        fontSize: '12px',
        padding: '6px 12px',
      }}
      title="Signaler ce rang à l'admin"
    >
      <Flag size={11} />
      Signaler le rang
    </button>
  );

  return (
    <>
      {trigger}
      <ReportRankDialog
        open={open}
        onClose={() => setOpen(false)}
        targetUid={targetUid}
        targetName={targetName}
        game={game}
      />
    </>
  );
}
