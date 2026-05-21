'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { Upload, X } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

interface PendingImagePickerProps {
  // Fichier sélectionné (null si aucun)
  value: File | null;
  // Callback à chaque changement de sélection
  onChange: (file: File | null) => void;
  // Taille max côté client (bytes) — affichée dans l'aide
  maxBytes: number;
  // Libellé contextuel
  label: string;
  hint?: string;
  // Ratio de la prévisualisation
  aspect?: 'square' | 'banner';
  disabled?: boolean;
}

// Sélecteur d'image « différé » : ne déclenche AUCUN upload, il conserve juste le
// fichier choisi en mémoire et en affiche un aperçu local. Conçu pour les
// formulaires de création (équipe, structure) où la cible d'upload n'existe pas
// encore — le parent uploade le fichier une fois l'entité créée et son ID connu.
export default function PendingImagePicker({
  value, onChange, maxBytes, label, hint, aspect = 'square', disabled,
}: PendingImagePickerProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const maxMb = Math.round(maxBytes / (1024 * 1024));

  // Aperçu local via objectURL — révoqué quand le fichier change ou au démontage.
  useEffect(() => {
    if (!value) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const handleFile = useCallback((file: File) => {
    if (disabled) return;
    if (!ACCEPT.split(',').includes(file.type)) {
      toast.error('Format non supporté (JPEG, PNG, WebP, GIF)');
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`Fichier trop lourd — max ${maxMb} MB`);
      return;
    }
    onChange(file);
  }, [disabled, maxBytes, maxMb, onChange, toast]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const outerClass = aspect === 'square' ? 'w-[160px]' : 'w-full';
  const aspectClass = aspect === 'square' ? 'aspect-square' : 'aspect-[4/1] w-full';

  return (
    <div className="space-y-2">
      <label className="t-label block">{label}</label>

      <div
        className={`bevel-sm relative overflow-hidden cursor-pointer transition-all ${outerClass}`}
        style={{
          background: 'var(--s-elevated)',
          border: `1px dashed ${dragOver ? 'var(--s-gold)' : 'var(--s-border)'}`,
          opacity: disabled ? 0.5 : 1,
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
      >
        <div className={`relative ${aspectClass}`}>
          {previewUrl ? (
            <Image
              src={previewUrl}
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

          {dragOver && (
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
          disabled={disabled}
          className="hidden"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          {hint ?? `JPEG, PNG, WebP, GIF — max ${maxMb} MB`}
        </p>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
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
