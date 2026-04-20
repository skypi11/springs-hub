// Source de vérité pour les infos légales affichées dans /legal/mentions et
// /legal/confidentialite. À compléter par l'utilisateur — les placeholders
// "À COMPLÉTER" sont volontairement visibles pour ne rien publier de faux.

export const LEGAL_INFO = {
  // Association
  associationName: 'Springs E-Sport',
  associationType: 'Association loi 1901',
  associationRNA: 'À COMPLÉTER — numéro RNA (format W + 9 chiffres)',
  associationSiret: null as string | null, // ex: '123 456 789 00012' — null si pas de SIRET
  associationDeclarationDate: 'À COMPLÉTER — date de déclaration en préfecture',
  associationDeclarationPrefecture: 'À COMPLÉTER — préfecture de déclaration',
  associationAddress: 'À COMPLÉTER — adresse complète du siège',

  // Représentant légal
  representativeName: 'À COMPLÉTER — Prénom NOM du président',
  representativeRole: 'Président',

  // Contact
  contactEmail: 'mattmolines@gmail.com',
  contactPhone: null as string | null, // ex: '+33 6 00 00 00 00' — null si non communiqué

  // Site
  siteUrl: 'https://springs-hub.vercel.app',

  // Hébergeur
  hosterName: 'Vercel Inc.',
  hosterAddress: '340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis',
  hosterUrl: 'https://vercel.com',

  // Infrastructure tierce (stockage / auth / DB)
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
  lastUpdated: '2026-04-20',
} as const;
