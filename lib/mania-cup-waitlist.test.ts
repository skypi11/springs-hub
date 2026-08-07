import { describe, it, expect } from 'vitest';
import {
  fileEnAttente, rangDe, placesReservees, prochainAInviter, invitationActive,
  type EntreeAttente,
} from './mania-cup-waitlist';

const T = 1_800_000_000_000; // instant de référence, arbitraire mais fixe

const e = (uid: string, createdAt: number, statut: EntreeAttente['statut'], expireA?: number | null): EntreeAttente =>
  ({ uid, createdAt, statut, expireA });

describe('file d’attente', () => {
  it('classe par ordre d’arrivée', () => {
    const l = [e('c', T + 200, 'waiting'), e('a', T, 'waiting'), e('b', T + 100, 'waiting')];
    expect(fileEnAttente(l).map((x) => x.uid)).toEqual(['a', 'b', 'c']);
  });

  it('départage deux arrivées simultanées de façon stable', () => {
    // Deux inscriptions à la même milliseconde ne doivent pas changer d'ordre
    // d'un affichage à l'autre : l'organisation lit une file, pas un tirage.
    const l = [e('zeta', T, 'waiting'), e('alpha', T, 'waiting')];
    expect(fileEnAttente(l).map((x) => x.uid)).toEqual(['alpha', 'zeta']);
  });

  it('sort de la file ceux qui ont réglé ou sont partis', () => {
    const l = [e('a', T, 'converted'), e('b', T + 1, 'left'), e('c', T + 2, 'waiting')];
    expect(fileEnAttente(l).map((x) => x.uid)).toEqual(['c']);
  });

  it('donne un rang à partir de 1, et rien à qui n’est pas dans la file', () => {
    const l = [e('a', T, 'waiting'), e('b', T + 1, 'waiting')];
    expect(rangDe(l, 'b')).toBe(2);
    expect(rangDe(l, 'inconnu')).toBeNull();
  });

  it('garde son rang à celui dont l’invitation a expiré', () => {
    // Le premier a laissé passer son délai. Il reste premier : le délai est
    // choisi par l'organisation, le punir d'un tour serait arbitraire.
    const l = [e('a', T, 'invited', T + 10), e('b', T + 1, 'waiting')];
    expect(rangDe(l, 'a')).toBe(1);
  });
});

describe('places réservées par les invitations', () => {
  it('compte une invitation en cours', () => {
    expect(placesReservees([e('a', T, 'invited', T + 10_000)], T)).toBe(1);
  });

  it('ne compte plus une invitation échue', () => {
    expect(placesReservees([e('a', T, 'invited', T - 1)], T)).toBe(0);
  });

  it('considère une invitation sans échéance comme tenant la place', () => {
    expect(invitationActive(e('a', T, 'invited', null), T)).toBe(true);
  });
});

describe('qui inviter', () => {
  const base = { placesTotales: 64, maintenant: T };

  it('n’invite personne tant que tout est réglé', () => {
    const l = [e('a', T, 'waiting')];
    expect(prochainAInviter({ ...base, entrees: l, placesReglees: 64 })).toBeNull();
  });

  it('invite le premier de la file quand une place se libère', () => {
    const l = [e('a', T, 'waiting'), e('b', T + 1, 'waiting')];
    expect(prochainAInviter({ ...base, entrees: l, placesReglees: 63 })?.uid).toBe('a');
  });

  it('N’INVITE PERSONNE quand la seule place libre est déjà réservée', () => {
    // LE CŒUR DU DISPOSITIF. Sans ce calcul, l'organisation inviterait un
    // deuxième joueur sur la place qu'un premier est en train de régler — et
    // l'un des deux devrait être remboursé.
    const l = [e('a', T, 'invited', T + 10_000), e('b', T + 1, 'waiting')];
    expect(prochainAInviter({ ...base, entrees: l, placesReglees: 63 })).toBeNull();
  });

  it('repropose la place dès que l’invitation a expiré', () => {
    const l = [e('a', T, 'invited', T - 1), e('b', T + 1, 'waiting')];
    // C'est « a » qui revient en premier : il n'a pas perdu son rang.
    expect(prochainAInviter({ ...base, entrees: l, placesReglees: 63 })?.uid).toBe('a');
  });

  it('offre deux places quand deux se libèrent', () => {
    const l = [e('a', T, 'invited', T + 10_000), e('b', T + 1, 'waiting')];
    expect(prochainAInviter({ ...base, entrees: l, placesReglees: 62 })?.uid).toBe('b');
  });
});

describe('sans échéance automatique', () => {
  it('une invitation émise aujourd’hui tient la place indéfiniment', () => {
    // Décision de l'organisation : pas d'horloge. Écrire un délai dans le
    // règlement obligerait à s'y tenir, y compris face à quelqu'un qui répond
    // une heure trop tard avec une bonne raison. C'est un humain qui passe au
    // suivant.
    const l = [e('a', T, 'invited', null), e('b', T + 1, 'waiting')];
    expect(placesReservees(l, T + 30 * 24 * 3600_000)).toBe(1);
    expect(prochainAInviter({ entrees: l, placesReglees: 63, placesTotales: 64, maintenant: T + 30 * 24 * 3600_000 }))
      .toBeNull();
  });

  it('libère la place dès que la personne invitée est passée', () => {
    // « Passer au suivant » met la personne à `left` : la place redevient
    // offrable, et c'est au tour de la suivante.
    const l = [e('a', T, 'left', null), e('b', T + 1, 'waiting')];
    expect(placesReservees(l, T)).toBe(0);
    expect(prochainAInviter({ entrees: l, placesReglees: 63, placesTotales: 64, maintenant: T })?.uid)
      .toBe('b');
  });
});
