// Vérification de signature Ed25519 des interactions Discord (webhook HTTP).
//
// Discord signe la concaténation `timestamp + rawBody` avec la clé privée de
// l'application ; on vérifie avec la Public Key (hex, Developer Portal). Toute
// altération du corps invalide la signature — d'où l'obligation de vérifier sur
// le CORPS BRUT (req.text()) AVANT tout JSON.parse.
//
// node:crypto suffit (aucune dépendance) : on enveloppe la clé publique brute
// (32 octets) dans un préfixe SPKI/DER Ed25519 pour createPublicKey, puis
// crypto.verify(null, ...) (null = Ed25519). Runtime Node requis.

import crypto from 'node:crypto';

// Préfixe SPKI/DER fixe d'une clé publique Ed25519 (12 octets) — suivi des 32
// octets de la clé brute donne un SubjectPublicKeyInfo valide.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const HEX64 = /^[0-9a-fA-F]{64}$/;    // 32 octets (clé publique)
const HEX128 = /^[0-9a-fA-F]{128}$/;  // 64 octets (signature)

function publicKeyFromHex(hex: string): crypto.KeyObject | null {
  if (!HEX64.test(hex)) return null;
  try {
    return crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return null;
  }
}

/**
 * Vérifie une interaction Discord. Retourne true SEULEMENT si la signature est
 * valide pour `timestamp + rawBody` sous `publicKeyHex`. Tout paramètre malformé
 * (clé/sig non-hex de la bonne longueur) → false, jamais d'exception.
 */
export function verifyDiscordSignature(
  publicKeyHex: string | undefined | null,
  signatureHex: string | undefined | null,
  timestamp: string | undefined | null,
  rawBody: string,
): boolean {
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  if (!HEX128.test(signatureHex)) return false;
  const key = publicKeyFromHex(publicKeyHex);
  if (!key) return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(timestamp + rawBody, 'utf8'),
      key,
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}
