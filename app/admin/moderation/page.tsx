'use client';

import { ShieldAlert } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminModerationPage() {
  return (
    <SectionStub
      title="Modération"
      icon={ShieldAlert}
      accent="#ff8800"
      description="File des signalements, sanctions actives et historique complet."
      plannedFeatures={[
        'File des signalements reçus (users, contenus, bios, messages)',
        'Liste des bans actifs avec raison + date + admin responsable',
        'Historique complet des sanctions (ban, unban, suspension structure)',
        'Actions rapides depuis la file (bannir, avertir, rejeter)',
        'Système de notes internes partagées entre admins',
      ]}
    />
  );
}
