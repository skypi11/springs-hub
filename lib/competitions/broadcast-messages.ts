// Ce que le bot DIT pendant un tournoi — rien que le texte, aucune I/O.
//
// Tout est ici pour deux raisons : la voix reste la même d'un bout à l'autre du
// tournoi (elle était éparpillée dans six routes), et chaque formulation est
// testable sans Discord ni Firestore.
//
// Voix : sèche, tutoiement, vocabulaire de la scène. Un message ne se justifie
// que s'il appelle une ACTION du destinataire ou l'informe d'une décision qui le
// touche. Le reste est du bruit qui fait couper les notifications du serveur.

export interface BroadcastText {
  title: string;
  message: string;
}

/** Room d'un match, quand elle est connue. */
export interface RoomInfo {
  name: string;
  password: string;
}

function withRoom(lines: string[], room?: RoomInfo | null): string {
  if (room?.name) {
    lines.push(`Room \`${room.name}\`${room.password ? ` · mot de passe \`${room.password}\`` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Check-in d'un match. La room est jointe ICI plutôt que dans un message à part :
 * le bot la promet dans son message d'accueil, et c'est la première question
 * posée le jour J.
 */
export function matchCheckinText(input: {
  opponentName: string;
  minutes: number;
  room?: RoomInfo | null;
}): BroadcastText {
  return {
    title: 'Check-in ouvert',
    message: withRoom([
      `Tu joues contre ${input.opponentName}.`,
      `Le capitaine a ${input.minutes} minutes pour check-in, sinon l'équipe est déclarée forfait.`,
    ], input.room),
  };
}

/** Seconde chance donnée par le staff à une équipe en retard. */
export function checkinReopenedText(input: {
  opponentName: string;
  minutes: number;
  room?: RoomInfo | null;
}): BroadcastText {
  return {
    title: 'Check-in relancé',
    message: withRoom([
      `Le match contre ${input.opponentName} repart : ${input.minutes} minutes pour check-in.`,
    ], input.room),
  };
}

/**
 * Un camp a saisi, l'autre pas. Sans ce message, un score peut devenir officiel
 * contre une équipe qui n'a jamais su qu'on l'attendait.
 */
export function scoreAwaitingConfirmText(input: {
  opponentName: string;
  claimedScore: string;
  minutes: number;
}): BroadcastText {
  return {
    title: 'Score à confirmer',
    message: [
      `${input.opponentName} annonce ${input.claimedScore}.`,
      `Tu as ${input.minutes} minutes pour confirmer ou contester depuis ta page de match. Sans réponse, ce score est retenu.`,
    ].join('\n'),
  };
}

/** Match gelé : les joueurs doivent produire la preuve, le staff est déjà alerté. */
export function disputeOpenedText(input: { opponentName: string }): BroadcastText {
  return {
    title: 'Match en litige',
    message: [
      `Le résultat du match contre ${input.opponentName} est contesté.`,
      'Dépose tes captures sur ta page de match. Un admin tranche, ne relance pas de manche en attendant.',
    ].join('\n'),
  };
}

/**
 * Décision d'arbitrage. C'est le message le plus important du tournoi : une
 * décision qui tombe en silence se découvre par l'adversaire, et le conflit
 * commence là.
 */
export function adminRulingText(input: {
  kind: 'forced_score' | 'forfeit' | 'double_forfeit';
  winnerName: string;
  loserName: string;
  score?: string | null;
  reason?: string | null;
}): BroadcastText {
  const TITLES = {
    forfeit: 'Forfait validé',
    double_forfeit: 'Double forfait',
    forced_score: 'Litige tranché',
  } as const;
  const lines = input.kind === 'forfeit'
    ? [`${input.loserName} est déclarée forfait. ${input.winnerName} passe au tour suivant.`]
    : input.kind === 'double_forfeit'
      ? [`${input.winnerName} et ${input.loserName} sont déclarées forfait. Aucune des deux ne poursuit dans ce tableau.`]
      : [`Score retenu : ${input.winnerName} ${input.score ?? ''} ${input.loserName}`.trim() + '.'];
  if (input.reason) lines.push(`Motif : ${input.reason}`);
  return { title: TITLES[input.kind], message: lines.join('\n') };
}

/** À l'équipe qui quitte le tournoi (retrait volontaire ou disqualification). */
export function teamWithdrawnText(input: {
  teamName: string;
  reason?: string | null;
}): BroadcastText {
  return {
    title: 'Retrait du tournoi',
    message: [
      `${input.teamName} ne participe plus à ce tournoi.`,
      ...(input.reason ? [`Motif : ${input.reason}`] : []),
    ].join('\n'),
  };
}

/**
 * Aux adversaires touchés par la cascade de forfaits. Sans ce message, une
 * équipe attend en lobby quelqu'un qui ne viendra jamais.
 */
export function opponentWithdrawnText(input: { opponentName: string }): BroadcastText {
  return {
    title: 'Ton adversaire est forfait',
    message: [
      `${input.opponentName} a été retirée du tournoi.`,
      'Tu passes au tour suivant sans jouer ce match. Reste joignable, la suite du bracket peut avancer plus vite que prévu.',
    ].join('\n'),
  };
}

/**
 * Bracket publié, message adressé à CHAQUE équipe : l'annonce publique dit que
 * le tournoi est lancé, elle ne dit à personne contre qui il joue.
 */
export function bracketPublishedTeamText(input: {
  opponentName: string | null;
  startsAt?: string | null;
}): BroadcastText {
  const lines = input.opponentName
    ? [`Premier match contre ${input.opponentName}.`]
    : ['Tu es exempte du premier tour, tu entres au tour suivant.'];
  if (input.startsAt) lines.push(`Début : ${input.startsAt}.`);
  lines.push('Le check-in ouvre peu avant ton match, garde un œil sur ce salon.');
  return { title: 'Le bracket est en ligne', message: lines.join('\n') };
}

/**
 * Ouverture du check-in général. Le capitaine est NOMMÉ : il est figé au moment
 * de l'inscription, donc ce n'est pas forcément celui qui dirige l'équipe
 * aujourd'hui. Sans son nom, une équipe au complet peut rester bloquée devant un
 * bouton que personne d'autre ne peut presser.
 */
export function generalCheckinOpenText(input: {
  teamName: string;
  captainName: string | null;
  minutes: number;
}): BroadcastText {
  return {
    title: 'Check-in général ouvert',
    message: [
      input.captainName
        ? `${input.captainName} confirme la présence de ${input.teamName} — lui seul peut le faire.`
        : `Le capitaine de ${input.teamName} confirme la présence de l'équipe — lui seul peut le faire.`,
      `${input.minutes} minutes, sinon l'équipe ne sera pas alignée.`,
    ].join('\n'),
  };
}

/**
 * Dernier appel du check-in général, aux SEULES équipes qui n'ont pas confirmé.
 * Sans lui, une équipe présente peut être déclarée forfait du tournoi entier
 * parce que son capitaine n'a pas vu le message d'ouverture.
 */
export function generalCheckinReminderText(input: { minutesLeft: number }): BroadcastText {
  return {
    title: `Check-in — il reste ${input.minutesLeft} minutes`,
    message: [
      "Ton équipe n'a pas encore confirmé sa présence.",
      'Sans check-in à la fin du compte à rebours, elle ne sera pas alignée. Le capitaine confirme depuis la page du tournoi.',
    ].join('\n'),
  };
}

/** Extrait d'un message de fil : borné, sur une seule ligne. */
function excerptOf(body: string, max = 180): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Une équipe écrit dans le fil d'un match → le staff doit le voir. Un fil que
 * personne ne surveille oblige les deux camps à camper sur une page.
 */
export function threadToStaffText(input: {
  teamName: string;
  matchLabel: string;
  body: string;
}): BroadcastText {
  return {
    title: `Message d'équipe — match ${input.matchLabel}`,
    message: `${input.teamName} : « ${excerptOf(input.body)} »`,
  };
}

/** Le staff répond dans le fil → les deux équipes du match doivent le voir. */
export function threadToTeamsText(input: { body: string }): BroadcastText {
  return {
    title: 'Message du staff',
    message: [
      `« ${excerptOf(input.body)} »`,
      'Réponds sur la page de ton match.',
    ].join('\n'),
  };
}

/** Annonce publique de l'organisateur (texte libre), jamais mise en forme. */
export function organizerAnnouncementText(input: {
  competitionName: string;
  body: string;
}): BroadcastText {
  return { title: input.competitionName, message: input.body.trim() };
}
