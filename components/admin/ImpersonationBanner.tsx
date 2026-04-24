'use client';

import { useEffect, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Shield, LogOut, Loader2 } from 'lucide-react';

// Bannière affichée quand l'admin courant est en mode "impersonation".
// Lit le claim `impersonatedBy` embarqué dans le custom token Firebase généré
// par /api/admin/impersonate/start.
//
// Cliquer "Revenir admin" → POST /stop, récupère un custom token pour l'admin
// d'origine, signInWithCustomToken, reload complet pour rafraîchir tout le site.
export default function ImpersonationBanner() {
  const { firebaseUser, user } = useAuth();
  const [impersonatedBy, setImpersonatedBy] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!firebaseUser) {
      setImpersonatedBy(null);
      return;
    }
    let cancelled = false;
    // Lecture du claim impersonatedBy. `getIdTokenResult()` décode le token
    // et expose les custom claims ; pas de roundtrip réseau si le token est
    // encore valide.
    firebaseUser.getIdTokenResult().then(r => {
      if (cancelled) return;
      const by = (r.claims?.impersonatedBy as string | undefined) ?? null;
      setImpersonatedBy(by || null);
    }).catch(() => setImpersonatedBy(null));
    return () => { cancelled = true; };
  }, [firebaseUser]);

  async function stop() {
    setStopping(true);
    try {
      const res = await fetch('/api/admin/impersonate/stop', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Erreur');
        setStopping(false);
        return;
      }
      await signInWithCustomToken(auth, data.token);
      // Reload complet : toutes les pages re-fetchent avec le nouveau token admin.
      window.location.href = '/admin';
    } catch (err) {
      alert((err as Error).message);
      setStopping(false);
    }
  }

  if (!impersonatedBy) return null;

  const displayName = user?.displayName || user?.discordUsername || firebaseUser?.uid || 'utilisateur';

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: 'linear-gradient(90deg, #FFB800, #ff8800)',
        color: '#0a0a0f',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontWeight: 600,
        fontSize: 13,
        boxShadow: '0 2px 12px rgba(255,184,0,0.35)',
      }}
    >
      <Shield size={16} />
      <span style={{ flex: 1 }}>
        MODE IMPERSONATION — tu es connecté en tant que <strong>{displayName}</strong>. Toutes les actions
        sont enregistrées avec ton identité admin (<code style={{ fontSize: 11, background: 'rgba(0,0,0,0.12)', padding: '2px 6px', borderRadius: 2 }}>{impersonatedBy}</code>).
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={stopping}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: '#0a0a0f',
          color: '#FFB800',
          border: 'none',
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 700,
          cursor: stopping ? 'wait' : 'pointer',
          opacity: stopping ? 0.6 : 1,
        }}
      >
        {stopping ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
        {stopping ? 'Retour…' : 'Revenir admin'}
      </button>
    </div>
  );
}
