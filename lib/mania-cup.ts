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
  /** Billets vendus sur la billetterie HelloAsso, hors inscription joueur.
   *  Le billet accompagnant (« staff ») donne accès à la ZONE JOUEURS, ce qui
   *  le distingue d'un billet spectateur — d'où son tarif propre. */
  spectatorDayEuros: 10,
  spectatorTwoDaysEuros: 15,
  companionEuros: 20,
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
/** Textes de l'événement stockés dans `rulebooks` (markdown versionné).
 *  La FAQ n'en fait PAS partie : elle est structurée en paires
 *  question/réponse, voir lib/mania-cup-faq.ts. */
export const MANIA_CUP_DOCS = {
  rules: MANIA_CUP.slug,
} as const;

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
 * Combien de temps chaque pièce est conservée après la LAN. Annoncé au joueur
 * au moment du dépôt et appliqué par le cron de purge : une collecte propre se
 * distingue d'un dossier qui traîne par sa date de fin.
 *
 * Les deux durées DIFFÈRENT, et c'est volontaire :
 *  - l'AUTORISATION est la seule preuve qu'un parent a laissé son enfant
 *    concourir. Si une famille conteste quoi que ce soit deux mois après la
 *    LAN, l'effacer à J+14 revient à ne plus rien pouvoir montrer. Un an.
 *  - le SCAN de la pièce d'identité du parent ne sert qu'une fois : vérifier,
 *    au moment de la relecture, que la signature émane bien du titulaire. Passé
 *    ce contrôle il ne prouve plus rien de plus que l'autorisation elle-même.
 *    On le supprime dès la validation — garder des photos de papiers d'identité
 *    « au cas où » est exactement ce qu'il ne faut pas faire.
 */
export const GUARDIAN_DOC_RETENTION_DAYS: Record<GuardianDocKind, number> = {
  consent: 365,
  guardian_id: 14,
};

/** La plus longue des deux : ce que la page d'inscription annonce au joueur. */
export const GUARDIAN_DOCS_RETENTION_DAYS = GUARDIAN_DOC_RETENTION_DAYS.consent;

// ── Références des titres d'identité (dossier mineur) ────────────────────────
//
// Ce qu'on consigne quand un joueur de 16-17 ans concourt : la nature du titre,
// son numéro et l'autorité qui l'a délivré, pour le mineur ET pour le
// représentant légal signataire.
//
// C'est ce que demande l'article R.321-43 du code de la sécurité intérieure —
// et c'est aussi la seule façon de rendre l'autorisation exploitable : un
// papier signé « la mère de » ne vaut rien si personne ne peut dire quel titre
// a été présenté au moment de la signature.
//
// On note les RÉFÉRENCES, pas des photocopies. Le scan de la pièce du parent
// ne sert qu'au contrôle visuel de la relecture et disparaît juste après.

export const IDENTITY_DOC_KINDS = ['cni', 'passport', 'residence_permit', 'other'] as const;
export type IdentityDocKind = (typeof IDENTITY_DOC_KINDS)[number];

export const IDENTITY_DOC_LABELS: Record<IdentityDocKind, string> = {
  cni: 'Carte nationale d’identité',
  passport: 'Passeport',
  residence_permit: 'Titre de séjour',
  other: 'Autre titre officiel',
};

export interface IdentityRef {
  kind: IdentityDocKind;
  /** Numéro figurant sur le titre. */
  number: string;
  /** Autorité de délivrance : préfecture, mairie, ambassade… */
  authority: string;
}

/**
 * Les références vivent dans leur propre collection, jamais dans le dossier
 * d'inscription.
 *
 * Trois raisons : c'est la donnée la plus sensible du module ; sa durée de
 * conservation lui est propre ; et aucune route ne doit pouvoir la sérialiser
 * par accident en renvoyant « le dossier » à son propriétaire ou à un écran
 * d'administration. Même séparation que la date de naissance, rangée dans
 * `user_secrets` plutôt que sur le profil.
 */
export const MANIA_CUP_IDENTITY = 'mania_cup_identity';

export interface ManiaCupIdentityRecord {
  uid: string;
  /** Nom du représentant légal qui signe l'autorisation. */
  representativeName: string;
  representative: IdentityRef;
  minor: IdentityRef;
  collectedAt?: unknown;
}

/** Combien de temps les références sont conservées après la LAN. */
export const IDENTITY_RETENTION_DAYS = 365;

