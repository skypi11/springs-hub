import { describe, it, expect } from 'vitest';
import {
  parseTierMap,
  classifyTier,
  extractCode,
  parseOrder,
  decideItem,
  isItemValid,
  isItemVoided,
  type OrderItemView,
  type RegistrationSnapshot,
} from './reconcile';
import type { HelloAssoOrder } from './types';

// Ce fichier décide qui a payé sa place et qui ne l'a pas payée. Chaque cas
// testé correspond à une situation qui SE PRODUIRA sur 64 joueurs : un code
// recopié de travers, un parent qui paie pour son fils, un remboursement, un
// double règlement, un tarif renommé la veille.

const TIERS = parseTierMap(
  JSON.stringify({
    '101': 'player',
    '102': 'companion',
    '103': 'spectator',
    '105': 'pc_rental',
    Joueur: 'player',
    Accompagnant: 'companion',
    'Spectateur': 'spectator',
  })
);

const OPTS = { tiers: TIERS, codeFieldLabel: 'Code d’inscription' };

function order(overrides: Partial<HelloAssoOrder> = {}): HelloAssoOrder {
  return {
    id: 9001,
    formSlug: 'springs-mania-cup',
    formType: 'Event',
    organizationSlug: 'springs-esport',
    payer: { firstName: 'Martine', lastName: 'Dupont', email: 'martine@example.org' },
    items: [],
    ...overrides,
  };
}

function playerItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 5001,
    amount: 3000,
    name: 'Joueur',
    tierId: 101,
    state: 'Processed',
    user: { firstName: 'Paul', lastName: 'Dupont' },
    customFields: [{ id: 1, name: 'Code d’inscription', type: 'TextInput', answer: 'LAN-4B2C' }],
    ...overrides,
  };
}

describe('parseTierMap / classifyTier', () => {
  it('reconnaît un tarif par son identifiant', () => {
    expect(classifyTier({ tierId: 101, name: 'peu importe' }, TIERS)).toBe('player');
  });

  it('reconnaît un tarif par son libellé quand l’identifiant manque', () => {
    expect(classifyTier({ name: 'Joueur' }, TIERS)).toBe('player');
  });

  it('tolère la casse, les accents et les espaces en trop', () => {
    expect(classifyTier({ name: 'SPECTATEUR' }, TIERS)).toBe('spectator');
    expect(classifyTier({ name: '  Accompagnant  ' }, TIERS)).toBe('companion');
  });

  it('préfère l’identifiant au libellé', () => {
    // Un tarif renommé dans le back-office ne doit pas changer sa nature :
    // c'est exactement le scénario qui casserait la reconnaissance en silence.
    expect(classifyTier({ tierId: 101, name: 'Joueur (early bird)' }, TIERS)).toBe('player');
  });

  it('ne reconnaît pas un tarif inconnu', () => {
    expect(classifyTier({ name: 'Tombola' }, TIERS)).toBeNull();
    expect(classifyTier({}, TIERS)).toBeNull();
  });

  it('survit à une correspondance mal saisie', () => {
    const broken = parseTierMap('{ceci nest pas du json');
    expect(broken.byId).toEqual({});
    expect(classifyTier({ tierId: 101 }, broken)).toBeNull();
  });
});

describe('extractCode', () => {
  it('lit le champ au libellé exact', () => {
    expect(extractCode(playerItem(), 'Code d’inscription')).toBe('LAN-4B2C');
  });

  it('retrouve le champ malgré un libellé approximatif', () => {
    // La personne qui crée la billetterie n'écrira pas le libellé au caractère
    // près : rater le rattachement pour une apostrophe serait absurde.
    const item = playerItem({
      customFields: [{ name: "Code d'inscription (LAN-XXXX)", answer: 'LAN-7XQZ' }],
    });
    expect(extractCode(item, 'Code d’inscription')).toBe('LAN-7XQZ');
  });

  it('renvoie null quand aucun champ ne parle de code', () => {
    const item = playerItem({ customFields: [{ name: 'Taille de t-shirt', answer: 'L' }] });
    expect(extractCode(item, 'Code d’inscription')).toBeNull();
  });

  it('renvoie null quand il n’y a aucun champ personnalisé', () => {
    // Cas réel : l'exemple officiel de notification HelloAsso ne contient
    // aucun customFields. C'est pourquoi on ne se fie jamais au webhook seul.
    expect(extractCode({ id: 1 }, 'Code d’inscription')).toBeNull();
  });
});

