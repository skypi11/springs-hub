'use client';

// Banner d'erreur d'authentification, affiché en haut du site quand le flow
// Discord OAuth a réussi côté serveur mais que le cookie httpOnly a été bloqué
// côté navigateur (Brave Shield strict, adblock agressif).
//
// Visible sur la landing visiteur ET les pages internes (l'user n'est pas
// connecté, il peut être sur n'importe quelle page protégée → redirigé sur
// landing par le LayoutShell, donc il faut que ce banner s'affiche aussi là).
//
// Le contexte AuthContext set `authError = 'cookie_blocked'` quand la route
// /api/auth/discord/session renvoie 404/data sans `ft` alors que `?auth=1`
// était présent dans l'URL.

import { Shield, X, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function AuthErrorBanner() {
  const { authError, dismissAuthError, signInWithDiscord } = useAuth();

  if (authError !== 'cookie_blocked') return null;

  function handleRetry() {
    dismissAuthError();
    signInWithDiscord();
  }

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[60]"
      style={{
        background: 'linear-gradient(180deg, rgba(255,85,85,0.20) 0%, rgba(255,85,85,0.12) 100%)',
        borderBottom: '1px solid rgba(255,85,85,0.5)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-start sm:items-center gap-3">
        <div
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center bevel-sm"
          style={{
            background: 'rgba(255,85,85,0.18)',
            border: '1px solid rgba(255,85,85,0.45)',
          }}
        >
          <Shield size={14} style={{ color: '#ff8a8a' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: '#ff8a8a' }}>
            Connexion bloquée par ton navigateur
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
            Discord a accepté ton autorisation, mais ton bloqueur a empêché Aedral de
            mémoriser ta session. <strong style={{ color: 'var(--s-text)' }}>Désactive Brave Shield</strong> (ou
            ton adblock) sur <span className="t-mono">aedral.com</span> et réessaie.
            Sinon, utilise un autre navigateur (Chrome, Firefox, Safari).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleRetry}
            className="btn-springs btn-primary bevel-sm inline-flex items-center gap-1.5"
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            <RefreshCw size={12} />
            Réessayer
          </button>
          <button
            type="button"
            onClick={dismissAuthError}
            aria-label="Fermer"
            className="p-1 hover:opacity-100 opacity-60 transition-opacity"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--s-text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
