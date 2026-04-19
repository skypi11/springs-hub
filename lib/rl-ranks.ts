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
