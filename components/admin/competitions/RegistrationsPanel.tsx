'use client';

// File de validation des inscriptions d'une compétition (spec Legends §4,
// archi §7) — vue console des admins de compétition.
//
// - Détail par équipe : roster complet (MMR réf, âge, pays, vérifié, tracker),
//   drapeaux serveur, signalements smurf en AGRÉGAT anonymisé (jamais
//   l'identité des signaleurs), version du règlement acceptée.
// - Valider : cap → validée ou liste d'attente ; dérogations mineurs exigées
//   note par note ; rattachement circuit arbitré explicitement en cas
//   d'ambiguïté (noyau 2/3, name_mismatch, identity_conflict).
// - Refuser : motif obligatoire, transmis à l'équipe (notif + DM).
// - Provisionner Discord : batch idempotent découplé (statut par équipe).
//
// Formulaires INLINE dans la rangée dépliée — pas de dropdown/modal absolu
// dans un panel .bevel (le clip-path clippe, piège documenté).

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, ShieldAlert } from 'lucide-react';
import { getProfileHref } from '@/lib/user-slug';
import { getStructureHref } from '@/lib/structure-slug';
import { SANCTION_REASON_CODES } from '@/lib/competitions/sanctions';
import type { AdminCompetition } from '@/components/admin/competitions/types';

// ── Formes JSON de /api/admin/competitions/[id]/registrations ───────────────

interface RosterRow {
  uid: string;
  role: 'titulaire' | 'remplacant';
  displayName: string;
  slug: string | null;
  declaredCurrentMmr: number;
  declaredPeakMmr: number;
  refMmr: number;
  trackerUrl: string | null;
  discordId: string | null;
  discordUsername: string | null;
  epicId: string | null;
  epicName: string | null;
  steamId: string | null;
  onDiscordGuild: boolean | null;
  country: string | null;
  age: number | null;
  verified: boolean;
  smurf: { pendingReports: number; adminFlag: boolean };
}

interface IdentityMatchRow {
  circuitTeamId: string;
  name: string;
  nameMatch: boolean;
  coreMatch: boolean;
  coreOverlap: number;
  claimedByOther: boolean;
  totalPoints: number;
  participationsCount: number;
}

interface IdentityInfo {
  proposal: 'new' | 'attach' | 'choice_required';
  circuitTeamId: string | null;
  flags: string[];
  matches: IdentityMatchRow[];
}

interface StaffMember {
  uid: string;
  displayName: string;
  discordUsername: string | null;
  slug: string | null;
}

interface StaffInfo {
  founder: StaffMember | null;
  coFounders: StaffMember[];
  responsables: StaffMember[];
  teamManagers: StaffMember[];
  teamCoaches: StaffMember[];
  captain: StaffMember | null;
}

