'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Sidebar from './Sidebar';
import LegalFooter from './LegalFooter';
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';

// Landing visiteur full-bleed sur `/` uniquement quand non-connecté.
// Partout ailleurs (pages internes, ou `/` connecté) → layout standard avec sidebar.
export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const isLandingMode = pathname === '/' && !loading && !user;

  if (isLandingMode) {
    return (
      <div className="min-h-screen overflow-x-hidden flex flex-col w-full hex-bg landing-root relative" style={{ background: '#0a0a0a' }}>
        {/* Orbes globales (couvrent toute la landing, pas coupées aux frontières de section) */}
        <div className="aedral-landing-orbs pointer-events-none">
          <div className="aedral-orb-1 absolute top-[-200px] left-[-100px] w-[700px] h-[700px] opacity-[0.10]"
            style={{ background: 'radial-gradient(circle, var(--s-gold), transparent 60%)' }} />
          <div className="aedral-orb-2 absolute top-[400px] right-[-200px] w-[800px] h-[800px] opacity-[0.06]"
            style={{ background: 'radial-gradient(circle, rgba(255,220,180,1), transparent 60%)' }} />
        </div>
        <ImpersonationBanner />
        <div className="flex-1 relative" style={{ zIndex: 1 }}>{children}</div>
        <LegalFooter />
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <div className="flex-1 lg:ml-[260px] min-h-screen overflow-x-hidden hex-bg pt-14 lg:pt-0 flex flex-col">
        <ImpersonationBanner />
        <div className="flex-1">{children}</div>
        <LegalFooter />
      </div>
    </>
  );
}
