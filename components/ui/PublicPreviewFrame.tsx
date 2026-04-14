'use client';

import Link from 'next/link';
import { Eye, ExternalLink } from 'lucide-react';

export default function PublicPreviewFrame({
  label = 'APERÇU PUBLIC',
  helper = 'Ce que voient les visiteurs de Springs Hub.',
  href,
  ctaLabel = 'Ouvrir la page complète',
  children,
}: {
  label?: string;
  helper?: string;
  href: string;
  ctaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bevel relative overflow-hidden animate-fade-in"
      style={{
        background: 'var(--s-elevated)',
        border: '1px solid var(--s-border)',
      }}
    >
      {/* Top bar façon fenêtre : label + dots */}
      <div
        className="flex items-center gap-3 px-4 py-2"
        style={{
          background: 'var(--s-surface)',
          borderBottom: '1px solid var(--s-border)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#4a4a60' }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#4a4a60' }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#4a4a60' }} />
        </div>
        <Eye size={12} style={{ color: 'var(--s-text-muted)' }} />
        <span
          className="t-label flex-1 truncate"
          style={{ fontSize: '9px', letterSpacing: '0.14em', color: 'var(--s-text-muted)' }}
        >
          {label}
        </span>
      </div>

      {/* Contenu preview */}
      <div className="p-4 sm:p-5">
        <p className="text-xs mb-4" style={{ color: 'var(--s-text-dim)' }}>
          {helper}
        </p>
        <div className="relative">{children}</div>
      </div>

      {/* CTA bas */}
      <div
        className="flex items-center justify-end gap-2 px-4 py-3"
        style={{
          background: 'var(--s-surface)',
          borderTop: '1px solid var(--s-border)',
        }}
      >
        <Link
          href={href}
          className="btn-springs btn-secondary bevel-sm text-xs inline-flex items-center gap-1.5"
          style={{ padding: '7px 12px', fontSize: '11px' }}
        >
          {ctaLabel}
          <ExternalLink size={11} />
        </Link>
      </div>
    </div>
  );
}
