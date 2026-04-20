'use client';

import { MessagesSquare } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminDiscordPage() {
  return (
    <SectionStub
      title="Discord"
      icon={MessagesSquare}
      accent="#7289da"
      description="Configuration et monitoring des webhooks Discord Springs."
      plannedFeatures={[
        'Configurer les URLs des webhooks par channel (recrutement, comps, admin)',
        "Tester l'envoi d'un message sur chaque webhook",
        "Historique des derniers messages envoyés + statut (ok/erreur)",
        "Statistiques : nombre d'envois/jour, erreurs récentes",
        "Templates de messages Discord (annonces, recrutement ouvert)",
      ]}
    />
  );
}
