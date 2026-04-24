'use client';

import { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { api, ApiError } from '@/lib/api-client';
import { Shield, Loader2 } from 'lucide-react';

// Bouton réutilisable pour lancer une impersonation depuis n'importe quelle page admin.
// Masqué si l'UID cible est l'admin lui-même. Redirige sur `/` après connexion.
type Props = {
  targetUid: string;
  targetName?: string | null;
  size?: 'sm' | 'icon';
  redirectTo?: string;
};

export default function ImpersonateButton({ targetUid, targetName, size = 'sm', redirectTo = '/' }: Props) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);

  if (!targetUid || targetUid === firebaseUser?.uid) return null;

  async function run() {
    const ok = await confirm({
      title: `Se connecter en tant que ${targetName || targetUid} ?`,
      message: 'Tu verras le site comme cet utilisateur. Les actions restent tracées avec ton identité admin. Tu pourras revenir via la bannière.',
      confirmLabel: 'Se connecter',
    });
    if (!ok) return;
    setLoading(true);
    try {
      const data = await api<{ token: string }>('/api/admin/impersonate/start', {
        method: 'POST',
        body: { targetUid },
      });
      await signInWithCustomToken(auth, data.token);
      window.location.href = redirectTo;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
      setLoading(false);
    }
  }

  if (size === 'icon') {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); run(); }}
        disabled={loading}
        title={`Se connecter en tant que ${targetName || targetUid}`}
        className="inline-flex items-center justify-center transition-colors"
        style={{
          width: 24, height: 24,
          background: 'rgba(123,47,190,0.08)',
          color: 'var(--s-violet-light)',
          border: '1px solid rgba(123,47,190,0.3)',
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Shield size={11} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); run(); }}
      disabled={loading}
      className="btn-springs bevel-sm inline-flex items-center gap-2"
      style={{
        background: 'rgba(123,47,190,0.08)',
        color: 'var(--s-violet-light)',
        borderColor: 'rgba(123,47,190,0.3)',
        fontSize: '12px',
        padding: '6px 12px',
      }}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
      <span>Se connecter en tant que</span>
    </button>
  );
}
