// Validation côté serveur — à appliquer aux URL et chaînes contrôlées par l'utilisateur
// avant de les écrire en base ou de les renvoyer au client.

const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];

// Renvoie l'URL si elle est valide et utilise un protocole autorisé, sinon une chaîne vide.
// Ne lance jamais d'exception — usage : `safeUrl(input) || fallback`.
export function safeUrl(input: unknown): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  // Limite de longueur — protège contre les payloads géants stockés en base
  if (trimmed.length > 2048) return '';
  try {
    const url = new URL(trimmed);
    if (!ALLOWED_URL_PROTOCOLS.includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

// Tronque une chaîne à `max` caractères (pour bio, description, etc.)
export function clampString(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, max);
}

// Limites par champ — référence unique pour le serveur et l'UI (à venir)
export const LIMITS = {
  bio: 500,
  recruitmentMessage: 500,
  structureDescription: 5000,
  structureName: 50,
  structureTag: 5,
  displayName: 32,
};
