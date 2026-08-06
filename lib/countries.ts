/**
 * Pays proposés à l'inscription et sur les profils.
 *
 * L'ordre n'est pas alphabétique et c'est volontaire : la France, ses voisins
 * et l'espace francophone d'abord — ils représentent l'écrasante majorité des
 * comptes — puis le reste de l'Europe par ordre alphabétique.
 *
 * La liste a longtemps compté 19 entrées, taillées pour une communauté
 * francophone. Elle a été élargie quand la Springs Mania Cup s'est ouverte aux
 * joueurs européens : la Pologne, la Suède, la Finlande, la Tchéquie et le
 * Danemark — c'est-à-dire une bonne part de la scène Trackmania — n'y
 * figuraient pas. Un joueur polonais devait se déclarer « Autre ».
 *
 * ATTENTION : le serveur valide le pays contre CETTE liste
 * (app/api/mania-cup/register/route.ts). Retirer une entrée empêche
 * l'inscription des personnes concernées et invalide les profils existants.
 */
export const countries = [
  // France et voisins immédiats
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'BE', name: 'Belgique', flag: '🇧🇪' },
  { code: 'CH', name: 'Suisse', flag: '🇨🇭' },
  { code: 'LU', name: 'Luxembourg', flag: '🇱🇺' },
  { code: 'MC', name: 'Monaco', flag: '🇲🇨' },

  // Grands voisins européens
  { code: 'DE', name: 'Allemagne', flag: '🇩🇪' },
  { code: 'ES', name: 'Espagne', flag: '🇪🇸' },
  { code: 'IT', name: 'Italie', flag: '🇮🇹' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'GB', name: 'Royaume-Uni', flag: '🇬🇧' },
  { code: 'NL', name: 'Pays-Bas', flag: '🇳🇱' },

  // Reste de l'Europe, par ordre alphabétique
  { code: 'AT', name: 'Autriche', flag: '🇦🇹' },
  { code: 'BG', name: 'Bulgarie', flag: '🇧🇬' },
  { code: 'HR', name: 'Croatie', flag: '🇭🇷' },
  { code: 'DK', name: 'Danemark', flag: '🇩🇰' },
  { code: 'EE', name: 'Estonie', flag: '🇪🇪' },
  { code: 'FI', name: 'Finlande', flag: '🇫🇮' },
  { code: 'GR', name: 'Grèce', flag: '🇬🇷' },
  { code: 'HU', name: 'Hongrie', flag: '🇭🇺' },
  { code: 'IE', name: 'Irlande', flag: '🇮🇪' },
  { code: 'IS', name: 'Islande', flag: '🇮🇸' },
  { code: 'LV', name: 'Lettonie', flag: '🇱🇻' },
  { code: 'LT', name: 'Lituanie', flag: '🇱🇹' },
  { code: 'MT', name: 'Malte', flag: '🇲🇹' },
  { code: 'NO', name: 'Norvège', flag: '🇳🇴' },
  { code: 'PL', name: 'Pologne', flag: '🇵🇱' },
  { code: 'CZ', name: 'Tchéquie', flag: '🇨🇿' },
  { code: 'RO', name: 'Roumanie', flag: '🇷🇴' },
  { code: 'RS', name: 'Serbie', flag: '🇷🇸' },
  { code: 'SK', name: 'Slovaquie', flag: '🇸🇰' },
  { code: 'SI', name: 'Slovénie', flag: '🇸🇮' },
  { code: 'SE', name: 'Suède', flag: '🇸🇪' },
  { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },

  // Hors Europe — communauté francophone historique
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'US', name: 'États-Unis', flag: '🇺🇸' },
  { code: 'MA', name: 'Maroc', flag: '🇲🇦' },
  { code: 'DZ', name: 'Algérie', flag: '🇩🇿' },
  { code: 'TN', name: 'Tunisie', flag: '🇹🇳' },
  { code: 'SN', name: 'Sénégal', flag: '🇸🇳' },
  { code: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮' },

  { code: 'OTHER', name: 'Autre', flag: '🌍' },
];
