import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { MANIA_CUP_REGISTRATIONS } from '@/lib/mania-cup';
import { isCompetitionAdmin } from '@/lib/firebase-admin';
import { encodePolyline } from '@/lib/carpool';
import type { CarpoolEvent, CarpoolTrip, GeoPoint, RouteGeometry, TripKind } from '@/lib/carpool';

// Le stockage des trajets, et la porte d'entrée.
//
// Doc id DÉTERMINISTE `${eventId}__${uid}` : « une seule fiche par personne »
// est garanti par la clé, sans transaction ni compteur — même motif que les
// inscriptions en compétition (`${competitionId}_${teamId}`). Reposer son
// trajet écrase le précédent, ce qui est exactement le comportement attendu :
// on corrige son point, on ne s'ajoute pas une deuxième fois sur la carte.

const COLLECTION = 'carpool_trips';

export function tripDocId(eventId: string, uid: string): string {
  return `${eventId}__${uid}`;
}

/**
 * Qui a le droit de voir la carte et d'y poser un trajet.
 *
 * Pour la Mania Cup : avoir une inscription qui tient encore. Le portail est
 * déjà exigeant en amont — compte Trackmania vérifié par OAuth Nadeo, membre
 * du Discord Springs, identité civile et date de naissance — donc ce n'est pas
 * une porte ouverte à un curieux de passage. Une inscription retirée ferme
 * l'accès : la personne ne vient plus.
 *
 * Les administrateurs voient tout, pour pouvoir modérer.
 */
export async function canParticipate(
  db: Firestore,
  ev: CarpoolEvent,
  uid: string,
): Promise<boolean> {
  if (ev.id === 'mania-cup') {
    const snap = await db.collection(MANIA_CUP_REGISTRATIONS).doc(uid).get();
    if (snap.exists && snap.data()?.status !== 'cancelled') return true;
  }
  return isCompetitionAdmin(uid);
}

/** Le pseudo sous lequel on se connaît à la LAN, avec de quoi joindre la
 *  personne. Le Trackmania d'abord : c'est le nom porté sur le badge. */
export interface TripAuthor {
  uid: string;
  displayName: string;
  slug: string | null;
  discordUsername: string | null;
}

export interface StoredTrip extends CarpoolTrip {
  author: TripAuthor;
  updatedAt: string | null;
}

/**
 * Le tracé d'un trajet, ancien format compris.
 *
 * Avant le 22/08, il était stocké en liste de nombres aplatie et SIMPLIFIÉ à
 * 500 m — ce qui faisait couper les virages. Les trajets déjà posés à cette
 * date n'ont pas de `polyline` : plutôt que de les faire disparaître de la
 * carte, on ré-encode ce qu'on a. Ils restent moins précis jusqu'à ce que leur
 * auteur les réenregistre, ce qui les recalcule entièrement.
 */
function lireTrace(brut: unknown): RouteGeometry | null {
  if (!brut || typeof brut !== 'object') return null;
  const r = brut as RouteGeometry & { coordinates?: unknown };
  if (typeof r.polyline === 'string' && r.polyline.length > 0) return r;

  const plat = Array.isArray(r.coordinates) ? (r.coordinates as unknown[]) : [];
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < plat.length; i += 2) {
    const lat = Number(plat[i]);
    const lng = Number(plat[i + 1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
  }
  if (points.length < 2) return null;
  return {
    polyline: encodePolyline(points),
    distanceM: Number(r.distanceM) || 0,
    durationS: Number(r.durationS) || 0,
    kind: r.kind === 'road' ? 'road' : 'straight',
  };
}

function readTrip(data: FirebaseFirestore.DocumentData): CarpoolTrip {
  return {
    eventId: data.eventId ?? '',
    uid: data.uid ?? '',
    kind: (data.kind as TripKind) ?? 'search',
    origin: data.origin as GeoPoint,
    waypoints: (data.waypoints as GeoPoint[]) ?? [],
    route: lireTrace(data.route),
    seats: Number(data.seats) || 1,
    departAt: data.departAt ?? null,
    returnAt: data.returnAt ?? null,
    note: data.note ?? '',
  };
}

/**
 * Tous les trajets d'un événement, avec l'identité de leur auteur.
 *
 * Deux lectures groupées quel que soit le nombre de trajets : les profils, et
 * les inscriptions pour le pseudo Trackmania. Aucune requête par joueur.
 */
export async function listTrips(db: Firestore, ev: CarpoolEvent): Promise<StoredTrip[]> {
  const snap = await db.collection(COLLECTION).where('eventId', '==', ev.id).get();
  if (snap.empty) return [];

  const uids = snap.docs.map((d) => (d.data().uid as string) ?? '').filter(Boolean);
  const [profils, inscriptions] = await Promise.all([
    db.getAll(...uids.map((u) => db.collection('users').doc(u))),
    ev.id === 'mania-cup'
      ? db.getAll(...uids.map((u) => db.collection(MANIA_CUP_REGISTRATIONS).doc(u)))
      : Promise.resolve([]),
  ]);
  const profilPar = new Map(profils.map((p) => [p.id, p.data() ?? {}]));
  const inscritPar = new Map(inscriptions.map((p) => [p.id, p.data() ?? {}]));

  return snap.docs.map((d) => {
    const data = d.data();
    const uid = (data.uid as string) ?? '';
    const u = profilPar.get(uid) ?? {};
    const reg = inscritPar.get(uid) ?? {};
    return {
      ...readTrip(data),
      author: {
        uid,
        // Le pseudo Trackmania d'abord : c'est celui du badge et des
        // conversations, et il n'a souvent rien à voir avec le pseudo Discord.
        displayName:
          (reg.tmDisplayName as string)
          || (u.pseudoTM as string)
          || (u.displayName as string)
          || (u.discordUsername as string)
          || uid,
        slug: ((u.slug as string) || '').trim() || null,
        discordUsername: ((u.discordUsername as string) || '').trim() || null,
      },
      updatedAt: (data.updatedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null,
    };
  });
}

/** Combien de trajets sont posés — le seul chiffre servi au visiteur non
 *  inscrit. Aucune position, aucun pseudo. */
export async function countTrips(db: Firestore, ev: CarpoolEvent): Promise<number> {
  const snap = await db.collection(COLLECTION).where('eventId', '==', ev.id).count().get();
  return snap.data().count;
}

export async function saveTrip(
  db: Firestore,
  ev: CarpoolEvent,
  uid: string,
  trip: Omit<CarpoolTrip, 'eventId' | 'uid'>,
): Promise<void> {
  await db.collection(COLLECTION).doc(tripDocId(ev.id, uid)).set(
    {
      ...trip,
      eventId: ev.id,
      uid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );
}

export async function deleteTrip(db: Firestore, eventId: string, uid: string): Promise<void> {
  await db.collection(COLLECTION).doc(tripDocId(eventId, uid)).delete();
}

/**
 * Purge après l'événement.
 *
 * Un trajet dit où quelqu'un se trouvait un jour donné : ça n'a plus aucune
 * raison d'être conservé une fois la LAN passée. Même principe que les
 * autorisations parentales.
 */
export async function purgeTrips(db: Firestore, eventId: string): Promise<number> {
  const snap = await db.collection(COLLECTION).where('eventId', '==', eventId).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}
