/**
 * L'identité Trackmania d'un joueur, et ce qu'on peut en déduire.
 *
 * Le profil réclamait DEUX choses au joueur : son pseudo Ubisoft/Nadeo et
 * l'adresse de sa fiche trackmania.io. Or depuis que la liaison Ubisoft existe,
 * on récupère son identifiant de compte — et cette adresse n'est rien d'autre
 * que cet identifiant collé derrière une adresse fixe. La demander revenait à
 * faire recopier à la main une information qu'on possédait déjà.
 *
 * Concrètement, un joueur qui liait son compte Ubisoft pour s'inscrire à la LAN
 * se retrouvait ensuite bloqué sur l'accueil par un formulaire de complétion de
 * profil réclamant cette adresse.
 */

import { getGame } from './games-registry';

/** L'adresse de la fiche publique, déduite de l'identifiant de compte. */
export function tmIoUrlFromAccountId(accountId: string | null | undefined): string | null {
  const id = (accountId ?? '').trim();
  if (!id) return null;
  const gabarit = getGame('trackmania')?.trackerUrlTemplate;
  if (!gabarit) return null;
  return gabarit.replace('{id}', id);
}

/**
 * L'identifiant de compte du joueur, quelle qu'en soit la provenance.
 *
 * `tmAccountId` est posé par la liaison Ubisoft et fait foi. `tmIoUrl` est la
 * saisie manuelle historique, dont on sait extraire l'identifiant : elle sert
 * de repli pour les comptes créés avant la liaison.
 */
export function tmAccountIdOf(
  u: { tmAccountId?: string | null; tmIoUrl?: string | null } | null | undefined
): string | null {
  const direct = (u?.tmAccountId ?? '').trim();
  if (direct) return direct;
  return extractAccountIdFromUrl(u?.tmIoUrl);
}

/** Extrait l'identifiant de compte d'une adresse trackmania.io. */
export function extractAccountIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s) return null;
  const avecDiese = s.match(/trackmania\.io\/#\/player\/([a-f0-9-]{36})/i);
  if (avecDiese) return avecDiese[1];
  const sansDiese = s.match(/trackmania\.io\/player\/([a-f0-9-]{36})/i);
  if (sansDiese) return sansDiese[1];
  // L'entrée PEUT être directement l'identifiant.
  if (/^[a-f0-9-]{36}$/i.test(s)) return s;
  return null;
}