interface SanctionRow {
  id: string;
  type: 'warn' | 'exclusion' | 'ban';
  targetType: 'user' | 'structure' | 'team';
  targetId: string;
  targetLabel: string;
  reason: string;
  reasonCode: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

interface RegistrationRow {
  id: string;
  teamId: string;
  structureId: string;
  structureName: string;
  structureSlug: string | null;
  name: string;
  tag: string;
  logoUrl: string | null;
  status: 'pending' | 'approved' | 'waitlisted' | 'rejected' | 'withdrawn';
  createdAt: string | null;
  createdByName: string;
  createdByUid: string;
  createdBySlug: string | null;
  createdByDiscordUsername: string | null;
  createdByOnDiscordGuild: boolean | null;
  captainUid: string;
  staff: StaffInfo;
  sanctions: SanctionRow[];
  adminNotes: string;
  roster: RosterRow[];
  computed: { worstLineupAvg: number | null; worstLineupGap: number | null; flags: string[] };
  review: { byName: string; at: string | null; reason: string | null; derogations: Array<{ uid: string; note: string }> } | null;
  rulebookAccepted: { version: number; at: string | null } | null;
  circuitTeamId: string | null;
  discord: {
    provisioningStatus: 'none' | 'queued' | 'partial' | 'done' | 'error';
    warnings: string[];
    errorMessage: string | null;
  };
  identity: IdentityInfo | null;
}

interface RegistrationsResponse {
  registrations: RegistrationRow[];
  counts: { approved: number; maxTeams: number; waitlistEnabled: boolean };
  minAge: number | null;
  discordConfigured: boolean;
  circuitName: string | null;
}

interface ProvisionReport {
  total: number;
  done: number;
  partial: number;
  errors: number;
  deadlineReached: boolean;
  teams: Array<{ name: string; status: string; warnings: string[] }>;
}

// ── Libellés ────────────────────────────────────────────────────────────────

const FLAG_LABELS: Record<string, string> = {
  mmr_avg_exceeded: 'Moyenne MMR dépassée',
  mmr_gap_exceeded: 'Écart MMR dépassé',
  mmr_player_cap_exceeded: 'Plafond MMR joueur',
  underage: 'Dérogation requise',
  unverified_account: 'Compte non vérifié',
  banned_player: 'Joueur banni',
  banned_structure: 'Structure bannie',
  identity_conflict: 'Conflit d\'identité circuit',
  name_mismatch: 'Changement de nom',
  discord_guild_missing: 'Absent du Discord',
};

const DISCORD_STATUS_LABELS: Record<string, string> = {
  none: '',
  queued: 'Discord à provisionner',
  partial: 'Discord partiel',
  done: 'Discord prêt',
  error: 'Discord en erreur',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}

// ── Composant ───────────────────────────────────────────────────────────────

export default function RegistrationsPanel({
  competition,
  onClose,
}: {
  competition: AdminCompetition;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<RegistrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Formulaire de décision inline : au plus un ouvert à la fois.
  const [decision, setDecision] = useState<{
    regId: string;
    mode: 'approve' | 'reject';
    reason: string;
    derogations: Record<string, string>;         // uid → note
    circuitChoice: string | null;                // circuitTeamId ou 'new'
  } | null>(null);
  const [acting, setActing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [report, setReport] = useState<ProvisionReport | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<RegistrationsResponse>(`/api/admin/competitions/${competition.id}/registrations`);
      setData(d);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competition.id]);

  useEffect(() => { load(); }, [load]);

  const showMmr = !!competition.eligibility?.mmr;

  const sections = useMemo(() => {
    const regs = data?.registrations ?? [];
    const byDate = (a: RegistrationRow, b: RegistrationRow) =>
      String(a.createdAt).localeCompare(String(b.createdAt));
    const byReview = (a: RegistrationRow, b: RegistrationRow) =>
      String(a.review?.at ?? '').localeCompare(String(b.review?.at ?? ''));
    return [
      { key: 'pending', title: 'En attente', rows: regs.filter(r => r.status === 'pending').sort(byDate) },
      { key: 'approved', title: 'Validées', rows: regs.filter(r => r.status === 'approved').sort(byReview) },
      { key: 'waitlisted', title: 'Liste d\'attente', rows: regs.filter(r => r.status === 'waitlisted').sort(byReview) },
      { key: 'rejected', title: 'Refusées', rows: regs.filter(r => r.status === 'rejected').sort(byDate) },
      { key: 'withdrawn', title: 'Retirées', rows: regs.filter(r => r.status === 'withdrawn').sort(byDate) },
    ].filter(s => s.rows.length > 0);
  }, [data]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openDecision(reg: RegistrationRow, mode: 'approve' | 'reject') {
    setExpanded(prev => new Set(prev).add(reg.id));
    const underageUids = underagePlayers(reg).map(p => p.uid);
    const derogations: Record<string, string> = {};
    for (const u of underageUids) {
      const existing = reg.review?.derogations?.find(d => d.uid === u);
      derogations[u] = existing?.note ?? '';
    }
    setDecision({
      regId: reg.id,
      mode,
      reason: '',
      derogations,
      circuitChoice: reg.identity?.proposal === 'choice_required' ? null : 'auto',
    });
  }

  function underagePlayers(reg: RegistrationRow): RosterRow[] {
    const minAge = data?.minAge ?? null;
    if (minAge === null) return [];
    return reg.roster.filter(p => p.age === null || p.age < minAge);
  }

  async function submitDecision(reg: RegistrationRow) {
    if (!decision) return;
    setActing(true);
    try {
      if (decision.mode === 'reject') {
        await api(`/api/admin/competitions/${competition.id}/registrations`, {
          method: 'POST',
          body: { action: 'reject', registrationId: reg.id, reason: decision.reason.trim() },
        });
        toast.success(`Inscription de ${reg.name} refusée.`);
      } else {
        const body: Record<string, unknown> = { action: 'approve', registrationId: reg.id };
        const derogations = Object.entries(decision.derogations)
          .filter(([, note]) => note.trim().length >= 3)
          .map(([uid, note]) => ({ uid, note: note.trim() }));
        if (derogations.length > 0) body.derogations = derogations;
        if (reg.identity?.proposal === 'choice_required') {
          // 'auto' est la sentinelle posée quand la proposition n'exigeait pas
          // de choix — si un rechargement a rendu l'arbitrage nécessaire entre
          // temps, elle ne doit jamais partir au serveur comme un vrai choix.
          if (!decision.circuitChoice || decision.circuitChoice === 'auto') {
            toast.error('Choisis le rattachement circuit avant de valider.');
            setActing(false);
            return;
          }
          body.circuitTeam = decision.circuitChoice === 'new'
            ? { choice: 'new' }
            : { choice: 'attach', circuitTeamId: decision.circuitChoice };
        }
        const res = await api<{ status: string }>(`/api/admin/competitions/${competition.id}/registrations`, {
          method: 'POST',
          body,
        });
        toast.success(res.status === 'waitlisted'
          ? `${reg.name} placée en liste d'attente (compétition complète).`
          : `${reg.name} validée.`);
      }
      setDecision(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
      // Un 409/422 signifie que l'état serveur a bougé (conflit d'identité,
      // claim pris, doc réécrit…) : on recharge pour que l'admin arbitre sur
      // des données fraîches au lieu de rester bloqué sur une vue périmée.
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) {
        await load();
      }
    } finally {
      setActing(false);
    }
  }

  async function unapprove(reg: RegistrationRow) {
    const ok = await confirm({
      title: 'Annuler la validation',
      message: `${reg.name} repassera en attente de validation. Son rattachement circuit est libéré ; les salons Discord déjà créés restent en place.`,
      confirmLabel: 'Remettre en attente',
    });
    if (!ok) return;
    setActing(true);
    try {
      await api(`/api/admin/competitions/${competition.id}/registrations`, {
        method: 'POST',
        body: { action: 'unapprove', registrationId: reg.id },
      });
      toast.success(`${reg.name} remise en attente.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setActing(false);
    }
  }

  async function provision() {
    setProvisioning(true);
    setReport(null);
    try {
      const res = await api<{ report: ProvisionReport }>(`/api/admin/competitions/${competition.id}/provision`, {
        method: 'POST',
      });
      setReport(res.report);
      const r = res.report;
      if (r.total === 0) toast.success('Rien à provisionner : toutes les équipes validées sont prêtes.');
      else if (r.errors > 0) toast.error(`Provisioning terminé avec ${r.errors} erreur${r.errors > 1 ? 's' : ''}.`);
      else toast.success(`Provisioning terminé : ${r.done} prête${r.done > 1 ? 's' : ''}${r.partial > 0 ? `, ${r.partial} partielle${r.partial > 1 ? 's' : ''}` : ''}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setProvisioning(false);
    }
  }

  // Export CSV client-side (ouvrable dans Google Sheets / Excel) — une ligne par
  // joueur, toutes les équipes. BOM UTF-8 pour les accents.
  function exportCsv() {
    const regs = data?.registrations ?? [];
    const head = ['Équipe', 'Tag', 'Statut', 'Structure', 'Joueur', 'Rôle', 'Capitaine', 'MMR réf', 'MMR actuel', 'MMR peak', 'Âge', 'Pays', 'Vérifié', 'Discord', 'Epic/Steam'];
    const rows: string[][] = [head];
    for (const r of regs) {
      for (const p of r.roster) {
        rows.push([
          r.name, r.tag, r.status, r.structureName, p.displayName, p.role,
          p.uid === r.captainUid ? 'oui' : '',
          String(p.refMmr), String(p.declaredCurrentMmr), String(p.declaredPeakMmr),
          p.age != null ? String(p.age) : '', p.country ?? '', p.verified ? 'oui' : 'non',
          p.discordUsername ?? '', p.epicName ?? p.steamId ?? '',
        ]);
      }
    }
    // Anti-injection de formules (CSV injection) : un nom d'équipe/pseudo saisi
    // par un utilisateur commençant par = + - @ (ou tab/CR) serait interprété
    // comme une formule à l'ouverture dans Sheets/Excel → on préfixe d'une
    // apostrophe (forçage texte, masquée par le tableur) avant l'échappement.
    const neutralize = (c: string) => (/^[=+\-@\t\r]/.test(c) ? `'${c}` : c);
    const csv = rows.map(row => row.map(c => `"${neutralize(String(c)).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscriptions-${competition.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="panel bevel">
        <div className="panel-body">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Chargement des inscriptions…</p>
        </div>
      </div>
    );
  }

  const counts = data?.counts ?? { approved: 0, maxTeams: 0, waitlistEnabled: false };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1.5" onClick={onClose}>
          <ArrowLeft size={14} /> Compétitions
        </button>
        <h2 className="font-display text-xl flex-1 min-w-0 truncate" style={{ letterSpacing: '0.04em' }}>
          INSCRIPTIONS — {competition.name.toUpperCase()}
        </h2>
        <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
          {counts.approved}/{counts.maxTeams} équipes validées
          {counts.waitlistEnabled ? ' · liste d\'attente activée' : ''}
        </span>
        <button
          type="button"
          className="btn-springs btn-ghost text-sm"
          onClick={exportCsv}
          disabled={(data?.registrations?.length ?? 0) === 0}
        >
          Exporter CSV
        </button>
        {data?.discordConfigured && (
          <button
            type="button"
            className="btn-springs btn-secondary bevel-sm text-sm"
            onClick={provision}
            disabled={provisioning || acting}
          >
            {provisioning ? 'Provisioning en cours…' : 'Provisionner Discord'}
          </button>
        )}
      </div>

      {report && (
        <div className="panel bevel">
          <div className="panel-header">
            <span className="t-sub">
              Rapport Discord — {report.done} prête{report.done > 1 ? 's' : ''}, {report.partial} partielle{report.partial > 1 ? 's' : ''}, {report.errors} erreur{report.errors > 1 ? 's' : ''}
              {report.deadlineReached ? ' · interrompu par la limite de temps, relance le bouton pour continuer' : ''}
            </span>
          </div>
          <div className="panel-body p-0">
            {report.teams.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-2"
                style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
                <span className="text-sm font-semibold">{t.name}</span>
                <span className="tag tag-neutral">{t.status === 'done' ? 'Prêt' : t.status === 'partial' ? 'Partiel' : 'Erreur'}</span>
                {t.warnings.length > 0 && (
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{t.warnings.join(' · ')}</span>
                )}
              </div>
            ))}
            {report.teams.length === 0 && (
              <p className="text-sm px-4 py-3" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe à traiter.</p>
            )}
          </div>
        </div>
      )}

      {sections.length === 0 ? (
        <div className="panel bevel">
          <div className="panel-body">
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Aucune inscription pour l&apos;instant. Elles apparaîtront ici dès la première soumission du wizard.
            </p>
          </div>
        </div>
      ) : sections.map(section => (
        <div key={section.key} className="panel bevel">
          <div className="panel-header">
            <span className="t-sub">{section.title} ({section.rows.length})</span>
          </div>
          <div className="panel-body p-0">
            {section.rows.map((reg, i) => (
              <RegistrationRowView
                key={reg.id}
                reg={reg}
                first={i === 0}
                expanded={expanded.has(reg.id)}
                onToggle={() => toggleExpand(reg.id)}
                showMmr={showMmr}
                mmrMaxAvg={competition.eligibility?.mmr?.maxAvg ?? null}
                mmrMaxGap={competition.eligibility?.mmr?.maxGap ?? null}
                minAge={data?.minAge ?? null}
                circuitName={data?.circuitName ?? null}
                decision={decision?.regId === reg.id ? decision : null}
                setDecision={setDecision}
                onOpenDecision={openDecision}
                onSubmitDecision={() => submitDecision(reg)}
                onUnapprove={() => unapprove(reg)}
                acting={acting || provisioning}
                underage={underagePlayers(reg)}
                competitionId={competition.id}
                competitionName={competition.name}
                onReload={load}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Rangée d'inscription ────────────────────────────────────────────────────

function RegistrationRowView({
  reg, first, expanded, onToggle, showMmr, mmrMaxAvg, mmrMaxGap, minAge, circuitName,
  decision, setDecision, onOpenDecision, onSubmitDecision, onUnapprove,
  acting, underage, competitionId, competitionName, onReload,
}: {
  reg: RegistrationRow;
  first: boolean;
  expanded: boolean;
  onToggle: () => void;
  showMmr: boolean;
  mmrMaxAvg: number | null;
  mmrMaxGap: number | null;
  minAge: number | null;
  circuitName: string | null;
  decision: { regId: string; mode: 'approve' | 'reject'; reason: string; derogations: Record<string, string>; circuitChoice: string | null } | null;
  setDecision: React.Dispatch<React.SetStateAction<{ regId: string; mode: 'approve' | 'reject'; reason: string; derogations: Record<string, string>; circuitChoice: string | null } | null>>;
  onOpenDecision: (reg: RegistrationRow, mode: 'approve' | 'reject') => void;
  onSubmitDecision: () => void;
  onUnapprove: () => void;
  acting: boolean;
  underage: RosterRow[];
  competitionId: string;
  competitionName: string;
  onReload: () => void;
}) {
  const [sanctionTarget, setSanctionTarget] = useState<{ targetType: 'user' | 'structure' | 'team'; targetId: string; targetLabel: string } | null>(null);
  const smurfTotal = reg.roster.reduce((n, p) => n + p.smurf.pendingReports, 0);
  const adminFlagged = reg.roster.some(p => p.smurf.adminFlag);
  const discordLabel = DISCORD_STATUS_LABELS[reg.discord.provisioningStatus];
  const actionable = reg.status === 'pending' || reg.status === 'waitlisted';

  // Roster trié titulaires → remplaçants + compteurs (rangées-groupe dans la table).
  const rosterSorted = [...reg.roster].sort((a, b) => (a.role === b.role ? 0 : a.role === 'titulaire' ? -1 : 1));
  const titCount = rosterSorted.filter(p => p.role === 'titulaire').length;
  const remCount = rosterSorted.length - titCount;
  const colCount = showMmr ? 9 : 6;
  // MMR d'équipe (worstLineupAvg = moyenne de la meilleure compo alignable) + éligibilité.
  const teamAvg = reg.computed.worstLineupAvg;
  const teamGap = reg.computed.worstLineupGap;
  const avgOver = reg.computed.flags.includes('mmr_avg_exceeded');
  const gapOver = reg.computed.flags.includes('mmr_gap_exceeded');
  const staffRows = buildStaffRows(reg);

  return (
    <div style={{ borderTop: first ? 'none' : '1px solid var(--s-border)' }}>
      <button
        type="button"
        className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-[var(--s-hover)]"
        style={{ cursor: 'pointer' }}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={14} style={{ flexShrink: 0 }} /> : <ChevronRight size={14} style={{ flexShrink: 0 }} />}
        <span className="text-sm font-semibold min-w-0 truncate">
          {reg.name}{reg.tag ? <span style={{ color: 'var(--s-text-muted)' }}> [{reg.tag}]</span> : null}
        </span>
        {reg.computed.flags.map(f => (
          <span key={f} className="tag tag-neutral" style={{ color: '#ffb46b', borderColor: 'rgba(255,180,107,0.4)' }}>
            {FLAG_LABELS[f] ?? f}
          </span>
        ))}
        {smurfTotal > 0 && (
          <span className="tag tag-neutral" style={{ color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.4)' }}>
            {smurfTotal} signalement{smurfTotal > 1 ? 's' : ''} smurf
          </span>
        )}
        {adminFlagged && (
          <span className="tag tag-neutral" style={{ color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.4)' }}>
            Flag admin
          </span>
        )}
        {discordLabel && <span className="tag tag-neutral">{discordLabel}</span>}
        <span className="text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>
          {formatDate(reg.createdAt)} · par {reg.createdByName}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4" style={{ paddingLeft: '2rem' }}>
          {/* Roster — caption « MMR d'équipe » (lu en premier) + table alignée */}
          <div className="bevel-sm overflow-x-auto" style={{ border: '1px solid var(--s-border)' }}>
            <div className="flex items-baseline justify-between gap-4 px-3 py-2" style={{ borderBottom: '1px solid var(--s-border)' }}>
              {showMmr ? (
                teamAvg !== null ? (
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="t-label-soft">MMR d&apos;équipe</span>
                    <span className="t-mono" style={{ fontSize: '16px', color: avgOver ? '#ffb46b' : 'var(--s-text)', fontWeight: 600 }}>{teamAvg}</span>
                    <span className="t-mono" style={{ color: gapOver ? '#ffb46b' : 'var(--s-text-dim)' }}>· écart {teamGap}</span>
                    {(mmrMaxAvg !== null || mmrMaxGap !== null) && (
                      <span className="t-label-soft">· limite {mmrMaxAvg ?? '—'} / {mmrMaxGap ?? '—'}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    MMR d&apos;équipe — indisponible (compo de 3 incomplète)
                  </span>
                )
              ) : <span />}
              <span className="flex-shrink-0 whitespace-nowrap">
                <span className="t-label">Roster</span>
                <span className="t-label-soft"> · {reg.roster.length} joueur{reg.roster.length > 1 ? 's' : ''}</span>
              </span>
            </div>

            <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: showMmr ? 900 : 680 }}>
              <thead>
                {showMmr ? (
                  <>
                    <tr style={{ borderBottom: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                      <th rowSpan={2} className="text-left font-medium px-3 py-2 align-bottom">Joueur</th>
                      <th colSpan={3} className="text-center font-medium px-2 py-1.5"
                        title="MMR de référence = 0,7 × actuel + 0,3 × peak (le MMR qui compte pour l'éligibilité)"
                        style={{ borderBottom: '1px solid var(--s-border)' }}>MMR</th>
                      <th rowSpan={2} className="text-right font-medium px-2 py-2 align-bottom">Âge</th>
                      <th rowSpan={2} className="text-center font-medium px-2 py-2 align-bottom">Pays</th>
                      <th rowSpan={2} className="text-left font-medium px-2 py-2 align-bottom">Comptes</th>
                      <th rowSpan={2} className="text-left font-medium px-3 py-2 align-bottom">Alertes</th>
                      <th rowSpan={2} className="px-2 py-2" />
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                      <th className="text-right font-medium px-2 py-1.5">Actuel</th>
                      <th className="text-right font-medium px-2 py-1.5">Peak</th>
                      <th className="text-right font-medium px-2 py-1.5">Réf</th>
                    </tr>
                  </>
                ) : (
                  <tr style={{ borderBottom: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                    <th className="text-left font-medium px-3 py-2">Joueur</th>
                    <th className="text-right font-medium px-2 py-2">Âge</th>
                    <th className="text-center font-medium px-2 py-2">Pays</th>
                    <th className="text-left font-medium px-2 py-2">Comptes</th>
                    <th className="text-left font-medium px-3 py-2">Alertes</th>
                    <th className="px-2 py-2" />
                  </tr>
                )}
              </thead>
              <tbody>
                {rosterSorted.map((p, i) => {
                  const underAge = minAge !== null && (p.age === null || p.age < minAge);
                  const newGroup = i === 0 || rosterSorted[i - 1].role !== p.role;
                  return (
                    <Fragment key={p.uid}>
                      {newGroup && (
                        <tr style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
                          <td colSpan={colCount} className="t-label-soft px-3 py-1.5" style={{ background: 'var(--s-elevated)' }}>
                            {p.role === 'titulaire' ? `Titulaires · ${titCount}` : `Remplaçants · ${remCount}`}
                          </td>
                        </tr>
                      )}
                      <tr style={{ borderTop: '1px solid var(--s-border)' }}>
                        <td className="px-3 py-2 align-top">
                          <Link href={getProfileHref({ slug: p.slug, uid: p.uid })} target="_blank"
                            className="font-semibold hover:underline" onClick={e => e.stopPropagation()}>
                            {p.displayName}
                          </Link>
                          {p.uid === reg.captainUid && <span className="text-xs ml-1.5" style={{ color: 'var(--s-text-muted)' }}>(C)</span>}
                        </td>
                        {showMmr && (
                          <>
                            <td className="px-2 py-2 text-right t-mono align-top" style={{ color: 'var(--s-text-dim)' }}>{p.declaredCurrentMmr}</td>
                            <td className="px-2 py-2 text-right t-mono align-top" style={{ color: 'var(--s-text-dim)' }}>{p.declaredPeakMmr}</td>
                            <td className="px-2 py-2 text-right t-mono align-top" style={{ color: 'var(--s-text)', fontWeight: 600 }}>{p.refMmr}</td>
                          </>
                        )}
                        <td className="px-2 py-2 text-right whitespace-nowrap align-top" style={{ color: underAge ? '#ffb46b' : 'var(--s-text-dim)' }}>
                          {p.age !== null ? `${p.age} ans` : 'Inconnu'}
                        </td>
                        <td className="px-2 py-2 text-center align-top" style={{ color: 'var(--s-text-dim)' }}>{p.country || '—'}</td>
                        <td className="px-2 py-2 align-top">
                          <div className="flex flex-col gap-0.5" style={{ color: 'var(--s-text-dim)' }}>
                            {p.discordUsername ? <span>@{p.discordUsername}</span> : <span style={{ color: 'var(--s-text-muted)' }}>Discord —</span>}
                            {p.epicName ? <span>Epic {p.epicName}</span> : p.steamId ? <span>Steam {p.steamId}</span> : (
                              <span style={{ color: '#ffb46b' }}>Non vérifié</span>
                            )}
                            {p.trackerUrl && (
                              <a href={p.trackerUrl} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 hover:underline" style={{ color: 'var(--s-blue)' }}
                                onClick={e => e.stopPropagation()}>
                                Tracker <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-col gap-0.5">
                            {underAge && <span style={{ color: '#ffb46b' }}>Dérogation</span>}
                            {p.onDiscordGuild === false && <span style={{ color: '#ffb46b' }}>Hors Discord</span>}
                            {p.smurf.pendingReports > 0 && (
                              <span className="flex items-center gap-1" style={{ color: '#ff8a8a' }}>
                                <ShieldAlert size={12} /> {p.smurf.pendingReports} smurf
                              </span>
                            )}
                            {p.smurf.adminFlag && (
                              <span className="flex items-center gap-1" style={{ color: '#ff8a8a' }}><ShieldAlert size={12} /> flag</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap align-top">
                          <button type="button" className="text-xs hover:underline" style={{ color: 'var(--s-text-muted)' }}
                            onClick={e => { e.stopPropagation(); setSanctionTarget({ targetType: 'user', targetId: p.uid, targetLabel: p.displayName }); }}>
                            Sanctionner
                          </button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Staff & direction — grille « rôle · nom · @Discord », une ligne par personne */}
          <div>
            <p className="t-label mb-2">Staff & direction</p>
            <div className="overflow-x-auto">
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,max-content) minmax(110px,max-content) minmax(0,1fr)', columnGap: '1.5rem', minWidth: 'min-content' }}>
                {staffRows.map((s, i) => {
                  const cellStyle = { padding: '0.5rem 0', borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' } as const;
                  return (
                    <Fragment key={s.uid}>
                      <div className="t-label-soft" style={cellStyle}>{s.roles.join(' · ')}</div>
                      <div className="text-sm" style={cellStyle}>
                        <Link href={getProfileHref({ slug: s.slug, uid: s.uid })} target="_blank"
                          className="hover:underline" style={{ color: 'var(--s-text)', fontWeight: 500 }} onClick={e => e.stopPropagation()}>
                          {s.name}
                        </Link>
                      </div>
                      <div className="text-sm truncate min-w-0" style={{ ...cellStyle, color: 'var(--s-text-muted)' }}>
                        {s.discord && `@${s.discord}`}
                        {s.warn && <span style={{ color: '#ffb46b' }}>{s.discord ? ' · ' : ''}{s.warn}</span>}
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Meta compétition */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            <span>
              Structure{' '}
              <Link href={getStructureHref({ id: reg.structureId, slug: reg.structureSlug })} target="_blank"
                className="hover:underline" style={{ color: 'var(--s-text)' }}>
                {reg.structureName || reg.structureId}
              </Link>
            </span>
            <span>
              {reg.rulebookAccepted
                ? `Règlement v${reg.rulebookAccepted.version} accepté le ${formatDate(reg.rulebookAccepted.at)}`
                : 'Aucun règlement accepté'}
            </span>
            {reg.review && reg.status !== 'pending' && (
              <span>
                {reg.status === 'rejected' ? 'Refusée' : 'Validée'} par {reg.review.byName} le {formatDate(reg.review.at)}
                {reg.review.reason ? ` — ${reg.review.reason}` : ''}
              </span>
            )}
            {(reg.review?.derogations?.length ?? 0) > 0 && (
              <span>{reg.review!.derogations.length} dérogation{reg.review!.derogations.length > 1 ? 's' : ''} accordée{reg.review!.derogations.length > 1 ? 's' : ''}</span>
            )}
            {reg.discord.warnings.length > 0 && (
              <span style={{ color: '#ffb46b' }}>{reg.discord.warnings.join(' · ')}</span>
            )}
            {reg.discord.errorMessage && (
              <span style={{ color: '#ff8a8a' }}>Discord : {reg.discord.errorMessage}</span>
            )}
          </div>

          {/* Historique des sanctions (fonde l'escalade manuelle) */}
          {reg.sanctions.length > 0 && (
            <div style={{ border: '1px solid var(--s-border)' }}>
              <div className="px-3 py-1.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
                <span className="t-label">Historique sanctions ({reg.sanctions.length})</span>
              </div>
              {reg.sanctions.map((s, i) => (
                <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm"
                  style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none', opacity: s.active ? 1 : 0.55 }}>
                  <span className="tag tag-neutral" style={SANCTION_COLOR[s.type]}>{SANCTION_LABEL[s.type]}</span>
                  <span style={{ color: 'var(--s-text-dim)' }}>{s.reason}</span>
                  <span className="text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>
                    {formatDate(s.createdAt)}
                    {s.revokedAt ? ' · levée' : !s.active ? ' · expirée' : s.expiresAt ? ` · jusqu'au ${formatDate(s.expiresAt)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Notes admin internes (jamais vues par l'équipe) */}
          <NotesEditor regId={reg.id} competitionId={competitionId} initial={reg.adminNotes} onSaved={onReload} />

          {/* Modération graduée — avertir/exclure/bannir l'équipe ou la structure */}
          {!sanctionTarget && (
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" className="btn-springs btn-ghost text-sm"
                onClick={() => setSanctionTarget({ targetType: 'team', targetId: reg.teamId, targetLabel: reg.name })}>
                Sanctionner l&apos;équipe
              </button>
              <button type="button" className="btn-springs btn-ghost text-sm"
                onClick={() => setSanctionTarget({ targetType: 'structure', targetId: reg.structureId, targetLabel: reg.structureName || reg.structureId })}>
                Sanctionner la structure
              </button>
            </div>
          )}

          {/* Formulaire de sanction (joueur / équipe / structure) */}
          {sanctionTarget && (
            <SanctionForm
              target={sanctionTarget}
              competitionId={competitionId}
              competitionName={competitionName}
              contextStructureId={reg.structureId}
              contextTeamId={reg.teamId}
              onClose={() => setSanctionTarget(null)}
              onDone={() => { setSanctionTarget(null); onReload(); }}
            />
          )}

          {/* Identité circuit (pending uniquement, résolue serveur) */}
          {reg.identity && reg.status === 'pending' && (
            <IdentityBlock reg={reg} circuitName={circuitName} decision={decision} setDecision={setDecision} />
          )}

          {/* Actions */}
          {actionable && !decision && (
            <div className="flex items-center gap-3">
              <button type="button" className="btn-springs btn-primary bevel-sm text-sm"
                disabled={acting}
                onClick={() => onOpenDecision(reg, 'approve')}>
                Valider
              </button>
              <button type="button" className="btn-springs btn-secondary bevel-sm text-sm"
                disabled={acting}
                onClick={() => onOpenDecision(reg, 'reject')}>
                Refuser
              </button>
              {reg.status === 'waitlisted' && (
                <button type="button" className="btn-springs btn-ghost text-sm" disabled={acting} onClick={onUnapprove}>
                  Remettre en attente
                </button>
              )}
            </div>
          )}
          {reg.status === 'approved' && (
            <div>
              <button type="button" className="btn-springs btn-ghost text-sm" disabled={acting} onClick={onUnapprove}>
                Annuler la validation
              </button>
            </div>
          )}

          {/* Formulaire de décision inline */}
          {decision && actionable && (
            <div className="space-y-3" style={{ border: '1px solid var(--s-border)', padding: '12px' }}>
              {decision.mode === 'reject' ? (
                <>
                  <label className="block text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    Motif du refus — transmis à l&apos;équipe (notification + DM au capitaine)
                  </label>
                  <textarea
                    className="settings-input w-full"
                    rows={2}
                    maxLength={500}
                    aria-label="Motif du refus"
                    value={decision.reason}
                    onChange={e => setDecision(d => d ? { ...d, reason: e.target.value } : d)}
                    placeholder="MMR incohérent avec le tracker, roster incomplet…"
                  />
                </>
              ) : (
                <>
                  {underage.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                        Dérogation requise pour chaque joueur sous l&apos;âge minimum ({minAge} ans) ou d&apos;âge
                        inconnu. La note reste interne (audit).
                      </p>
                      {underage.map(p => (
                        <div key={p.uid} className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold" style={{ minWidth: '12ch' }}>
                            {p.displayName} <span style={{ color: 'var(--s-text-muted)' }}>({p.age !== null ? `${p.age} ans` : 'âge inconnu'})</span>
                          </span>
                          <input
                            className="settings-input flex-1"
                            style={{ minWidth: '220px' }}
                            maxLength={500}
                            aria-label={`Note de dérogation pour ${p.displayName}`}
                            value={decision.derogations[p.uid] ?? ''}
                            onChange={e => setDecision(d => d
                              ? { ...d, derogations: { ...d.derogations, [p.uid]: e.target.value } }
                              : d)}
                            placeholder="Accord parental reçu le…, justificatif…"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {underage.length === 0 && reg.identity?.proposal !== 'choice_required' && (
                    <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                      Valider cette inscription ? L&apos;équipe sera notifiée (notification + DM au capitaine).
                    </p>
                  )}
                </>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="btn-springs btn-primary bevel-sm text-sm"
                  disabled={acting
                    || (decision.mode === 'reject' && decision.reason.trim().length < 3)
                    || (decision.mode === 'approve'
                      && underage.some(p => (decision.derogations[p.uid] ?? '').trim().length < 3))}
                  onClick={onSubmitDecision}
                >
                  {acting ? 'En cours…' : decision.mode === 'reject' ? 'Confirmer le refus' : 'Confirmer la validation'}
                </button>
                <button type="button" className="btn-springs btn-ghost text-sm" disabled={acting}
                  onClick={() => setDecision(null)}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bloc identité circuit ───────────────────────────────────────────────────

function IdentityBlock({
  reg, circuitName, decision, setDecision,
}: {
  reg: RegistrationRow;
  circuitName: string | null;
  decision: { regId: string; mode: 'approve' | 'reject'; circuitChoice: string | null } & Record<string, unknown> | null;
  setDecision: React.Dispatch<React.SetStateAction<{ regId: string; mode: 'approve' | 'reject'; reason: string; derogations: Record<string, string>; circuitChoice: string | null } | null>>;
}) {
  const identity = reg.identity!;
  const label = circuitName ?? 'circuit';

  if (identity.proposal === 'new') {
    return (
      <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
        Identité {label} : nouvelle équipe, points à zéro (aucune équipe existante ne correspond).
      </p>
    );
  }
  if (identity.proposal === 'attach') {
    const m = identity.matches.find(x => x.circuitTeamId === identity.circuitTeamId);
    return (
      <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
        Identité {label} : rattachée à « {m?.name ?? identity.circuitTeamId} »
        ({m?.totalPoints ?? 0} pts, noyau {m?.coreOverlap ?? 0}/3 retrouvé) — points conservés.
      </p>
    );
  }

  // choice_required — l'arbitrage se fait dans le formulaire de validation.
  const choosing = decision?.mode === 'approve';
  return (
    <div className="space-y-2" style={{ border: '1px solid rgba(255,180,107,0.35)', padding: '12px' }}>
      <p className="text-sm font-semibold" style={{ color: '#ffb46b' }}>
        Rattachement {label} à arbitrer
        {identity.flags.includes('name_mismatch') ? ' — noyau retrouvé sous un autre nom (rattacher vaut accord de changement de nom)' : ''}
        {identity.flags.includes('identity_conflict') ? ' — conflit d\'identité (nom repris sans noyau, ou plusieurs candidats)' : ''}
      </p>
      {identity.matches.map(m => (
        <label key={m.circuitTeamId} className="flex flex-wrap items-center gap-2 text-sm" style={{ cursor: choosing ? 'pointer' : 'default' }}>
          {choosing && (
            <input
              type="radio"
              name={`identity-${reg.id}`}
              checked={decision?.circuitChoice === m.circuitTeamId}
              disabled={m.claimedByOther}
              onChange={() => setDecision(d => d ? { ...d, circuitChoice: m.circuitTeamId } : d)}
            />
          )}
          <span className="font-semibold">{m.name}</span>
          <span style={{ color: 'var(--s-text-dim)' }}>
            {m.totalPoints} pts · {m.participationsCount} participation{m.participationsCount > 1 ? 's' : ''}
            · noyau {m.coreOverlap}/3{m.nameMatch ? ' · même nom' : ''}
            {m.claimedByOther ? ' · déjà rattachée à une autre inscription' : ''}
          </span>
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm" style={{ cursor: choosing ? 'pointer' : 'default' }}>
        {choosing && (
          <input
            type="radio"
            name={`identity-${reg.id}`}
            checked={decision?.circuitChoice === 'new'}
            onChange={() => setDecision(d => d ? { ...d, circuitChoice: 'new' } : d)}
          />
        )}
        <span>Nouvelle équipe de circuit — repart à zéro</span>
      </label>
      {!choosing && (
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Le choix se fait au moment de la validation.
        </p>
      )}
    </div>
  );
}

// ── Sanctions ────────────────────────────────────────────────────────────────

const SANCTION_LABEL: Record<string, string> = { warn: 'Avertissement', exclusion: 'Exclusion', ban: 'Ban' };
const SANCTION_COLOR: Record<string, React.CSSProperties> = {
  warn: { color: '#ffb46b', borderColor: 'rgba(255,180,107,0.4)' },
  exclusion: { color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.4)' },
  ban: { color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.4)' },
};

interface StaffRowData { uid: string; name: string; slug: string | null; discord: string | null; roles: string[]; warn: string | null }

// Ordre de priorité d'affichage (dirigeant en haut, inscripteur externe en bas).
const STAFF_PRIORITY = ['Dirigeant', 'Co-fondateur', 'Responsable', "Manager d'équipe", "Coach d'équipe", 'Capitaine', 'Inscription'];

// Dédoublonne le staff par uid : une personne = une ligne, rôles cumulés joints
// par « · ». L'inscripteur fusionne dans sa ligne s'il est déjà staff, sinon en
// ligne « Inscription ». Catégories vides omises. Trié par priorité de rôle.
function buildStaffRows(reg: RegistrationRow): StaffRowData[] {
  const map = new Map<string, StaffRowData>();
  const add = (m: StaffMember | null, role: string) => {
    if (!m || !m.uid) return;
    const existing = map.get(m.uid);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      map.set(m.uid, { uid: m.uid, name: m.displayName, slug: m.slug, discord: m.discordUsername, roles: [role], warn: null });
    }
  };
  add(reg.staff.founder, 'Dirigeant');
  reg.staff.coFounders.forEach(m => add(m, 'Co-fondateur'));
  reg.staff.responsables.forEach(m => add(m, 'Responsable'));
  reg.staff.teamManagers.forEach(m => add(m, "Manager d'équipe"));
  reg.staff.teamCoaches.forEach(m => add(m, "Coach d'équipe"));
  add(reg.staff.captain, 'Capitaine');
  // Inscripteur (peut déjà être staff → fusion) + warn « hors Discord » le cas échéant.
  const inscWarn = reg.createdByOnDiscordGuild === false ? 'hors Discord' : null;
  if (reg.createdByUid) {
    const existing = map.get(reg.createdByUid);
    if (existing) {
      if (!existing.roles.includes('Inscription')) existing.roles.push('Inscription');
      if (inscWarn) existing.warn = inscWarn;
    } else {
      map.set(reg.createdByUid, {
        uid: reg.createdByUid, name: reg.createdByName, slug: reg.createdBySlug,
        discord: reg.createdByDiscordUsername, roles: ['Inscription'], warn: inscWarn,
      });
    }
  }
  const minPriority = (roles: string[]) => Math.min(...roles.map(r => {
    const idx = STAFF_PRIORITY.indexOf(r);
    return idx === -1 ? 99 : idx;
  }));
  return Array.from(map.values()).sort((a, b) => minPriority(a.roles) - minPriority(b.roles));
}

function NotesEditor({ regId, competitionId, initial, onSaved }: {
  regId: string; competitionId: string; initial: string; onSaved: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = value !== initial;
  async function save() {
    setSaving(true);
    try {
      await api(`/api/admin/competitions/${competitionId}/registrations`, {
        method: 'POST', body: { action: 'set_notes', registrationId: regId, notes: value },
      });
      toast.success('Notes enregistrées.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally { setSaving(false); }
  }
  return (
    <div>
      <p className="t-label mb-1.5">Notes admin (internes)</p>
      <textarea className="settings-input w-full" rows={2} maxLength={2000}
        value={value} onChange={e => setValue(e.target.value)}
        placeholder="Notes internes sur l'équipe — jamais visibles par elle." />
      {dirty && (
        <div className="mt-2">
          <button type="button" className="btn-springs btn-secondary bevel-sm text-sm" disabled={saving} onClick={save}>
            {saving ? 'Enregistrement…' : 'Enregistrer les notes'}
          </button>
        </div>
      )}
    </div>
  );
}

function SanctionForm({ target, competitionId, competitionName, contextStructureId, contextTeamId, onClose, onDone }: {
  target: { targetType: 'user' | 'structure' | 'team'; targetId: string; targetLabel: string };
  competitionId: string;
  competitionName: string;
  contextStructureId: string;
  contextTeamId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  // Exclusion = Lot 3 (nécessite la plomberie de retrait) : ici warn + ban.
  const [type, setType] = useState<'warn' | 'ban'>('warn');
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const kind = target.targetType === 'user' ? 'le joueur' : target.targetType === 'team' ? 'l’équipe' : 'la structure';

  const chip = (active: boolean): React.CSSProperties => ({
    cursor: 'pointer',
    background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
    color: active ? 'var(--s-text)' : 'var(--s-text-muted)',
    borderColor: active ? 'rgba(255,255,255,0.35)' : 'var(--s-border)',
  });

  async function submit() {
    if (reason.trim().length < 3) { toast.error('Le motif est obligatoire.'); return; }
    setSaving(true);
    try {
      await api('/api/admin/competition-sanctions', {
        method: 'POST',
        body: {
          type, targetType: target.targetType, targetId: target.targetId,
          reasonCode: reasonCode || undefined, reason: reason.trim(),
          expiresAt: type === 'ban' && expiresAt ? expiresAt : undefined,
          competitionId, competitionName,
          contextStructureId, contextTeamId,
        },
      });
      toast.success(type === 'warn' ? 'Avertissement envoyé (notification + DM).' : 'Ban enregistré.');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3" style={{ border: '1px solid rgba(255,180,107,0.35)', padding: '12px' }}>
      <p className="text-sm font-semibold">Sanctionner {kind} — {target.targetLabel}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {(['warn', 'ban'] as const).map(t => (
          <button key={t} type="button" className="tag" style={chip(type === t)} onClick={() => setType(t)}>
            {SANCTION_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {SANCTION_REASON_CODES.map(rc => (
          <button key={rc.code} type="button" className="tag" style={chip(reasonCode === rc.code)}
            onClick={() => setReasonCode(reasonCode === rc.code ? '' : rc.code)}>
            {rc.label}
          </button>
        ))}
      </div>
      <textarea className="settings-input w-full" rows={2} maxLength={500}
        value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Motif — transmis à l'équipe (notification in-app + DM Discord)." />
      {type === 'ban' && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span style={{ color: 'var(--s-text-dim)' }}>Expiration (vide = permanent)</span>
          <input type="date" className="settings-input" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="button" className="btn-springs btn-primary bevel-sm text-sm"
          disabled={saving || reason.trim().length < 3} onClick={submit}>
          {saving ? 'Envoi…' : type === 'warn' ? 'Envoyer l’avertissement' : 'Bannir'}
        </button>
        <button type="button" className="btn-springs btn-ghost text-sm" disabled={saving} onClick={onClose}>
          Annuler
        </button>
      </div>
    </div>
  );
}
