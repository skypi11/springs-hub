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
  /** `sm` = pill compact pour les cartes ; `md` = bouton plus lisible pour les fiches */
  size?: 'sm' | 'md';
}

export default function ReportRankButton({
  targetUid,
  targetName,
  enabled = true,
  size = 'md',
}: ReportRankButtonProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  if (!enabled) return null;

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
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

  if (size === 'sm') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center gap-1 tag transition-colors hover:bg-[var(--s-elevated)] disabled:opacity-50"
        style={{
          background: 'transparent',
          color: '#ff8a8a',
          borderColor: 'rgba(255,85,85,0.35)',
          fontSize: '10px',
          padding: '2px 6px',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
        title="Signaler le rang à l'admin"
      >
        {loading ? <Loader2 size={9} className="animate-spin" /> : <Flag size={9} />}
        signaler
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="btn-springs bevel-sm inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
      style={{
        background: 'rgba(255,85,85,0.08)',
        color: '#ff8a8a',
        borderColor: 'rgba(255,85,85,0.35)',
        fontSize: '11px',
        padding: '6px 12px',
      }}
      title="Signaler ce rang à l'admin"
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : <Flag size={11} />}
      Signaler le rang
    </button>
  );
}
