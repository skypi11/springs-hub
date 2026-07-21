// Fil du match — helpers PURS partagés entre la page de match (rendu) et les
// tests. Deux morceaux à risque, extraits pour être testables sans monter tout
// le composant : la fusion optimiste et la dérivation du camp d'écriture.

export interface ThreadMsg {
  id: string;
  side: 'a' | 'b' | 'admin';
  authorName: string;
  body: string;
  createdAt: string | null;
  /** Nonce généré côté client, posé sur le message optimiste ET renvoyé par le
   *  serveur sur le message confirmé. Sert à retirer l'optimiste dès que SON
   *  message revient — sans dédupliquer par contenu (deux « gg » d'affilée
   *  restaient sinon invisibles jusqu'au refetch). */
  clientNonce?: string;
}

/**
 * Fil affiché = messages serveur + messages optimistes pas encore confirmés.
 * Un optimiste s'efface dès que le message serveur portant SON nonce arrive :
 * exact (pas de collision de contenu), et le vrai message porte le nonce donc
 * il n'y a jamais de doublon transitoire. Filet en cas de nonce manquant
 * (déploiement en cours) : le retrait par nonce côté appelant après le POST.
 */
export function mergeThread(server: ThreadMsg[], pending: ThreadMsg[]): ThreadMsg[] {
  return [
    ...server,
    ...pending.filter(p => !server.some(s => s.clientNonce != null && s.clientNonce === p.clientNonce)),
  ];
}

/**
 * Camp d'écriture du lecteur dans le fil — MIROIR EXACT de la logique serveur
 * (app/api/competitions/[id]/matches/[matchId]/thread/route.ts) : mon équipe si
 * je peux saisir les scores, sinon 'admin' si je suis admin, sinon lecture
 * seule (null). Un décalage ici colorerait le message optimiste au mauvais camp.
 */
export function threadPostSide(
  access: { side: 'a' | 'b' | null; canSubmitScores: boolean } | null,
  isAdmin: boolean,
): 'a' | 'b' | 'admin' | null {
  if (access?.side && access.canSubmitScores) return access.side;
  if (isAdmin) return 'admin';
  return null;
}
