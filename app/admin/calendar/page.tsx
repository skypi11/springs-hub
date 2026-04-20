'use client';

import { CalendarDays } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminCalendarPage() {
  return (
    <SectionStub
      title="Calendrier global"
      icon={CalendarDays}
      accent="#FFB800"
      description="Tous les événements du site agrégés (structures, équipes, compétitions, Springs officiels)."
      plannedFeatures={[
        'Vue mois / semaine / liste de tous les événements',
        'Filtrer par type (training, scrim, match, springs, comp)',
        'Créer un événement Springs officiel (visible par tous)',
        'Éditer / annuler un événement de structure (modération)',
        'Export iCal global',
      ]}
    />
  );
}
