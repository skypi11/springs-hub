// Liste des rangs Rocket League utilisée pour le rang auto-déclaré dans /settings
// (fallback quand TRN_API_KEY absente / joueur sans tracker connecté).
// Noms en FR pour rester cohérent avec le seed dev (`app/api/dev/seed/route.ts`).
export const RL_RANKS = [
  'Bronze I', 'Bronze II', 'Bronze III',
  'Argent I', 'Argent II', 'Argent III',
  'Or I', 'Or II', 'Or III',
  'Platine I', 'Platine II', 'Platine III',
  'Diamant I', 'Diamant II', 'Diamant III',
  'Champion I', 'Champion II', 'Champion III',
  'Grand Champion I', 'Grand Champion II', 'Grand Champion III',
  'Super Sonic Legend',
] as const;

export type RLRank = (typeof RL_RANKS)[number];

export function isValidRLRank(v: unknown): v is RLRank {
  return typeof v === 'string' && (RL_RANKS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Tiers RL — helpers server-safe (réutilisés côté OG endpoints et UI).
// Source de vérité unique pour les couleurs officielles (Grand Champion = rouge
// #DC143C, Champion = violet, Diamant = bleu RL, etc.). Si tu changes une
// couleur ici, RankBadge ET les OG en bénéficient.
// ---------------------------------------------------------------------------

export type RankTier =
  | 'bronze' | 'argent' | 'or' | 'platine'
  | 'diamant' | 'champion' | 'grand_champion' | 'ssl';

export interface TierConfig {
  /** Couleur principale du tier (HEX), sert au cadre + au texte */
  color: string;
  /** Variante avec alpha pour les fonds (rgba) */
  bgColor: string;
  /** Border alpha */
  borderColor: string;
  /** Label affiché */
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
