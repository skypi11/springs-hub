import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import {
  MANIA_CUP_CODES,
  MANIA_CUP_REGISTRATIONS,
  generateRegistrationCode,
  normalizeRegistrationCode,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';
import { getStructuresForGame } from '@/lib/structure-membership';

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

/** À quelle écurie et à quelle équipe appartient un inscrit. */
export interface Appartenance {
  /** Nom de la structure, tag court s'il existe (« Nyxar Esport », « NYX »). */
  structure: string;
  tag: string | null;
  /** Équipe au sein de la structure, si le joueur est dans un roster. */
  team: string | null;
}

/**
 * L'appartenance Trackmania des inscrits à la LAN.
 *
 * La billetterie ne connaît que des personnes ; l'accueil du 3 octobre, lui,
 * voit arriver des écuries. Sans ce rapprochement, l'organisation ne savait pas
 * que trois inscrits venaient du même club, et le badge ne pouvait pas le dire.
 *
 * Deux lectures, quel que soit le nombre d'inscrits : les structures citées par
 * les profils, et les équipes Trackmania. On ne fait AUCUNE requête par joueur.
 *
 * `profils` est la liste déjà chargée par l'appelant — la console lit ces
 * documents de toute façon, autant ne pas les relire.
 */
export async function lireAppartenancesTM(
  db: Firestore,
  profils: { id: string; data(): Record<string, unknown> | undefined }[]
): Promise<Map<string, Appartenance>> {
  const structureIdsParUid = new Map<string, string[]>();
  const tousLesIds = new Set<string>();
  for (const p of profils) {
    const ids = getStructuresForGame(
      p.data()?.structurePerGame as Record<string, string | string[]> | undefined,
      'trackmania'
    );
    if (ids.length === 0) continue;
    structureIdsParUid.set(p.id, ids);
    for (const id of ids) tousLesIds.add(id);
  }
  if (tousLesIds.size === 0) return new Map();

  const [structDocs, teamsSnap] = await Promise.all([
    db.getAll(...Array.from(tousLesIds).map((id) => db.collection('structures').doc(id))),
    // Volume borné : ce sont les équipes Trackmania de TOUT le site, et une
    // écurie en compte quelques-unes. Le cap évite un balayage incontrôlé si le
    // jeu décolle.
    db.collection('sub_teams').where('game', '==', 'trackmania').limit(500).get(),
  ]);

  const structures = new Map(
    structDocs
      .filter((d) => d.exists)
      .map((d) => [d.id, d.data() as { name?: string; tag?: string; status?: string }])
  );

  // uid → nom d'équipe. Un joueur n'a qu'une équipe par jeu (règle du site) ;
  // si le cas se présentait quand même, la première rencontrée fait foi.
  const equipeParUid = new Map<string, string>();
  for (const doc of teamsSnap.docs) {
    const t = doc.data() as { name?: string; playerIds?: string[]; subIds?: string[]; status?: string };
    if (t.status === 'archived') continue;
    for (const id of [...(t.playerIds ?? []), ...(t.subIds ?? [])]) {
      if (id && !equipeParUid.has(id)) equipeParUid.set(id, t.name ?? '');
    }
  }

  const out = new Map<string, Appartenance>();
  for (const [uid, ids] of structureIdsParUid) {
    // Une structure retirée ou refusée ne dit plus rien de l'appartenance.
    const vivantes = ids
      .map((id) => structures.get(id))
      .filter((s): s is { name?: string; tag?: string; status?: string } =>
        Boolean(s) && s?.status !== 'archived' && s?.status !== 'rejected'
      );
    if (vivantes.length === 0) continue;
    const s = vivantes[0];
    out.set(uid, {
      structure: s.name?.trim() || '',
      tag: s.tag?.trim() || null,
      team: equipeParUid.get(uid)?.trim() || null,
    });
  }
  return out;
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
