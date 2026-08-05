'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';

// Retrait d'une inscription par le joueur lui-même.
//
// Extrait de la page parce qu'il s'est cassé : le retrait qui RÉUSSISSAIT
// laissait le bouton tourner indéfiniment, l'état n'étant remis à zéro que
// dans la branche d'erreur. Un composant isolé se teste ; enfoui dans un écran
// de six cents lignes, il ne l'était pas.

export default function WithdrawButton({ onDone }: { onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/mania-cup/register', { method: 'DELETE' });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Le retrait a échoué.');
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return <p className="max-w-md text-sm text-red-300">{err}</p>;
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm text-[#8d89a8] underline hover:text-red-300"
      >
        Retirer mon inscription
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-[#c9c5d8]">Libérer ta place ?</span>
      <button
        disabled={busy}
        onClick={() => void withdraw()}
        className="inline-flex items-center gap-1.5 border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
      >
        {busy && <Loader2 className="animate-spin" size={14} aria-hidden />}
        Confirmer
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-sm text-[#8d89a8] underline"
      >
        Annuler
      </button>
    </div>
  );
}
