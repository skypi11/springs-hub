import type { Firestore } from 'firebase-admin/firestore';
import { MANIA_CUP } from '@/lib/mania-cup';
import { MANIA_CUP_FAQ_COLLECTION } from '@/lib/mania-cup-faq';

// Réglages modifiables de la Springs Mania Cup : tarifs, jauge, dotation, liens
// de billetterie.
//
// Ces valeurs vivaient dans les constantes du code. Or un tarif change — une
// remise négociée, un cashprize revu à la hausse quand un sponsor s'ajoute —
// et Matt ne code pas : les y laisser lui imposait un déploiement pour corriger
// un chiffre. Les constantes ne servent plus que de valeurs par défaut, quand
// rien n'a encore été enregistré.

export const MANIA_CUP_SETTINGS_DOC = 'settings';

export interface ManiaCupSettings {
  // Billetterie HelloAsso, un lien par tarif
  ticketingPlayerUrl: string;
  ticketingSpectatorUrl: string;
  ticketingCompanionUrl: string;
  ticketingPcRentalUrl: string;
  /**
   * Correspondance entre les tarifs de la billetterie et nos catégories, au
   * format JSON `{"<identifiant ou libellé>": "player" | "companion" | …}`.
   *
   * Elle vit ici plutôt que dans une variable d'environnement parce qu'elle
   * n'est connue qu'APRÈS la création de la billetterie : la console propose
   * de lire les tarifs chez HelloAsso et d'associer chacun en un clic, sans
   * redéploiement ni recopie d'identifiants à la main.
   */
  helloAssoTierMap: string;
  /** Libellé exact du champ personnalisé qui porte le code d'inscription. */
  helloAssoCodeField: string;
  // Tarifs et jauge
  priceEuros: number;
  /** Billet public, valable les deux jours. */
  spectatorEuros: number;
  companionEuros: number;
  /** Zéro tant que le prix n'est pas arrêté : les boutons restent alors muets
   *  plutôt que d'annoncer une location à 0 €. */
  pcRentalEuros: number;
  prizePoolEuros: number;
  maxPlayers: number;
}

export const DEFAULT_SETTINGS: ManiaCupSettings = {
  ticketingPlayerUrl: '',
  ticketingSpectatorUrl: '',
  ticketingCompanionUrl: '',
  ticketingPcRentalUrl: '',
  helloAssoTierMap: '',
  helloAssoCodeField: 'Code d’inscription',
  priceEuros: MANIA_CUP.priceEuros,
  spectatorEuros: MANIA_CUP.spectatorEuros,
  companionEuros: MANIA_CUP.companionEuros,
  pcRentalEuros: 0,
  prizePoolEuros: MANIA_CUP.prizePoolEuros,
  maxPlayers: MANIA_CUP.maxPlayers,
};

/** Bornes de saisie. La jauge a un plancher à 1 : une valeur à zéro fermerait
 *  l'événement sans que personne comprenne pourquoi. */
export const SETTINGS_BOUNDS = {
  priceEuros: { min: 0, max: 500 },
  spectatorEuros: { min: 0, max: 500 },
  companionEuros: { min: 0, max: 500 },
  pcRentalEuros: { min: 0, max: 500 },
  prizePoolEuros: { min: 0, max: 100_000 },
  maxPlayers: { min: 1, max: 512 },
} as const;

export type NumericSettingKey = keyof typeof SETTINGS_BOUNDS;

/** Normalise une valeur numérique venue de la base ou d'un formulaire.
 *  Toute saisie hors bornes ou non numérique retombe sur la valeur par défaut
 *  plutôt que d'écrire un tarif absurde sur la page publique. */
export function normalizeNumber(key: NumericSettingKey, raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS[key];
  const { min, max } = SETTINGS_BOUNDS[key];
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function mergeSettings(data: FirebaseFirestore.DocumentData | undefined): ManiaCupSettings {
  const d = data ?? {};
  return {
    ticketingPlayerUrl: (d.ticketingPlayerUrl as string) ?? '',
    ticketingSpectatorUrl: (d.ticketingSpectatorUrl as string) ?? '',
    ticketingCompanionUrl: (d.ticketingCompanionUrl as string) ?? '',
    ticketingPcRentalUrl: (d.ticketingPcRentalUrl as string) ?? '',
    helloAssoTierMap: (d.helloAssoTierMap as string) ?? '',
    helloAssoCodeField:
      (d.helloAssoCodeField as string) || DEFAULT_SETTINGS.helloAssoCodeField,
    pcRentalEuros:
      d.pcRentalEuros != null
        ? normalizeNumber('pcRentalEuros', d.pcRentalEuros)
        : DEFAULT_SETTINGS.pcRentalEuros,
    priceEuros: d.priceEuros != null ? normalizeNumber('priceEuros', d.priceEuros) : DEFAULT_SETTINGS.priceEuros,
    spectatorEuros:
      d.spectatorEuros != null
        ? normalizeNumber('spectatorEuros', d.spectatorEuros)
        : DEFAULT_SETTINGS.spectatorEuros,
    companionEuros:
      d.companionEuros != null
        ? normalizeNumber('companionEuros', d.companionEuros)
        : DEFAULT_SETTINGS.companionEuros,
    prizePoolEuros:
      d.prizePoolEuros != null
        ? normalizeNumber('prizePoolEuros', d.prizePoolEuros)
        : DEFAULT_SETTINGS.prizePoolEuros,
    maxPlayers:
      d.maxPlayers != null ? normalizeNumber('maxPlayers', d.maxPlayers) : DEFAULT_SETTINGS.maxPlayers,
  };
}

/** Lecture serveur. Ne lève jamais : une panne Firestore doit dégrader vers les
 *  valeurs par défaut, pas faire tomber la page publique de l'événement. */
export async function getManiaCupSettings(db: Firestore): Promise<ManiaCupSettings> {
  try {
    const snap = await db.collection(MANIA_CUP_FAQ_COLLECTION).doc(MANIA_CUP_SETTINGS_DOC).get();
    return mergeSettings(snap.data());
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Formatage des montants, pour que la page et la console affichent pareil. */
export function euros(n: number): string {
  return `${n.toLocaleString('fr-FR')} €`;
}
