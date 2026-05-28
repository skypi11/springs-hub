// Limites d'upload, fichier sans dépendance serveur pour pouvoir être importé
// côté client (FormData preview, validation avant envoi) et côté serveur (API routes).

export const UPLOAD_LIMITS = {
  STRUCTURE_LOGO_BYTES: 2 * 1024 * 1024,       // 2 MB
  STRUCTURE_BANNER_BYTES: 5 * 1024 * 1024,     // 5 MB
  USER_AVATAR_BYTES: 2 * 1024 * 1024,          // 2 MB
  REPLAY_BYTES: 10 * 1024 * 1024,              // 10 MB
  STAFF_DOCUMENT_BYTES: 20 * 1024 * 1024,      // 20 MB
  // Quota total partagé docs + replays par structure (free tier). Bumpé sur
  // le flag `structures.premium = true`. Voir docs/rl-rank-verification-plan.md
  // pour le rationale du modèle freemium par structure.
  STRUCTURE_STORAGE_QUOTA_BYTES: 500 * 1024 * 1024,         // 500 MB free
  STRUCTURE_STORAGE_QUOTA_BYTES_PREMIUM: 5 * 1024 * 1024 * 1024, // 5 GB premium
  // Alias rétrocompat, anciennes routes lisaient ce nom. À retirer une fois
  // les imports migrés vers STRUCTURE_STORAGE_QUOTA_BYTES.
  STRUCTURE_DOCS_QUOTA_BYTES: 500 * 1024 * 1024,
} as const;
