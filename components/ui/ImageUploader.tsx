'use client';

import { useCallback, useRef, useState } from 'react';
import Image from 'next/image';
import { Upload, Loader2, X } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useToast } from '@/components/ui/Toast';

interface ImageUploaderProps {
  // URL actuelle affichée en prévisualisation (null/'' si pas d'image)
  currentUrl?: string | null;
  // Endpoint POST qui accepte le multipart form
  endpoint: string;
  // Champs additionnels à envoyer dans le formData (structureId, type, etc.)
  extraFields?: Record<string, string>;
  // Aspect ratio de la prévisualisation (square pour logo/avatar, banner pour cover)
  aspect: 'square' | 'banner';
  // Taille max côté client (bytes) — affichée dans l'aide
  maxBytes: number;
  // Libellé contextuel
  label: string;
  hint?: string;
  // Callback après upload réussi : reçoit la nouvelle URL publique
  onUploaded: (url: string) => void;
  // Optionnel : callback de suppression (remet logoUrl/coverUrl à '' via un autre endpoint)
  onRemove?: () => Promise<void>;
  disabled?: boolean;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export default function ImageUploader({
  currentUrl,
  endpoint,
  extraFields,
  aspect,
  maxBytes,
  label,
  hint,
  onUploaded,
  onRemove,
  disabled,
}: ImageUploaderProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const maxMb = Math.round(maxBytes / (1024 * 1024));

  const handleFile = useCallback(async (file: File) => {
    if (uploading || disabled) return;

    // Validation côté client (feedback immédiat)
    if (!ACCEPT.split(',').includes(file.type)) {
      toast.error('Format non supporté (JPEG, PNG, WebP, GIF)');
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`Fichier trop lourd — max ${maxMb} MB`);
      return;
    }

    setUploading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        toast.error('Session expirée, reconnecte-toi');
        return;
      }

      const form = new FormData();
      form.append('file', file);
      for (const [k, v] of Object.entries(extraFields ?? {})) {
        form.append(k, v);
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || 'Échec de l\'upload');
        return;
      }
      if (typeof json?.url === 'string') {
        onUploaded(json.url);
        toast.success('Image mise à jour');
      }
    } catch {
      toast.error('Erreur réseau pendant l\'upload');
    } finally {
      setUploading(false);
    }
  }, [endpoint, extraFields, maxBytes, maxMb, onUploaded, toast, uploading, disabled]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = '';  // reset pour pouvoir re-uploader le même fichier
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const handleRemove = async () => {
    if (!onRemove || uploading) return;
    setUploading(true);
    try {
      await onRemove();
    } finally {
      setUploading(false);
    }
  };

  const aspectClass = aspect === 'square'
    ? 'aspect-square max-w-[160px]'
    : 'aspect-[4/1] w-full';

  return (
    <div className="space-y-2">
      <label className="t-label block">{label}</label>

      <div
        className="bevel-sm relative overflow-hidden cursor-pointer transition-all"
        style={{
          background: 'var(--s-elevated)',
          border: `1px dashed ${dragOver ? 'var(--s-gold)' : 'var(--s-border)'}`,
          opacity: disabled ? 0.5 : 1,
        }}
        onClick={() => !uploading && !disabled && inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
      >
        <div className={`relative ${aspectClass}`}>
          {currentUrl ? (
            <Image
              src={currentUrl}
              alt=""
              fill
              className="object-cover"
              unoptimized
              sizes="(max-width: 768px) 100vw, 400px"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"
              style={{ color: 'var(--s-text-muted)' }}>
              <Upload size={24} />
              <span className="text-xs">Déposer ou cliquer</span>
            </div>
          )}

          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(8,8,15,0.7)' }}>
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
            </div>
          )}

          {dragOver && !uploading && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(255,184,0,0.12)' }}>
              <span className="t-label" style={{ color: 'var(--s-gold)' }}>DÉPOSER ICI</span>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          disabled={uploading || disabled}
          className="hidden"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          {hint ?? `JPEG, PNG, WebP, GIF — max ${maxMb} MB`}
        </p>
        {currentUrl && onRemove && !uploading && (
          <button
            type="button"
            onClick={handleRemove}
            className="flex items-center gap-1 text-xs hover:underline"
            style={{ color: '#ef4444' }}
          >
            <X size={12} /> Retirer
          </button>
        )}
      </div>
    </div>
  );
}
