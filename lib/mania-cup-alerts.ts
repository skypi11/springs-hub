import type { Firestore } from 'firebase-admin/firestore';
import { createNotification } from './notifications';
import { addMemberRole, removeMemberRole } from './discord-competition';
import { springsGuildId, discordIdFromUid } from './mania-cup';
import { getManiaCupSettings } from './mania-cup-settings';

/**
 * Ce que l'organisation apprend, et ce que le joueur reçoit sur Discord.
 *
 * CE QUI MANQUAIT. Personne n'était prévenu quand quelqu'un s'inscrivait : ni
 * sur le site, ni dans la console, ni sur Discord. Le seul signal existant
 * concernait les règlements QUI ÉCHOUENT à se rattacher — on alertait sur les
 * ennuis, jamais sur la bonne nouvelle. Pour savoir qu'une place venait de
 * partir, il fallait penser à ouvrir la console.
 *
 * Deux moments distincts, et c'est volontaire :
 *   · le dossier déposé — quelqu'un s'engage, rien n'est encore payé ;
 *   · le règlement encaissé — la place est PRISE, c'est celui qui compte.
 *
 * Rien ici ne doit jamais faire échouer ce qui l'a déclenché. Une inscription
 * ne se perd pas parce que Discord répond mal : tout est en `catch` côté
 * appelant, et les fonctions renvoient un compte rendu au lieu de lever.
 */

const DISCORD_API = 'https://discord.com/api/v10';

/** Un message simple dans un salon. Les embeds riches ont leurs fonctions
 *  dédiées ; ici on veut une ligne lisible dans un salon de staff. */
async function posterDansSalon(
  channelId: string,
  contenu: string
): Promise<{ ok: boolean; raison?: string }> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return { ok: false, raison: 'bot_token_absent' };
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
    body: JSON.stringify({
      content: contenu.slice(0, 1900),
      // Un salon de staff n'a pas à réveiller tout le serveur.
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) {
    const corps = await res.text().catch(() => '');
    return { ok: false, raison: `post_${res.status}: ${corps.slice(0, 120)}` };
  }
  return { ok: true };
}

/**
 * Ce dossier est-il un dossier de TEST ?
 *
 * La base Firestore est partagée entre le développement et la production : les
 * scripts de bout en bout déposent donc de vraies inscriptions, qu'ils nettoient
 * ensuite. Mais un message Discord, lui, ne se nettoie pas — et le 12 août, six
 * lignes « E2E_p1 a déposé son inscription » sont arrivées dans le salon
 * d'inscription de Springs, sous les yeux de tout le staff.
 *
 * `isDev` est la convention du dépôt pour les données fictives (bac à sable des
 * compétitions, messages ciblés, rappels quotidiens). Elle s'applique désormais
 * aussi ici. Une lecture par alerte : c'est un événement rare, et le prix d'une
 * fausse alerte au staff est bien plus élevé.
 */
export async function estDossierDeTest(db: Firestore, uid: string | undefined): Promise<boolean> {
  if (!uid) return false;
  const snap = await db.collection('users').doc(uid).get().catch(() => null);
  return snap?.data()?.isDev === true;
}

/** Prévient tous les administrateurs Aedral, sur le site. */
async function prevenirLesAdmins(
  db: Firestore,
  payload: { titre: string; message: string }
): Promise<void> {
  const admins = await db.collection('aedral_admins').get().catch(() => null);
  if (!admins || admins.empty) return;
  await Promise.all(
    admins.docs.map((doc) =>
      createNotification(db, {
        userId: doc.id,
        type: 'mania_cup_registration',
        title: payload.titre,
        message: payload.message,
        link: '/admin/mania-cup',
      }).catch(() => {})
    )
  );
}

export type EvenementInscription = {
  /** Pseudo Trackmania, ou à défaut l'identité civile. */
  qui: string;
  /** Le dossier concerné. Sert à taire les alertes des comptes de test. */
  uid?: string;
  /** Places réglées après l'événement, et total. */
  placesReglees?: number;
  placesTotales?: number;
};

/** Un dossier vient d'être déposé — rien n'est encore payé. */
export async function alerterDossierDepose(
  db: Firestore,
  e: EvenementInscription
): Promise<void> {
  if (await estDossierDeTest(db, e.uid)) return;
  const titre = 'Mania Cup — nouveau dossier';
  const message = `${e.qui} vient de déposer son inscription. En attente de règlement.`;
  await prevenirLesAdmins(db, { titre, message });

  const { staffChannelId } = await getManiaCupSettings(db);
  if (staffChannelId) {
    await posterDansSalon(staffChannelId, `📩 **${e.qui}** a déposé son inscription — en attente de règlement.`)
      .catch(() => ({ ok: false }));
  }
}

