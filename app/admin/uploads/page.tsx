'use client';

import { UploadCloud } from 'lucide-react';
import SectionStub from '@/components/admin/SectionStub';

export default function AdminUploadsPage() {
  return (
    <SectionStub
      title="Uploads & stockage"
      icon={UploadCloud}
      accent="#0081FF"
      description="Gestion du stockage Cloudflare R2 (logos, bannières, replays, docs staff)."
      plannedFeatures={[
        'Vue quotas R2 : espace utilisé, nombre de fichiers, coût estimé',
        'Explorateur des fichiers par structure / équipe / user',
        'Purger les fichiers orphelins (références cassées)',
        'Identifier les plus gros consommateurs',
        'Forcer la suppression d\'un upload (modération contenu)',
      ]}
    />
  );
}
