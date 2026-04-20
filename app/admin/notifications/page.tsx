'use client';

import { Bell } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminNotificationsPage() {
  return (
    <SectionStub
      title="Notifications"
      icon={Bell}
      accent="#FFB800"
      description="Envoyer des notifications in-app ciblées et consulter l'historique."
      plannedFeatures={[
        'Envoyer une notif à un user, une structure, ou tout le site',
        'Templates de notifications récurrentes (annonces Springs, rappels comps)',
        "Historique des notifs envoyées avec taux d'ouverture",
        'Notifications programmées (futures)',
        "Import/export de listes de destinataires",
      ]}
    />
  );
}
