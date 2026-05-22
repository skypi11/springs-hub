// Bouton « Signaler le rang » sur la fiche d'un joueur — Lot 5.
// Caché si non-connecté, ou si on regarde son propre profil, ou si le joueur
// cible n'a pas de rang affiché (rien à signaler).

'use client';

import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';

export interface ReportRankButtonProps {
  targetUid: string;
  targetName?: string;
  /** Désactive si false — typiquement quand le joueur n'a pas de rang à signaler */
  enabled?: boolean;
}

export default function ReportRankButton({ targetUid, targetName, enabled = true }: ReportRankButtonProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  if (!enabled) return null;

  async function onClick() {
    const ok = await confirm({
      title: 'Signaler ce rang',
      message: `Tu vas signaler le rang affiché par ${targetName ?? 'ce joueur'}. L'admin va recevoir ton signalement et pourra vérifier via le lien tracker.\n\nN'utilise cette fonction que si le rang te paraît clairement faux. Les signalements abusifs sont aussi visibles par l'admin.`,
      confirmLabel: 'Signaler',
    });
    if (!ok) return;
    const message = typeof window !== 'undefined'
      ? window.prompt('Tu peux ajouter un message (optionnel — max 500 caractères) :') ?? ''
      : '';
    setLoading(true);
    try {
      await api(`/api/profile/${targetUid}/rank-report`, {
        method: 'POST',
        body: { message },
      });
      toast.success('Signalement envoyé. Merci.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erreur réseau.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs transition-colors hover:text-white disabled:opacity-50"
      style={{ color: 'var(--s-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
      title="Signaler ce rang à l'admin"
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : <Flag size={11} />}
      Signaler le rang
    </button>
  );
}
