'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { apiForm, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';

// Champ « logo de l'organisateur » : aperçu, upload, retrait.
//
// UPLOAD ET PAS URL. Un lien externe casse (le site source change de chemin,
// l'image est supprimée, le domaine expire) et le jour où il casse, c'est
// l'affiche d'Aedral qui a l'air défaillante — pas le lien. On héberge donc
// le fichier, une bonne fois.
//
// Composant partagé par le formulaire de CIRCUIT et celui de COMPÉTITION :
// les deux portent un organisateur, et la logique d'upload n'a aucune raison
// d'exister en deux exemplaires.

export default function OrganizerLogoField({ value, onChange, label = 'Logo de l\'organisateur (optionnel)' }: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiForm<{ url: string }>('/api/admin/competitions/organizer-logo', fd);
        onChange(res.url);
        toast.success('Logo uploadé.');
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Upload échoué.');
      } finally {
        setUploading(false);
      }
    }
    // Remis à zéro pour que re-choisir LE MÊME fichier redéclenche l'événement.
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div>
      <label className="t-label-soft block mb-2">{label}</label>
      <div className="flex items-center gap-3 flex-wrap">
        {value ? (
          <div className="flex items-center justify-center bevel-sm px-3 flex-shrink-0"
            style={{ height: 56, minWidth: 88, maxWidth: 220, background: 'var(--s-bg)', border: '1px solid var(--s-border)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu logo arbitraire hors remotePatterns */}
            <img src={value} alt="" style={{ maxHeight: 40, maxWidth: 190, width: 'auto', objectFit: 'contain' }} />
          </div>
        ) : (
          <div className="flex items-center justify-center bevel-sm text-xs flex-shrink-0"
            style={{ height: 56, width: 88, background: 'var(--s-bg)', border: '1px dashed var(--s-border)', color: 'var(--s-text-muted)' }}>
            Aperçu
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden" onChange={onFile} />
        <button type="button" className="btn-springs btn-secondary bevel-sm text-sm"
          onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Upload…' : value ? 'Remplacer' : 'Choisir une image'}
        </button>
        {value && !uploading && (
          <button type="button" className="btn-springs btn-ghost text-sm" onClick={() => onChange('')}>
            Retirer
          </button>
        )}
      </div>
      <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
        PNG à fond transparent conseillé (pas de fond noir). Max 2 Mo. Le ratio est conservé, jamais rogné.
      </p>
    </div>
  );
}
