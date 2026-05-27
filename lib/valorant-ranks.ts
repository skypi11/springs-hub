// Liste des rangs Valorant utilisée pour :
// - le rang auto-déclaré dans /settings (fallback quand pas de Discord connection
//   Riot, ou en attendant la sync HenrikDev)
// - la validation côté serveur des saisies
// - le composant <RankBadge gameId="valorant" rank="Diamond 1" />
//
// Noms en anglais (Iron/Bronze/Silver…) car c'est le standard Valorant officiel
// même en VF (contrairement à RL qui traduit "Diamant", "Argent", etc.).
export const VALORANT_RANKS = [
  'Iron 1', 'Iron 2', 'Iron 3',
  'Bronze 1', 'Bronze 2', 'Bronze 3',
  'Silver 1', 'Silver 2', 'Silver 3',
  'Gold 1', 'Gold 2', 'Gold 3',
  'Platinum 1', 'Platinum 2', 'Platinum 3',
  'Diamond 1', 'Diamond 2', 'Diamond 3',
  'Ascendant 1', 'Ascendant 2', 'Ascendant 3',
  'Immortal 1', 'Immortal 2', 'Immortal 3',
  'Radiant',
] as const;

export type ValorantRank = (typeof VALORANT_RANKS)[number];

export function isValidValorantRank(v: unknown): v is ValorantRank {
  return typeof v === 'string' && (VALORANT_RANKS as readonly string[]).includes(v);
}

export type ValorantTier =
  | 'iron' | 'bronze' | 'silver' | 'gold'
  | 'platinum' | 'diamond' | 'ascendant' | 'immortal'
  | 'radiant';

interface TierConfig {
  /** Couleur principale du tier (HEX) — sert au cadre + au texte */
  color: string;
  /** Variante avec alpha pour les fonds (rgba) */
  bgColor: string;
  /** Border alpha */
  borderColor: string;
  /** Label affiché */
  label: string;
}

// Couleurs alignées sur les codes officiels Riot Valorant.
const TIERS: Record<ValorantTier, TierConfig> = {
  iron:      { color: '#5A5A5A', bgColor: 'rgba(90,90,90,0.10)',    borderColor: 'rgba(90,90,90,0.35)',    label: 'Iron' },
  bronze:    { color: '#A06A3E', bgColor: 'rgba(160,106,62,0.10)',  borderColor: 'rgba(160,106,62,0.35)',  label: 'Bronze' },
  silver:    { color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.10)', borderColor: 'rgba(192,192,192,0.35)', label: 'Silver' },
  gold:      { color: '#F0B232', bgColor: 'rgba(240,178,50,0.10)',  borderColor: 'rgba(240,178,50,0.35)',  label: 'Gold' },
  platinum:  { color: '#3FB4E6', bgColor: 'rgba(63,180,230,0.10)',  borderColor: 'rgba(63,180,230,0.35)',  label: 'Platinum' },
  diamond:   { color: '#C77AE0', bgColor: 'rgba(199,122,224,0.10)', borderColor: 'rgba(199,122,224,0.35)', label: 'Diamond' },
  ascendant: { color: '#3DB374', bgColor: 'rgba(61,179,116,0.10)',  borderColor: 'rgba(61,179,116,0.35)',  label: 'Ascendant' },
  immortal:  { color: '#B23B4E', bgColor: 'rgba(178,59,78,0.10)',   borderColor: 'rgba(178,59,78,0.35)',   label: 'Immortal' },
  radiant:   { color: '#FFE39B', bgColor: 'rgba(255,227,155,0.12)', borderColor: 'rgba(255,227,155,0.40)', label: 'Radiant' },
};

export function getValorantTier(rank: string | null | undefined): ValorantTier | null {
  if (!rank) return null;
  const lower = rank.toLowerCase().trim();
  if (lower.startsWith('iron')) return 'iron';
  if (lower.startsWith('bronze')) return 'bronze';
  if (lower.startsWith('silver')) return 'silver';
  if (lower.startsWith('gold')) return 'gold';
  if (lower.startsWith('platinum')) return 'platinum';
  if (lower.startsWith('diamond')) return 'diamond';
  if (lower.startsWith('ascendant')) return 'ascendant';
  if (lower.startsWith('immortal')) return 'immortal';
  if (lower.startsWith('radiant')) return 'radiant';
  return null;
}

export function getValorantTierConfig(rank: string | null | undefined): TierConfig | null {
  const tier = getValorantTier(rank);
  return tier ? TIERS[tier] : null;
}

// Mappe un rang Val vers le nom de fichier dans public/valorant-ranks/.
// Ex: "Diamond 2" → "diamond-2", "Radiant" → "radiant".
export function getValorantRankIconFile(rank: string | null | undefined): string | null {
  if (!rank) return null;
  const lower = rank.toLowerCase().trim();
  if (lower === 'radiant') return 'radiant';
  return lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
