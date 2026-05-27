// Badge officiel de rang Valorant — utilise les icônes Riot Games dans
// public/valorant-ranks/ (renommées en kebab-case : iron-1.png ... radiant.png).
//
// Le composant rend l'icône officielle + un cadre coloré au teint du tier
// (cohérence avec la DA Aedral). Pas de Lucide générique : les icônes
// Valorant sont familières aux joueurs.

'use client';

import Image from 'next/image';
import { Trophy } from 'lucide-react';
import { getValorantTierConfig, getValorantRankIconFile } from '@/lib/valorant-ranks';

interface RankBadgeProps {
  rank: string | null | undefined;
  size?: number;
}

export default function ValorantRankBadge({ rank, size = 64 }: RankBadgeProps) {
  const config = getValorantTierConfig(rank);
  const iconFile = getValorantRankIconFile(rank);

  // Fallback rang inconnu : Trophy générique rouge tactique
  if (!config) {
    return (
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: 'rgba(255, 70, 85, 0.08)',
          border: '1px solid rgba(255, 70, 85, 0.25)',
        }}
        aria-label="Rang Valorant inconnu"
      >
        <Trophy size={size * 0.42} style={{ color: '#FF4655' }} />
      </div>
    );
  }

  // Cas "Unranked" : config présent mais pas d'icône — on rend un Trophy
  // teinté du tier (couleurs grises neutres) pour cohérence visuelle.
  if (!iconFile) {
    return (
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: config.bgColor,
          border: `1px solid ${config.borderColor}`,
        }}
        aria-label={`Rang ${rank}`}
        title={rank ?? undefined}
      >
        <Trophy size={size * 0.42} style={{ color: config.color }} />
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 flex items-center justify-center relative"
      style={{
        width: size,
        height: size,
        background: config.bgColor,
        border: `1px solid ${config.borderColor}`,
        padding: Math.max(2, Math.round(size * 0.06)),
      }}
      aria-label={`Rang ${rank}`}
      title={rank ?? undefined}
    >
      <Image
        src={`/valorant-ranks/${iconFile}.png`}
        alt={`Icône ${config.label}`}
        width={size}
        height={size}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        unoptimized
      />
    </div>
  );
}
