import type { Firestore } from 'firebase-admin/firestore';
import {
  collectGameIdentities,
  describeMatches,
  identityDocId,
  isEntryActive,
  matchBlocksRegistration,
  type BanEvasionMatch,
  type BanEvasionUser,
  type BannedIdentityEntry,
  type GameIdentity,
} from '@/lib/ban-evasion';
import { createNotification } from '@/lib/notifications';
import type { SanctionScope } from '@/types/competitions';

// Le registre des comptes de jeu bannis.
//
// Pourquoi une collection à part plutôt qu'une lecture des comptes bannis :
//
//  1. Il SURVIT à la suppression du compte. C'est le point décisif — supprimer
//     le compte d'un banni effacerait sinon les empreintes avec lui, et la
//     personne reviendrait sans laisser de trace. Or supprimer un compte
//     problématique est exactement ce qu'on a envie de faire.
//  2. L'identifiant du document se déduit de l'empreinte, donc la question
//     « ce compte de jeu est-il banni ? » coûte une lecture directe par
//     empreinte — pas un balayage de la collection `users`, qui deviendrait
//     ruineux à quelques milliers de comptes.
//
// Un document = une empreinte. Il porte la LISTE des bannissements qui l'ont
// enregistrée : le même compte de jeu peut être banni du site puis, séparément,
// des compétitions. Lever l'un ne doit pas lever l'autre.

const COLLECTION = 'banned_identities';

interface IdentityDoc {
  type: string;
  identityId: string;
  entries: BannedIdentityEntry[];
}

export interface RegisterArgs {
  uid: string;
  /** Pseudo au moment du bannissement — le seul nom qui restera si le compte
   *  est supprimé ensuite. */
  label: string;
  reason: string;
  source: 'site' | 'competition';
  /** Portée, pour une sanction de compétition : elle décide plus tard quelles
   *  inscriptions l'empreinte interdit. */
  sanctionType?: 'ban' | 'exclusion' | null;
  scope?: SanctionScope | null;
  competitionId?: string | null;
  adminUid: string;
}

/** Lit le profil et renvoie ses empreintes. Renvoie [] si le compte n'existe
 *  plus — un bannissement peut suivre une suppression. */
async function identitiesOf(db: Firestore, uid: string): Promise<GameIdentity[]> {
  const snap = await db.collection('users').doc(uid).get().catch(() => null);
  if (!snap?.exists) return [];
  return collectGameIdentities(snap.data() as BanEvasionUser);
}

/**
 * Enregistre les empreintes de jeu d'un compte qu'on vient de bannir.
 *
 * Ne lève jamais : un bannissement ne doit pas échouer parce que le registre a
 * un problème. La porte se ferme d'abord, la trace se pose ensuite.
 */
export async function registerBannedIdentities(
  db: Firestore,
  args: RegisterArgs,
): Promise<{ registered: number }> {
  try {
    const identities = await identitiesOf(db, args.uid);
    if (identities.length === 0) return { registered: 0 };

    const entry: BannedIdentityEntry = {
      uid: args.uid,
      label: args.label,
      reason: args.reason,
      source: args.source,
      sanctionType: args.sanctionType ?? null,
      scope: args.scope ?? null,
      competitionId: args.competitionId ?? null,
      // `serverTimestamp()` est interdit dans un tableau. La date fait foi pour
      // l'affichage ; le journal d'administration, lui, garde l'heure serveur.
      createdAt: new Date().toISOString(),
      createdBy: args.adminUid,
      revokedAt: null,
      revokedBy: null,
    };

    await Promise.all(
      identities.map((identity) =>
        db.runTransaction(async (tx) => {
          const ref = db.collection(COLLECTION).doc(identityDocId(identity));
          const snap = await tx.get(ref);
          const doc = (snap.data() as IdentityDoc | undefined) ?? {
            type: identity.type,
            identityId: identity.id,
            entries: [],
          };
          // Rejouer un bannissement ne doit pas empiler des doublons : on
          // remplace l'entrée du même compte et de la même origine.
          const entries = (doc.entries ?? []).filter(
            (e) => !(e.uid === args.uid && e.source === args.source && e.competitionId === entry.competitionId),
          );
          entries.push(entry);
          tx.set(ref, { ...doc, type: identity.type, identityId: identity.id, entries });
        }),
      ),
    );

    return { registered: identities.length };
  } catch {
    return { registered: 0 };
  }
}

/**
 * Lève les empreintes posées par un bannissement — débannissement, ou sanction
 * révoquée. On ne SUPPRIME rien : l'entrée est horodatée comme levée, comme
 * partout ailleurs dans le projet, pour que l'historique reste lisible.
 *
 * La levée est ciblée : lever le ban du site laisse en place un éventuel
 * bannissement de compétition sur la même empreinte.
 */
