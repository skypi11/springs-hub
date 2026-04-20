'use client';

import { ClipboardList } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminDevoirsPage() {
  return (
    <SectionStub
      title="Devoirs"
      icon={ClipboardList}
      accent="#a364d9"
      description="Vue cross-teams des devoirs, stats de complétion et templates Springs officiels."
      plannedFeatures={[
        'Tableau de bord : taux de complétion global, par structure, par équipe',
        'Liste des devoirs en retard / abandonnés',
        'Créer des templates de devoirs Springs (diffusés à toutes les équipes)',
        'Stats qualité : feedback moyen, délai de complétion',
        'Phase 2 vision : feedback loop, types structurés, notifs',
      ]}
    />
  );
}
