'use client';

import { Users2 } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminTeamsPage() {
  return (
    <SectionStub
      title="Équipes"
      icon={Users2}
      accent="#0081FF"
      description="Vue transverse de toutes les sub_teams du site, filtrable par jeu, structure ou statut."
      plannedFeatures={[
        'Liste paginée de toutes les équipes de toutes les structures',
        'Filtres par jeu (RL/TM), par structure, par statut (actif/archivé)',
        'Vue détaillée équipe : roster, staff, calendrier, devoirs',
        'Actions : archiver, restaurer, forcer suppression',
        'Stats : nombre de matchs, taux de complétion devoirs',
      ]}
    />
  );
}
