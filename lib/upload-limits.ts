// Limites d'upload — fichier sans dépendance serveur pour pouvoir être importé
// côté client (FormData preview, validation avant envoi) et côté serveur (API routes).

export const UPLOAD_LIMITS = {
  STRUCTURE_LOGO_BYTES: 2 * 1024 * 1024,       // 2 MB
  STRUCTURE_BANNER_BYTES: 5 * 1024 * 1024,     // 5 MB
  USER_AVATAR_BYTES: 2 * 1024 * 1024,          // 2 MB
  REPLAY_BYTES: 10 * 1024 * 1024,              // 10 MB
  STAFF_DOCUMENT_BYTES: 20 * 1024 * 1024,      // 20 MB
  STRUCTURE_DOCS_QUOTA_BYTES: 500 * 1024 * 1024, // 500 MB / structure
} as const;
