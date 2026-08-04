import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import {
  MANIA_CUP_CODES,
  MANIA_CUP_REGISTRATIONS,
  generateRegistrationCode,
  normalizeRegistrationCode,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

// Attribution et lecture des codes d'inscription, côté serveur.
//
// Le code est la clé qui relie un règlement encaissé sur HelloAsso à un dossier
// sur Aedral. Deux exigences en découlent, et elles ne se négocient pas :
// il doit être UNIQUE (sinon un paiement crédite le mauvais joueur), et il doit
// se retrouver en une lecture (le webhook n'a que quelques secondes, et une
// requête `where` sur la collection coûterait une lecture par dossier).
//
// D'où la collection réservataire `mania_cup_codes/{CODE}` : l'identifiant du
// document EST le code. Firestore garantit alors l'unicité par construction, et
// la recherche inverse « quel dossier porte ce code ? » devient un simple accès
// par identifiant.

/** Combien de tirages avant d'abandonner. Avec 32^4 possibilités et quelques
 *  dizaines de dossiers, dix candidats sans un seul libre relève de la panne,
 *  pas de la malchance. */
const MAX_ATTEMPTS = 10;

export interface CodeReservation {
  uid: string;
  createdAt?: unknown;
}

/**
 * Réserve un code libre pour ce joueur, ou rend celui qu'il possède déjà.
 *
 * Toute la manœuvre tient dans une transaction : on lit d'abord une poignée de
 * candidats, puis on écrit le premier qui n'appartient à personne. Deux
 * inscriptions déposées à la même seconde ne peuvent donc pas se voir attribuer
 * le même code — la seconde transaction rejouera et prendra le suivant.
 */
export async function allocateRegistrationCode(
  db: Firestore,
  uid: string,
  random: () => number = Math.random
): Promise<string> {
  return db.runTransaction(async (tx) => {
    // Un joueur garde son code d'une visite à l'autre : il a pu le
    // communiquer à son accompagnant, voire l'avoir déjà saisi sur HelloAsso.
    const regRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(uid);
    const regSnap = await tx.get(regRef);
    const existing = (regSnap.data() as ManiaCupRegistration | undefined)?.registrationCode;
    if (existing) {
      const codeRef = db.collection(MANIA_CUP_CODES).doc(existing);
      const codeSnap = await tx.get(codeRef);
      const owner = codeSnap.exists ? (codeSnap.data() as CodeReservation).uid : null;

      if (owner === uid) return existing;

      // Libre : soit le dossier est antérieur à la collection réservataire,
      // soit le joueur s'était retiré et son code est retourné au pot. On le
      // reprend.
      if (!codeSnap.exists) {
        tx.set(codeRef, { uid, createdAt: FieldValue.serverTimestamp() });
        return existing;
      }

      // Le code appartient désormais à quelqu'un d'autre : il a été libéré par
      // un retrait puis retiré au sort par un autre joueur. On ne le lui prend
      // pas — ce joueur-ci repart avec un code neuf.
    }

    // Firestore impose que toutes les lectures d'une transaction précèdent ses
    // écritures : on tire donc les candidats d'un coup, puis on choisit.
    const candidates = Array.from({ length: MAX_ATTEMPTS }, () => generateRegistrationCode(random));
    const refs = candidates.map((c) => db.collection(MANIA_CUP_CODES).doc(c));
    const snaps = await tx.getAll(...refs);

    const freeIndex = snaps.findIndex((s) => !s.exists);
    if (freeIndex === -1) {
      throw new Error('mania-cup: aucun code libre après 10 tirages');
    }

    const code = candidates[freeIndex];
    tx.set(refs[freeIndex], { uid, createdAt: FieldValue.serverTimestamp() });
    return code;
  });
}

/**
 * Rend un code au pot commun. Silencieux si le code appartient à quelqu'un
 * d'autre : une suppression aveugle libérerait la clé d'un dossier actif.
 */
export async function releaseRegistrationCode(
  db: Firestore,
  code: string | null | undefined,
  uid: string
): Promise<void> {
  const normalized = normalizeRegistrationCode(code);
  if (!normalized) return;
  const ref = db.collection(MANIA_CUP_CODES).doc(normalized);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    if ((snap.data() as CodeReservation).uid !== uid) return;
    tx.delete(ref);
  });
}

/**
 * Quel dossier porte ce code ? Renvoie null si le code est illisible ou
 * inconnu — c'est le cas nominal d'un paiement à rattacher à la main.
 */
export async function findUidByRegistrationCode(
  db: Firestore,
  rawCode: string | null | undefined
): Promise<string | null> {
  const code = normalizeRegistrationCode(rawCode);
  if (!code) return null;
  const snap = await db.collection(MANIA_CUP_CODES).doc(code).get();
  if (!snap.exists) return null;
  return (snap.data() as CodeReservation).uid ?? null;
}
