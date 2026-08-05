'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, ChevronDown } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';

// Identité Trackmania : la connexion officielle Ubisoft, et le repli manuel.
//
// Ce bloc existe parce que le site demandait jusqu'ici de TAPER son pseudo
// Trackmania dans un champ libre, alors que la connexion Nadeo — celle qui
// prouve qu'on détient le compte — était déjà branchée sur l'inscription à la
// Springs Mania Cup. Deux niveaux de confiance pour la même donnée, selon la
// page où on la saisissait.
//
// La connexion passe donc devant, et la saisie libre devient un repli replié :
// quelqu'un qui a un compte Ubisoft n'a aucune raison de recopier son pseudo à
// la main, et un pseudo tapé ne vaudra jamais un pseudo vérifié.

export default function TrackmaniaIdentityBlock({
  verified,
  pseudo,
  onManualChange,
  manualPseudo,
  manualLogin,
  onManualLoginChange,
}: {
  /** Vrai quand l'OAuth Nadeo est passé : le pseudo est alors garanti. */
  verified: boolean;
  /** Pseudo tel que le profil le porte. */
  pseudo: string;
  manualPseudo: string;
  manualLogin: string;
  onManualChange: (value: string) => void;
  onManualLoginChange: (value: string) => void;
}) {
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const [showManual, setShowManual] = useState(false);

  async function link() {
    setLinking(true);
    try {
      // Le chemin de retour ramène ici : sans lui, la connexion renvoie sur
      // l'accueil et l'utilisateur perd le réglage qu'il était en train de faire.
      const { url } = await api<{ url: string }>('/api/auth/trackmania/start', {
        method: 'POST',
        body: { next: '/settings' },
      });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Connexion Ubisoft indisponible.');
      setLinking(false);
    }
  }

  if (verified) {
    return (
      <div
        className="flex flex-wrap items-center gap-3 p-3"
        style={{ background: 'rgba(0,217,54,0.06)', border: '1px solid rgba(0,217,54,0.25)' }}
      >
        <ShieldCheck size={18} style={{ color: 'var(--s-green)' }} aria-hidden />
        <div className="min-w-0">
          <div className="font-semibold">{pseudo || 'Compte lié'}</div>
          <div className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
            Compte Ubisoft vérifié — ton pseudo se met à jour tout seul.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void link()}
          disabled={linking}
          className="ml-auto text-sm underline"
          style={{ color: 'var(--s-text-dim)' }}
        >
          {linking ? 'Ouverture…' : 'Changer de compte'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void link()}
        disabled={linking}
        className="btn-springs bevel-sm inline-flex items-center gap-2 font-bold"
        style={{ background: 'var(--s-green)', color: '#07050b' }}
      >
        {linking && <Loader2 className="animate-spin" size={16} aria-hidden />}
        Se connecter avec Ubisoft
      </button>
      <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
        La connexion officielle Nadeo récupère ton pseudo en jeu et le garde à
        jour. C’est elle qui atteste que le compte est bien le tien.
      </p>

      <button
        type="button"
        onClick={() => setShowManual((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs underline"
        style={{ color: 'var(--s-text-muted)' }}
      >
        <ChevronDown
          size={13}
          style={{ transform: showManual ? 'rotate(180deg)' : undefined }}
          aria-hidden
        />
        Saisir mon pseudo à la main
      </button>

      {showManual && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="t-label mb-2 block">Pseudo Ubisoft/Nadeo *</label>
            <input
              type="text"
              value={manualPseudo}
              onChange={(e) => onManualChange(e.target.value)}
              className="settings-input w-full"
              placeholder="Ton pseudo en jeu"
            />
          </div>
          <div>
            <label className="t-label mb-2 block">Login TM (optionnel)</label>
            <input
              type="text"
              value={manualLogin}
              onChange={(e) => onManualLoginChange(e.target.value)}
              className="settings-input w-full"
              placeholder="Identifiant Ubisoft/Nadeo"
            />
          </div>
          <p className="text-xs sm:col-span-2" style={{ color: 'var(--s-text-muted)' }}>
            Un pseudo saisi ici n’est pas vérifié : il n’ouvre pas les
            inscriptions qui exigent un compte Trackmania authentifié.
          </p>
        </div>
      )}
    </div>
  );
}
