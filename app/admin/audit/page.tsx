'use client';

import { History } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminAuditPage() {
  return (
    <SectionStub
      title="Audit log"
      icon={History}
      accent="#a364d9"
      description="Flux complet de toutes les actions admin sensibles (structure_audit_logs + actions critiques)."
      plannedFeatures={[
        'Flux chronologique de toutes les actions admin : qui, quoi, quand, sur qui',
        'Filtrer par admin, par type d\'action, par cible (user/structure)',
        'Recherche full-text dans les actions',
        'Export CSV d\'une plage de dates',
        'Ajout audit log manquant sur : approve/reject/suspend structure, ban/unban user, promote/demote admin',
        'Priorité : cette section doit aller vite — on a eu un cas où un admin a validé une structure sans prévenir',
      ]}
    />
  );
}
