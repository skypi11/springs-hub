import Link from 'next/link';
import { Home, Compass } from 'lucide-react';

// Page 404 globale, affichée par Next.js pour toute route non matchée.
// DA Aedral : panel biseauté, fond hex, accent or, Bebas Neue.
export default function NotFound() {
  return (
    <div className="min-h-screen hex-bg flex items-center justify-center px-6 py-16">
      <div className="panel bevel relative overflow-hidden max-w-lg w-full">
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 80%)' }} />
        <div
          className="absolute top-0 right-0 w-[240px] h-[240px] pointer-events-none opacity-[0.07]"
          style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }}
        />
        <div className="relative z-[1] p-10 text-center">
          <div
            className="w-16 h-16 mx-auto mb-6 flex items-center justify-center bevel-sm"
            style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}
          >
            <Compass size={28} style={{ color: 'var(--s-gold)' }} />
          </div>

          <p className="t-label mb-2" style={{ color: 'var(--s-gold)' }}>Erreur 404</p>
          <h1 className="font-display text-3xl mb-3" style={{ letterSpacing: '0.04em' }}>
            PAGE INTROUVABLE
          </h1>
          <p className="t-body mb-8" style={{ color: 'var(--s-text-dim)' }}>
            Cette page n&apos;existe pas, ou a été déplacée. Vérifie l&apos;adresse ou reviens à l&apos;accueil.
          </p>

          <div className="flex items-center justify-center gap-3">
            <Link href="/" className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2">
              <Home size={14} /> Accueil
            </Link>
            <Link href="/community" className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2">
              <Compass size={14} /> Communauté
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
