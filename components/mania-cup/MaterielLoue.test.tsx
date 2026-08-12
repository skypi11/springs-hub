import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MaterielLoue, type Row, type ActionBody } from './RegistrationRow';

// Ce bloc remplace un bouton à deux états qui a coûté une donnée en production
// le 12 août : « Poste loué » avait l'apparence d'un badge et le comportement
// d'un interrupteur. Un clic destiné à savoir QUEL matériel avait été loué a
// effacé une location réglée 90 €, puis un second clic l'a remplacée par une
// location manuelle à 0 € — le lien avec l'argent encaissé était perdu.
//
// Ces tests verrouillent les deux règles qui en découlent : le matériel s'écrit
// toujours en toutes lettres, et une location payée ne s'annule pas d'ici.

const base: Row = {
  uid: 'discord_1',
  tmDisplayName: 'Fan2SkandeaR',
  tmAccountId: 'a-b-c',
  discordId: '179161896883060736',
  firstName: 'Romain',
  lastName: 'Pajot',
  email: 'romain@example.org',
  phone: null,
  emergencyContact: null,
  imageConsent: true,
  countryCode: 'FR',
  ageAtEvent: 29,
  status: 'confirmed',
  guardianConsent: 'not_required',
  guardianDocs: {},
  guardianRejectionReason: null,
  registrationCode: 'LAN-RJDC',
  companions: [],
  payment: null,
  pcRental: null,
  seat: null,
  checkedIn: false,
  createdAt: null,
  paidAt: null,
  staffMessage: null,
};

function setup(pcRental: Row['pcRental']) {
  const onAct = vi.fn<(b: ActionBody) => void>();
  render(<MaterielLoue row={{ ...base, pcRental }} onAct={onAct} pending={false} />);
  return { onAct };
}

describe('MaterielLoue', () => {
  it('écrit l’article loué en toutes lettres', () => {
    // Le libellé était en base depuis le premier paiement ; l'organisation
    // devait rouvrir HelloAsso pour savoir s'il fallait préparer une tour, un
    // portable ou un écran.
    setup({ itemId: 198968963, orderId: 189031974, amountCents: 9000, label: 'LOCATION PC FIXE (2 jours)' });
    expect(screen.getByText('LOCATION PC FIXE (2 jours)')).toBeInTheDocument();
    expect(screen.getByText('90,00 €')).toBeInTheDocument();
  });

  it('donne le numéro de commande de la LOCATION', () => {
    // Celui de l'inscription ne mène pas au bon règlement : payer sa place et
    // louer un poste font deux commandes distinctes.
    setup({ itemId: 198968963, orderId: 189031974, amountCents: 9000, label: 'LOCATION PC FIXE' });
    expect(screen.getByText('189031974')).toBeInTheDocument();
  });

  it('n’offre AUCUN moyen d’effacer une location réglée', () => {
    // Le cœur du fix : plus aucun contrôle de cet écran ne peut défaire un
    // règlement encaissé. Il se défait chez HelloAsso, par un remboursement.
    const { onAct } = setup({ itemId: 198968963, orderId: 189031974, amountCents: 9000, label: 'LOCATION PC FIXE' });
    for (const bouton of screen.queryAllByRole('button')) fireEvent.click(bouton);
    expect(onAct).not.toHaveBeenCalled();
  });

  it('laisse retirer une location notée par l’organisation', () => {
    const { onAct } = setup({ amountCents: 0, label: 'PC fixe' });
    fireEvent.click(screen.getByText('Retirer cette location'));
    expect(onAct).toHaveBeenCalledWith({
      uid: 'discord_1',
      action: 'set_pc_rental',
      pcRental: false,
    });
  });

  it('demande QUOI est loué avant de noter une location', () => {
    // L'ancien bouton écrivait un oui/non muet : on savait qu'un poste était
    // réservé, jamais lequel.
    const { onAct } = setup(null);
    fireEvent.click(screen.getByText('Noter une location'));
    expect(onAct).not.toHaveBeenCalled();

    const champ = screen.getByLabelText('Matériel loué');
    fireEvent.change(champ, { target: { value: '  écran seul  ' } });
    fireEvent.click(screen.getByText('Enregistrer'));

    expect(onAct).toHaveBeenCalledWith({
      uid: 'discord_1',
      action: 'set_pc_rental',
      pcRental: true,
      label: 'écran seul',
    });
  });

  it('n’enregistre pas une location sans matériel', () => {
    const { onAct } = setup(null);
    fireEvent.click(screen.getByText('Noter une location'));
    fireEvent.click(screen.getByText('Enregistrer'));
    expect(onAct).not.toHaveBeenCalled();
  });

  it('signale une location dont le matériel est inconnu', () => {
    // Les dossiers écrits par l'ancien bouton n'ont pas de libellé : le dire
    // vaut mieux que d'afficher un blanc que personne ne saura interpréter.
    setup({ amountCents: 0 });
    expect(screen.getByText('matériel non précisé')).toBeInTheDocument();
  });
});
