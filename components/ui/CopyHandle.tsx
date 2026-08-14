'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

// Le pseudo Discord de quelqu'un, copiable d'un clic.
//
// L'usage est toujours le même : le coller dans la recherche de Discord pour
// retrouver la personne, ou dans un message pour la citer. Le relire à l'écran
// pour le retaper, sur des pseudos qui comportent souvent des chiffres et des
// underscores, c'est une faute de frappe qui attend.
//
// Vivait en double : une copie dans le Dossier d'une inscription en
// compétition, l'autre à écrire pour la console de la LAN. Une seule
// désormais — la seule chose qui diffère d'un contexte à l'autre est la
// couleur de l'accusé, l'or étant proscrit là où il signale une action à faire.

export default function CopyHandle({
  handle,
  confirmColor = 'var(--s-green)',
  title = 'Copier le pseudo Discord',
}: {
  handle: string;
  /** Couleur de l'accusé de copie, 1,2 s. */
  confirmColor?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1 whitespace-nowrap hover:underline"
      style={{ color: 'var(--s-text-dim)' }}
      title={title}
      // La ligne qui porte ce bouton est souvent cliquable elle-même : copier
      // un pseudo ne doit pas déplier un dossier au passage.
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          ?.writeText(`@${handle}`)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      <span className="t-mono truncate">@{handle}</span>
      {copied ? (
        <Check size={12} className="shrink-0" style={{ color: confirmColor }} aria-hidden />
      ) : (
        <Copy size={12} className="shrink-0" aria-hidden />
      )}
    </button>
  );
}
