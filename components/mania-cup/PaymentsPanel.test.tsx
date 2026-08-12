import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentRow, type Payment } from './PaymentsPanel';

// La console de caisse a laissé croire, le 12 août, qu'un règlement remboursé
// avait DISPARU du site. Il n'avait pas bougé : l'écran le peignait en vert
// « rattaché », annonçait « Payé par » alors que l'argent était reparti, et
// l'écrivait en anglais brut. Ces tests verrouillent ce que dit une ligne de
// caisse — c'est la seule chose sur laquelle l'organisation se fonde pour
// décider de rembourser, de rappeler quelqu'un, ou de ne rien faire.

const base: Payment = {
  itemId: 198457897,
  orderId: 188786961,
  ticket: 'player',
  tierLabel: 'Billet Joueur',
  amountCents: 3000,
  state: 'Processed',
  rawCode: 'LAN-7Y6B',
  code: 'LAN-7Y6B',
  participantName: 'Charly LEPRINCE',
  payerName: 'Charly LEPRINCE',
  payerEmail: 'charly@example.org',
  matchedUid: 'discord_1',
  outcome: 'confirm_player',
  reason: null,
  source: 'webhook',
};

function poser(p: Partial<Payment>) {
  render(
    <PaymentRow
      payment={{ ...base, ...p }}
      targets={[]}
      onMatch={() => {}}
      busy={false}
    />
  );
}

describe('PaymentRow', () => {
  it('ne dit « rattaché » que sur un règlement qui tient vraiment une place', () => {
    poser({});
    expect(screen.getByText('rattaché')).toBeInTheDocument();
  });

  it('ne peint PAS en vert une ligne annulée', () => {
    poser({ state: 'Canceled', outcome: 'ignore', matchedUid: null });
    expect(screen.queryByText('rattaché')).not.toBeInTheDocument();
    expect(screen.getByText('annulé')).toBeInTheDocument();
  });

  it('dit en clair que l’argent est reparti quand la ligne, elle, est restée valide', () => {
    // Le cas du remboursement fait sans annuler la commande : la ligne reste
    // « Processed », seul le paiement passe à « Refunded ».
    poser({ moneyBack: 'remboursé', outcome: 'needs_review' });
    expect(screen.getByText('à traiter')).toBeInTheDocument();
  });

  it('n’écrit plus « Payé par » sur un règlement reparti', () => {
    poser({ state: 'Canceled', outcome: 'ignore' });
    expect(screen.queryByText(/Payé par/)).not.toBeInTheDocument();
    expect(screen.getByText(/Réglé par/)).toBeInTheDocument();
  });

  it('n’écrit plus l’état HelloAsso en anglais brut', () => {
    // L'écran affichait « CANCELED » dans une console française.
    poser({ state: 'Canceled', outcome: 'ignore' });
    expect(screen.queryByText('Canceled')).not.toBeInTheDocument();
  });

  it('ne répète pas l’état quand le verdict le dit déjà', () => {
    poser({ state: 'Canceled', outcome: 'ignore' });
    expect(screen.getAllByText('annulé')).toHaveLength(1);
  });

  it('affiche l’état quand il apprend autre chose que le verdict', () => {
    // « à traiter » ne dit pas POURQUOI : l'état brut complète.
    poser({ state: 'Waiting', outcome: 'needs_review' });
    expect(screen.getByText('en attente d’autorisation')).toBeInTheDocument();
    expect(screen.getByText('à traiter')).toBeInTheDocument();
  });

  it('garde le libellé exact de l’article, pas seulement sa catégorie', () => {
    poser({ ticket: 'pc_rental', tierLabel: 'LOCATION PC FIXE (2 jours)', amountCents: 9000 });
    expect(screen.getByText('LOCATION PC FIXE (2 jours)')).toBeInTheDocument();
  });

  it('donne la date d’arrivée du règlement', () => {
    // Devant une ligne annulée, l'organisation ne pouvait pas dire si le
    // remboursement datait d'hier ou du mois dernier.
    poser({ receivedAt: { _seconds: 1785978135 } });
    expect(screen.getByText(/reçu le/)).toBeInTheDocument();
  });
});
