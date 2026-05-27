'use client';

import { getGame } from '@/lib/games-registry';

/**
 * Pill colorée représentant un jeu — bleue pour RL, verte pour TM, etc.
 * Consomme la registry des jeux : ajouter un nouveau jeu dans la registry
 * suffit à ce que tous les `<GameTag>` du site l'affichent correctement.
 *
 * Remplace le pattern hardcodé :
 *   <span className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}>
 *     {g === 'rocket_league' ? 'RL' : 'TM'}
 *   </span>
 */
export default function GameTag({
  gameId,
  variant = 'short',
  size = 'md',
  className = '',
  style: extraStyle,
}: {
  /** Id de jeu de la registry (rocket_league, trackmania, valorant…). Si inconnu, rend un tag neutre. */
  gameId: string | null | undefined;
  /** "short" affiche "RL" / "TM" — "full" affiche "Rocket League" / "Trackmania" */
  variant?: 'short' | 'full';
  /** "sm" = 10px, "md" = défaut .tag (12px), "lg" = 14px */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Style additionnel (mergé après les styles de couleur) */
  style?: React.CSSProperties;
}) {
  const game = getGame(gameId);

  if (!game) {
    return (
      <span className={`tag tag-neutral ${className}`} style={extraStyle}>
        {variant === 'full' ? 'Jeu inconnu' : '?'}
      </span>
    );
  }

  const label = variant === 'full' ? game.label : game.shortLabel;
  const fontSize = size === 'sm' ? '10px' : size === 'lg' ? '14px' : '12px';

  return (
    <span
      className={`tag ${className}`}
      style={{
        background: `rgba(${game.colorRgb}, 0.1)`,
        color: game.colorLight,
        borderColor: `rgba(${game.colorRgb}, 0.25)`,
        fontSize,
        ...extraStyle,
      }}
    >
      {label}
    </span>
  );
}