export function isIdentityRefComplete(ref: Partial<IdentityRef> | null | undefined): boolean {
  return Boolean(
    ref &&
      typeof ref.kind === 'string' &&
      (IDENTITY_DOC_KINDS as readonly string[]).includes(ref.kind) &&
      ref.number?.trim() &&
      ref.authority?.trim()
  );
}

/** Le dossier mineur est complet quand les DEUX pièces sont déposées ET que les
 *  références des deux titres sont saisies. */
export function isGuardianRecordComplete(
  docs: Partial<Record<GuardianDocKind, GuardianDoc>> | undefined,
  identity: Partial<ManiaCupIdentityRecord> | null | undefined
): boolean {
  return (
    isGuardianDossierComplete(docs) &&
    Boolean(identity?.representativeName?.trim()) &&
    isIdentityRefComplete(identity?.representative) &&
    isIdentityRefComplete(identity?.minor)
  );
}

export interface ManiaCupRegistration {
  uid: string;
  /** Snowflake Discord, extrait de l'uid Aedral (`discord_<snowflake>`). */
  discordId: string | null;
  /** Identité Trackmania vérifiée par OAuth Nadeo au moment de l'inscription. */
  tmAccountId: string;
  tmDisplayName: string;
  /**
   * Identité civile. Un pseudo ne sert à rien le samedi matin : l'accueil
   * contrôle une carte d'identité et coche un nom sur une liste. C'est aussi la
   * seule prise de secours quand un règlement arrive sans son code — HelloAsso
   * nous donne le nom du PAYEUR (souvent un parent), jamais le pseudo de jeu.
   */
  firstName: string;
  lastName: string;
  /** Adresse de l'organisation vers le joueur. Distincte de celle du payeur. */
  email: string;
  /** Facultatif : joindre quelqu'un qui n'est pas arrivé, ou qui a laissé un sac. */
  phone?: string | null;
  /** Exigé des 16-17 ans : une personne à prévenir qui n'est pas dans la salle. */
  emergencyContact?: { name: string; phone: string } | null;
  /**
   * Autorisation de diffuser l'image du joueur (stream, VOD, réseaux, presse).
   * Refuser n'empêche pas de jouer : ça donne un badge distinct et une consigne
   * au cadreur. Pour un mineur, c'est le représentant légal qui l'accorde, dans
   * l'autorisation parentale.
   */
  imageConsent?: { accepted: boolean; at: unknown } | null;
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
   * Accompagnant déclaré par le joueur. Il achète un billet « staff » sur
   * HelloAsso, qui lui donne accès à la ZONE JOUEURS — contrairement à un
   * spectateur. D'où l'obligation de le rattacher à un joueur identifié :
   * l'accueil doit pouvoir dire qui accompagne qui, et un billet staff ne peut
   * pas circuler librement.
   */
  companion?: {
    name: string;
    role: string;
    declaredAt?: unknown;
    /** Passe à vrai quand le billet accompagnant a été réglé sur HelloAsso. */
    ticketPaid?: boolean;
    ticketPaidAt?: unknown;
  } | null;
  /**
   * Code unique à reporter dans le champ personnalisé de la billetterie
   * HelloAsso. C'est lui qui permet de relier un paiement à une inscription :
   * l'e-mail ne suffit pas (un joueur peut payer avec l'adresse de ses parents).
   */
  registrationCode: string;
  /**
   * Preuve du règlement de l'inscription, recopiée depuis HelloAsso. Sans elle,
   * `paidAt` seul ne permet ni de rapprocher une caisse, ni de traiter un
   * remboursement, ni de repérer un double paiement.
   */
  payment?: RegistrationPayment | null;
  /** Poste loué sur la billetterie. Ne vaut JAMAIS règlement de l'inscription. */
  pcRental?: { itemId: number; amountCents: number; at?: unknown } | null;
  /** Emplacement attribué dans la salle, imprimé sur le badge. */
  seat?: string | null;
  /** Passage à l'accueil le jour J. */
  checkedInAt?: unknown;
  checkedInBy?: string | null;
  /** Mot de l'organisation affiché sur l'espace du joueur (« il manque… »). */
  staffMessage?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  paidAt?: unknown;
}

