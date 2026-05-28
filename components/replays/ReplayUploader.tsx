'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import { api } from '@/lib/api-client';

interface Props {
  structureId: string;
  teamId: string;
  eventId?: string | null;
  onUploaded: () => void;   // invoqué après finalisation, le parent recharge la liste
  disabled?: boolean;
  compact?: boolean;        // rendu compact pour intégration dans EventDetailModal
}

interface UploadItem {
  filename: string;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  progress: number;
  error?: string;
}

// Nombre max d'uploads simultanés vers R2 + ballchasing. 3 est un bon
// compromis : assez parallèle pour 5-10 replays d'un BOX en 1-2min total,
// pas trop pour ne pas saturer le réseau / la function Vercel finalize.
const MAX_CONCURRENT = 3;

// Upload en 3 étapes par fichier :
// 1. POST /replays → URL signée R2 + replayId (doc Firestore pending)
// 2. PUT direct sur R2 (binary, suit la progression via XHR)
// 3. PATCH /replays/[id] avec finalize=true → status ready
//
// Supporte le multi-fichiers : input multiple + drag-drop. Les uploads se
// font en parallèle (cap 3), si l'un fail les autres continuent.
export default function ReplayUploader({ structureId, teamId, eventId, onUploaded, disabled, compact }: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Upload d'un seul fichier. Renvoie true si OK, false sinon.
  // Met à jour `items` par index.
  const uploadOne = useCallback(async (file: File, index: number, setOne: (next: Partial<UploadItem>) => void): Promise<boolean> => {
    try {
      setOne({ status: 'uploading', progress: 0 });

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

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setOne({ progress: Math.round((ev.loaded / ev.total) * 100) });
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`R2 status ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('network'));
        xhr.send(file);
      });

      await api(`/api/structures/${structureId}/replays/${replayId}`, {
        method: 'PATCH',
        body: { finalize: true },
      });

      setOne({ status: 'done', progress: 100 });
      return true;
    } catch (err) {
      setOne({ status: 'failed', error: (err as Error).message || 'Erreur upload' });
      return false;
    }
  }, [structureId, teamId, eventId]);

  // Process N fichiers en parallèle avec un cap de MAX_CONCURRENT simultanés.
  const handleFiles = useCallback(async (filesList: File[]) => {
    if (busy || disabled || filesList.length === 0) return;

    // Pré-validation : extension + taille. Garde uniquement les fichiers valides
    // mais affiche un toast pour ceux qui sortent.
    const valid: File[] = [];
    let rejected = 0;
    for (const f of filesList) {
      if (!f.name.toLowerCase().endsWith('.replay')) { rejected++; continue; }
      if (f.size > UPLOAD_LIMITS.REPLAY_BYTES) { rejected++; continue; }
      valid.push(f);
    }
    if (rejected > 0) {
      const mb = Math.round(UPLOAD_LIMITS.REPLAY_BYTES / (1024 * 1024));
      toast.error(`${rejected} fichier(s) ignoré(s) : extension .replay et max ${mb} MB requis`);
    }
    if (valid.length === 0) return;

    const initial: UploadItem[] = valid.map(f => ({ filename: f.name, status: 'queued', progress: 0 }));
    setItems(initial);
    setBusy(true);

    // Helper pour mettre à jour un item par index sans race.
    const updateAt = (i: number) => (next: Partial<UploadItem>) =>
      setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...next } : it));

    // Semaphore artisanal : on lance MAX_CONCURRENT workers qui pull dans la queue.
    let nextIndex = 0;
    let succeeded = 0;
    let failed = 0;
    const worker = async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= valid.length) return;
        const ok = await uploadOne(valid[i], i, updateAt(i));
        if (ok) succeeded++; else failed++;
        // Recharge la liste replays au fil de l'eau, l'utilisateur voit
        // chaque replay apparaître au moment où il finit.
        onUploaded();
      }
    };

    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, valid.length) }, () => worker());
    await Promise.all(workers);

    setBusy(false);

    // Récap toast final
    if (failed === 0) {
      toast.success(`${succeeded} replay${succeeded > 1 ? 's' : ''} ajouté${succeeded > 1 ? 's' : ''}`);
    } else if (succeeded === 0) {
      toast.error(`${failed} échec${failed > 1 ? 's' : ''} d'upload`);
    } else {
      toast.error(`${succeeded} sur ${succeeded + failed} uploadés, ${failed} échec${failed > 1 ? 's' : ''}`);
    }

    // Auto-clear la liste après 4s si tout est OK (sinon on laisse pour debug)
    if (failed === 0) {
      setTimeout(() => setItems([]), 4000);
    }
  }, [busy, disabled, toast, uploadOne, onUploaded]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) void handleFiles(files);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (busy || disabled) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void handleFiles(files);
  };

  // ── Rendu compact (boutons dans header section replays) ─────────────────
  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => !busy && !disabled && inputRef.current?.click()}
          disabled={busy || disabled}
          className="btn-springs btn-secondary bevel-sm text-xs flex items-center gap-1.5"
        >
          {busy ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              <span>Upload {items.filter(i => i.status === 'done').length}/{items.length}</span>
            </>
          ) : (
            <>
              <Upload size={11} />
              <span>Ajouter des replays</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".replay"
          multiple
          onChange={onPick}
          disabled={busy || disabled}
          className="hidden"
        />
        {/* Mini liste de progression en compact mode (sous le bouton) */}
        {items.length > 0 && (
          <div className="mt-2 w-full">
            <UploadList items={items} />
          </div>
        )}
      </>
    );
  }

  // ── Rendu large (drag-drop zone) ────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div
        onClick={() => !busy && !disabled && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); if (!busy && !disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="bevel-sm relative overflow-hidden cursor-pointer transition-all p-8 flex flex-col items-center justify-center gap-2"
        style={{
          background: dragOver ? 'var(--s-hover)' : 'var(--s-elevated)',
          border: `1px dashed ${dragOver ? 'var(--s-gold)' : 'var(--s-border)'}`,
          opacity: disabled ? 0.5 : 1,
          color: 'var(--s-text-muted)',
        }}
      >
        {busy ? (
          <>
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
            <span className="text-xs">
              Upload {items.filter(i => i.status === 'done').length} / {items.length}
            </span>
          </>
        ) : (
          <>
            <Upload size={22} />
            <span className="text-xs">Glisse-dépose ou clique pour choisir des fichiers .replay</span>
            <span className="text-xs" style={{ fontSize: '12px' }}>Multiple OK · Max 10 MB par fichier</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".replay"
        multiple
        onChange={onPick}
        disabled={busy || disabled}
        className="hidden"
      />
      {items.length > 0 && <UploadList items={items} />}
    </div>
  );
}

// Liste live des uploads en cours / terminés / échoués.
function UploadList({ items }: { items: UploadItem[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => {
        const icon =
          it.status === 'done' ? <CheckCircle2 size={12} style={{ color: 'var(--s-green)' }} /> :
          it.status === 'failed' ? <XCircle size={12} style={{ color: '#ef4444' }} /> :
          it.status === 'uploading' ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--s-gold)' }} /> :
          <Loader2 size={12} style={{ color: 'var(--s-text-muted)', opacity: 0.5 }} />;

        return (
          <li key={i} className="flex items-center gap-2 px-2 py-1.5 bevel-sm text-xs"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text)' }}>
            {icon}
            <span className="truncate flex-1 min-w-0" title={it.filename}>{it.filename}</span>
            {it.status === 'uploading' && (
              <span className="t-mono text-[11px] flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>
                {it.progress}%
              </span>
            )}
            {it.status === 'failed' && it.error && (
              <span className="text-[11px] truncate max-w-[200px] flex-shrink-0" style={{ color: '#ef4444' }} title={it.error}>
                {it.error}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
