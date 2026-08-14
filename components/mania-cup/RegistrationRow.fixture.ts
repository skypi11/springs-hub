import type { Row } from './RegistrationRow';

// Un dossier d'inscription complet, pour les tests de composant.
//
// Partagé plutôt que recopié : `Row` compte une trentaine de champs, et chaque
// nouveau champ obligeait sinon à retoucher tous les fichiers de test à la
// main — la première occasion venue de laisser deux fixtures diverger.

export const baseRow: Row = {
  uid: 'discord_1',
  tmDisplayName: 'Fan2SkandeaR',
  tmAccountId: 'a-b-c',
  discordId: '179161896883060736',
  discordUsername: 'romainpjt',
  profileSlug: 'fan2skandear',
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
  appartenance: null,
  companions: [],
  payment: null,
  pcRental: null,
  seat: null,
  checkedIn: false,
  createdAt: null,
  paidAt: null,
  staffMessage: null,
};
