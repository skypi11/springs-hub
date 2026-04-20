'use client';

import { useCallback, useState } from 'react';
import { Download, Trash2, Edit2, Check, X, Loader2, Film } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { api } from '@/lib/api-client';

export type ReplayListItem = {
  id: string;
  teamId: string;
  eventId?: string | null;
  uploadedBy: string;
  filename: string;
  sizeBytes: number;
  title: string;
  result?: 'win' | 'loss' | 'draw' | null;
  score?: string | null;
  map?: string | null;
  notes?: string | null;
  createdAt?: string | null;
};

interface Props {
  structureId: string;
  items: ReplayListItem[];
  currentUid: string;
  canDeleteAny: boolean;   // dirigeant → peut supprimer les replays de tous
  canEdit: boolean;        // staff upload-right sur les équipes concernées (simplifié : passé en prop)
  onChanged: () => void;   // parent recharge après suppression / edit
  emptyLabel?: string;
  showEventLink?: boolean; // affiche "Lié à l'event..." dans la liste bibliothèque
  eventTitlesById?: Record<string, string>;
}

const RESULT_LABEL: Record<string, { text: string; color: string }> = {
  win:  { text: 'V', color: '#33ff66' },
  loss: { text: 'D', color: '#ef4444' },
  draw: { text: '=', color: '#7a7a95' },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReplayList({
  structureId,
  items,
  currentUid,
  canDeleteAny,
  canEdit,
  onChanged,
  emptyLabel,
  showEventLink,
  eventTitlesById,
}: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);

  const download = useCallback(async (id: string) => {
    try {
      const data = await api<{ url?: string }>(`/api/structures/${structureId}/replays/${id}/download`);
      if (!data.url) {
        toast.error('Échec du lien de téléchargement');
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      toast.error((err as Error).message || 'Erreur réseau');
    }
  }, [structureId, toast]);

  const remove = useCallback(async (item: ReplayListItem) => {
    const ok = await confirm({
      title: 'Supprimer ce replay ?',
      message: `"${item.title}" sera définitivement effacé du stockage.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/api/structures/${structureId}/replays/${item.id}`, { method: 'DELETE' });
      toast.success('Replay supprimé');
      onChanged();
    } catch (err) {
      toast.error((err as Error).message || 'Échec suppression');
    }
  }, [structureId, confirm, toast, onChanged]);

  if (items.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: 'var(--s-text-muted)' }}>
        <Film size={28} className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">{emptyLabel ?? 'Aucun replay pour l\'instant.'}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map(item => {
        const canDelete = canDeleteAny || item.uploadedBy === currentUid;
        const resultBadge = item.result ? RESULT_LABEL[item.result] : null;
        const isEditing = editingId === item.id;

        return (
          <li key={item.id} className="bevel-sm p-3" style={{
            background: 'var(--s-elevated)',
            border: '1px solid var(--s-border)',
          }}>
            {isEditing ? (
              <ReplayEditForm
                structureId={structureId}
                item={item}
                onClose={() => setEditingId(null)}
                onSaved={() => { setEditingId(null); onChanged(); }}
              />
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                {/* Titre + métadonnées */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {resultBadge && (
                      <span
                        className="inline-flex items-center justify-center text-xs font-bold"
                        style={{
                          width: 20, height: 20,
                          background: `${resultBadge.color}20`,
                          color: resultBadge.color,
                          border: `1px solid ${resultBadge.color}40`,
                        }}
                      >
                        {resultBadge.text}
                      </span>
                    )}
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--s-text)' }}>
                      {item.title}
                    </span>
                    {item.score && (
                      <span className="t-mono text-xs" style={{ color: 'var(--s-gold)' }}>
                        {item.score}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs flex-wrap" style={{ color: 'var(--s-text-muted)' }}>
                    <span>{formatDate(item.createdAt)}</span>
                    <span>·</span>
                    <span>{formatSize(item.sizeBytes)}</span>
                    {item.map && (<><span>·</span><span>{item.map}</span></>)}
                    {showEventLink && item.eventId && eventTitlesById?.[item.eventId] && (
                      <>
                        <span>·</span>
                        <span>Lié à « {eventTitlesById[item.eventId]} »</span>
                      </>
                    )}
                  </div>
                  {item.notes && (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-dim)' }}>{item.notes}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <IconButton title="Télécharger" onClick={() => download(item.id)}>
                    <Download size={13} />
                  </IconButton>
                  {canEdit && (
                    <IconButton title="Modifier" onClick={() => setEditingId(item.id)}>
                      <Edit2 size={13} />
                    </IconButton>
                  )}
                  {canDelete && (
                    <IconButton title="Supprimer" onClick={() => remove(item)} danger>
                      <Trash2 size={13} />
                    </IconButton>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function IconButton({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center justify-center transition-opacity hover:opacity-100"
      style={{
        width: 28, height: 28,
        background: 'var(--s-surface)',
        border: '1px solid var(--s-border)',
        color: danger ? '#ef4444' : 'var(--s-text-dim)',
        opacity: 0.8,
      }}
    >
      {children}
    </button>
  );
}

function ReplayEditForm({
  structureId,
  item,
  onClose,
  onSaved,
}: {
  structureId: string;
  item: ReplayListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(item.title);
  const [result, setResult] = useState<'win' | 'loss' | 'draw' | ''>(item.result ?? '');
  const [score, setScore] = useState(item.score ?? '');
  const [map, setMap] = useState(item.map ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/structures/${structureId}/replays/${item.id}`, {
        method: 'PATCH',
        body: {
          title,
          result: result || null,
          score: score || null,
          map: map || null,
          notes: notes || null,
        },
      });
      toast.success('Replay mis à jour');
      onSaved();
    } catch (err) {
      toast.error((err as Error).message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="t-label block mb-1">Titre</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="settings-input w-full text-sm" maxLength={120} />
        </div>
        <div>
          <label className="t-label block mb-1">Résultat</label>
          <select value={result} onChange={e => setResult(e.target.value as 'win' | 'loss' | 'draw' | '')}
            className="settings-input w-full text-sm">
            <option value="">—</option>
            <option value="win">Victoire</option>
            <option value="loss">Défaite</option>
            <option value="draw">Égalité</option>
          </select>
        </div>
        <div>
          <label className="t-label block mb-1">Score</label>
          <input value={score} onChange={e => setScore(e.target.value)} placeholder="3-2"
            className="settings-input w-full text-sm" maxLength={20} />
        </div>
        <div className="col-span-2">
          <label className="t-label block mb-1">Map (optionnel)</label>
          <input value={map} onChange={e => setMap(e.target.value)} placeholder="DFH Stadium"
            className="settings-input w-full text-sm" maxLength={60} />
        </div>
        <div className="col-span-2">
          <label className="t-label block mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="settings-input w-full text-sm" maxLength={2000} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} type="button"
          className="btn-springs btn-secondary bevel-sm text-xs flex items-center gap-1">
          <X size={11} /> Annuler
        </button>
        <button onClick={save} disabled={saving} type="button"
          className="btn-springs btn-primary bevel-sm text-xs flex items-center gap-1">
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}
