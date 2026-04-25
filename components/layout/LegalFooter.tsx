'use client';

import Link from 'next/link';

// Footer minimal — liens légaux discrets en bas de chaque page.
// Volontairement sobre pour ne pas concurrencer le contenu.
export default function LegalFooter() {
  return (
    <footer
      className="mt-12 border-t"
      style={{ borderColor: 'var(--s-border)', background: 'rgba(0,0,0,0.2)' }}
    >
      <div className="px-8 py-5 flex items-center justify-between flex-wrap gap-3 text-xs">
        <span style={{ color: 'var(--s-text-muted)' }}>
          © {new Date().getFullYear()} Aedral · Matthieu MOLINES
        </span>
        <div className="flex gap-4">
          <Link
            href="/legal/mentions"
            className="transition-colors duration-150"
            style={{ color: 'var(--s-text-dim)' }}
          >
            Mentions légales
          </Link>
          <Link
            href="/legal/confidentialite"
            className="transition-colors duration-150"
            style={{ color: 'var(--s-text-dim)' }}
          >
            Confidentialité
          </Link>
        </div>
      </div>
    </footer>
  );
}