/** Une place vient d'être prise. C'est l'événement qui compte. */
export async function alerterPlacePrise(
  db: Firestore,
  e: EvenementInscription
): Promise<void> {
  if (await estDossierDeTest(db, e.uid)) return;
  const jauge =
    e.placesReglees != null && e.placesTotales != null
      ? ` ${e.placesReglees}/${e.placesTotales} places réglées.`
      : '';
  const titre = 'Mania Cup — place réglée';
  const message = `${e.qui} a réglé son inscription.${jauge}`;
  await prevenirLesAdmins(db, { titre, message });

  const { staffChannelId } = await getManiaCupSettings(db);
  if (staffChannelId) {
    const restantes =
      e.placesReglees != null && e.placesTotales != null
        ? ` · **${Math.max(0, e.placesTotales - e.placesReglees)}** place(s) restante(s)`
        : '';
    await posterDansSalon(
      staffChannelId,
      `✅ **${e.qui}** a réglé son inscription à la Springs Mania Cup${restantes}`
    ).catch(() => ({ ok: false }));
  }
}

/**
 * Un siège revient à la vente : le salon qui annonce les places qui PARTENT
 * doit annoncer celles qui reviennent.
 *
 * Sans ça, une place libérée par un remboursement n'existait nulle part : la
 * liste d'attente n'avance que si quelqu'un clique « Passer au suivant », et
 * personne ne savait qu'il fallait le faire.
 */
export async function alerterPlaceLiberee(
  db: Firestore,
  e: EvenementInscription & { motif: string; quoi: 'place' | 'location' | 'accompagnant' }
): Promise<void> {
  if (await estDossierDeTest(db, e.uid)) return;

  const { staffChannelId } = await getManiaCupSettings(db);
  if (!staffChannelId) return;

  const quoi =
    e.quoi === 'place'
      ? 'sa place'
      : e.quoi === 'location'
        ? 'sa location de poste'
        : 'un billet accompagnant';
  const rappel =
    e.quoi === 'place'
      ? ' · un siège est à réattribuer — pense à la liste d’attente'
      : '';

  await posterDansSalon(
    staffChannelId,
    `↩️ **${e.qui}** perd ${quoi} — ${e.motif}.${rappel}\n` +
      `« Annulé » chez HelloAsso ne prouve pas que l’argent est reparti : vérifie la commande avant d’inviter quelqu’un d’autre.`
  ).catch(() => ({ ok: false }));
}

export type ResultatRole =
  | { ok: true }
  | { ok: false; raison: 'role_non_configure' | 'pas_de_discord' | 'pas_membre' | 'role_introuvable' | 'erreur' };

/**
 * Donne le rôle des inscrits sur le Discord de Springs E-Sport.
 *
 * `notMember` n'est PAS une erreur à crier : un joueur peut régler son
 * inscription avant d'avoir rejoint le serveur. Le rôle lui sera donné au
 * rattrapage, depuis la console — d'où le compte rendu détaillé plutôt qu'un
 * simple booléen.
 */
export async function donnerRoleInscrit(
  db: Firestore,
  uid: string
): Promise<ResultatRole> {
  // Un compte de test n'a rien à faire sur le vrai serveur de Springs.
  if (await estDossierDeTest(db, uid)) return { ok: false, raison: 'pas_de_discord' };
  const { participantRoleId } = await getManiaCupSettings(db);
  if (!participantRoleId) return { ok: false, raison: 'role_non_configure' };

  const discordId = discordIdFromUid(uid);
  if (!discordId) return { ok: false, raison: 'pas_de_discord' };

  try {
    const r = await addMemberRole(springsGuildId(), discordId, participantRoleId);
    if (r.ok) return { ok: true };
    if (r.staleRole) return { ok: false, raison: 'role_introuvable' };
    return { ok: false, raison: 'pas_membre' };
  } catch {
    return { ok: false, raison: 'erreur' };
  }
}

/** Retire le rôle — inscription retirée, ou règlement défait. */
export async function retirerRoleInscrit(db: Firestore, uid: string): Promise<void> {
  const { participantRoleId } = await getManiaCupSettings(db);
  const discordId = discordIdFromUid(uid);
  if (!participantRoleId || !discordId) return;
  await removeMemberRole(springsGuildId(), discordId, participantRoleId).catch(() => {});
}
