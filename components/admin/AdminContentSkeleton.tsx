'use client';

// Skeleton de chargement pour les pages du panel admin.
// Remplace le <Loader2> centré "brutal" par un placeholder structuré
// (barre d'outils + liste de lignes) cohérent avec la DA Aedral.

import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';

export default function AdminContentSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4 animate-fade-in">
      {/* Barre d'outils / filtres */}
      <div
        className="bevel-sm flex items-center gap-3 px-4 py-3"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <SkeletonText width={180} height={14} />
        <div className="flex-1" />
        <Skeleton style={{ width: 90, height: 30 }} />
        <Skeleton style={{ width: 110, height: 30 }} />
      </div>

      {/* Lignes de contenu */}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="bevel-sm relative overflow-hidden flex items-center gap-4 px-4 py-4"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
          >
            <div
              className="absolute top-0 left-0 bottom-0 w-[3px]"
              style={{ background: 'var(--s-gold)', opacity: 0.25 }}
            />
            <Skeleton style={{ width: 44, height: 44 }} />
            <div className="flex-1 space-y-2">
              <SkeletonText width="45%" height={15} />
              <SkeletonText width="70%" height={11} />
            </div>
            <Skeleton style={{ width: 80, height: 28 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
