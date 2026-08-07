/**
 * Trace opposable de l'acceptation du règlement.
 *
 * LE DÉFAUT CORRIGÉ ICI. La règle d'écriture était « si aucune trace n'existe,
 * en poser une ». Un joueur inscrit sous la version 1, revenu sur son dossier
 * après une republication et ayant coché la case sur le texte de la version 3,
 * restait donc enregistré comme ayant accepté la version 1. En cas de litige,
 * l'organisation aurait opposé un texte que le joueur n'a pas lu — c'est-à-dire
 * l'inverse exact de ce que cette trace existe pour prouver.
 *
 * La route vérifie déjà que la version cochée est bien la version en ligne
 * (409 sinon) : quand on arrive ici, `versionAcceptee` est celle que le joueur
 * avait sous les yeux.
 *
 * L'historique s'ajoute à côté de la trace courante plutôt que de la remplacer.
 * Les deux répondent à des questions différentes : « quel texte l'engage
 * aujourd'hui ? » et « qu'a-t-il accepté, et quand ? ». Un joueur inscrit en
 * juillet sous la version 1 puis revenu en septembre sous la version 3 a bien
 * accepté les deux, et l'écraser effacerait la première.
 */

export type TraceReglement = { version: number; at: unknown; byUid: string };

/** Ce que la trace doit devenir, ou `null` s'il n'y a rien à écrire. */
export type DecisionTrace = {
  /** Trace courante à poser. */
  trace: { version: number; byUid: string };
  /** L'entrée à ajouter à l'historique — même contenu, mais horodaté côté
   *  serveur au moment de l'écriture : Firestore refuse un horodatage
   *  différé à l'intérieur d'un tableau. */
  ajouterAHistorique: true;
} | null;

export function decideTraceReglement({
  versionAcceptee,
  tracePrecedente,
  uid,
}: {
  /** Version du règlement en ligne, celle que le joueur vient d'accepter.
   *  `null` quand aucun règlement n'est publié : rien à tracer. */
  versionAcceptee: number | null;
  tracePrecedente: { version?: number } | null | undefined;
  uid: string;
}): DecisionTrace {
  if (versionAcceptee === null) return null;

  // Rien de neuf : le joueur re-enregistre son dossier sans que le règlement
  // ait bougé. Réécrire ne changerait que la date et ferait croire à une
  // nouvelle acceptation.
  if (tracePrecedente?.version === versionAcceptee) return null;

  return { trace: { version: versionAcceptee, byUid: uid }, ajouterAHistorique: true };
}
