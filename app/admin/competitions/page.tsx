'use client';

// Panel admin — moteur de compétitions (Lot 0 Legends Cup).
// CRUD circuits + compétitions (tout vit en brouillon au Lot 0 : la publication
// arrive avec le wizard d'inscription) + gestion des admins de compétition.

import AdminContentSkeleton from '@/components/admin/AdminContentSkeleton';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { Trophy, Plus, Pencil, Trash2, UserMinus, ScrollText, ClipboardCheck } from 'lucide-react';
import GameTag from '@/components/games/GameTag';
import CircuitForm from '@/components/admin/competitions/CircuitForm';
import CompetitionForm from '@/components/admin/competitions/CompetitionForm';
import BansPanel, { type CompetitionBanRow } from '@/components/admin/competitions/BansPanel';
import RulebookEditor, { type RulebookScope } from '@/components/admin/competitions/RulebookEditor';
import RegistrationsPanel from '@/components/admin/competitions/RegistrationsPanel';
import SandboxPanel from '@/components/admin/competitions/SandboxPanel';
import type { AdminCircuit, AdminCompetition, CompetitionAdminEntry } from '@/components/admin/competitions/types';

type View =
  | { kind: 'list' }
  | { kind: 'circuit-form'; circuit: AdminCircuit | null }
  | { kind: 'competition-form'; competition: AdminCompetition | null }
  | { kind: 'rulebook'; scope: RulebookScope; label: string }
  | { kind: 'registrations'; competition: AdminCompetition };

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  registration: 'Inscriptions',
  validation: 'Validation',
  seeding: 'Seeding',
  live: 'Live',
  active: 'Actif',
  finished: 'Terminé',
  archived: 'Archivé',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}

