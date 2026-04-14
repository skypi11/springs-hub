'use client';

import Link from 'next/link';
import { Home, ChevronRight } from 'lucide-react';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export default function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav
      aria-label="Fil d'Ariane"
      className="flex items-center gap-1.5 text-sm animate-fade-in"
      style={{ color: 'var(--s-text-muted)' }}
    >
      <Link
        href="/"
        className="flex items-center gap-1.5 px-2 py-1 transition-colors duration-150"
        style={{ color: 'var(--s-text-dim)' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--s-violet-light)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--s-text-dim)'; }}
      >
        <Home size={13} />
        <span className="text-xs font-medium">Accueil</span>
      </Link>

      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            <ChevronRight size={12} style={{ color: 'var(--s-text-muted)', opacity: 0.5 }} />
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="px-2 py-1 transition-colors duration-150 text-xs font-medium truncate max-w-[180px]"
                style={{ color: 'var(--s-text-dim)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--s-violet-light)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--s-text-dim)'; }}
                title={item.label}
              >
                {item.label}
              </Link>
            ) : (
              <span
                className="px-2 py-1 text-xs font-semibold truncate max-w-[220px]"
                style={{ color: 'var(--s-text)' }}
                title={item.label}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
