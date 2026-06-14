'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ShieldAlert, Check, Loader2, X, ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import GameTag from '@/components/games/GameTag';
import { track } from '@/lib/analytics';
import { getVerificationItems, type VerifyGame, type VerifyItem } from '@/lib/account-verification';

const DISMISS_KEY = 'aedral_verify_nudge_dismissed';

type VerifyResponse = {
  ok?: boolean; message?: string;
  rank?: string; riotId?: string; notRanked?: boolean;
  rlEpicId?: string; rlSteamId?: string;
};

// Bandeau de vérification de compte de jeu. Surfacé sur le dashboard pour
// déterrer le bouton « 1 clic » enterré dans Settings : la connection Discord
// est déjà capturée pour beaucoup d'users, il manque juste le clic.
// Disparaît tout seul une fois tous les comptes vérifiés.
export default function VerifyAccountNudge() {
  const { user, firebaseUser, refreshProfile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<VerifyGame | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const shownRef = useRef(false);

  const items = getVerificationItems(user);
  const unverified = items.filter(i => i.action);
  const visible = unverified.length > 0 && !dismissed;

  const gamesKey = unverified.map(i => i.game).join(',');
  const oneClickReady = unverified.filter(i => i.action && i.action.kind !== 'linkInDiscord').length;

  useEffect(() => {
    try { if (sessionStorage.getItem(DISMISS_KEY) === '1') setDismissed(true); } catch { /* SSR */ }
  }, []);

  useEffect(() => {
    if (visible && !shownRef.current) {
      shownRef.current = true;
      track('account_verify_prompt_shown', { games: gamesKey, oneClickReady });
    }
  }, [visible, gamesKey, oneClickReady]);

  if (!visible) return null;

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
  };

  async function handleVerify(item: VerifyItem) {
    const action = item.action;
    if (!action || action.kind === 'linkInDiscord') return;
    setBusy(item.game);
    track('account_verify_clicked', { game: item.game, method: action.kind });
    try {
      const res = await api<VerifyResponse>(action.apiPath, { method: 'POST', body: {} });
      if (res.ok) {
        track('account_verified', { game: item.game, method: action.kind });
        if (action.kind === 'oneClickValorant') {
          toast.success(res.notRanked
            ? `${res.riotId ?? 'Compte'} vérifié — non classé`
            : `Compte vérifié — rang ${res.rank}`);
        } else {
          toast.success(res.message ?? 'Compte vérifié.');
        }
        await Promise.all([
          refreshProfile?.(),
          qc.invalidateQueries({ queryKey: ['profile', firebaseUser?.uid ?? null] }),
        ]);
      } else {
        toast.error(res.message ?? 'Échec de la vérification.');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bevel relative overflow-hidden animate-fade-in"
      style={{ background: 'var(--s-surface)', border: '1px solid rgba(255,184,0,0.28)' }}>
      <button type="button" onClick={dismiss} aria-label="Masquer"
        className="absolute top-3 right-3 z-[2] w-6 h-6 flex items-center justify-center transition-colors"
        style={{ color: 'var(--s-text-muted)' }}>
        <X size={14} />
      </button>

      <div className="p-5 flex flex-col gap-4">
        {/* En-tête + bénéfice (le « pourquoi », pas une demande à sec) */}
        <div className="flex items-start gap-3 pr-6">
          <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center bevel-sm"
            style={{ background: 'rgba(255,184,0,0.10)', border: '1px solid rgba(255,184,0,0.28)' }}>
            <ShieldAlert size={17} style={{ color: 'var(--s-gold)' }} />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-lg tracking-wider leading-none">VÉRIFIE TON COMPTE DE JEU</h3>
            <p className="text-sm mt-1.5" style={{ color: 'var(--s-text-dim)' }}>
              Un compte vérifié affiche ton vrai rang, te rend visible auprès des recruteurs — et il sera requis pour t&apos;inscrire aux compétitions et scrims à venir.
            </p>
          </div>
        </div>

        {/* Une ligne d'action par jeu non vérifié */}
        <div className="flex flex-col gap-2">
          {unverified.map(item => {
            const action = item.action!;
            const isBusy = busy === item.game;

            if (action.kind === 'linkInDiscord') {
              return (
                <div key={item.game}
                  className="flex items-center justify-between gap-3 flex-wrap px-3 py-2.5"
                  style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <GameTag gameId={item.game} size="sm" />
                    <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                      Lie ton compte <strong style={{ color: 'var(--s-text)' }}>{action.what}</strong> à ton Discord, reconnecte-toi, et la vérif passe en 1 clic.
                    </span>
                  </div>
                  <Link href="/guide" className="text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 flex-shrink-0"
                    style={{ color: 'var(--s-gold)' }}>
                    Voir comment <ArrowRight size={11} />
                  </Link>
                </div>
              );
            }

            return (
              <div key={item.game}
                className="flex items-center justify-between gap-3 flex-wrap px-3 py-2.5"
                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <GameTag gameId={item.game} size="sm" />
                  <span className="text-sm truncate" style={{ color: 'var(--s-text-dim)' }}>
                    Compte détecté : <strong style={{ color: 'var(--s-text)' }}>{action.accountName}</strong>
                  </span>
                </div>
                <button type="button" onClick={() => handleVerify(item)} disabled={isBusy}
                  className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2 flex-shrink-0"
                  style={{ opacity: isBusy ? 0.7 : 1, cursor: isBusy ? 'wait' : 'pointer' }}>
                  {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Vérifier en 1 clic
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
