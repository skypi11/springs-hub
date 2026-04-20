'use client';

import { Wrench } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminDevPage() {
  return (
    <SectionStub
      title="Outils dev"
      icon={Wrench}
      accent="#7a7a95"
      description="Utilitaires de debug et maintenance réservés aux admins techniques."
      plannedFeatures={[
        'Visualiser le contenu brut d\'un document Firestore par ID',
        "Forcer le rechargement d'un profil (invalider caches)",
        'Re-seed démo dev (local uniquement)',
        'Réindexer manuellement les champs dénormalisés (nameLower, etc.)',
        'Tester les rate limits et rules Firestore',
        "Déclencher manuellement les crons (rappels, nettoyages)",
      ]}
    />
  );
}
