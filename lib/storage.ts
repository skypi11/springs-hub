import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UPLOAD_LIMITS } from './upload-limits';

// Configuration Cloudflare R2 (API compatible S3)
// Variables d'env requises :
//   R2_ENDPOINT              — https://<account_id>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID         — depuis le token API R2
//   R2_SECRET_ACCESS_KEY     — depuis le token API R2
//   R2_BUCKET_NAME           — nom du bucket (ex: springs-hub)
//   R2_PUBLIC_URL (optionnel)— domaine public r2.dev ou custom (ex: https://pub-xxx.r2.dev)

let _client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 credentials manquantes — configurer R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'
    );
  }
  _client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // Désactive le checksum CRC32 par défaut du SDK v3 récent : il ajoute un
    // paramètre `x-amz-sdk-checksum-algorithm=CRC32` dans l'URL présignée que
    // R2 ne gère pas, ce qui casse le CORS preflight des PUT client→R2.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _client;
}

export function getBucketName(): string {
  const b = process.env.R2_BUCKET_NAME;
  if (!b) throw new Error('R2_BUCKET_NAME non configuré');
  return b;
}

// URL publique pour un asset (logos/avatars/bannières)
// Nécessite que le bucket ait un domaine public activé (r2.dev ou custom)
export function getPublicUrl(key: string): string {
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) {
    throw new Error(
      'R2_PUBLIC_URL non configuré — activer r2.dev public access ou un custom domain sur le bucket'
    );
  }
  return `${publicUrl.replace(/\/$/, '')}/${key}`;
}

// Télécharge un fichier depuis R2 dans un Buffer (utilisé pour
// (re)chiffrer un document sensible après son upload initial en clair).
export async function downloadBuffer(key: string): Promise<Buffer> {
  const res = await getR2Client().send(
    new GetObjectCommand({ Bucket: getBucketName(), Key: key })
  );
  if (!res.Body) throw new Error(`R2 objet vide : ${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Upload direct d'un buffer depuis le serveur (ex: après compression sharp)
export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
  cacheControl?: string
): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: cacheControl ?? 'public, max-age=31536000, immutable',
    })
  );
}

// URL signée pour UPLOAD direct depuis le client (PUT)
// Utilisé pour les gros fichiers (replays, docs) qui dépassent la limite Vercel body
export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresSeconds = 300
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
  });
  return await getSignedUrl(getR2Client(), cmd, { expiresIn: expiresSeconds });
}

// URL signée pour DOWNLOAD privé (documents staff — jamais publique)
export async function generateDownloadUrl(
  key: string,
  expiresSeconds = 60,
  downloadFilename?: string
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    // Force le navigateur à télécharger avec ce nom plutôt qu'afficher inline
    ResponseContentDisposition: downloadFilename
      ? `attachment; filename="${downloadFilename.replace(/"/g, '')}"`
      : undefined,
  });
  return await getSignedUrl(getR2Client(), cmd, { expiresIn: expiresSeconds });
}

export async function deleteFile(key: string): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({ Bucket: getBucketName(), Key: key })
  );
}

// Suppression silencieuse (ne throw pas si le fichier n'existe pas)
export async function deleteFileSilent(key: string): Promise<void> {
  try {
    await deleteFile(key);
  } catch {
    // ignore
  }
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    await getR2Client().send(
      new HeadObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    return true;
  } catch {
    return false;
  }
}

export async function getFileSize(key: string): Promise<number | null> {
  try {
    const res = await getR2Client().send(
      new HeadObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    return res.ContentLength ?? null;
  } catch {
    return null;
  }
}

// Liste les clés sous un préfixe (utilisé pour compter l'usage par structure)
export async function listKeys(prefix: string, maxKeys = 1000): Promise<string[]> {
  const res = await getR2Client().send(
    new ListObjectsV2Command({
      Bucket: getBucketName(),
      Prefix: prefix,
      MaxKeys: maxKeys,
    })
  );
  return (res.Contents ?? []).map(o => o.Key!).filter(Boolean);
}

// Calcule la taille totale utilisée sous un préfixe (pour les quotas)
export async function getTotalSize(prefix: string): Promise<number> {
  const res = await getR2Client().send(
    new ListObjectsV2Command({
      Bucket: getBucketName(),
      Prefix: prefix,
    })
  );
  return (res.Contents ?? []).reduce((sum, o) => sum + (o.Size ?? 0), 0);
}

// ============================================================
// Helpers de construction de clés (centralisés pour cohérence)
// ============================================================

// Les clés d'assets versionnables utilisent un paramètre `version` (timestamp ms)
// pour contourner le cache CDN : chaque nouvel upload change la clé/URL, l'ancienne
// est supprimée explicitement.
export const StorageKeys = {
  structureLogo: (structureId: string, version: number) =>
    `structures/${structureId}/logo-${version}.webp`,
  structureBanner: (structureId: string, version: number) =>
    `structures/${structureId}/banner-${version}.webp`,
  userAvatar: (uid: string, version: number) =>
    `users/${uid}/avatar-${version}.webp`,
  eventReplay: (structureId: string, eventId: string, replayId: string) =>
    `structures/${structureId}/replays/${eventId}/${replayId}.replay`,
  structureDocument: (structureId: string, documentId: string, filename: string) =>
    `structures/${structureId}/documents/${documentId}/${sanitizeFilename(filename)}`,
  // Préfixes pour calculs de quota
  structurePrefix: (structureId: string) => `structures/${structureId}/`,
  structureDocumentsPrefix: (structureId: string) => `structures/${structureId}/documents/`,
  userPrefix: (uid: string) => `users/${uid}/`,
} as const;

// Extrait la clé R2 d'une URL publique (null si l'URL n'est pas sur notre bucket)
// Utile pour supprimer l'ancien asset quand on en upload un nouveau.
export function extractR2Key(url: string | null | undefined): string | null {
  if (!url) return null;
  const base = process.env.R2_PUBLIC_URL;
  if (!base) return null;
  const prefix = base.replace(/\/$/, '') + '/';
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
}

// Nettoie un nom de fichier pour éviter les caractères problématiques dans la clé S3
export function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // accents
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}

// ============================================================
// Limites par type (sources de vérité — à utiliser partout)
// ============================================================

// Re-export pour compat — la vraie source est lib/upload-limits.ts (safe côté client)
export const UploadLimits = UPLOAD_LIMITS;

export const AllowedMimeTypes = {
  IMAGES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  DOCUMENTS: [
    // PDF
    'application/pdf',
    // Microsoft Office
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // OpenDocument (LibreOffice, Google Suite exports)
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    // Texte
    'text/plain',
    'text/csv',
    'text/markdown',
    // Archives
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    // Images (converties en webp à l'upload)
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    // Fallback : octet-stream (certains navigateurs ne détectent pas le MIME)
    'application/octet-stream',
  ],
  REPLAYS: ['application/octet-stream', ''],  // .replay n'a pas de MIME standard
} as const;

// Détecte si un MIME correspond à une image (pour conversion webp à l'upload)
export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

// Détermine l'extension pour le stockage R2 — garde l'extension d'origine sauf
// pour les images qui sont systématiquement converties en webp.
export function extensionForStorage(filename: string, mime: string): string {
  if (isImageMime(mime)) return 'webp';
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'bin';
  return filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

export function isAllowedMime(mime: string, category: keyof typeof AllowedMimeTypes): boolean {
  const list = AllowedMimeTypes[category] as readonly string[];
  return list.includes(mime);
}