/** Ce qu'on garde d'un règlement encaissé sur HelloAsso. */
export interface RegistrationPayment {
  /** Identifiants HelloAsso — `itemId` est la clé d'idempotence du rattachement. */
  orderId: number;
  itemId: number;
  /** Libellé du tarif tel qu'il figure sur la billetterie. */
  tierLabel: string;
  /** En CENTIMES, comme HelloAsso les expose. 30 € vaut 3000. */
  amountCents: number;
  /** Le payeur n'est pas forcément le joueur (parent, coach, structure). */
  payerName: string;
  payerEmail: string;
  at?: unknown;
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

/**
 * Contrôle de forme d'une adresse e-mail.
 *
 * Volontairement permissif : le but n'est pas de prouver que l'adresse existe
 * — seul un envoi le dirait — mais d'écarter les saisies qui ne peuvent
 * manifestement pas en être une. Un contrôle trop zélé rejette des adresses
 * parfaitement valides et bloque un joueur à la dernière étape.
 */
export function isPlausibleEmail(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 5 || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(value);
}

/**
 * Numéro de téléphone : on garde ce que la personne a tapé, on vérifie
 * seulement qu'il reste assez de chiffres pour que ce soit appelable. Les
 * formats varient (indicatif, espaces, points) et les normaliser ferait perdre
 * de l'information utile au moment d'appeler.
 */
export function isPlausiblePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
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
const CODE_BODY_LENGTH = 4;
const CODE_PREFIX = 'LAN';

export function generateRegistrationCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_BODY_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return `${CODE_PREFIX}-${out}`;
}

/**
 * Remet en forme un code recopié à la main dans le formulaire HelloAsso.
 *
 * Le payeur tape ce qu'il croit lire : minuscules, espaces, tiret oublié,
 * préfixe absent ou doublé, parfois le tout à la fois. Refuser « lan 4b2c »
 * alors qu'on sait parfaitement de quel dossier il s'agit obligerait
 * l'organisation à rattacher à la main un paiement parfaitement lisible.
 *
 * Renvoie la forme canonique `LAN-XXXX`, ou null si l'entrée ne peut pas être
 * un code : longueur inattendue, ou caractère que le générateur n'emploie
 * jamais (I, O, 0 et 1 sont exclus de l'alphabet justement pour éviter les
 * confusions de lecture — les rencontrer signifie que la saisie est fautive,
 * et rien ne permet de deviner ce que la personne avait sous les yeux).
 */
export function normalizeRegistrationCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;

  // Le préfixe est facultatif à la saisie, et certains le doublent en le
  // recopiant par-dessus un champ pré-rempli.
  let body = cleaned;
  while (body.startsWith(CODE_PREFIX) && body.length > CODE_BODY_LENGTH) {
    body = body.slice(CODE_PREFIX.length);
  }

  if (body.length !== CODE_BODY_LENGTH) return null;
  for (const ch of body) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return `${CODE_PREFIX}-${body}`;
}

/** Distance de Levenshtein, bornée : au-delà de `max` on arrête de compter. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Codes connus qui ressemblent à une saisie fautive, à une lettre près.
 *
 * Sert à PROPOSER un rattachement à l'organisation, jamais à en décider : deux
 * dossiers peuvent être à distance 1 l'un de l'autre, et confirmer d'autorité
 * reviendrait à créditer un joueur du paiement d'un autre. La décision reste
 * humaine, en un clic.
 */
export function suggestRegistrationCodes(raw: string, known: readonly string[]): string[] {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = cleaned.startsWith(CODE_PREFIX) ? cleaned.slice(CODE_PREFIX.length) : cleaned;
  if (!body) return [];
  return known
    .filter((code) => {
      const other = code.startsWith(`${CODE_PREFIX}-`) ? code.slice(CODE_PREFIX.length + 1) : code;
      return editDistance(body, other, 1) <= 1;
    })
    .slice(0, 5);
}

/**
 * Collection réservataire des codes d'inscription : un document par code, dont
 * l'identifiant EST le code.
 *
 * Le générateur tire au hasard dans 32^4 possibilités ; sur 64 joueurs la
 * probabilité de collision est faible mais réelle, et une collision ferait
 * exactement ce que le code est censé rendre impossible — rattacher un
 * règlement au mauvais dossier. Créer le document en transaction rend le tirage
 * atomique : deux inscriptions simultanées ne peuvent pas repartir avec le même
 * code.
 */
export const MANIA_CUP_CODES = 'mania_cup_codes';

/** `discord_123456789` → `123456789`. Null pour tout autre format d'uid. */
export function discordIdFromUid(uid: string): string | null {
  const m = /^discord_(\d+)$/.exec(uid);
  return m ? m[1] : null;
}
