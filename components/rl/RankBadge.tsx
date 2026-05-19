// Badge officiel de rang Rocket League — utilise les icônes Psyonix haute
// résolution (1280×1280 originaux, redimensionnés à 512 et convertis WebP)
// hébergées dans public/rl-ranks/.
//
// Le composant rend l'icône officielle + un cadre coloré au teint du tier
// (cohérence avec la DA Aedral). Pas de Lucide générique : les icônes RL
// sont familières aux joueurs et c'est ce qui était demandé.

'use client';

import Image from 'next/image';
import { Trophy } from 'lucide-react';

export type RankTier =
  | 'bronze' | 'argent' | 'or' | 'platine'
  | 'diamant' | 'champion' | 'grand_champion' | 'ssl';

interface TierConfig {
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}

// Couleurs alignées sur les codes officiels RL, avec emprunt à la palette
// Aedral quand ça matche (or = #FFB800 Aedral, diamant = #0081FF Aedral RL).
const TIERS: Record<RankTier, TierConfig> = {
  bronze:         { color: '#CD7F32', bgColor: 'rgba(205,127,50,0.08)',  borderColor: 'rgba(205,127,50,0.3)',  label: 'Bronze' },
  argent:         { color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.08)', borderColor: 'rgba(192,192,192,0.3)', label: 'Argent' },
  or:             { color: '#FFB800', bgColor: 'rgba(255,184,0,0.08)',   borderColor: 'rgba(255,184,0,0.3)',   label: 'Or' },
  platine:        { color: '#4FC3F7', bgColor: 'rgba(79,195,247,0.08)',  borderColor: 'rgba(79,195,247,0.3)',  label: 'Platine' },
  diamant:        { color: '#0081FF', bgColor: 'rgba(0,129,255,0.1)',    borderColor: 'rgba(0,129,255,0.35)',  label: 'Diamant' },
  champion:       { color: '#7B2FBE', bgColor: 'rgba(123,47,190,0.1)',   borderColor: 'rgba(123,47,190,0.35)', label: 'Champion' },
  grand_champion: { color: '#DC143C', bgColor: 'rgba(220,20,60,0.1)',    borderColor: 'rgba(220,20,60,0.35)',  label: 'Grand Champion' },
  ssl:            { color: '#F5F5FA', bgColor: 'rgba(245,245,250,0.1)',  borderColor: 'rgba(245,245,250,0.4)', label: 'Super Sonic Legend' },
};

export function getRankTier(rank: string | null | undefined): RankTier | null {
  if (!rank) return null;
  const lower = rank.toLowerCase().trim();
  // Important : tester "grand champion" AVANT "champion" pour éviter false positive
  if (lower.startsWith('grand champion')) return 'grand_champion';
  if (lower.startsWith('champion')) return 'champion';
  if (lower.startsWith('super sonic')) return 'ssl';
  if (lower.startsWith('bronze')) return 'bronze';
  if (lower.startsWith('argent')) return 'argent';
  if (lower.startsWith('or')) return 'or';
  if (lower.startsWith('platine')) return 'platine';
  if (lower.startsWith('diamant')) return 'diamant';
  return null;
}

export function getRankTierConfig(rank: string | null | undefined): TierConfig | null {
  const tier = getRankTier(rank);
  return tier ? TIERS[tier] : null;
}

// Mappe un nom de rang FR vers le nom de fichier de l'icône dans public/rl-ranks/.
// Ex: "Diamant III" → "diamant-iii", "Super Sonic Legend" → "ssl".
export function getRankIconFile(rank: string | null | undefined): string | null {
  if (!rank) return null;
  const lower = rank.toLowerCase().trim();
  if (lower === 'super sonic legend') return 'ssl';
  // Convertit "Grand Champion III" → "grand-champion-iii", "Diamant II" → "diamant-ii"
  return lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

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
