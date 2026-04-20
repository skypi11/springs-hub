'use client';

// Petit composant pour afficher une référence à un utilisateur dans le panel admin.
// - Si on connaît le nom : affiche "Nom ↗" cliquable vers le profil + UID en gris dessous (cliquable = copie).
// - Si on n'a que l'UID : affiche l'UID tout court cliquable pour copier.
// À utiliser partout où un UID apparaît dans l'admin pour qu'on n'ait jamais à
// chercher à qui appartient un "discord_123…".

import { useState } from 'react';
import Link from 'next/link';
import { User as UserIcon, Building2, ExternalLink, type LucideIcon } from 'lucide-react';

type Props = {
  uid?: string | null;
  name?: string | null;
  kind?: 'user' | 'structure';
  // Layout : "row" (nom à droite, UID dessous — dans une definition list),
  //          "inline" (tout sur une ligne, nom + UID petit à côté).
  layout?: 'row' | 'inline';
  // Icône custom (fallback : user/building selon kind).
  icon?: LucideIcon;
};

export default function AdminUserRef({
  uid, name, kind = 'user', layout = 'row', icon,
}: Props) {
  const [copied, setCopied] = useState(false);

  if (!uid) return <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>—</span>;

  const Icon = icon ?? (kind === 'structure' ? Building2 : UserIcon);
  const href = kind === 'structure' ? `/community/structure/${uid}` : `/profile/${uid}`;
  const displayName = name?.trim() || '';

  async function copyUid() {
    try {
      await navigator.clipboard.writeText(uid!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  if (layout === 'inline') {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        {displayName ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: 'var(--s-violet-light)' }}
          >
            <Icon size={12} />
            <span>{displayName}</span>
            <ExternalLink size={9} style={{ opacity: 0.6 }} />
          </Link>
        ) : (
          <button
            type="button"
            onClick={copyUid}
            className="t-mono text-xs hover:opacity-100"
            style={{ color: 'var(--s-text-muted)', opacity: 0.8, cursor: 'pointer' }}
            title="Cliquer pour copier"
          >
            {copied ? '✓ copié' : uid}
          </button>
        )}
      </span>
    );
  }

  // Layout "row" : nom à droite, UID discret en dessous
  return (
    <div className="flex flex-col items-end gap-0.5 min-w-0">
      {displayName ? (
        <Link
          href={href}
          className="flex items-center gap-1.5 text-sm hover:underline"
          style={{ color: 'var(--s-violet-light)' }}
        >
          <Icon size={12} />
          <span className="truncate">{displayName}</span>
          <ExternalLink size={10} style={{ opacity: 0.6 }} />
        </Link>
      ) : null}
      <button
        type="button"
        onClick={copyUid}
        className="t-mono text-xs hover:opacity-100 transition-opacity"
        style={{
          color: 'var(--s-text-muted)',
          opacity: displayName ? 0.6 : 0.9,
          wordBreak: 'break-all',
          textAlign: 'right',
          cursor: 'pointer',
        }}
        title="Cliquer pour copier l'UID"
      >
        {copied ? '✓ copié' : uid}
      </button>
    </div>
  );
}
