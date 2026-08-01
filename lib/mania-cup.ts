// Springs Mania Cup — LAN Trackmania des 3 et 4 octobre 2026 à Marzy (58).
// Organisateur : SPRINGS E-SPORT. Aedral héberge l'inscription et l'affichage.
//
// Ce module rassemble les constantes et les règles métier de l'inscription,
// pour que la page, l'API et l'admin partagent la même source de vérité.

import { computeAge } from '@/lib/age';

export const MANIA_CUP = {
  slug: 'mania-cup',
  name: 'Springs Mania Cup',
  /** Premier jour de l'événement — sert de date de référence pour l'âge. */
  startDate: '2026-10-03',
  endDate: '2026-10-04',
  city: 'Marzy (58)',
  address: '19 rue des Charrons, 58180 Marzy',
  maxPlayers: 64,
  priceEuros: 30,
  prizePoolEuros: 1200,
  /** Âge minimum, apprécié au PREMIER JOUR de la LAN et non à l'inscription :
   *  un joueur qui a 15 ans en août mais 16 ans fin septembre peut venir. */
  minAge: 16,
  /** En dessous de cet âge (toujours au premier jour), une autorisation
   *  parentale est exigée avant de confirmer la place. */
  guardianConsentBelowAge: 18,
} as const;

/** Collection Firestore des inscriptions. Doc id = uid Aedral → une inscription
 *  par compte, garantie sans transaction. */
export const MANIA_CUP_REGISTRATIONS = 'mania_cup_registrations';

/**
 * Serveur Discord de Springs E-Sport, dont l'appartenance est exigée pour
 * s'inscrire. Un identifiant de serveur Discord n'est pas un secret (il est
 * visible de tout membre), d'où la valeur par défaut en clair : la variable
 * d'environnement reste prioritaire pour pouvoir pointer un serveur de test.
 */
export function springsGuildId(): string {
  return process.env.SPRINGS_DISCORD_GUILD_ID || '730008459088494632';
}

/** Invitation publique au Discord Springs, proposée au joueur qui n'y est pas
 *  encore. Lien public : aucune raison d'en faire une variable d'environnement. */
export const SPRINGS_DISCORD_INVITE = 'https://discord.gg/xyAr9h45eu';

/**
 * L'événement est-il ouvert au public ? Même logique que le brouillon d'une
 * compétition Legends (`isCompetitionHidden`) : tant que c'est faux, les pages
 * ne sont pas indexées et PERSONNE ne peut s'inscrire, hormis les admins et les
 * comptes du bac à sable — ce qui permet de tout éprouver sur aedral.com, seul
 * domaine où les retours OAuth Discord et Trackmania sont déclarés.
 *
 * Bascule : variable d'environnement `MANIA_CUP_PUBLIC=true` sur Vercel, suivie
 * d'un redéploiement. Aucun code à toucher le jour de l'annonce.
 */
export function isManiaCupPublic(): boolean {
  return process.env.MANIA_CUP_PUBLIC === 'true';
}

export type RegistrationStatus =
  /** Inscrit sur le site, en attente du règlement HelloAsso. */
  | 'pending_payment'
  /** Paiement reçu et dossier complet — la place est acquise. */
  | 'confirmed'
  /** Retirée par le joueur ou annulée par l'organisation. */
  | 'cancelled';

export type GuardianConsentStatus =
  | 'not_required'
  /** Mineur : au moins une des deux pièces manque. */
  | 'missing'
  /** Dossier complet, en attente de relecture par l'organisation. */
  | 'pending_review'
  | 'approved'
  | 'rejected';

/**
 * Les deux pièces exigées d'un joueur de 16-17 ans.
 *
 * L'autorisation seule ne prouve rien — n'importe qui peut signer « le père
 * de ». C'est la pièce d'identité du représentant légal qui rend la signature
 * opposable. En revanche l'identité DU MINEUR se contrôle à l'accueil le jour
 * J, sur présentation : la vérifier n'exige pas d'en conserver une copie, et
 * on évite ainsi d'accumuler des papiers d'identité de mineurs.
 */
