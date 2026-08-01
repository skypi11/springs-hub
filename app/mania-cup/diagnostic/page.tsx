'use client';

import { useEffect, useState } from 'react';
import { Loader2, Copy, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';

// Page de diagnostic de la connexion Trackmania — administrateurs uniquement.
//
// Nadeo répond « invalid_client — check the redirect URI » sans dire quelle
// adresse il a reçue. Cette page affiche celle que le site envoie réellement,
// prête à être copiée dans l'application sur api.trackmania.com.

type Diag = {
  redirectUriEnvoye: string;
  origineDetectee: string;
  clientId: { present: boolean; longueur: number; apercu: string | null; espacesParasites: boolean };
  clientSecret: { present: boolean; longueur: number; espacesParasites: boolean };
  urlAutorisation: string | null;
};

export default function DiagnosticPage() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const [diag, setDiag] = useState<Diag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (authLoading || !firebaseUser) return;
    api<Diag>('/api/auth/trackmania/diagnostic')
      .then(setDiag)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur'));
  }, [authLoading, firebaseUser]);

  if (authLoading) return <Shell><Loader2 className="animate-spin" size={20} /></Shell>;
  if (!firebaseUser) return <Shell><p>Connecte-toi avec Discord.</p></Shell>;
  if (error) return <Shell><p className="text-red-300">{error}</p></Shell>;
  if (!diag) return <Shell><Loader2 className="animate-spin" size={20} /></Shell>;

  const ok = (b: boolean) => (b ? 'text-[#00D936]' : 'text-red-400');

  return (
    <Shell>
      <h1 className="font-display text-4xl">Diagnostic connexion Trackmania</h1>

      <section className="mt-10">
        <h2 className="text-sm tracking-[0.2em] text-[#8d89a8] uppercase">
          Adresse de retour envoyée par le site
        </h2>
        <p className="mt-2 text-[#c9c5d8]">
          Elle doit figurer <strong className="text-white">à l’identique</strong> dans ton
          application sur api.trackmania.com — un caractère de différence suffit à
          provoquer l’erreur.
        </p>
        <div className="mt-4 flex items-center gap-3 border border-[#00D936]/40 bg-black/50 p-4">
          <code className="flex-1 break-all text-[#00D936]">{diag.redirectUriEnvoye}</code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(diag.redirectUriEnvoye);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="shrink-0 border border-white/20 p-2 hover:bg-white/10"
            aria-label="Copier"
          >
            {copied ? <Check size={16} className="text-[#00D936]" /> : <Copy size={16} />}
          </button>
        </div>
        <p className="mt-2 text-sm text-[#8d89a8]">
          Origine détectée par le serveur : <code>{diag.origineDetectee}</code>
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm tracking-[0.2em] text-[#8d89a8] uppercase">
          Variables d’environnement
        </h2>
        <ul className="mt-4 space-y-2 text-[#c9c5d8]">
          <li className={ok(diag.clientId.present)}>
            Identifiant : {diag.clientId.present ? `chargé (${diag.clientId.longueur} caractères, ${diag.clientId.apercu})` : 'ABSENT'}
          </li>
          <li className={ok(!diag.clientId.espacesParasites)}>
            {diag.clientId.espacesParasites
              ? '⚠ L’identifiant contient un espace ou un retour à la ligne parasite'
              : 'Identifiant sans espace parasite'}
          </li>
          <li className={ok(diag.clientSecret.present)}>
            Secret : {diag.clientSecret.present ? `chargé (${diag.clientSecret.longueur} caractères)` : 'ABSENT'}
          </li>
          <li className={ok(!diag.clientSecret.espacesParasites)}>
            {diag.clientSecret.espacesParasites
              ? '⚠ Le secret contient un espace ou un retour à la ligne parasite'
              : 'Secret sans espace parasite'}
          </li>
        </ul>
      </section>

      {diag.urlAutorisation && (
        <section className="mt-10">
          <h2 className="text-sm tracking-[0.2em] text-[#8d89a8] uppercase">
            URL d’autorisation complète
          </h2>
          <p className="mt-2 text-sm text-[#8d89a8]">
            Exactement ce que le site demande à Nadeo. Tu peux l’ouvrir pour reproduire
            l’erreur hors du parcours d’inscription.
          </p>
          <code className="mt-3 block break-all border border-white/15 bg-black/50 p-4 text-xs text-[#c9c5d8]">
            {diag.urlAutorisation}
          </code>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#07050b] text-[#eaeaf0]">
      <div className="mx-auto max-w-3xl px-6 py-16">{children}</div>
    </main>
  );
}