export default function AdminCompetitionsPage() {
  // isAdmin = admin Aedral complet (config des compétitions). Un admin de
  // compétition (rôle scopé) voit les listes + gère le registre des bans,
  // mais pas la création/édition ni la nomination d'admins (spec §6).
  const { firebaseUser, isAdmin, isCompetitionAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [circuits, setCircuits] = useState<AdminCircuit[]>([]);
  const [competitions, setCompetitions] = useState<AdminCompetition[]>([]);
  const [compAdmins, setCompAdmins] = useState<CompetitionAdminEntry[]>([]);
  const [bans, setBans] = useState<CompetitionBanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: 'list' });

  // Ajout d'un admin de compétition : recherche dans la liste users (chargée
  // à l'ouverture du champ seulement — payload lourd).
  const [adminSearch, setAdminSearch] = useState('');
  const [allUsers, setAllUsers] = useState<Array<{ uid: string; displayName: string; discordUsername: string; isAdmin: boolean }> | null>(null);
  const [addingUid, setAddingUid] = useState<string | null>(null);

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const [circuitsData, compsData, bansData, adminsData] = await Promise.all([
        api<{ circuits: AdminCircuit[] }>('/api/admin/circuits'),
        api<{ competitions: AdminCompetition[] }>('/api/admin/competitions'),
        api<{ bans: CompetitionBanRow[] }>('/api/admin/competition-bans'),
        // Nomination réservée aux admins Aedral : la route 403 un admin compét,
        // on ne l'appelle pas pour lui.
        isAdmin
          ? api<{ admins: CompetitionAdminEntry[] }>('/api/admin/competition-admins')
          : Promise.resolve({ admins: [] as CompetitionAdminEntry[] }),
      ]);
      setCircuits(circuitsData.circuits ?? []);
      setCompetitions(compsData.competitions ?? []);
      setBans(bansData.bans ?? []);
      setCompAdmins(adminsData.admins ?? []);
    } catch (err) {
      console.error('[admin/competitions] load', err);
      toast.error(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && (isAdmin || isCompetitionAdmin)) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin, isCompetitionAdmin]);

  const circuitNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of circuits) map[c.id] = c.name;
    return map;
  }, [circuits]);

  async function deleteCircuit(c: AdminCircuit) {
    const ok = await confirm({
      title: 'Supprimer le circuit',
      message: `« ${c.name} » sera supprimé définitivement. Uniquement possible en brouillon, sans compétition rattachée.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/api/admin/circuits/${c.id}`, { method: 'DELETE' });
      toast.success('Circuit supprimé.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    }
  }

  async function deleteCompetition(c: AdminCompetition) {
    const ok = await confirm({
      title: 'Supprimer la compétition',
      message: `« ${c.name} » sera supprimée définitivement.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/api/admin/competitions/${c.id}`, { method: 'DELETE' });
      toast.success('Compétition supprimée.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    }
  }

  async function openAdminSearch() {
    if (allUsers !== null) return;
    try {
      const data = await api<{ users: Array<{ uid: string; displayName: string; discordUsername: string; isAdmin: boolean }> }>('/api/admin/users');
      setAllUsers(data.users ?? []);
    } catch {
      toast.error('Impossible de charger la liste des joueurs.');
    }
  }

  async function addCompAdmin(uid: string) {
    setAddingUid(uid);
    try {
      await api('/api/admin/competition-admins', { method: 'POST', body: { uid } });
      toast.success('Admin de compétition ajouté.');
      setAdminSearch('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setAddingUid(null);
    }
  }

  async function removeCompAdmin(a: CompetitionAdminEntry) {
    const ok = await confirm({
      title: "Retirer l'admin de compétition",
      message: `${a.displayName} perdra l'accès à la gestion des compétitions (validation, litiges, scores).`,
      confirmLabel: 'Retirer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/api/admin/competition-admins?uid=${encodeURIComponent(a.uid)}`, { method: 'DELETE' });
      toast.success('Admin de compétition retiré.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    }
  }

  const searchResults = useMemo(() => {
    if (!allUsers || adminSearch.trim().length < 2) return [];
    const q = adminSearch.trim().toLowerCase();
    const alreadyAdmin = new Set(compAdmins.map(a => a.uid));
    return allUsers
      .filter(u =>
        !alreadyAdmin.has(u.uid) && !u.isAdmin &&
        (u.displayName.toLowerCase().includes(q) || u.discordUsername.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [allUsers, adminSearch, compAdmins]);

  if (loading) return <AdminContentSkeleton />;

  if (view.kind === 'circuit-form') {
    return (
      <CircuitForm
        initial={view.circuit}
        onCancel={() => setView({ kind: 'list' })}
        onSaved={async () => { setView({ kind: 'list' }); await load(); }}
      />
    );
  }

  if (view.kind === 'competition-form') {
    return (
      <CompetitionForm
        initial={view.competition}
        circuits={circuits}
        onCancel={() => setView({ kind: 'list' })}
        onSaved={async () => { setView({ kind: 'list' }); await load(); }}
      />
    );
  }

  if (view.kind === 'rulebook') {
    return (
      <RulebookEditor
        scope={view.scope}
        label={view.label}
        onClose={() => setView({ kind: 'list' })}
      />
    );
  }

  if (view.kind === 'registrations') {
    return (
      <RegistrationsPanel
        competition={view.competition}
        onClose={() => { setView({ kind: 'list' }); load(); }}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Trophy size={18} style={{ color: 'var(--s-gold)' }} />
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          COMPÉTITIONS
        </h2>
      </div>

      {/* Circuits */}
      <div className="panel bevel">
        <div className="panel-header flex items-center justify-between">
          <span className="t-sub">Circuits ({circuits.length})</span>
          {isAdmin && (
            <button
              type="button"
              className="btn-springs btn-secondary bevel-sm text-sm flex items-center gap-1.5"
              onClick={() => setView({ kind: 'circuit-form', circuit: null })}
            >
              <Plus size={14} /> Nouveau circuit
            </button>
          )}
        </div>
        <div className="panel-body p-0">
          {circuits.length === 0 ? (
            <p className="text-sm px-4 py-6" style={{ color: 'var(--s-text-dim)' }}>
              Aucun circuit. Crée le circuit Legends Springs Cup pour rattacher les Qualifs.
            </p>
          ) : circuits.map((c, i) => (
            // flex-wrap : sur mobile le surplus serait clippé par le clip-path
            // du panel .bevel (pas de scroll horizontal possible) — les actions
            // passent à la ligne au lieu de disparaître.
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3"
              style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
              <GameTag gameId={c.game} size="sm" />
              <span className="text-sm font-semibold flex-1 min-w-0 truncate">{c.name}</span>
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                {c.competitionIds.length} compétition{c.competitionIds.length > 1 ? 's' : ''}
              </span>
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Top {c.lanTeamCount} · best {c.bestResultsCount}
              </span>
              <span className="tag tag-neutral">{STATUS_LABELS[c.status] ?? c.status}</span>
              <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1"
                onClick={() => setView({ kind: 'rulebook', scope: { circuitId: c.id }, label: c.name })}>
                <ScrollText size={13} /> Règlement
              </button>
              {isAdmin && (
                <>
                  <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1"
                    onClick={() => setView({ kind: 'circuit-form', circuit: c })}>
                    <Pencil size={13} /> Éditer
                  </button>
                  <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1"
                    style={{ color: '#ff8a8a' }}
                    onClick={() => deleteCircuit(c)}>
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Compétitions */}
      <div className="panel bevel">
        <div className="panel-header flex items-center justify-between">
          <span className="t-sub">Compétitions ({competitions.length})</span>
          {isAdmin && (
            <button
              type="button"
              className="btn-springs btn-primary bevel-sm text-sm flex items-center gap-1.5"
              onClick={() => setView({ kind: 'competition-form', competition: null })}
            >
              <Plus size={14} /> Nouvelle compétition
            </button>
          )}
        </div>
        <div className="panel-body p-0">
          {competitions.length === 0 ? (
            <p className="text-sm px-4 py-6" style={{ color: 'var(--s-text-dim)' }}>
              Aucune compétition. Le préréglage Legends Qualif remplit le format
              complet (BO, MMR, phases), il ne reste que le nom et les dates.
            </p>
          ) : competitions.map((c, i) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3"
              style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
              <GameTag gameId={c.game} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{c.name}</p>
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  {c.circuitId ? circuitNames[c.circuitId] ?? 'Circuit supprimé' : 'Hors circuit'}
                  {c.schedule?.days?.[0]?.date ? ` · ${formatDate(c.schedule.days[0].date)}` : ''}
                  {c.registration?.opensAt
                    ? ` · inscriptions ${formatDate(c.registration.opensAt)} → ${formatDate(c.registration.closesAt)}`
                    : ''}
                </p>
              </div>
              <span className="tag tag-neutral">{STATUS_LABELS[c.status] ?? c.status}</span>
              <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1"
                onClick={() => setView({ kind: 'registrations', competition: c })}>
                <ClipboardCheck size={13} /> Inscriptions
              </button>
              <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1"
                onClick={() => setView({ kind: 'rulebook', scope: { competitionId: c.id }, label: c.name })}>
                <ScrollText size={13} /> Règlement
              </button>
              {isAdmin && (
                <>
                  <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1"
                    onClick={() => setView({ kind: 'competition-form', competition: c })}>
                    <Pencil size={13} /> Éditer
                  </button>
                  <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1"
                    style={{ color: '#ff8a8a' }}
                    onClick={() => deleteCompetition(c)}>
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Registre des bans — géré par les admins de compétition (rôle scopé inclus) */}
      <BansPanel bans={bans} onChanged={load} />

      {/* Bac à sable de test — admins Aedral uniquement (création de comptes fictifs) */}
      {isAdmin && <SandboxPanel competitions={competitions} />}

      {/* Admins de compétition — nomination réservée aux admins Aedral */}
      {isAdmin && (
      <div className="panel bevel">
        <div className="panel-header">
          <span className="t-sub">Admins de compétition ({compAdmins.length})</span>
        </div>
        <div className="panel-body space-y-4">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Rôle scopé : validation des inscriptions, litiges, scores, bans de
            compétition. Aucun accès au reste du panel admin. Les admins Aedral
            ont déjà tous ces droits.
          </p>

          {/* Résultats en flux normal, PAS en dropdown absolute : le panel
              porte .bevel dont le clip-path clippe tout dépassement (piège
              documenté — mémoire project_bevel_clips_dropdowns). */}
          <div className="max-w-md">
            <input
              className="settings-input w-full"
              placeholder="Chercher un joueur (pseudo ou Discord)"
              value={adminSearch}
              onFocus={openAdminSearch}
              onChange={e => setAdminSearch(e.target.value)}
            />
            {searchResults.length > 0 && (
              <div className="mt-1"
                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                {searchResults.map(u => (
                  <button
                    key={u.uid}
                    type="button"
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--s-hover)]"
                    style={{ cursor: 'pointer' }}
                    disabled={addingUid === u.uid}
                    onClick={() => addCompAdmin(u.uid)}
                  >
                    <span>{u.displayName}</span>
                    <span style={{ color: 'var(--s-text-muted)' }}>@{u.discordUsername}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {compAdmins.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
              Aucun admin de compétition nommé.
            </p>
          ) : (
            <div style={{ border: '1px solid var(--s-border)' }}>
              {compAdmins.map((a, i) => (
                <div key={a.uid} className="flex items-center gap-3 px-3 py-2"
                  style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
                  {a.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- avatar Discord externe, taille fixe
                    <img src={a.avatarUrl} alt="" width={24} height={24}
                      style={{ borderRadius: '50%', flexShrink: 0 }} />
                  ) : (
                    <span className="w-6 h-6 flex-shrink-0" style={{ background: 'var(--s-elevated)', borderRadius: '50%' }} />
                  )}
                  <span className="text-sm font-semibold flex-1">{a.displayName}</span>
                  <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    Ajouté le {formatDate(a.addedAt)}
                  </span>
                  <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1"
                    onClick={() => removeCompAdmin(a)}>
                    <UserMinus size={13} /> Retirer
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
