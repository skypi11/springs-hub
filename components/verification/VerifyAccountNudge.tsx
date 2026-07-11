'use client';

import { useState, useEffect, useRef } from 'react';
import { ShieldAlert, Check, Loader2, X, ChevronDown, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import GameTag from '@/components/games/GameTag';
import { track } from '@/lib/analytics';
import { getVerificationItems, type VerifyGame, type VerifyItem } from '@/lib/account-verification';

const DISMISS_KEY = 'aedral_verify_nudge_dismissed';
const AUTO_REFRESH_KEY = 'aedral_verify_autorefresh_done';

type VerifyResponse = {
  ok?: boolean; message?: string;
  rank?: string; riotId?: string; notRanked?: boolean;
  rlEpicId?: string; rlSteamId?: string;
};

type RefreshResponse = { ok?: boolean; changed?: boolean; connectionTypes?: string[]; needsRelogin?: boolean };

// Bandeau de vérification de compte de jeu. Surfacé sur le dashboard + own
// profile pour déterrer le « 1 clic » enterré dans Settings (la connection
// Discord est déjà capturée pour beaucoup d'users). Pour ceux qui n'ont pas
// encore lié leur compte à Discord (palier C), un tuto inline + un bouton
// « J'ai lié » qui re-fetch les connexions à la demande. Se masque tout seul
// une fois tout vérifié.
export default function VerifyAccountNudge() {
  const { user, firebaseUser, refreshProfile, signInWithDiscord } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<VerifyGame | null>(null);
  const [refreshing, setRefreshing] = useState<VerifyGame | null>(null);
  const [expanded, setExpanded] = useState<VerifyGame | null>(null);
  // Quand le refresh à la demande ne suffit pas (token Discord périmé / connexion
  // toujours absente), on escalade vers un relogin complet bien visible — le seul
  // remède (nouveau token + re-fetch des connexions au login).
  const [reloginGame, setReloginGame] = useState<VerifyGame | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const shownRef = useRef(false);
  const autoRefreshedRef = useRef(false);

  const items = getVerificationItems(user);
  // On exclut valorantPaused : rien à faire dessus (Discord a coupé Riot), donc
  // pas de ligne d'action dans le nudge — il ne surface que l'actionnable.
  const unverified = items.filter(i => i.action && i.action.kind !== 'valorantPaused');
  const hasLinkInDiscord = unverified.some(i => i.action?.kind === 'linkInDiscord');
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

  // Auto-détection au retour : si un compte reste à lier dans Discord, on tente
  // UN refresh silencieux par session — le user vient peut-être de lier son
  // compte et de revenir. Si une connexion apparaît, le nudge passe tout seul en
  // « 1 clic », sans aucune action ni déconnexion/reconnexion. Le tuto + le
  // bouton « J'ai lié » restent en fallback si ça n'a rien trouvé.
  useEffect(() => {
    if (!visible || !hasLinkInDiscord || autoRefreshedRef.current) return;
    autoRefreshedRef.current = true;
    let already = false;
    try { already = sessionStorage.getItem(AUTO_REFRESH_KEY) === '1'; } catch { /* SSR */ }
    if (already) return;
    try { sessionStorage.setItem(AUTO_REFRESH_KEY, '1'); } catch { /* noop */ }
    void (async () => {
      try {
        const res = await api<RefreshResponse>('/api/profile/refresh-discord-connections', { method: 'POST', body: {} });
        if (res.ok && res.changed) await refreshProfile?.();
      } catch { /* silencieux : le tuto + le bouton restent en fallback */ }
    })();
  }, [visible, hasLinkInDiscord, refreshProfile]);

  if (!visible) return null;

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
  };

  async function handleVerify(item: VerifyItem) {
    const action = item.action;
    if (!action || action.kind === 'linkInDiscord' || action.kind === 'valorantPaused') return;
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

  // Palier C : re-fetch les connexions Discord à la demande (le user vient de
  // lier son compte) pour débloquer le 1-clic sans relogin ni attendre le cron.
  async function handleRefresh(item: VerifyItem) {
    setRefreshing(item.game);
    track('account_verify_clicked', { game: item.game, method: 'refresh' });
    try {
      const res = await api<RefreshResponse>('/api/profile/refresh-discord-connections', { method: 'POST', body: {} });
      const types = res.connectionTypes ?? [];
      const found = item.game === 'valorant'
        ? types.includes('riotgames')
        : (types.includes('epicgames') || types.includes('steam'));
      await Promise.all([
        refreshProfile?.(),
        qc.invalidateQueries({ queryKey: ['profile', firebaseUser?.uid ?? null] }),
      ]);
      if (found) {
        toast.success('Connexion détectée — clique « Vérifier en 1 clic ».');
        setExpanded(null);
        setReloginGame(null);
      } else {
        // Refresh OK mais connexion toujours absente : seul un relogin complet
        // (nouveau token + re-fetch des connexions au login) peut la récupérer.
        setReloginGame(item.game);
        toast.error('On ne voit pas ta connexion. Reconnecte-toi avec Discord pour tout resynchroniser.');
      }
    } catch (err) {
      // Échec du refresh (token Discord périmé → invalid_grant/needsRelogin, ou
      // réseau). Le remède est le relogin complet : on l'escalade dans l'UI.
      setReloginGame(item.game);
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setRefreshing(null);
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
            // valorantPaused est déjà filtré de `unverified` ; garde de type.
            if (action.kind === 'valorantPaused') return null;
            const isBusy = busy === item.game;

            if (action.kind === 'linkInDiscord') {
              const isOpen = expanded === item.game;
              const isRefreshing = refreshing === item.game;
              return (
                <div key={item.game} style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <GameTag gameId={item.game} size="sm" />
                      <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                        Lie ton compte <strong style={{ color: 'var(--s-text)' }}>{action.what}</strong> à ton Discord pour vérifier.
                      </span>
                    </div>
                    <button type="button" onClick={() => setExpanded(isOpen ? null : item.game)}
                      className="text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 flex-shrink-0"
                      style={{ color: 'var(--s-gold)', cursor: 'pointer' }}>
                      Comment faire
                      <ChevronDown size={12} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="px-3 pb-3 pt-2 space-y-3 border-t" style={{ borderColor: 'var(--s-border)' }}>
                      <ol className="text-sm space-y-1.5" style={{ color: 'var(--s-text-dim)' }}>
                        <li><span style={{ color: 'var(--s-gold)' }}>1.</span> Dans Discord : <strong style={{ color: 'var(--s-text)' }}>Paramètres → Connexions</strong>.</li>
                        <li><span style={{ color: 'var(--s-gold)' }}>2.</span> Ajoute <strong style={{ color: 'var(--s-text)' }}>{action.what}</strong> et autorise l&apos;affichage.</li>
                        <li><span style={{ color: 'var(--s-gold)' }}>3.</span> Reviens ici et clique <strong style={{ color: 'var(--s-text)' }}>J&apos;ai lié mon compte</strong>.</li>
                      </ol>
                      {reloginGame === item.game ? (
                        // Le refresh n'a pas suffi (session Discord expirée / connexion
                        // toujours absente) → relogin complet, bien visible.
                        <div className="space-y-2">
                          <p className="text-sm" style={{ color: '#ff8a8a' }}>
                            Ta session Discord a expiré, on ne peut pas resynchroniser automatiquement. Reconnecte-toi : ça récupère toutes tes connexions.
                          </p>
                          <button type="button" onClick={() => signInWithDiscord?.()}
                            className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2">
                            <RefreshCw size={13} />
                            Se reconnecter avec Discord
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-4 flex-wrap">
                          <button type="button" onClick={() => handleRefresh(item)} disabled={isRefreshing}
                            className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2"
                            style={{ opacity: isRefreshing ? 0.7 : 1, cursor: isRefreshing ? 'wait' : 'pointer' }}>
                            {isRefreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            J&apos;ai lié mon compte
                          </button>
                          <button type="button" onClick={() => signInWithDiscord?.()}
                            className="text-xs inline-flex items-center" style={{ color: 'var(--s-text-muted)', cursor: 'pointer' }}>
                            Ça ne marche pas ? Reconnecte-toi avec Discord
                          </button>
                        </div>
                      )}
                    </div>
                  )}
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