export async function revokeBannedIdentities(
  db: Firestore,
  args: { uid: string; source: 'site' | 'competition'; competitionId?: string | null; adminUid: string },
): Promise<void> {
  try {
    // On repart des empreintes ACTUELLES du compte, mais aussi de celles que le
    // registre lui attribue : le joueur a pu délier un compte de jeu entre
    // temps, et son empreinte doit tout de même se lever.
    const [courantes, snap] = await Promise.all([
      identitiesOf(db, args.uid),
      db.collection(COLLECTION).get(),
    ]);
    const cibles = new Set(courantes.map((i) => identityDocId(i)));
    for (const d of snap.docs) {
      const doc = d.data() as IdentityDoc;
      if ((doc.entries ?? []).some((e) => e.uid === args.uid)) cibles.add(d.id);
    }

    const maintenant = new Date().toISOString();
    await Promise.all(
      Array.from(cibles).map((docId) =>
        db.runTransaction(async (tx) => {
          const ref = db.collection(COLLECTION).doc(docId);
          const s = await tx.get(ref);
          if (!s.exists) return;
          const doc = s.data() as IdentityDoc;
          const entries = (doc.entries ?? []).map((e) =>
            e.uid === args.uid
              && e.source === args.source
              && (args.competitionId === undefined || e.competitionId === args.competitionId)
              && !e.revokedAt
              ? { ...e, revokedAt: maintenant, revokedBy: args.adminUid }
              : e,
          );
          tx.set(ref, { ...doc, entries });
        }),
      ),
    );
  } catch {
    /* Une levée qui échoue ne doit pas faire échouer le débannissement. */
  }
}

/**
 * Ces comptes partagent-ils un compte de jeu avec quelqu'un de banni ?
 *
 * LE point de lecture du registre — tout le reste passe par ici. Une seule
 * lecture groupée quel que soit le nombre de comptes examinés, et zéro lecture
 * si aucun n'a relié de jeu. Aucune requête, aucun index : les identifiants de
 * document se déduisent des empreintes.
 */
export async function findBanEvasionForUsers(
  db: Firestore,
  users: (BanEvasionUser & { uid: string })[],
): Promise<Map<string, BanEvasionMatch[]>> {
  const out = new Map<string, BanEvasionMatch[]>();
  const parDoc = new Map<string, { uid: string; identity: GameIdentity }[]>();
  for (const user of users) {
    if (!user?.uid) continue;
    for (const identity of collectGameIdentities(user)) {
      const docId = identityDocId(identity);
      if (!parDoc.has(docId)) parDoc.set(docId, []);
      parDoc.get(docId)!.push({ uid: user.uid, identity });
    }
  }
  if (parDoc.size === 0) return out;

  const docIds = Array.from(parDoc.keys());
  const snaps = await db.getAll(...docIds.map((d) => db.collection(COLLECTION).doc(d))).catch(() => null);
  if (!snaps) return out;

  snaps.forEach((snap, idx) => {
    if (!snap.exists) return;
    const doc = snap.data() as IdentityDoc;
    for (const { uid, identity } of parDoc.get(docIds[idx]) ?? []) {
      for (const entry of doc.entries ?? []) {
        // Un banni se reconnaît évidemment lui-même : ce n'est pas une évasion.
        if (entry.uid === uid) continue;
        if (!isEntryActive(entry)) continue;
        const liste = out.get(uid) ?? [];
        liste.push({ identity, entry });
        out.set(uid, liste);
      }
    }
  });

  // Les empreintes fortes d'abord : c'est la première que lira un humain, et
  // c'est la seule qui peut justifier un blocage.
  for (const [uid, liste] of out) {
    out.set(uid, liste.sort((a, b) => Number(b.identity.strong) - Number(a.identity.strong)));
  }
  return out;
}

/** Un seul compte. */
export async function findBanEvasionMatches(
  db: Firestore,
  user: (BanEvasionUser & { uid: string }) | null | undefined,
): Promise<BanEvasionMatch[]> {
  if (!user?.uid) return [];
  const map = await findBanEvasionForUsers(db, [user]);
  return map.get(user.uid) ?? [];
}

/**
 * Le roster d'une équipe contient-il quelqu'un qui revient sous un autre
 * compte Discord ?
 *
 * Ne renvoie QUE ce qui interdit vraiment cette inscription-là — empreinte
 * forte, sanction en vigueur, portée qui couvre la compétition visée. Le reste
 * (signaux faibles, exclusion d'un autre tournoi) ne remonte pas ici : ça
 * relève de l'alerte, pas du refus.
 */
