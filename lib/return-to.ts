/**
 * Validation stricte d'un chemin de retour après OAuth (open redirect = critique).
 *
 * Utilisé par le flow Discord OAuth pour préserver la page d'origine pendant
 * la redirection vers Discord et le callback. Le path est lu depuis :
 * - le query `?next=` de /api/auth/discord/start
 * - le cookie httpOnly `discord_oauth_next` re-lu dans /api/auth/discord/callback
 *
 * Stratégie : whitelist serrée plutôt que blacklist. On accepte uniquement
 * des chemins relatifs absolus (`/...`) sans schéma, sans host, et de
 * longueur bornée. Tout cas ambigu est rejeté.
 *
 * Bypass classiques couverts :
 * - `//evil.com` (protocol-relative URL)
 * - `http://evil.com`, `https://evil.com`, `javascript:`, `data:`, `vbscript:`
 * - `/\evil.com` (Chrome traite `\` comme `/` dans certains contextes)
 * - `%2F%2Fevil.com`, `%5C%5Cevil.com` (encodage URL pour cacher //, \\)
 * - CR/LF injection (`/foo%0d%0aLocation: evil`)
 * - URL absolue avec username `https://user@evil.com` après normalisation
 */

const MAX_LENGTH = 512;

/**
 * Décode jusqu'à 3 niveaux d'encodage URL pour neutraliser les double/triple
 * encodages (`%252F%252F` → `%2F%2F` → `//`). 3 passes suffisent : aucun
 * navigateur ne décode au-delà de 2 niveaux, mais on garde une marge.
 *
 * decodeURIComponent throw sur séquences invalides ; on rattrape et on
 * considère ça comme invalide (donc rejet à l'étape de validation).
 */
function tryDecode(input: string): string | null {
  let current = input;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return next;
    current = next;
  }
  return current;
}

/**
 * Renvoie true si `path` est un chemin relatif sûr utilisable comme
 * destination de redirection post-OAuth, false sinon.
 *
 * Règles d'acceptation :
 * - Type string non vide après trim
 * - Longueur ≤ 512 chars (cap raisonnable, évite cookies obèses)
 * - Décodable URL sans throw (rejet sur séquences malformées)
 * - Commence par `/` (chemin absolu relatif au domaine)
 * - Le 2ème caractère, s'il existe, n'est NI `/` NI `\` (bloque `//evil.com`
 *   et `/\evil.com` qui sont des protocol-relative URLs valides côté
 *   navigateur)
 * - Ne contient AUCUN caractère de contrôle (CR/LF/tab/null...)
 * - Ne contient PAS de `://` (bloque les schémas après normalisation)
 * - Ne contient PAS de backslash `\` (Chrome le traite parfois comme `/`)
 */
export function isValidNext(path: unknown): path is string {
  if (typeof path !== 'string') return false;

  const trimmed = path.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_LENGTH) return false;

  // Décodage défensif : on valide la forme décodée pour bloquer les
  // encodages cachant un `//evil.com`, un `\\evil.com`, un `javascript:`, etc.
  const decoded = tryDecode(trimmed);
  if (decoded === null) return false;
  if (decoded.length > MAX_LENGTH) return false;

  // Caractères de contrôle (incluant CR, LF, tab, null) → injection headers
  // possible si jamais on les écrit dans une réponse HTTP.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(decoded)) return false;

  // Backslash : risque navigateur (Chrome interprète `\` comme `/` dans
  // certains contextes URL).
  if (decoded.includes('\\')) return false;

  // Doit commencer par `/`.
  if (!decoded.startsWith('/')) return false;

  // Bloquer `//host` (protocol-relative).
  if (decoded.length >= 2 && decoded[1] === '/') return false;

  // Bloquer toute occurrence de schéma (`javascript:`, `data:`, `http://`,
  // `mailto:`, etc.). On rejette dès qu'on voit `xxx:` au début OU après
  // un `/`. Au plus simple : interdire `:` avant un `/` (un path légitime
  // n'a jamais `foo:bar` avant le premier `/`, car on commence par `/`).
  // Mais on accepte `:` dans la query string et fragment. Donc on scope
  // la vérification à la portion pathname uniquement.
  const queryIdx = decoded.search(/[?#]/);
  const pathnameOnly = queryIdx === -1 ? decoded : decoded.slice(0, queryIdx);
  if (pathnameOnly.includes(':')) return false;

  // Bloquer `://` partout (paranoïa, déjà couvert par le check `:` ci-dessus
  // pour la portion path, mais on couvre aussi le cas où il apparaîtrait
  // dans la query d'une manière qui ferait croire à un schéma).
  if (decoded.includes('://')) return false;

  return true;
}

/**
 * Sanitize un chemin de retour : renvoie le path s'il est valide, sinon `/`.
 * Helper pratique pour les call-sites qui veulent toujours une string.
 *
 * Note : on renvoie le path d'origine (pas la version décodée), pour
 * préserver l'encodage des query params (ex: `/profile/noxx?from=email`).
 */
export function sanitizeNext(path: unknown, fallback = '/'): string {
  return isValidNext(path) ? path.trim() : fallback;
}
