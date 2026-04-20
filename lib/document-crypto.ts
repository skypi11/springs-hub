import crypto from 'node:crypto';

// Chiffrement AES-256-GCM pour les documents sensibles (CNI, RIB, justificatifs,
// statuts asso, contrats…). Clé unique stockée dans DOCUMENT_ENCRYPTION_KEY
// (base64, 32 octets). À sauvegarder hors de Vercel (gestionnaire de mots de
// passe + sauvegarde papier) — sans elle, les fichiers chiffrés sont perdus.
//
// Format du blob stocké sur R2 :
//   [IV (12 o)][AUTH_TAG (16 o)][CIPHERTEXT…]
// Tout est self-contained : un seul fichier = toutes les infos pour déchiffrer.

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const ENCRYPTION_ALGO_LABEL = 'AES-256-GCM';

let _cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const b64 = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      'DOCUMENT_ENCRYPTION_KEY manquante — configurer la variable sur Vercel (base64, 32 octets)'
    );
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `DOCUMENT_ENCRYPTION_KEY invalide — attend 32 octets (base64), reçu ${buf.length}`
    );
  }
  _cachedKey = buf;
  return buf;
}

// Vérifie à froid que la clé est bien configurée (sans planter si absente).
export function isEncryptionAvailable(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptBuffer(plaintext: Buffer): Buffer {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptBuffer(blob: Buffer): Buffer {
  if (blob.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Blob chiffré invalide — trop court');
  }
  const key = loadKey();
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
