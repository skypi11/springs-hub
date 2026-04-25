'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import AdminSidebar from '@/components/admin/AdminSidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading: authLoading, firebaseUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!firebaseUser || !isAdmin) {
      router.replace('/');
    }
  }, [authLoading, isAdmin, firebaseUser, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (!firebaseUser || !isAdmin) {
    // Le useEffect redirige — on évite juste un flash de contenu
    return null;
  }

  return (
    <div className="min-h-screen hex-bg px-8 py-8">
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
                Accès complet aux outils de gestion Springs
              </p>
            </div>
          </div>
        </header>

        {/* Layout 2 colonnes : sous-nav gauche + contenu droite */}
        <div className="grid grid-cols-[240px_1fr] gap-6 animate-fade-in-d1">
          <AdminSidebar />
          <div className="min-w-0 space-y-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