export const GUARDIAN_DOC_KINDS = ['consent', 'guardian_id'] as const;
export type GuardianDocKind = (typeof GUARDIAN_DOC_KINDS)[number];

export const GUARDIAN_DOC_LABELS: Record<GuardianDocKind, string> = {
  consent: 'Autorisation parentale signée',
  guardian_id: 'Pièce d’identité du représentant légal',
};

export interface GuardianDoc {
  key: string;
  name: string;
  mime: string;
  uploadedAt?: unknown;
}

export function isGuardianDossierComplete(
  docs: Partial<Record<GuardianDocKind, GuardianDoc>> | undefined
): boolean {
  return GUARDIAN_DOC_KINDS.every((k) => Boolean(docs?.[k]?.key));
}

/**
 * Combien de temps les pièces sont conservées après la LAN. Annoncé au joueur
 * au moment du dépôt et appliqué par le cron de purge : une collecte propre se
 * distingue d'un dossier qui traîne par sa date de fin.
 */
export const GUARDIAN_DOCS_RETENTION_DAYS = 14;

export interface ManiaCupRegistration {
  uid: string;
  /** Snowflake Discord, extrait de l'uid Aedral (`discord_<snowflake>`). */
  discordId: string | null;
  /** Identité Trackmania vérifiée par OAuth Nadeo au moment de l'inscription. */
  tmAccountId: string;
  tmDisplayName: string;
  /** ISO YYYY-MM-DD. Donnée sensible : jamais servie sur la liste publique. */
  birthDate: string;
  /** Âge au premier jour de la LAN, figé à l'inscription pour l'organisation. */
  ageAtEvent: number;
  /** Code ISO 2 lettres, issu de `lib/countries`. */
  countryCode: string;
  status: RegistrationStatus;
  guardianConsent: GuardianConsentStatus;
  /** Les pièces déposées, chiffrées sur R2. Jamais servies par URL publique. */
  guardianDocs?: Partial<Record<GuardianDocKind, GuardianDoc>>;
  /** Motif communiqué au joueur quand le dossier est refusé. */
  guardianRejectionReason?: string | null;
  /** Date de purge des pièces, une fois l'événement passé. */
  guardianDocsPurgedAt?: unknown;
  /** Version du règlement acceptée à l'inscription — trace opposable. */
  rulebookAccepted?: { version: number; at: unknown; byUid: string } | null;
  /**
   * Code unique à reporter dans le champ personnalisé de la billetterie
   * HelloAsso. C'est lui qui permet de relier un paiement à une inscription :
   * l'e-mail ne suffit pas (un joueur peut payer avec l'adresse de ses parents).
   */
  registrationCode: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  paidAt?: unknown;
}

/** Ce que la liste publique des inscrits expose — et rien d'autre.
 *  Ni date de naissance, ni âge, ni code d'inscription. */
export interface PublicRegistration {
  tmDisplayName: string;
  countryCode: string;
  status: RegistrationStatus;
}

/** Âge du joueur le premier jour de la LAN. */
export function ageAtEvent(birthDate: string): number | null {
  return computeAge(birthDate, new Date(`${MANIA_CUP.startDate}T00:00:00Z`));
}

export function needsGuardianConsent(age: number): boolean {
  return age < MANIA_CUP.guardianConsentBelowAge;
}

/**
 * Code d'inscription lisible et dictable au téléphone : préfixe + 4 caractères.
 * L'alphabet exclut I, O, 0, 1 — ce sont les confusions qui reviennent quand un
 * joueur recopie son code à la main dans le formulaire HelloAsso.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRegistrationCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return `LAN-${out}`;
}

/** `discord_123456789` → `123456789`. Null pour tout autre format d'uid. */
export function discordIdFromUid(uid: string): string | null {
  const m = /^discord_(\d+)$/.exec(uid);
  return m ? m[1] : null;
}
