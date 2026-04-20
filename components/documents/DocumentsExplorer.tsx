'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder as FolderIcon, FolderPlus, Upload, File as FileIcon, FileText, Image as ImageIcon,
  Pencil, Trash2, Download, ChevronRight, Home, Loader2, FolderInput, X, Lock, ShieldCheck, Eye,
} from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import Portal from '@/components/ui/Portal';

type Folder = {
  id: string;
  structureId: string;
  parentId: string | null;
  name: string;
  createdAt?: string | null;
};

type Doc = {
  id: string;
  structureId: string;
  folderId: string | null;
  filename: string;
  mime: string;
  sizeBytes: number;
  title: string;
  notes?: string | null;
  uploadedBy: string;
  sensitive?: boolean;
  encrypted?: boolean;
  createdAt?: string | null;
};

export default function DocumentsExplorer({ structureId }: { structureId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [usage, setUsage] = useState<{ used: number; quota: number }>({ used: 0, quota: UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES });
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [movingDoc, setMovingDoc] = useState<{ type: 'doc' | 'folder'; id: string; currentParent: string | null } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) { setLoading(false); return; }
      const [fRes, dRes] = await Promise.all([
        fetch(`/api/structures/${structureId}/folders`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/structures/${structureId}/documents?folderId=${currentFolderId ?? ''}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const fData = await fRes.json().catch(() => ({}));
      const dData = await dRes.json().catch(() => ({}));
      if (fRes.ok) setFolders(fData.folders ?? []);
      if (dRes.ok) {
        setDocuments(dData.documents ?? []);
        setUsage({ used: dData.usageBytes ?? 0, quota: dData.quotaBytes ?? UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES });
      }
    } catch {
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [structureId, currentFolderId, toast]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const subFolders = useMemo(
    () => folders.filter(f => f.parentId === currentFolderId)
                  .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    [folders, currentFolderId]
  );

  const breadcrumb = useMemo(() => {
    const chain: Folder[] = [];
    let cur = currentFolderId;
    const byId = new Map(folders.map(f => [f.id, f]));
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const f = byId.get(cur);
      if (!f) break;
      chain.unshift(f);
      cur = f.parentId;
    }
    return chain;
  }, [folders, currentFolderId]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) { setCreatingFolder(false); setNewFolderName(''); return; }
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch(`/api/structures/${structureId}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ parentId: currentFolderId, name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data?.error || 'Erreur création dossier');
      return;
    }
    toast.success('Dossier créé');
    setCreatingFolder(false);
    setNewFolderName('');
    void loadAll();
  }, [newFolderName, structureId, currentFolderId, toast, loadAll]);

  const renameItem = useCallback(async (type: 'folder' | 'doc', id: string) => {
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); return; }
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const url = type === 'folder'
      ? `/api/structures/${structureId}/folders/${id}`
      : `/api/structures/${structureId}/documents/${id}`;
    const body = type === 'folder' ? { name } : { title: name };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data?.error || 'Erreur'); return; }
    toast.success('Renommé');
    setRenamingId(null);
    void loadAll();
  }, [renameValue, structureId, toast, loadAll]);

  const deleteFolder = useCallback(async (f: Folder) => {
    const ok = await confirm({
      title: 'Supprimer ce dossier ?',
      message: `Le dossier "${f.name}" sera supprimé. Il doit être vide.`,
      confirmLabel: 'Supprimer', variant: 'danger',
    });
    if (!ok) return;
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch(`/api/structures/${structureId}/folders/${f.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data?.error || 'Erreur suppression'); return; }
    toast.success('Dossier supprimé');
    void loadAll();
  }, [structureId, confirm, toast, loadAll]);

  const deleteDoc = useCallback(async (d: Doc) => {
    const ok = await confirm({
      title: 'Supprimer ce document ?',
      message: `"${d.title}" sera définitivement effacé.`,
      confirmLabel: 'Supprimer', variant: 'danger',
    });
    if (!ok) return;
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch(`/api/structures/${structureId}/documents/${d.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data?.error || 'Erreur suppression'); return; }
    toast.success('Document supprimé');
    void loadAll();
  }, [structureId, confirm, toast, loadAll]);

  // Détermine si un fichier peut être prévisualisé en ligne (iframe/img)
  const isPreviewable = (mime: string): boolean => {
    if (mime.startsWith('image/')) return true;
    if (mime === 'application/pdf') return true;
    if (mime === 'text/plain' || mime === 'text/markdown') return true;
    return false;
  };

  const openPreview = useCallback((d: Doc) => {
    if (!isPreviewable(d.mime)) {
      toast.info('Aperçu non supporté — téléchargement à la place');
      // Fallback : on lance le download standard
      void (async () => {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`/api/structures/${structureId}/documents/${d.id}/download`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { toast.error('Erreur téléchargement'); return; }
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const data = await res.json();
          if (data.url) window.location.href = data.url;
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = d.filename; document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
        }
      })();
      return;
    }
    setPreviewDoc(d);
  }, [structureId, toast]);

  const downloadDoc = useCallback(async (d: Doc) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch(`/api/structures/${structureId}/documents/${d.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.error || 'Erreur téléchargement');
      return;
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      // Doc non chiffré : URL signée 60s
      const data = await res.json();
      if (!data.url) { toast.error('Erreur téléchargement'); return; }
      window.location.href = data.url as string;
      return;
    }
    // Doc chiffré : binaire déchiffré côté serveur, on déclenche un download manuel
    const blob = await res.blob();
    const disp = res.headers.get('content-disposition') || '';
    const m = disp.match(/filename="?([^";]+)"?/);
    const filename = m?.[1] || d.filename || 'document';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [structureId, toast]);

  const moveItem = useCallback(async (targetParentId: string | null) => {
    if (!movingDoc) return;
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const url = movingDoc.type === 'folder'
      ? `/api/structures/${structureId}/folders/${movingDoc.id}`
      : `/api/structures/${structureId}/documents/${movingDoc.id}`;
    const body = movingDoc.type === 'folder'
      ? { parentId: targetParentId }
      : { folderId: targetParentId };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data?.error || 'Erreur déplacement'); return; }
    toast.success('Déplacé');
    setMovingDoc(null);
    void loadAll();
  }, [movingDoc, structureId, toast, loadAll]);

  // ── Upload ────────────────────────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File, sensitive: boolean) => {
    if (uploading) return;
    if (file.size > UPLOAD_LIMITS.STAFF_DOCUMENT_BYTES) {
      const mb = Math.round(UPLOAD_LIMITS.STAFF_DOCUMENT_BYTES / (1024 * 1024));
      toast.error(`Fichier trop lourd — max ${mb} MB`);
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) { toast.error('Session expirée'); return; }

      // Sensible : upload direct au serveur (multipart/form-data) qui chiffre
      // puis pousse vers R2. Évite le passage en clair sur R2 ET les soucis CORS.
      if (sensitive) {
        const form = new FormData();
        form.append('file', file);
        form.append('folderId', currentFolderId ?? '');
        form.append('title', file.name.replace(/\.[^.]+$/, ''));

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `/api/structures/${structureId}/documents/upload-sensitive`);
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.upload.onprogress = ev => {
            if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              let msg = `HTTP ${xhr.status}`;
              try {
                const j = JSON.parse(xhr.responseText);
                if (j?.error) msg = j.error;
              } catch { /* ignore */ }
              reject(new Error(msg));
            }
          };
          xhr.onerror = () => reject(new Error('network'));
          xhr.send(form);
        });

        toast.success('Document chiffré et ajouté');
        void loadAll();
        return;
      }

      // Non-sensible : flow standard (presigned URL → PUT direct vers R2)
      const isImage = file.type.startsWith('image/');
      let payload: Blob = file;
      let mime = file.type || 'application/octet-stream';

      if (isImage) {
        // Conversion webp côté client pour économiser le stockage
        try {
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
            if (blob) {
              payload = blob;
              mime = 'image/webp';
            }
          }
        } catch {
          // Fallback : on garde l'image d'origine si la conversion échoue
        }
      }

      const prep = await fetch(`/api/structures/${structureId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          folderId: currentFolderId,
          filename: file.name,
          mime,
          sizeBytes: payload.size,
          title: file.name.replace(/\.[^.]+$/, ''),
          sensitive: false,
        }),
      });
      const prepData = await prep.json().catch(() => ({}));
      if (!prep.ok) { toast.error(prepData?.error || 'Échec préparation'); return; }
      const { documentId, uploadUrl } = prepData as { documentId: string; uploadUrl: string };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', mime);
        xhr.upload.onprogress = ev => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`R2 status ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('network'));
        xhr.send(payload);
      });

      const fin = await fetch(`/api/structures/${structureId}/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ finalize: true }),
      });
      const finData = await fin.json().catch(() => ({}));
      if (!fin.ok) { toast.error(finData?.error || 'Échec finalisation'); return; }

      toast.success('Document ajouté');
      void loadAll();
    } catch (err) {
      console.error('[documents] upload error', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erreur upload : ${msg.slice(0, 100)}`);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }, [uploading, structureId, currentFolderId, toast, loadAll]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setPendingFile(f);
    e.target.value = '';
  };

  const usagePct = Math.min(100, Math.round((usage.used / usage.quota) * 100));

  return (
    <div className="space-y-4">
      {/* Breadcrumb + quota */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-sm flex-wrap">
          <button type="button" onClick={() => setCurrentFolderId(null)}
            className="flex items-center gap-1 hover:opacity-100 transition-opacity"
            style={{ color: currentFolderId === null ? 'var(--s-text)' : 'var(--s-text-dim)', opacity: currentFolderId === null ? 1 : 0.75 }}>
            <Home size={13} /> Racine
          </button>
          {breadcrumb.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight size={12} style={{ color: 'var(--s-text-muted)' }} />
              <button type="button" onClick={() => setCurrentFolderId(f.id)}
                className="hover:opacity-100 transition-opacity"
                style={{
                  color: i === breadcrumb.length - 1 ? 'var(--s-text)' : 'var(--s-text-dim)',
                  opacity: i === breadcrumb.length - 1 ? 1 : 0.75,
                }}>
                {f.name}
              </button>
            </span>
          ))}
        </div>

        <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          {formatSize(usage.used)} / {formatSize(usage.quota)}
          <span className="ml-2 inline-block align-middle" style={{ width: 80, height: 4, background: 'var(--s-border)' }}>
            <span style={{
              display: 'block', height: '100%',
              width: `${usagePct}%`,
              background: usagePct > 90 ? '#ef4444' : usagePct > 70 ? 'var(--s-gold)' : 'var(--s-green)',
            }} />
          </span>
        </div>
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button"
          onClick={() => { setCreatingFolder(true); setNewFolderName(''); }}
          className="btn-springs btn-secondary bevel-sm text-xs flex items-center gap-1.5">
          <FolderPlus size={12} /> Nouveau dossier
        </button>
        <button type="button"
          onClick={() => !uploading && fileInputRef.current?.click()}
          disabled={uploading}
          className="btn-springs btn-primary bevel-sm text-xs flex items-center gap-1.5">
          {uploading ? <><Loader2 size={12} className="animate-spin" /> {progress}%</> : <><Upload size={12} /> Uploader un fichier</>}
        </button>
        <input ref={fileInputRef} type="file" onChange={onPick} className="hidden" disabled={uploading} />
      </div>

      {/* Formulaire nouveau dossier */}
      {creatingFolder && (
        <div className="flex items-center gap-2 bevel-sm p-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <FolderIcon size={14} style={{ color: 'var(--s-gold)' }} />
          <input autoFocus
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void createFolder();
              if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
            }}
            placeholder="Nom du dossier"
            className="settings-input flex-1 text-sm"
            maxLength={80} />
          <button type="button" onClick={() => void createFolder()} className="btn-springs btn-primary bevel-sm text-xs">Créer</button>
          <button type="button" onClick={() => { setCreatingFolder(false); setNewFolderName(''); }} className="btn-springs btn-secondary bevel-sm text-xs">Annuler</button>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <p className="text-center py-8 text-sm" style={{ color: 'var(--s-text-muted)' }}>Chargement…</p>
      ) : subFolders.length === 0 && documents.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--s-text-muted)' }}>
          <FolderIcon size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Dossier vide. Crée un sous-dossier ou upload un fichier.</p>
        </div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {subFolders.map(f => (
            <FolderCard key={f.id}
              folder={f}
              isRenaming={renamingId === `folder:${f.id}`}
              renameValue={renameValue}
              onOpen={() => setCurrentFolderId(f.id)}
              onStartRename={() => { setRenamingId(`folder:${f.id}`); setRenameValue(f.name); }}
              onRenameChange={setRenameValue}
              onRenameSubmit={() => void renameItem('folder', f.id)}
              onRenameCancel={() => setRenamingId(null)}
              onMove={() => setMovingDoc({ type: 'folder', id: f.id, currentParent: f.parentId })}
              onDelete={() => void deleteFolder(f)}
            />
          ))}
          {documents.map(d => (
            <DocCard key={d.id}
              doc={d}
              isRenaming={renamingId === `doc:${d.id}`}
              renameValue={renameValue}
              canPreview={isPreviewable(d.mime)}
              onPreview={() => openPreview(d)}
              onDownload={() => void downloadDoc(d)}
              onStartRename={() => { setRenamingId(`doc:${d.id}`); setRenameValue(d.title); }}
              onRenameChange={setRenameValue}
              onRenameSubmit={() => void renameItem('doc', d.id)}
              onRenameCancel={() => setRenamingId(null)}
              onMove={() => setMovingDoc({ type: 'doc', id: d.id, currentParent: d.folderId })}
              onDelete={() => void deleteDoc(d)}
            />
          ))}
        </div>
      )}

      {/* Modal de déplacement */}
      {movingDoc && (
        <MoveModal
          folders={folders}
          excludeFolderId={movingDoc.type === 'folder' ? movingDoc.id : null}
          currentParent={movingDoc.currentParent}
          onClose={() => setMovingDoc(null)}
          onSelect={id => void moveItem(id)}
        />
      )}

      {/* Modal preview document */}
      {previewDoc && (
        <PreviewModal
          doc={previewDoc}
          structureId={structureId}
          onClose={() => setPreviewDoc(null)}
          onDownload={() => { const d = previewDoc; setPreviewDoc(null); void downloadDoc(d); }}
        />
      )}

      {/* Modal choix "sensible ou non" après pick du fichier */}
      {pendingFile && (
        <SensitiveChoiceModal
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onChoose={sensitive => {
            const f = pendingFile;
            setPendingFile(null);
            void uploadFile(f, sensitive);
          }}
        />
      )}
    </div>
  );
}

