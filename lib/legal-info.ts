// Source de vérité pour les infos légales affichées dans /legal/mentions et
// /legal/confidentialite.
//
// Aedral est édité en nom propre par Matthieu MOLINES (personne physique).
// Springs E-Sport est désormais un partenaire et n'est plus l'éditeur du site.
//
// Les placeholders "À COMPLÉTER" sont volontairement visibles pour ne rien
// publier de faux. Matthieu doit remplir l'adresse perso (obligation RGPD :
// nom + adresse de l'éditeur doivent être accessibles aux utilisateurs).

export const LEGAL_INFO = {
  // ── Éditeur du site (personne physique) ──────────────────────────
  editorName: 'Matthieu MOLINES',
  editorStatus: 'Personne physique',
  // Adresse postale obligatoire pour les mentions légales (LCEN 2004-575).
  // Si tu veux préserver ta vie privée tout en restant en règle, possibilités :
  //  - utiliser une adresse de boîte postale (BP)
  //  - utiliser l'adresse d'un cabinet de domiciliation (~10-30 €/mois)
  //  - basculer en auto-entrepreneur et utiliser l'adresse pro déclarée
  editorAddress: '300 chemin du Fumeou, 83160 La Valette-du-Var, France',
  // Tant que Matthieu n'est pas auto-entrepreneur, pas de SIRET/SIREN.
  // À mettre à jour s'il s'enregistre :
  editorSiret: null as string | null,
  editorSiren: null as string | null,

  // ── Contact ──────────────────────────────────────────────────────
  contactEmail: 'mattmolines@gmail.com',
  contactPhone: null as string | null,

  // ── Site ─────────────────────────────────────────────────────────
  siteUrl: 'https://aedral.com',
  siteName: 'Aedral',

  // ── Hébergeur ────────────────────────────────────────────────────
  hosterName: 'Vercel Inc.',
  hosterAddress: '340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis',
  hosterUrl: 'https://vercel.com',

  // ── Infrastructure tierce (stockage / auth / DB) ─────────────────
  infraProviders: [
    {
      name: 'Google Firebase / Firestore',
      purpose: 'Base de données et authentification',
      url: 'https://firebase.google.com',
      location: 'Google Cloud (voir console pour la région exacte)',
    },
    {
      name: 'Cloudflare R2',
      purpose: 'Stockage des fichiers (documents, replays, logos)',
      url: 'https://www.cloudflare.com/products/r2/',
      location: 'Cloudflare (infrastructure distribuée)',
    },
    {
      name: 'Upstash Redis',
      purpose: 'Rate limiting (protection anti-abus)',
      url: 'https://upstash.com',
      location: 'Serveurs en Europe',
    },
    {
      name: 'Discord',
      purpose: 'Authentification (OAuth 2.0, scope identify uniquement)',
      url: 'https://discord.com',
      location: 'Discord Inc., San Francisco, États-Unis',
    },
    {
      name: 'Sentry',
      purpose: 'Monitoring technique (erreurs applicatives)',
      url: 'https://sentry.io',
      location: 'États-Unis',
    },
  ],

  // Dernière mise à jour du document (format YYYY-MM-DD)
  lastUpdated: '2026-04-25',
} as const;
