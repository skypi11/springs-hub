import { describe, it, expect } from 'vitest';
import {
  parseTierMap,
  classifyTier,
  extractCode,
  parseOrder,
  decideItem,
  isItemValid,
  isItemVoided,
  assignCompanionTicket,
  isDonationLike,
  resolveManualTicket,
  isOutcomeAlreadyApplied,
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
    type: 'Registration',
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

describe('assignCompanionTicket', () => {
  const slot = (name: string, itemId: number | null = null) => ({
    name,
    role: 'Accompagnant',
    ticketItemId: itemId,
  });

  it('sert la déclaration qui porte le même nom', () => {
    const out = assignCompanionTicket(
      [slot('Martine Dupont'), slot('Jean Martin')],
      { itemId: 7001, participantName: 'Jean Martin' },
      3
    );
    expect(out).toEqual([slot('Martine Dupont'), slot('Jean Martin', 7001)]);
  });

  it('ignore la casse et les accents du nom', () => {
    const out = assignCompanionTicket(
      [slot('Amélie Berthier')],
      { itemId: 7002, participantName: 'AMELIE BERTHIER' },
      3
    );
    expect(out?.[0].ticketItemId).toBe(7002);
  });

  it('adopte le nom du billet quand la déclaration était approximative', () => {
    // Le joueur a écrit « Papa », le billet est au nom de son père. C'est ce
    // dernier qui se présentera à l'accueil : c'est lui qui doit être sur le
    // badge.
    const out = assignCompanionTicket(
      [slot('Papa')],
      { itemId: 7003, participantName: 'Jean Martin' },
      3
    );
    expect(out).toEqual([slot('Jean Martin', 7003)]);
  });

  it('ajoute un accompagnant que personne n’avait déclaré', () => {
    const out = assignCompanionTicket([], { itemId: 7004, participantName: 'Zoé Blanc' }, 3);
    expect(out).toEqual([slot('Zoé Blanc', 7004)]);
  });

  it('rattache trois billets à trois personnes distinctes', () => {
    let list: ReturnType<typeof assignCompanionTicket> = [];
    for (const [i, name] of ['Un', 'Deux', 'Trois'].entries()) {
      list = assignCompanionTicket(list ?? [], { itemId: 8000 + i, participantName: name }, 3);
    }
    expect(list).toHaveLength(3);
    expect(list?.map((c) => c.ticketItemId)).toEqual([8000, 8001, 8002]);
  });

  it('ne fait rien si le billet est déjà rattaché', () => {
    // HelloAsso rejoue ses notifications jusqu'à obtenir un 200 : repasser
    // deux fois ne doit pas créer un accompagnant fantôme.
    const list = [slot('Jean Martin', 7001)];
    expect(assignCompanionTicket(list, { itemId: 7001, participantName: 'Jean Martin' }, 3))
      .toBeNull();
  });

  it('refuse de dépasser le quota du joueur', () => {
    const full = [slot('A', 1), slot('B', 2), slot('C', 3)];
    expect(assignCompanionTicket(full, { itemId: 4, participantName: 'D' }, 3)).toBeNull();
  });

  it('survit à un billet sans nom de participant', () => {
    const out = assignCompanionTicket([], { itemId: 7005, participantName: '' }, 3);
    expect(out?.[0].name).toBe('Accompagnant');
  });
});

describe('dons et contributions', () => {
  const donation = (o: Partial<OrderItemView> = {}): OrderItemView => ({
    orderId: 9001,
    itemId: 6001,
    ticket: null,
    tierLabel: 'Don',
    type: 'Donation',
    amountCents: 500,
    state: 'Processed',
    rawCode: null,
    code: null,
    participantName: '',
    payerName: 'Martine Dupont',
    payerEmail: 'martine@example.org',
    ...o,
  });

  it('reconnaît un don au type déclaré par HelloAsso', () => {
    expect(isDonationLike({ type: 'Donation', tierLabel: 'peu importe' })).toBe(true);
    expect(isDonationLike({ type: 'Contribution', tierLabel: '' })).toBe(true);
  });

  it('reconnaît un don à son libellé quand le type manque', () => {
    expect(isDonationLike({ type: '', tierLabel: 'Don à l’association' })).toBe(true);
    expect(isDonationLike({ type: '', tierLabel: 'Soutien' })).toBe(true);
  });

  it('ne prend pas un billet pour un don', () => {
    expect(isDonationLike({ type: 'Registration', tierLabel: 'Billet Joueur' })).toBe(false);
    // Piège : un tarif dont le nom CONTIENT « don » sans en être un.
    expect(isDonationLike({ type: '', tierLabel: 'Billet Mondon' })).toBe(false);
  });

  it('laisse passer un don sans encombrer la file de rattachement', () => {
    // La billetterie propose un don à côté des billets. Sans cette porte,
    // chaque personne généreuse produirait un « tarif non reconnu » à traiter
    // à la main.
    const out = decideItem(donation(), { registration: null, expectedAmountCents: 3000 });
    expect(out.kind).toBe('ignore');
  });

  it('ignore aussi un don accompagné d’un code recopié par erreur', () => {
    const out = decideItem(donation({ code: 'LAN-4B2C', rawCode: 'LAN-4B2C' }), {
      registration: { uid: 'discord_1', status: 'pending_payment' },
      expectedAmountCents: 3000,
    });
    expect(out.kind).toBe('ignore');
  });
});

describe('resolveManualTicket — le rattachement de secours doit pouvoir conclure', () => {
  it('refuse, au lieu de faire semblant, quand le tarif n’est associé à rien', () => {
    // Le cas RÉEL du 6 août 2026 : correspondance des tarifs vide, deux
    // règlements de 30 € impossibles à rattacher, et une console qui répondait
    // « ok » sans rien écrire. Un joueur a payé deux fois.
    const out = resolveManualTicket({ ticket: null, tierLabel: 'Billet Joueur' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain('Billet Joueur');
      expect(out.reason).toContain('correspondance');
    }
  });

  it('laisse l’organisation trancher la catégorie sans dépendre du réglage', () => {
    const out = resolveManualTicket({ ticket: null, tierLabel: 'Billet Joueur' }, 'player');
    expect(out).toEqual({ ok: true, ticket: 'player' });
  });

  it('utilise la catégorie reconnue quand elle existe', () => {
    expect(resolveManualTicket({ ticket: 'companion' })).toEqual({
      ok: true,
      ticket: 'companion',
    });
  });

  it('la demande explicite prime sur une reconnaissance erronée', () => {
    expect(resolveManualTicket({ ticket: 'companion' }, 'player')).toEqual({
      ok: true,
      ticket: 'player',
    });
  });

  it('refuse un billet spectateur : il ne se rattache à aucun dossier', () => {
    const out = resolveManualTicket({ ticket: 'spectator' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('spectateur');
  });

  it('refuse une catégorie inventée', () => {
    expect(resolveManualTicket({ ticket: null }, 'n’importe quoi').ok).toBe(false);
    expect(resolveManualTicket({ ticket: null }, 'spectator').ok).toBe(false);
  });
});

describe('isOutcomeAlreadyApplied — « Relire les commandes » doit réparer, pas constater', () => {
  const player = { kind: 'confirm_player', uid: 'u1' } as const;

  it('répare un dossier qui a dérivé après coup', () => {
    // Le cas qui rendait le bouton inutile : le journal disait « confirmé », le
    // dossier était retombé en attente (un « Marquer payé » cliqué de travers
    // suffit), et la relecture répondait « tout était déjà à jour ».
    expect(
      isOutcomeAlreadyApplied(player, 42, { status: 'pending_payment', paidByItemId: null })
    ).toBe(false);
  });

  it('ne réécrit rien quand l’effet est bien là', () => {
    expect(
      isOutcomeAlreadyApplied(player, 42, { status: 'confirmed', paidByItemId: 42 })
    ).toBe(true);
  });

  it('distingue un dossier réglé par un AUTRE règlement', () => {
    expect(
      isOutcomeAlreadyApplied(player, 42, { status: 'confirmed', paidByItemId: 99 })
    ).toBe(false);
  });

  it('un dossier absent n’a jamais l’effet', () => {
    expect(isOutcomeAlreadyApplied(player, 42, undefined)).toBe(false);
  });

  it('révocation : appliquée dès que le dossier n’est plus confirmé', () => {
    const revoke = { kind: 'revoke', uid: 'u1', reason: 'remboursé' } as const;
    expect(isOutcomeAlreadyApplied(revoke, 42, { status: 'pending_payment' })).toBe(true);
    expect(isOutcomeAlreadyApplied(revoke, 42, { status: 'confirmed' })).toBe(false);
  });

  it('accompagnant : reconnaît le billet déjà attribué', () => {
    const comp = { kind: 'companion_paid', uid: 'u1' } as const;
    expect(isOutcomeAlreadyApplied(comp, 7, { companionItemIds: [null, 7] })).toBe(true);
    expect(isOutcomeAlreadyApplied(comp, 7, { companionItemIds: [null, null] })).toBe(false);
  });

  it('les issues sans effet métier n’ont rien à vérifier', () => {
    const review = { kind: 'needs_review', reason: 'doublon' } as const;
    expect(isOutcomeAlreadyApplied(review, 1, { status: 'pending_payment' })).toBe(true);
  });
});