export async function findBlockingEvasionForRoster(
  db: Firestore,
  args: {
    users: (BanEvasionUser & { uid: string; label: string })[];
    competitionId: string;
    circuitId?: string | null;
  },
): Promise<{ uid: string; label: string; match: BanEvasionMatch }[]> {
  const map = await findBanEvasionForUsers(db, args.users);
  const out: { uid: string; label: string; match: BanEvasionMatch }[] = [];
  for (const user of args.users) {
    for (const match of map.get(user.uid) ?? []) {
      if (!matchBlocksRegistration(match, { competitionId: args.competitionId, circuitId: args.circuitId })) continue;
      out.push({ uid: user.uid, label: user.label, match });
    }
  }
  return out;
}

/** Version par uid, quand on n'a pas le profil sous la main. */
export async function findBanEvasionMatchesByUid(db: Firestore, uid: string): Promise<BanEvasionMatch[]> {
  const snap = await db.collection('users').doc(uid).get().catch(() => null);
  if (!snap?.exists) return [];
  return findBanEvasionMatches(db, { ...(snap.data() as BanEvasionUser), uid });
}

/**
 * Contrôle à la connexion.
 *
 * On ne BLOQUE pas — décision prise avec Matt le 16/08. Un blocage au login
 * serait invisible pour l'organisation, alors que c'est justement
 * l'information qu'elle cherche ; et un compte de jeu peut être partagé entre
 * frères, ou revendu. On marque, on prévient, un humain tranche.
 *
 * L'alerte ne part que lorsque le verdict CHANGE : sans ça, chaque connexion
 * du même compte re-notifierait toute l'administration, qui finirait par ne
 * plus les lire.
 */
export async function checkBanEvasionOnLogin(
  db: Firestore,
  uid: string,
): Promise<{ matches: BanEvasionMatch[]; alerted: boolean }> {
  try {
    const [snap, flagsSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('user_admin_flags').doc(uid).get(),
    ]);
    if (!snap.exists) return { matches: [], alerted: false };
    const user = snap.data() as BanEvasionUser & { displayName?: string; discordUsername?: string };
    const matches = await findBanEvasionMatches(db, { ...user, uid });

    const dejaVu = new Set((flagsSnap.data()?.banEvasionMatchedUids as string[]) ?? []);
    const trouves = Array.from(new Set(matches.map((m) => m.entry.uid)));
    const nouveaux = trouves.filter((u) => !dejaVu.has(u));

    // Dans `user_admin_flags`, JAMAIS sur le profil : `users` est lisible par
    // tout compte connecté, donc y écrire ce drapeau reviendrait à dire à
    // l'intéressé qu'on l'a reconnu — et par quoi. Cette collection-ci est en
    // `allow read, write: if false` : Admin SDK uniquement.
    await db.collection('user_admin_flags').doc(uid).set(
      {
        banEvasionSuspected: matches.length > 0,
        banEvasionMatchedUids: trouves,
        banEvasionCheckedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    if (nouveaux.length === 0) return { matches, alerted: false };

    const label = user.displayName || user.discordUsername || uid;
    await alertAdminsOfBanEvasion(db, {
      uid,
      label,
      message: describeMatches(matches),
      link: '/admin/moderation',
    });
    return { matches, alerted: true };
  } catch {
    // Un contrôle qui échoue ne doit JAMAIS empêcher quelqu'un de se
    // connecter : ce serait transformer une alerte en panne d'authentification.
    return { matches: [], alerted: false };
  }
}

/**
 * Prévient les administrateurs. Jamais le joueur : lui dire ce qu'on a
 * reconnu, c'est lui expliquer quoi délier pour passer au travers la prochaine
 * fois.
 */
export async function alertAdminsOfBanEvasion(
  db: Firestore,
  args: { uid: string; label: string; message: string; link?: string },
): Promise<void> {
  try {
    const admins = await db.collection('aedral_admins').get();
    if (admins.empty) return;
    await Promise.all(
      admins.docs.map((doc) =>
        createNotification(db, {
          userId: doc.id,
          type: 'ban_evasion_suspected',
          title: 'Contournement de bannissement probable',
          message: `${args.label} — ${args.message}`,
          link: args.link ?? `/admin/users?q=${encodeURIComponent(args.label)}`,
          metadata: { uid: args.uid },
        }).catch(() => {}),
      ),
    );
  } catch {
    /* Une alerte perdue ne doit rien casser en amont. */
  }
}
