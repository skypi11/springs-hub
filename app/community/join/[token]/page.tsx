'use client';

import { useState, useEffect, use, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Shield, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api-client';

type LinkInfo = {
  structureId: string;
  structureName: string;
  structureTag: string;
  structureLogoUrl: string;
  structureGames: string[];
  presetGame: string | null;
};

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { firebaseUser, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<'loading' | 'choosing' | 'joining' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ structureId: string; structureName: string } | null>(null);
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [game, setGame] = useState('');

  const doJoin = useCallback(async (joinGame: string) => {
    if (!firebaseUser) return;
    setStatus('joining');
    try {
      const data = await api<{ structureId: string; structureName: string }>('/api/structures/join', {
        method: 'POST',
        body: { action: 'join_via_link', token, game: joinGame },
      });
      setResult(data);
      setStatus('success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur réseau');
      setStatus('error');
    }
  }, [firebaseUser, token]);

  // Précharge les infos du lien dès que l'auth est prête.
  // Si le fondateur a pré-rempli le jeu sur le lien, on rejoint directement.
  useEffect(() => {
    if (authLoading) return;
    if (!firebaseUser) {
      setStatus('error');
      setError('Tu dois être connecté pour rejoindre une structure.');
      return;
    }
    (async () => {
      try {
        const data = await api<LinkInfo>(`/api/structures/invitations/link-info?token=${encodeURIComponent(token)}`);
        setLinkInfo(data);
        // Jeu pré-rempli → join direct, pas de picker
        if (data.presetGame) {
          doJoin(data.presetGame);
        } else if ((data.structureGames || []).length === 1) {
          // Un seul jeu possible → pas de picker non plus
          doJoin(data.structureGames[0]);
        } else {
          setStatus('choosing');
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Erreur réseau');
        setStatus('error');
      }
    })();
  }, [authLoading, firebaseUser, token, doJoin]);

  return (
    <div className="min-h-screen hex-bg px-8 py-8 flex items-center justify-center">
      <div className="relative z-[1] bevel p-10 text-center max-w-md w-full" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        {status === 'loading' && (
          <Loader2 size={32} className="animate-spin mx-auto" style={{ color: 'var(--s-text-dim)' }} />
        )}

        {status === 'choosing' && linkInfo && (
          <>
            <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center" style={{ background: 'rgba(0,129,255,0.08)', border: '1px solid rgba(0,129,255,0.2)' }}>
              <Shield size={24} style={{ color: 'var(--s-blue)' }} />
            </div>
            <h2 className="font-display text-2xl mb-2">REJOINDRE {linkInfo.structureName.toUpperCase()}</h2>
            <p className="t-body mb-6" style={{ color: 'var(--s-text-dim)' }}>
              Cette structure joue à plusieurs jeux. Choisis celui que tu rejoins.
            </p>
            <div className="mb-5">
              <label className="t-label block mb-2">Jeu</label>
              <select className="settings-input w-full" value={game} onChange={e => setGame(e.target.value)}>
                <option value="">Choisir...</option>
                {linkInfo.structureGames.includes('rocket_league') && <option value="rocket_league">Rocket League</option>}
                {linkInfo.structureGames.includes('trackmania') && <option value="trackmania">Trackmania</option>}
              </select>
            </div>
            <button onClick={() => doJoin(game)} disabled={!game}
              className="btn-springs btn-primary bevel-sm w-full justify-center"
              style={{ opacity: game ? 1 : 0.5 }}>
              Rejoindre
            </button>
          </>
        )}

        {status === 'joining' && (
          <>
            <Loader2 size={32} className="animate-spin mx-auto mb-4" style={{ color: 'var(--s-blue)' }} />
            <p className="t-body">Rejoindre en cours...</p>
          </>
        )}

        {status === 'success' && result && (
          <>
            <CheckCircle size={32} className="mx-auto mb-4" style={{ color: '#33ff66' }} />
            <h2 className="font-display text-2xl mb-2">BIENVENUE !</h2>
            <p className="t-body mb-6" style={{ color: 'var(--s-text-dim)' }}>
              Tu as rejoint <strong style={{ color: 'var(--s-text)' }}>{result.structureName}</strong>.
            </p>
            <Link href={`/community/structure/${result.structureId}`}
              className="btn-springs btn-primary bevel-sm w-full justify-center">
              Voir la structure
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle size={32} className="mx-auto mb-4" style={{ color: '#ff5555' }} />
            <h2 className="font-display text-2xl mb-2">ERREUR</h2>
            <p className="t-body mb-6" style={{ color: '#ff5555' }}>{error}</p>
            <Link href="/community" className="btn-springs btn-secondary bevel-sm-border w-full justify-center">
              <span>Retour à la communauté</span>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
