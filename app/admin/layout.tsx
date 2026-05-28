'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Shield, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import AdminSidebar from '@/components/admin/AdminSidebar';

// Sous-ensemble de la réponse /api/admin/dashboard utile aux badges de la nav.
// Tout est optionnel : on tolère une réponse partielle (ex. mismatch de version
// pendant un déploiement) sans faire planter le layout admin.
type DashboardBadges = {
  groups?: { users?: unknown[]; teams?: unknown[]; events?: unknown[] };
  toHandle?: {
    pendingStructures?: number;
    suspendedStructures?: number;
    deletionScheduledStructures?: number;
    orphanedStructures?: number;
    pendingRankReports?: number;
    pendingLinkChanges?: number;
  };
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading: authLoading, firebaseUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!firebaseUser || !isAdmin) {
      router.replace('/');
    }
  }, [authLoading, isAdmin, firebaseUser, router]);

  // Même queryKey que le dashboard → React Query déduplique le fetch et les
  // badges se rafraîchissent quand l'admin clique "marquer comme vu".
  const { data } = useQuery({
    queryKey: ['admin', 'dashboard'] as const,
    queryFn: () => api<DashboardBadges>('/api/admin/dashboard'),
    enabled: !authLoading && !!firebaseUser && isAdmin,
  });

  const badges: Record<string, number> = data
    ? {
        '/admin/structures': data.toHandle?.pendingStructures ?? 0,
        '/admin/users': data.groups?.users?.length ?? 0,
        '/admin/teams': data.groups?.teams?.length ?? 0,
        '/admin/calendar': data.groups?.events?.length ?? 0,
        '/admin/moderation':
          (data.toHandle?.suspendedStructures ?? 0)
          + (data.toHandle?.deletionScheduledStructures ?? 0)
          + (data.toHandle?.orphanedStructures ?? 0),
        '/admin/rank-reports': data.toHandle?.pendingRankReports ?? 0,
        '/admin/rl-link-changes': data.toHandle?.pendingLinkChanges ?? 0,
      }
    : {};

  if (authLoading) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (!firebaseUser || !isAdmin) {
    // Le useEffect redirige, on évite juste un flash de contenu
    return null;
  }

  return (
    <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="relative z-[1] space-y-6">
        {/* Header admin */}
        <header
          className="bevel animate-fade-in relative overflow-hidden"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        >
          <div
            className="h-[3px]"
            style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold), transparent 80%)' }}
          />
          <div className="relative z-[1] p-6 flex items-center gap-3">
            <div
              className="p-2"
              style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)' }}
            >
              <Shield size={18} style={{ color: 'var(--s-gold)' }} />
            </div>
            <div>
              <h1 className="font-display text-2xl" style={{ letterSpacing: '0.03em' }}>
                PANEL ADMIN
              </h1>
              <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                Accès complet aux outils de gestion Aedral
              </p>
            </div>
          </div>
        </header>

        {/* Layout 2 colonnes : sous-nav gauche + contenu droite */}
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 animate-fade-in-d1">
          <AdminSidebar badges={badges} />
          <div className="min-w-0 space-y-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
