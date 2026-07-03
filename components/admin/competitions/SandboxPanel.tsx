'use client';

// Bac à sable de test du module compétitions — panel /admin/competitions,
// admins Aedral uniquement. Crée 2 structures fictives complètes (17 comptes,
// 4 équipes, cas limites : mineur, âge inconnu, non-vérifié, signalé smurf)
// pour dérouler inscription → validation → provisioning en conditions réelles.
//
// Flux de test : créer les données → copier le lien du wizard d'une
// compétition en brouillon → « Se connecter en tant que » un dirigeant fictif
// (impersonation admin existante, bannière de retour) → dérouler le wizard →
// revenir admin → valider dans la file. Supprimer les données à la fin.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import ImpersonateButton from '@/components/admin/ImpersonateButton';
import { FlaskConical, Copy } from 'lucide-react';
import type { AdminCompetition } from '@/components/admin/competitions/types';

interface SandboxState {
  exists: boolean;
  structures: Array<{
    id: string;
    name: string;
    tag: string;
    owner: { uid: string; displayName: string };
    teams: Array<{ name: string; playersCount: number }>;
  }>;
}

export default function SandboxPanel({ competitions }: { competitions: AdminCompetition[] }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [state, setState] = useState<SandboxState | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<SandboxState>('/api/admin/competitions/sandbox');
      setState(s);
    } catch { /* panel best-effort, l'admin peut recharger la page */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const draftCompetitions = competitions.filter(c => c.status === 'draft');

  async function seed() {
    setWorking(true);
    try {
      await api('/api/admin/competitions/sandbox', { method: 'POST', body: { action: 'seed' } });
      toast.success('Données de test créées : 2 structures, 4 équipes, 17 comptes fictifs.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setWorking(false);
    }
  }

  async function cleanup() {
    const ok = await confirm({
      title: 'Supprimer les données de test',
      message: 'Structures, comptes fictifs, inscriptions et notifications de test seront supprimés. Les compteurs des compétitions sont recalés automatiquement.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setWorking(true);
    try {
      await api('/api/admin/competitions/sandbox', { method: 'POST', body: { action: 'cleanup' } });
      toast.success('Données de test supprimées.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setWorking(false);
    }
  }

  async function copyWizardLink(compId: string) {
    const url = `${window.location.origin}/competitions/${compId}/inscription`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Lien du wizard copié.');
    } catch {
      toast.error(url);
    }
  }

  return (
    <div className="panel bevel">
      <div className="panel-header flex items-center justify-between">
        <span className="t-sub flex items-center gap-2">
          <FlaskConical size={14} style={{ color: 'var(--s-text-dim)' }} />
          Bac à sable de test
        </span>
        {state?.exists ? (
          <span className="flex items-center gap-2">
            {/* Re-seed idempotent (merge) : réapplique les profils fictifs à
                jour sans toucher aux inscriptions de test en cours. */}
            <button type="button" className="btn-springs btn-ghost text-sm"
              onClick={seed} disabled={working}>
              {working ? 'En cours…' : 'Recréer'}
            </button>
            <button type="button" className="btn-springs btn-ghost text-sm" style={{ color: '#ff8a8a' }}
              onClick={cleanup} disabled={working}>
              {working ? 'En cours…' : 'Supprimer les données de test'}
            </button>
          </span>
        ) : (
          <button type="button" className="btn-springs btn-secondary bevel-sm text-sm"
            onClick={seed} disabled={working}>
            {working ? 'Création…' : 'Créer les données de test'}
          </button>
        )}
      </div>
      <div className="panel-body space-y-4">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
          Structures et joueurs fictifs, invisibles du public, pour tester l&apos;inscription
          et la validation en conditions réelles : connecte-toi en tant qu&apos;un dirigeant
          fictif, inscris son équipe sur une compétition en brouillon via le lien du wizard,
          puis reviens ici (bannière en haut de page) pour valider. Les rosters couvrent les
          cas limites — mineur, âge inconnu, compte non vérifié, joueur signalé smurf.
        </p>

        {state?.exists && (
          <>
            <div style={{ border: '1px solid var(--s-border)' }}>
              {state.structures.map((s, i) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2"
                  style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
                  <span className="text-sm font-semibold">{s.name} [{s.tag}]</span>
                  <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    {s.teams.map(t => `${t.name} (${t.playersCount})`).join(' · ')}
                  </span>
                  <span className="text-sm ml-auto" style={{ color: 'var(--s-text-muted)' }}>
                    {s.owner.displayName}
                  </span>
                  <ImpersonateButton targetUid={s.owner.uid} targetName={s.owner.displayName} />
                </div>
              ))}
            </div>

            {draftCompetitions.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                  Liens du wizard d&apos;inscription (compétitions en brouillon) — à copier avant
                  de te connecter en tant que dirigeant fictif :
                </p>
                {draftCompetitions.map(c => (
                  <div key={c.id} className="flex items-center gap-2">
                    <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1.5"
                      onClick={() => copyWizardLink(c.id)}>
                      <Copy size={12} /> {c.name}
                    </button>
                    <span className="text-xs t-mono min-w-0 truncate" style={{ color: 'var(--s-text-muted)' }}>
                      /competitions/{c.id}/inscription
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
                Aucune compétition en brouillon : crée-en une pour avoir un terrain de test.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
