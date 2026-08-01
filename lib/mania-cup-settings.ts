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
  // Tarifs et jauge
  priceEuros: number;
  spectatorDayEuros: number;
  spectatorTwoDaysEuros: number;
  companionEuros: number;
  prizePoolEuros: number;
  maxPlayers: number;
}

export const DEFAULT_SETTINGS: ManiaCupSettings = {
  ticketingPlayerUrl: '',
  ticketingSpectatorUrl: '',
  ticketingCompanionUrl: '',
  priceEuros: MANIA_CUP.priceEuros,
  spectatorDayEuros: MANIA_CUP.spectatorDayEuros,
  spectatorTwoDaysEuros: MANIA_CUP.spectatorTwoDaysEuros,
  companionEuros: MANIA_CUP.companionEuros,
  prizePoolEuros: MANIA_CUP.prizePoolEuros,
  maxPlayers: MANIA_CUP.maxPlayers,
};

/** Bornes de saisie. La jauge a un plancher à 1 : une valeur à zéro fermerait
 *  l'événement sans que personne comprenne pourquoi. */
export const SETTINGS_BOUNDS = {
  priceEuros: { min: 0, max: 500 },
  spectatorDayEuros: { min: 0, max: 500 },
  spectatorTwoDaysEuros: { min: 0, max: 500 },
  companionEuros: { min: 0, max: 500 },
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
    priceEuros: d.priceEuros != null ? normalizeNumber('priceEuros', d.priceEuros) : DEFAULT_SETTINGS.priceEuros,
    spectatorDayEuros:
      d.spectatorDayEuros != null
        ? normalizeNumber('spectatorDayEuros', d.spectatorDayEuros)
        : DEFAULT_SETTINGS.spectatorDayEuros,
    spectatorTwoDaysEuros:
      d.spectatorTwoDaysEuros != null
        ? normalizeNumber('spectatorTwoDaysEuros', d.spectatorTwoDaysEuros)
        : DEFAULT_SETTINGS.spectatorTwoDaysEuros,
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