describe('parseOrder', () => {
  it('met une commande à plat', () => {
    const [item] = parseOrder(order({ items: [playerItem()] }), OPTS);
    expect(item).toMatchObject({
      orderId: 9001,
      itemId: 5001,
      ticket: 'player',
      amountCents: 3000,
      state: 'Processed',
      code: 'LAN-4B2C',
      participantName: 'Paul Dupont',
      payerName: 'Martine Dupont',
      payerEmail: 'martine@example.org',
    });
  });

  it('remet le code en forme', () => {
    const [item] = parseOrder(
      order({
        items: [playerItem({ customFields: [{ name: 'Code d’inscription', answer: ' lan 4b2c ' }] })],
      }),
      OPTS
    );
    expect(item.rawCode).toBe(' lan 4b2c ');
    expect(item.code).toBe('LAN-4B2C');
  });

  it('garde la saisie brute quand elle est illisible', () => {
    const [item] = parseOrder(
      order({
        items: [playerItem({ customFields: [{ name: 'Code d’inscription', answer: 'mon fils' }] })],
      }),
      OPTS
    );
    expect(item.rawCode).toBe('mon fils');
    expect(item.code).toBeNull();
  });

  it('lit plusieurs lignes d’une même commande', () => {
    // Un parent règle l'inscription de son fils ET son propre billet
    // accompagnant en une seule fois.
    const items = parseOrder(
      order({
        items: [
          playerItem(),
          playerItem({ id: 5002, tierId: 102, name: 'Accompagnant', amount: 2000 }),
        ],
      }),
      OPTS
    );
    expect(items.map((i) => i.ticket)).toEqual(['player', 'companion']);
  });

  it('ne lève pas sur une commande vide ou incomplète', () => {
    expect(parseOrder({}, OPTS)).toEqual([]);
    const [item] = parseOrder({ items: [{}] }, OPTS);
    expect(item.itemId).toBe(0);
    expect(item.ticket).toBeNull();
  });
});

describe('états d’une ligne', () => {
  it('compte Processed et Registered comme valides', () => {
    expect(isItemValid('Processed')).toBe(true);
    // Inscription saisie à la main par l'organisation, sans paiement en ligne.
    // L'ignorer ferait vendre deux fois le même siège.
    expect(isItemValid('Registered')).toBe(true);
  });

  it('ne compte pas une ligne en attente', () => {
    expect(isItemValid('Waiting')).toBe(false);
    expect(isItemVoided('Waiting')).toBe(false);
  });

  it('reconnaît les lignes défaites', () => {
    expect(isItemVoided('Canceled')).toBe(true);
    expect(isItemVoided('Refused')).toBe(true);
  });
});