function SensitiveChoiceModal({ file, onCancel, onChoose }: {
  file: File;
  onCancel: () => void;
  onChoose: (sensitive: boolean) => void;
}) {
  const [hover, setHover] = useState<'sensitive' | 'standard' | null>(null);
  return (
    <Portal>
      <div className="fixed inset-0 z-[9600] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onCancel}>
        <div className="bevel w-full max-w-lg overflow-hidden flex flex-col"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
          onClick={e => e.stopPropagation()}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), transparent 70%)' }} />
          <header className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <h3 className="font-display text-sm tracking-wider">TYPE DE FICHIER</h3>
            <button type="button" onClick={onCancel} className="flex items-center justify-center"
              style={{ width: 28, height: 28, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
              <X size={14} />
            </button>
          </header>
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
              <FileIcon size={13} />
              <span className="truncate">{file.name}</span>
              <span style={{ color: 'var(--s-text-muted)' }}>·</span>
              <span style={{ color: 'var(--s-text-muted)' }}>{formatSize(file.size)}</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Ce fichier contient-il des <strong style={{ color: 'var(--s-text)' }}>informations personnelles ou confidentielles</strong> ?
              (pièce d&apos;identité, justificatif de domicile, RIB, contrat, statuts de l&apos;asso, document médical…)
            </p>

            <div className="grid gap-2 md:grid-cols-2">
              <button type="button"
                onClick={() => onChoose(true)}
                onMouseEnter={() => setHover('sensitive')}
                onMouseLeave={() => setHover(null)}
                className="bevel-sm p-4 text-left transition-all cursor-pointer"
                style={{
                  background: hover === 'sensitive' ? 'rgba(123,47,190,0.15)' : 'var(--s-elevated)',
                  border: hover === 'sensitive'
                    ? '1px solid rgba(123,47,190,0.75)'
                    : '1px solid rgba(123,47,190,0.35)',
                  transform: hover === 'sensitive' ? 'translateY(-1px)' : 'none',
                }}>
                <div className="flex items-center gap-2 mb-2">
                  <Lock size={14} style={{ color: 'var(--s-violet-light)' }} />
                  <span className="font-display text-xs tracking-wider" style={{ color: 'var(--s-violet-light)' }}>OUI — SENSIBLE</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  Chiffré <strong>AES-256-GCM</strong> avant stockage. Lisible uniquement via le site après authentification.
                </p>
              </button>

              <button type="button"
                onClick={() => onChoose(false)}
                onMouseEnter={() => setHover('standard')}
                onMouseLeave={() => setHover(null)}
                className="bevel-sm p-4 text-left transition-all cursor-pointer"
                style={{
                  background: hover === 'standard' ? 'var(--s-hover)' : 'var(--s-elevated)',
                  border: hover === 'standard'
                    ? '1px solid rgba(255,255,255,0.22)'
                    : '1px solid var(--s-border)',
                  transform: hover === 'standard' ? 'translateY(-1px)' : 'none',
                }}>
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck size={14} style={{ color: 'var(--s-text-dim)' }} />
                  <span className="font-display text-xs tracking-wider" style={{ color: 'var(--s-text)' }}>NON — STANDARD</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  Logo, visuel, document interne non sensible. Stockage normal, accès restreint au staff.
                </p>
              </button>
            </div>

            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              En cas de doute, choisis <strong>Sensible</strong> — le chiffrement est transparent à l&apos;usage.
            </p>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────

function FolderCard({ folder, isRenaming, renameValue, onOpen, onStartRename, onRenameChange, onRenameSubmit, onRenameCancel, onMove, onDelete }: {
  folder: Folder; isRenaming: boolean; renameValue: string;
  onOpen: () => void; onStartRename: () => void;
  onRenameChange: (v: string) => void; onRenameSubmit: () => void; onRenameCancel: () => void;
  onMove: () => void; onDelete: () => void;
}) {
  return (
    <div className="bevel-sm p-3 flex items-center gap-3 group transition-all"
      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
      <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center"
        style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)' }}>
        <FolderIcon size={16} style={{ color: 'var(--s-gold)' }} />
      </div>
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <input autoFocus value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameSubmit}
            className="settings-input w-full text-sm"
            maxLength={80} />
        ) : (
          <button type="button" onClick={onOpen}
            className="text-sm font-medium truncate block text-left w-full hover:opacity-100 transition-opacity"
            style={{ color: 'var(--s-text)' }}>
            {folder.name}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <IconBtn title="Renommer" onClick={onStartRename}><Pencil size={12} /></IconBtn>
        <IconBtn title="Déplacer" onClick={onMove}><FolderInput size={12} /></IconBtn>
        <IconBtn title="Supprimer" onClick={onDelete} danger><Trash2 size={12} /></IconBtn>
      </div>
    </div>
  );
}

