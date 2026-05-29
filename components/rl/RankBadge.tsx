// Badge officiel de rang Rocket League, utilise les icônes Psyonix haute
// résolution (1280×1280 originaux, redimensionnés à 512 et convertis WebP)
// hébergées dans public/rl-ranks/.
//
// Le composant rend l'icône officielle + un cadre coloré au teint du tier
// (cohérence avec la DA Aedral). Pas de Lucide générique : les icônes RL
// sont familières aux joueurs et c'est ce qui était demandé.
//
// Les helpers (getRankTier, getRankTierConfig, getRankIconFile) vivent dans
// `lib/rl-ranks.ts` (server-safe — réutilisés côté OG endpoints). Ils sont
// ré-exportés ici pour ne pas casser les imports existants.

'use client';

import Image from 'next/image';
import { Trophy } from 'lucide-react';
import {
  getRankTierConfig,
  getRankIconFile,
} from '@/lib/rl-ranks';

// Ré-exports pour rétrocompat (anciens call sites importent depuis ce fichier)
export {
  getRankTier,
  getRankTierConfig,
  getRankIconFile,
} from '@/lib/rl-ranks';
export type { RankTier, TierConfig } from '@/lib/rl-ranks';

interface RankBadgeProps {
  rank: string | null | undefined;
  size?: number;
}

export default function RankBadge({ rank, size = 64 }: RankBadgeProps) {
  const config = getRankTierConfig(rank);
  const iconFile = getRankIconFile(rank);

  // Fallback générique si on ne reconnaît pas le rang
  if (!config || !iconFile) {
    return (
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: 'rgba(0, 129, 255, 0.08)',
          border: '1px solid rgba(0, 129, 255, 0.2)',
        }}
      >
        <Trophy size={size * 0.42} style={{ color: 'var(--s-blue)' }} />
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
        src={`/rl-ranks/${iconFile}.webp`}
        alt={`Icône ${config.label}`}
        width={size}
        height={size}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        unoptimized
      />
    </div>
  );
}