describe('decideItem', () => {
  const view = (o: Partial<OrderItemView> = {}): OrderItemView => ({
    orderId: 9001,
    itemId: 5001,
    ticket: 'player',
    tierLabel: 'Joueur',
    amountCents: 3000,
    state: 'Processed',
    rawCode: 'LAN-4B2C',
    code: 'LAN-4B2C',
    participantName: 'Paul Dupont',
    payerName: 'Martine Dupont',
    payerEmail: 'martine@example.org',
    ...o,
  });

  const pending: RegistrationSnapshot = { uid: 'discord_1', status: 'pending_payment' };

  it('confirme un règlement joueur conforme', () => {
    expect(decideItem(view(), { registration: pending, expectedAmountCents: 3000 })).toEqual({
      kind: 'confirm_player',
      uid: 'discord_1',
    });
  });

  it('ignore un paiement en cours d’autorisation', () => {
    const out = decideItem(view({ state: 'Waiting' }), {
      registration: pending,
      expectedAmountCents: 3000,
    });
    expect(out.kind).toBe('ignore');
  });

  it('laisse l’organisation trancher sur un tarif inconnu', () => {
    const out = decideItem(view({ ticket: null, tierLabel: 'Tombola' }), {
      registration: pending,
      expectedAmountCents: null,
    });
    expect(out).toMatchObject({ kind: 'needs_review' });
    expect((out as { reason: string }).reason).toContain('Tombola');
  });

  it('range un billet spectateur sans toucher à un dossier', () => {
    const out = decideItem(view({ ticket: 'spectator', code: null, rawCode: null }), {
      registration: null,
      expectedAmountCents: null,
    });
    expect(out).toEqual({ kind: 'spectator' });
  });

  it('met de côté un règlement sans code', () => {
    const out = decideItem(view({ code: null, rawCode: null }), {
      registration: null,
      expectedAmountCents: 3000,
    });
    expect(out).toMatchObject({ kind: 'unmatched' });
    expect((out as { reason: string }).reason).toContain('Aucun code');
  });

  it('met de côté un code illisible en gardant la saisie', () => {
    const out = decideItem(view({ code: null, rawCode: 'LAN 4B2O' }), {
      registration: null,
      expectedAmountCents: 3000,
    });
    expect((out as { reason: string }).reason).toContain('LAN 4B2O');
  });

  it('met de côté un code que personne ne porte', () => {
    const out = decideItem(view(), { registration: null, expectedAmountCents: 3000 });
    expect(out).toMatchObject({ kind: 'unmatched' });
    expect((out as { reason: string }).reason).toContain('LAN-4B2C');
  });

  it('refuse de confirmer sur un montant qui ne colle pas', () => {
    // 20 € versés sur un tarif à 30 € : soit le joueur s'est trompé de tarif,
    // soit le prix a bougé. Dans les deux cas, personne ne doit être confirmé
    // sans qu'un humain regarde.
    const out = decideItem(view({ amountCents: 2000 }), {
      registration: pending,
      expectedAmountCents: 3000,
    });
    expect(out).toMatchObject({ kind: 'needs_review' });
    expect((out as { reason: string }).reason).toContain('20.00');
  });

  it('accepte tout montant quand aucun contrôle n’est demandé', () => {
    const out = decideItem(view({ amountCents: 2500 }), {
      registration: pending,
      expectedAmountCents: null,
    });
    expect(out.kind).toBe('confirm_player');
  });

  it('signale un second règlement pour un dossier déjà réglé', () => {
    const out = decideItem(view({ itemId: 6000 }), {
      registration: { uid: 'discord_1', status: 'confirmed', paidByItemId: 5001 },
      expectedAmountCents: 3000,
    });
    expect(out).toMatchObject({ kind: 'needs_review' });
    expect((out as { reason: string }).reason).toContain('doublon');
  });

  it('rejoue sans effet la notification qui a déjà confirmé', () => {
    // HelloAsso relance ses notifications jusqu'à obtenir un 200 : la même
    // ligne repasse, et doit aboutir à la même décision, pas à un doublon.
    const out = decideItem(view(), {
      registration: { uid: 'discord_1', status: 'confirmed', paidByItemId: 5001 },
      expectedAmountCents: 3000,
    });
    expect(out).toEqual({ kind: 'confirm_player', uid: 'discord_1' });
  });

  it('ne confirme pas le règlement d’une inscription retirée', () => {
    const out = decideItem(view(), {
      registration: { uid: 'discord_1', status: 'cancelled' },
      expectedAmountCents: 3000,
    });
    expect(out).toMatchObject({ kind: 'needs_review' });
    expect((out as { reason: string }).reason).toContain('retirée');
  });

  it('défait une confirmation quand la ligne est remboursée', () => {
    const out = decideItem(view({ state: 'Canceled' }), {
      registration: { uid: 'discord_1', status: 'confirmed', paidByItemId: 5001 },
      expectedAmountCents: 3000,
    });
    expect(out).toMatchObject({ kind: 'revoke', uid: 'discord_1' });
  });

  it('ne défait rien quand la ligne annulée n’avait rien confirmé', () => {
    // Une ligne annulée qui n'est pas celle qui a payé ne doit pas libérer la
    // place : le joueur a bien réglé, par une autre commande.
    const out = decideItem(view({ state: 'Canceled', itemId: 7777 }), {
      registration: { uid: 'discord_1', status: 'confirmed', paidByItemId: 5001 },
      expectedAmountCents: 3000,
    });
    expect(out.kind).toBe('ignore');
  });

  it('rattache un billet accompagnant à son joueur', () => {
    const out = decideItem(view({ ticket: 'companion', amountCents: 2000 }), {
      registration: pending,
      expectedAmountCents: 2000,
    });
    expect(out).toEqual({ kind: 'companion_paid', uid: 'discord_1' });
  });

  it('n’exige pas le bon montant pour un accompagnant déjà rattaché', () => {
    // Le contrôle de montant ne vaut que pour l'inscription elle-même : c'est
    // elle qui décide d'une place.
    const out = decideItem(view({ ticket: 'companion', amountCents: 1 }), {
      registration: pending,
      expectedAmountCents: 2000,
    });
    expect(out.kind).toBe('companion_paid');
  });

  it('enregistre une location de poste sans confirmer la place', () => {
    // Une location payée ne vaut PAS inscription : le joueur peut réserver son
    // poste et ne jamais régler ses 30 €.
    const out = decideItem(view({ ticket: 'pc_rental', amountCents: 12000 }), {
      registration: pending,
      expectedAmountCents: 3000,
    });
    expect(out).toEqual({ kind: 'pc_rental', uid: 'discord_1' });
  });

  it('signale un accompagnant rattaché à une inscription retirée', () => {
    const out = decideItem(view({ ticket: 'companion' }), {
      registration: { uid: 'discord_1', status: 'cancelled' },
      expectedAmountCents: null,
    });
    expect(out).toMatchObject({ kind: 'needs_review' });
  });
});