function DocCard({ doc, isRenaming, renameValue, canPreview, onPreview, onDownload, onStartRename, onRenameChange, onRenameSubmit, onRenameCancel, onMove, onDelete }: {
  doc: Doc; isRenaming: boolean; renameValue: string;
  canPreview: boolean;
  onPreview: () => void;
  onDownload: () => void; onStartRename: () => void;
  onRenameChange: (v: string) => void; onRenameSubmit: () => void; onRenameCancel: () => void;
  onMove: () => void; onDelete: () => void;
}) {
  const { Icon, color } = iconForMime(doc.mime);
  return (
    <div className="bevel-sm p-3 flex items-center gap-3 group"
      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
      <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center"
        style={{ background: `${color}15`, border: `1px solid ${color}40` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <input autoFocus value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameSubmit}
            className="settings-input w-full text-sm"
            maxLength={120} />
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--s-text)' }}>{doc.title}</div>
              {doc.encrypted && (
                <span title="Chiffré AES-256-GCM" style={{ flexShrink: 0, lineHeight: 0 }}>
                  <Lock size={11} style={{ color: 'var(--s-violet-light)' }} />
                </span>
              )}
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
              {formatSize(doc.sizeBytes)} · {doc.filename}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {canPreview && <IconBtn title="Aperçu" onClick={onPreview}><Eye size={12} /></IconBtn>}
        <IconBtn title="Télécharger" onClick={onDownload}><Download size={12} /></IconBtn>
        <IconBtn title="Renommer" onClick={onStartRename}><Pencil size={12} /></IconBtn>
        <IconBtn title="Déplacer" onClick={onMove}><FolderInput size={12} /></IconBtn>
        <IconBtn title="Supprimer" onClick={onDelete} danger><Trash2 size={12} /></IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="flex items-center justify-center transition-opacity hover:opacity-100"
      style={{
        width: 26, height: 26,
        background: 'var(--s-surface)',
        border: '1px solid var(--s-border)',
        color: danger ? '#ef4444' : 'var(--s-text-dim)',
        opacity: 0.75,
      }}>
      {children}
    </button>
  );
}

