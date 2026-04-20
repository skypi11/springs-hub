'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import { api } from '@/lib/api-client';

interface Props {
  structureId: string;
  teamId: string;
  eventId?: string | null;
  onUploaded: () => void;   // invoqué après finalisation — le parent recharge la liste
  disabled?: boolean;
  compact?: boolean;        // rendu compact pour intégration dans EventDetailModal
}

// Upload en 3 étapes :
// 1. POST /replays → obtient URL signée R2 + replayId (doc Firestore pending)
// 2. PUT direct sur R2 (binary)
// 3. PATCH /replays/[id] avec finalize=true → status ready
export default function ReplayUploader({ structureId, teamId, eventId, onUploaded, disabled, compact }: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFile = useCallback(async (file: File) => {
    if (uploading || disabled) return;

    if (!file.name.toLowerCase().endsWith('.replay')) {
      toast.error('Extension invalide — uniquement .replay');
      return;
    }
    if (file.size > UPLOAD_LIMITS.REPLAY_BYTES) {
      const mb = Math.round(UPLOAD_LIMITS.REPLAY_BYTES / (1024 * 1024));
      toast.error(`Fichier trop lourd — max ${mb} MB`);
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      // 1. Prépare (signed URL + doc pending)
      const { replayId, uploadUrl } = await api<{ replayId: string; uploadUrl: string }>(
        `/api/structures/${structureId}/replays`,
        {
          method: 'POST',
          body: {
            teamId,
            eventId: eventId ?? null,
            filename: file.name,
            sizeBytes: file.size,
            contentType: file.type || 'application/octet-stream',
          },
        }
      );

      // 2. PUT R2 (XHR pour avoir la progression — pas passé par api-client car URL externe signée)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`R2 status ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('network'));
        xhr.send(file);
      });

      // 3. Finalize
      await api(`/api/structures/${structureId}/replays/${replayId}`, {
        method: 'PATCH',
        body: { finalize: true },
      });

      toast.success('Replay ajouté');
      onUploaded();
    } catch (err) {
      toast.error((err as Error).message || "Erreur pendant l'upload");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }, [structureId, teamId, eventId, onUploaded, toast, uploading, disabled]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = '';
  };

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => !uploading && !disabled && inputRef.current?.click()}
          disabled={uploading || disabled}
          className="btn-springs btn-secondary bevel-sm text-xs flex items-center gap-1.5"
        >
          {uploading ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              <span>{progress}%</span>
            </>
          ) : (
            <>
              <Upload size={11} />
              <span>Ajouter un replay</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".replay"
          onChange={onPick}
          disabled={uploading || disabled}
          className="hidden"
        />
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div
        onClick={() => !uploading && !disabled && inputRef.current?.click()}
        className="bevel-sm relative overflow-hidden cursor-pointer transition-all p-8 flex flex-col items-center justify-center gap-2"
        style={{
          background: 'var(--s-elevated)',
          border: '1px dashed var(--s-border)',
          opacity: disabled ? 0.5 : 1,
          color: 'var(--s-text-muted)',
        }}
      >
        {uploading ? (
          <>
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
            <span className="text-xs">Upload en cours — {progress}%</span>
            <div className="w-full max-w-[240px] h-1" style={{ background: 'var(--s-border)' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--s-gold)', transition: 'width 120ms linear' }} />
            </div>
          </>
        ) : (
          <>
            <Upload size={22} />
            <span className="text-xs">Cliquer pour choisir un fichier .replay</span>
            <span className="text-xs" style={{ fontSize: '10px' }}>Max 10 MB</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".replay"
        onChange={onPick}
        disabled={uploading || disabled}
        className="hidden"
      />
    </div>
  );
}