function MoveModal({ folders, excludeFolderId, currentParent, onClose, onSelect }: {
  folders: Folder[];
  excludeFolderId: string | null;     // quand on déplace un dossier, on exclut lui-même + ses descendants
  currentParent: string | null;
  onClose: () => void;
  onSelect: (targetParentId: string | null) => void;
}) {
  // Calcule l'ensemble des dossiers interdits (le dossier déplacé + ses descendants — anti-cycle)
  const forbidden = useMemo(() => {
    if (!excludeFolderId) return new Set<string>();
    const set = new Set<string>([excludeFolderId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) {
        if (!set.has(f.id) && f.parentId && set.has(f.parentId)) {
          set.add(f.id);
          added = true;
        }
      }
    }
    return set;
  }, [excludeFolderId, folders]);

  // Arborescence affichée : racine + tous les dossiers non interdits
  const tree = useMemo(() => {
    const byParent = new Map<string | null, Folder[]>();
    for (const f of folders) {
      if (forbidden.has(f.id)) continue;
      const key = f.parentId;
      const arr = byParent.get(key) ?? [];
      arr.push(f);
      byParent.set(key, arr);
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    }
    return byParent;
  }, [folders, forbidden]);

  const renderNode = (parentId: string | null, depth: number): React.ReactNode => {
    const nodes = tree.get(parentId) ?? [];
    return nodes.map(f => (
      <div key={f.id}>
        <button type="button"
          onClick={() => onSelect(f.id)}
          disabled={currentParent === f.id}
          className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm transition-colors"
          style={{
            paddingLeft: 8 + depth * 16,
            color: currentParent === f.id ? 'var(--s-text-muted)' : 'var(--s-text)',
            cursor: currentParent === f.id ? 'default' : 'pointer',
            background: 'transparent',
          }}>
          <FolderIcon size={13} style={{ color: 'var(--s-gold)' }} />
          <span className="truncate">{f.name}</span>
          {currentParent === f.id && <span className="text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>(ici)</span>}
        </button>
        {renderNode(f.id, depth + 1)}
      </div>
    ));
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[9600] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
        <div className="bevel w-full max-w-md max-h-[70vh] overflow-hidden flex flex-col"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
          onClick={e => e.stopPropagation()}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 70%)' }} />
          <header className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <h3 className="font-display text-sm tracking-wider">DÉPLACER VERS</h3>
            <button type="button" onClick={onClose} className="flex items-center justify-center"
              style={{ width: 28, height: 28, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
              <X size={14} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto py-2">
            <button type="button"
              onClick={() => onSelect(null)}
              disabled={currentParent === null}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm"
              style={{
                color: currentParent === null ? 'var(--s-text-muted)' : 'var(--s-text)',
                cursor: currentParent === null ? 'default' : 'pointer',
              }}>
              <Home size={13} style={{ color: 'var(--s-gold)' }} />
              <span>Racine</span>
              {currentParent === null && <span className="text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>(ici)</span>}
            </button>
            {renderNode(null, 0)}
          </div>
        </div>
      </div>
    </Portal>
  );
}

function PreviewModal({ doc, structureId, onClose, onDownload }: {
  doc: Doc;
  structureId: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) { setError('Session expirée'); return; }
        const res = await fetch(
          `/api/structures/${structureId}/documents/${doc.id}/download?preview=1`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error || 'Erreur chargement aperçu');
          return;
        }
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          // Doc non chiffré : on récupère une URL signée inline
          const data = await res.json();
          if (cancelled) return;
          setSrc(data.url || null);
        } else {
          // Doc chiffré : binaire déchiffré → blob URL
          const blob = await res.blob();
          if (cancelled) return;
          if (doc.mime === 'text/plain' || doc.mime === 'text/markdown') {
            const txt = await blob.text();
            if (!cancelled) setTextContent(txt);
          } else {
            blobUrl = URL.createObjectURL(blob);
            setSrc(blobUrl);
          }
        }
      } catch {
        if (!cancelled) setError('Erreur réseau');
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [doc.id, doc.mime, structureId]);

  // Pour les docs texte non chiffrés (URL signée), on doit fetcher le contenu séparément
  useEffect(() => {
    if (!src) return;
    if (doc.mime !== 'text/plain' && doc.mime !== 'text/markdown') return;
    if (textContent !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(src);
        const t = await r.text();
        if (!cancelled) setTextContent(t);
      } catch {
        if (!cancelled) toast.error('Erreur chargement texte');
      }
    })();
    return () => { cancelled = true; };
  }, [src, doc.mime, textContent, toast]);

  const isImage = doc.mime.startsWith('image/');
  const isPdf = doc.mime === 'application/pdf';
  const isText = doc.mime === 'text/plain' || doc.mime === 'text/markdown';

  return (
    <Portal>
      <div className="fixed inset-0 z-[9600] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
        <div className="bevel w-full max-w-5xl flex flex-col overflow-hidden"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', height: '90vh' }}
          onClick={e => e.stopPropagation()}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), transparent 70%)' }} />
          <header className="flex items-center justify-between gap-3 px-4 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <Eye size={14} style={{ color: 'var(--s-violet-light)', flexShrink: 0 }} />
              <h3 className="font-display text-sm tracking-wider truncate">{doc.title}</h3>
              {doc.encrypted && (
                <span title="Chiffré AES-256-GCM" style={{ lineHeight: 0, flexShrink: 0 }}>
                  <Lock size={11} style={{ color: 'var(--s-violet-light)' }} />
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button type="button" onClick={onDownload}
                className="btn-springs btn-secondary bevel-sm text-xs flex items-center gap-1.5">
                <Download size={12} /> Télécharger
              </button>
              <button type="button" onClick={onClose} className="flex items-center justify-center"
                style={{ width: 28, height: 28, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
                <X size={14} />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-hidden flex items-center justify-center"
            style={{ background: 'var(--s-bg)' }}>
            {error ? (
              <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
            ) : !src && !textContent ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
                <Loader2 size={14} className="animate-spin" /> Chargement…
              </div>
            ) : isImage && src ? (
              <img src={src} alt={doc.title}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : isPdf && src ? (
              <iframe src={src} title={doc.title}
                style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
            ) : isText && textContent !== null ? (
              <pre className="w-full h-full overflow-auto p-4 text-xs"
                style={{ color: 'var(--s-text)', background: 'var(--s-surface)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace' }}>
                {textContent}
              </pre>
            ) : (
              <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Aperçu non disponible</p>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function iconForMime(mime: string): { Icon: typeof FileIcon; color: string } {
  if (mime.startsWith('image/')) return { Icon: ImageIcon, color: '#a364d9' };
  if (mime === 'application/pdf') return { Icon: FileText, color: '#ef4444' };
  if (mime.includes('word') || mime.includes('document')) return { Icon: FileText, color: '#2b7fff' };
  if (mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv') return { Icon: FileText, color: '#00D936' };
  if (mime.includes('presentation') || mime.includes('powerpoint')) return { Icon: FileText, color: '#ff9500' };
  if (mime.includes('zip') || mime.includes('compressed')) return { Icon: FileIcon, color: '#7a7a95' };
  return { Icon: FileIcon, color: 'var(--s-text-dim)' };
}
