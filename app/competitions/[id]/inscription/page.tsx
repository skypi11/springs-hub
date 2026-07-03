'use client';

// Wizard d'inscription d'une équipe (spec Legends §4, archi §7).
// 4 étapes : équipe → roster + MMR → règlement → récap. Les drapeaux MMR se
// calculent en direct avec la même lib que le serveur (lib/competitions/mmr) —
// le dirigeant voit AVANT de soumettre ce que les admins verront à la
// validation. Rien n'est refusé automatiquement sauf le registre des bans.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { ChevronLeft, ChevronRight, ShieldCheck, ShieldAlert, ArrowRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import GameTag from '@/components/games/GameTag';
import { Skeleton } from '@/components/ui/Skeleton';
import { computeRefMmr, computeMmrFlags, analyzeLineups } from '@/lib/competitions/mmr';
import type { CompetitionEligibility } from '@/types/competitions';

interface WizardContext {
  competition: {
    id: string;
    name: string;
    game: string;
    status: string;
    roster: { starters: number; subsMax: number };
    eligibility: CompetitionEligibility | null;
    registration: { opensAt: string | null; closesAt: string | null };
    windowState: 'before' | 'open' | 'closed' | 'unavailable';
  };
  structures: Array<{
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
    teams: Array<{ id: string; name: string; playerIds: string[]; subIds: string[] }>;
    members: Record<string, { displayName: string; verified: boolean; avatarUrl: string }>;
  }>;
  existingRegistrations: Array<{ teamId: string; status: string; name: string }>;
  rulebook: { version: number; markdown: string } | null;
  isCompetitionAdmin: boolean;
  /** Droit de dérouler le wizard sur une compétition en brouillon : admins
   *  compét ET comptes du bac à sable (calculé serveur). */
  canTestDraft: boolean;
}

type Assignment = Record<string, 'titulaire' | 'remplacant'>;
type MmrInput = Record<string, { current: string; peak: string }>;

const REG_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente de validation',
  approved: 'Validée',
  waitlisted: "Liste d'attente",
};

export default function InscriptionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { firebaseUser, loading: authLoading } = useAuth();
  const toast = useToast();

  const [ctx, setCtx] = useState<WizardContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [step, setStep] = useState(1);
  const [structureId, setStructureId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [assignment, setAssignment] = useState<Assignment>({});
  const [mmr, setMmr] = useState<MmrInput>({});
  const [rulebookAccepted, setRulebookAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string[] | null>(null); // flags renvoyés

  useEffect(() => {
    if (authLoading) return;
    if (!firebaseUser) { router.replace(`/competitions/${params.id}`); return; }
    let cancelled = false;
    api<WizardContext>(`/api/competitions/${params.id}/register`)
      .then(res => {
        if (cancelled) return;
        setCtx(res);
        // Présélection : cas ultra-courant d'une seule structure / équipe
        if (res.structures.length === 1) {
          setStructureId(res.structures[0].id);
          setDisplayName(res.structures[0].name);
          if (res.structures[0].teams.length === 1) setTeamId(res.structures[0].teams[0].id);
        }
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement unique post-auth
  }, [authLoading, firebaseUser, params.id]);

  const structure = ctx?.structures.find(s => s.id === structureId) ?? null;
  const team = structure?.teams.find(t => t.id === teamId) ?? null;
  const comp = ctx?.competition ?? null;
  const mmrRules = comp?.eligibility?.mmr ?? null;
  const starters = comp?.roster.starters ?? 3;
  const subsMax = comp?.roster.subsMax ?? 2;

  const titulaires = useMemo(() => Object.keys(assignment).filter(u => assignment[u] === 'titulaire'), [assignment]);
  const remplacants = useMemo(() => Object.keys(assignment).filter(u => assignment[u] === 'remplacant'), [assignment]);
  const selectedUids = useMemo(() => [...titulaires, ...remplacants], [titulaires, remplacants]);

  // Drapeaux MMR en direct — même calcul que le serveur
  const liveMmr = useMemo(() => {
    if (!mmrRules) return null;
    const refs: Array<{ uid: string; ref: number | null }> = selectedUids.map(u => {
      const cur = parseInt(mmr[u]?.current ?? '', 10);
      const peak = parseInt(mmr[u]?.peak ?? '', 10);
      if (isNaN(cur) || isNaN(peak)) return { uid: u, ref: null };
      return { uid: u, ref: computeRefMmr(cur, peak, mmrRules.weightCurrent) };
    });
    const complete = refs.every(r => r.ref !== null) && refs.length > 0;
    const values = refs.map(r => r.ref ?? 0);
    return {
      refs,
      complete,
      flags: complete ? computeMmrFlags(values, mmrRules, starters) : [],
      analysis: complete ? analyzeLineups(values, starters) : null,
    };
  }, [mmrRules, selectedUids, mmr, starters]);

  // Rôle choisi explicitement (boutons Titulaire / Remplaçant) — re-cliquer le
  // rôle actif retire le joueur du roster.
  function setRole(uid: string, role: 'titulaire' | 'remplacant') {
    setAssignment(prev => {
      const next = { ...prev };
      if (next[uid] === role) {
        delete next[uid];
        return next;
      }
      const count = Object.entries(next).filter(([u, v]) => u !== uid && v === role).length;
      const cap = role === 'titulaire' ? starters : subsMax;
      if (count >= cap) {
        toast.error(role === 'titulaire'
          ? `Déjà ${starters} titulaires — retire un joueur d'abord.`
          : `Déjà ${subsMax} remplaçants — retire un joueur d'abord.`);
        return prev;
      }
      next[uid] = role;
      return next;
    });
  }

  function stepError(s: number): string | null {
    if (s === 1) {
      if (!structureId) return 'Choisis une structure.';
      if (!teamId) return 'Choisis une équipe.';
      if (!displayName.trim()) return "Le nom d'équipe est obligatoire.";
      return null;
    }
    if (s === 2) {
      if (titulaires.length !== starters) return `Il faut exactement ${starters} titulaires (${titulaires.length} sélectionnés).`;
      // Gate compét (spec §3) : le serveur refuse aussi — défense en profondeur.
      if (comp?.eligibility?.requireVerifiedAccounts) {
        const unverified = selectedUids.find(u => structure?.members[u] && !structure.members[u].verified);
        if (unverified) {
          return `${structure?.members[unverified]?.displayName ?? 'Un joueur'} doit vérifier son compte (Epic ou Steam) avant de pouvoir être aligné.`;
        }
      }
      if (mmrRules) {
        for (const u of selectedUids) {
          const cur = parseInt(mmr[u]?.current ?? '', 10);
          const peak = parseInt(mmr[u]?.peak ?? '', 10);
          if (isNaN(cur) || isNaN(peak)) return 'Renseigne le MMR actuel et le peak de chaque joueur.';
          if (cur < 0 || cur > 5000 || peak < 0 || peak > 5000) return 'MMR hors bornes (0-5000).';
          if (peak < cur) return `Le peak de ${structure?.members[u]?.displayName ?? u} est inférieur à son MMR actuel.`;
        }
      }
      return null;
    }
    if (s === 3 && ctx?.rulebook && !rulebookAccepted) {
      return 'L\'acceptation du règlement est obligatoire pour t\'inscrire.';
    }
    return null;
  }

  function goNext() {
    const err = stepError(step);
    if (err) { toast.error(err); return; }
    // Pas de règlement publié → l'étape 3 saute
    const next = step === 2 && !ctx?.rulebook ? 4 : step + 1;
    setStep(next);
  }
  function goBack() {
    const prev = step === 4 && !ctx?.rulebook ? 2 : step - 1;
    setStep(Math.max(1, prev));
  }

  async function submit() {
    for (const s of [1, 2, 3]) {
      const err = stepError(s);
      if (err) { toast.error(err); return; }
    }
    setSubmitting(true);
    try {
      const res = await api<{ flags: string[] }>(`/api/competitions/${params.id}/register`, {
        method: 'POST',
        body: {
          structureId,
          teamId,
          name: displayName.trim(),
          roster: selectedUids.map(u => ({
            uid: u,
            role: assignment[u],
            declaredCurrentMmr: mmrRules ? parseInt(mmr[u]?.current ?? '0', 10) : 0,
            declaredPeakMmr: mmrRules ? parseInt(mmr[u]?.peak ?? '0', 10) : 0,
          })),
          rulebookAccepted: ctx?.rulebook ? rulebookAccepted : undefined,
          rulebookVersion: ctx?.rulebook?.version,
        },
      });
      setSubmitted(res.flags ?? []);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Rendus d'état ──────────────────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError || !ctx || !comp) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto">
        <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>{loadError || 'Compétition introuvable.'}</p>
      </div>
    );
  }

  if (submitted !== null) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto space-y-4 animate-fade-in">
        <div className="panel bevel">
          <div className="panel-body space-y-3">
            <h1 className="font-display text-2xl" style={{ letterSpacing: '0.03em' }}>INSCRIPTION ENVOYÉE</h1>
            <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
              {displayName} est en file de validation. Les admins de compétition vérifient
              les trackers et le roster — tu seras notifié de la décision.
            </p>
            {submitted.length > 0 && (
              <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Points que la validation regardera de près : {submitted.map(flagLabel).join(' · ')}.
              </p>
            )}
            <Link href={`/competitions/${comp.id}`} className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-1.5">
              Retour à la compétition <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const registrationBlocked = comp.windowState !== 'open' && !(ctx.canTestDraft && comp.status === 'draft');
  if (registrationBlocked) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto">
        <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
          {comp.windowState === 'before' && 'Les inscriptions ne sont pas encore ouvertes.'}
          {comp.windowState === 'closed' && 'Les inscriptions sont fermées.'}
          {comp.windowState === 'unavailable' && 'Cette compétition ne prend pas d\'inscriptions.'}
        </p>
      </div>
    );
  }

  if (ctx.structures.length === 0) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto space-y-3">
        <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
          L&apos;inscription se fait par un dirigeant ou responsable d&apos;une structure
          avec une équipe {comp.game === 'rocket_league' ? 'Rocket League' : ''} sur Aedral.
        </p>
        <Link href="/community/structures" className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-1.5">
          Voir les structures <ArrowRight size={14} />
        </Link>
      </div>
    );
  }

  const existingForTeam = ctx.existingRegistrations.find(r => r.teamId === teamId);

  return (
    <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <GameTag gameId={comp.game} size="sm" />
          <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>{comp.name}</span>
        </div>
        <h1 className="font-display text-2xl" style={{ letterSpacing: '0.03em' }}>
          INSCRIPTION — ÉTAPE {step === 4 && !ctx.rulebook ? 3 : step}/{ctx.rulebook ? 4 : 3}
        </h1>
      </div>

      {/* Étape 1 — équipe */}
      {step === 1 && (
        <div className="panel bevel">
          <div className="panel-body space-y-4">
            {ctx.structures.length > 1 && (
              <div>
                <label className="t-label block mb-2">Structure</label>
                <select className="settings-input w-full" value={structureId}
                  onChange={e => {
                    setStructureId(e.target.value);
                    setTeamId('');
                    setAssignment({});
                    const s = ctx.structures.find(x => x.id === e.target.value);
                    setDisplayName(s?.name ?? '');
                  }}>
                  <option value="">Choisir…</option>
                  {ctx.structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {structure && (
              <div>
                <label className="t-label block mb-2">Équipe</label>
                {structure.teams.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    Aucune équipe pour ce jeu. Crée-la d&apos;abord dans ta structure.
                  </p>
                ) : (
                  <select className="settings-input w-full" value={teamId}
                    onChange={e => { setTeamId(e.target.value); setAssignment({}); }}>
                    <option value="">Choisir…</option>
                    {structure.teams.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.playerIds.length + t.subIds.length} joueurs)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {existingForTeam && (
              <p className="text-sm" style={{ color: 'var(--s-gold)' }}>
                Cette équipe a déjà une inscription : {REG_STATUS_LABELS[existingForTeam.status] ?? existingForTeam.status}.
              </p>
            )}
            <div>
              <label className="t-label block mb-2">Nom d&apos;équipe affiché</label>
              <input className="settings-input w-full" value={displayName} maxLength={50}
                onChange={e => setDisplayName(e.target.value)} />
              <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                Il identifie l&apos;équipe sur tout le circuit : le changer entre deux
                participations demande l&apos;accord des admins, les points de circuit
                suivent ce nom.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Étape 2 — roster + MMR */}
      {step === 2 && team && structure && (
        <div className="panel bevel">
          <div className="panel-header">
            <span className="t-sub">
              Roster — {titulaires.length}/{starters} titulaires · {remplacants.length}/{subsMax} remplaçants
            </span>
          </div>
          <div className="panel-body space-y-4">
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Choisis le rôle de chaque joueur aligné. Le roster est verrouillé une
              fois l&apos;inscription soumise.
            </p>
            <div style={{ border: '1px solid var(--s-border)' }}>
              {[...team.playerIds, ...team.subIds].map((uid, i) => {
                const m = structure.members[uid];
                if (!m) return null;
                const role = assignment[uid];
                const blocked = !!comp?.eligibility?.requireVerifiedAccounts && !m.verified;
                const ref = liveMmr?.refs.find(x => x.uid === uid)?.ref ?? null;
                return (
                  <div key={uid} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                    style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none', opacity: blocked ? 0.75 : 1 }}>
                    <span className="flex items-center gap-1.5" role="group" aria-label={`Rôle de ${m.displayName}`}>
                      {(['titulaire', 'remplacant'] as const).map(r => (
                        <button key={r} type="button"
                          onClick={() => setRole(uid, r)}
                          disabled={blocked}
                          aria-pressed={role === r}
                          className="tag"
                          style={{
                            cursor: blocked ? 'not-allowed' : 'pointer',
                            minWidth: '92px', textAlign: 'center',
                            background: role === r
                              ? (r === 'titulaire' ? 'rgba(0,129,255,0.15)' : 'rgba(255,255,255,0.12)')
                              : 'transparent',
                            borderColor: role === r
                              ? (r === 'titulaire' ? 'rgba(0,129,255,0.5)' : 'rgba(255,255,255,0.35)')
                              : 'var(--s-border)',
                            color: role === r
                              ? (r === 'titulaire' ? '#4fb3ff' : 'var(--s-text)')
                              : 'var(--s-text-muted)',
                          }}>
                          {r === 'titulaire' ? 'Titulaire' : 'Remplaçant'}
                        </button>
                      ))}
                    </span>
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm font-semibold truncate">{m.displayName}</span>
                      {m.verified ? (
                        <ShieldCheck size={14} style={{ color: '#33ff66', flexShrink: 0 }} aria-label="Compte vérifié" />
                      ) : (
                        <ShieldAlert size={14} style={{ color: 'var(--s-gold)', flexShrink: 0 }} aria-label="Compte non vérifié" />
                      )}
                    </span>
                    {blocked ? (
                      <span className="text-sm" style={{ color: 'var(--s-gold)' }}>
                        Compte non vérifié — requis pour être aligné
                      </span>
                    ) : mmrRules && role ? (
                      <span className="flex items-center gap-2">
                        <input type="number" min={0} max={5000} placeholder="MMR 2v2"
                          className="settings-input w-24"
                          aria-label={`MMR actuel de ${m.displayName}`}
                          value={mmr[uid]?.current ?? ''}
                          onChange={e => setMmr(prev => ({ ...prev, [uid]: { current: e.target.value, peak: prev[uid]?.peak ?? '' } }))} />
                        <input type="number" min={0} max={5000} placeholder="Peak"
                          className="settings-input w-24"
                          aria-label={`Peak MMR de ${m.displayName}`}
                          value={mmr[uid]?.peak ?? ''}
                          onChange={e => setMmr(prev => ({ ...prev, [uid]: { current: prev[uid]?.current ?? '', peak: e.target.value } }))} />
                        {/* Colonne à largeur fixe : le calcul apparaît sans décaler les champs */}
                        <span className="t-mono text-xs text-right" style={{
                          width: '58px', flexShrink: 0,
                          color: ref != null && mmrRules && ref > mmrRules.maxPlayer ? '#ff8a8a' : 'var(--s-text-muted)',
                        }}>
                          {ref != null ? `réf ${ref}` : ''}
                        </span>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {mmrRules && (
              <div className="text-sm space-y-1" style={{ color: 'var(--s-text-dim)' }}>
                <p>
                  Référence = {Math.round(mmrRules.weightCurrent * 100)} % du MMR actuel +{' '}
                  {Math.round((1 - mmrRules.weightCurrent) * 100)} % du peak. Les admins vérifient
                  sur les trackers : déclare juste.
                </p>
                {liveMmr?.complete && liveMmr.analysis && (
                  <p style={{ color: liveMmr.flags.length ? 'var(--s-gold)' : 'var(--s-text-dim)' }}>
                    Compositions possibles : moyenne la plus haute {liveMmr.analysis.worstLineupAvg} (limite {mmrRules.maxAvg}) ·
                    écart le plus grand {liveMmr.analysis.worstLineupGap} (limite {mmrRules.maxGap}).
                    {liveMmr.flags.length > 0
                      ? ' L\'inscription partira avec un signalement, examiné par les admins à la validation.'
                      : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Étape 3 — règlement */}
      {step === 3 && ctx.rulebook && (
        <div className="panel bevel">
          <div className="panel-header flex items-center justify-between">
            <Link href={`/competitions/${comp.id}/reglement`} target="_blank"
              className="t-sub hover:underline" style={{ color: 'var(--s-text)' }}>
              Règlement — version {ctx.rulebook.version}
            </Link>
            <Link href={`/competitions/${comp.id}/reglement`} target="_blank" className="text-sm underline"
              style={{ color: 'var(--s-text-dim)' }}>
              Ouvrir dans un onglet
            </Link>
          </div>
          <div className="panel-body space-y-4">
            <div className="prose-springs text-sm max-w-none overflow-y-auto px-1"
              style={{ maxHeight: '420px', border: '1px solid var(--s-border)', padding: '16px' }}>
              <ReactMarkdown>{ctx.rulebook.markdown}</ReactMarkdown>
            </div>
            <label className="flex items-start gap-2 text-sm" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={rulebookAccepted}
                onChange={e => setRulebookAccepted(e.target.checked)}
                style={{ marginTop: '2px' }} />
              <span>
                J&apos;ai lu et j&apos;accepte le règlement (version {ctx.rulebook.version}) au nom de l&apos;équipe.
                L&apos;acceptation est enregistrée avec l&apos;inscription.
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Étape 4 — récap */}
      {step === 4 && team && structure && (
        <div className="panel bevel">
          <div className="panel-header"><span className="t-sub">Récap avant envoi</span></div>
          <div className="panel-body space-y-4">
            <div className="text-sm space-y-1">
              <p><span style={{ color: 'var(--s-text-muted)' }}>Équipe :</span> <span className="font-semibold">{displayName}</span> {structure.tag ? `[${structure.tag}]` : ''}</p>
              <p><span style={{ color: 'var(--s-text-muted)' }}>Structure :</span> {structure.name} · {team.name}</p>
            </div>
            <div style={{ border: '1px solid var(--s-border)' }}>
              {selectedUids.map((uid, i) => {
                const m = structure.members[uid];
                const ref = liveMmr?.refs.find(x => x.uid === uid)?.ref;
                return (
                  <div key={uid} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                    style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
                    <span className="tag tag-neutral" style={{ minWidth: '86px', textAlign: 'center' }}>
                      {assignment[uid] === 'titulaire' ? 'Titulaire' : 'Remplaçant'}
                    </span>
                    <span className="font-semibold flex-1 min-w-0 truncate">{m?.displayName ?? uid}</span>
                    {mmrRules && ref != null && <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>réf {ref}</span>}
                    {!m?.verified && (
                      <span className="text-xs" style={{ color: 'var(--s-gold)' }}>compte non vérifié</span>
                    )}
                  </div>
                );
              })}
            </div>
            {liveMmr && liveMmr.flags.length > 0 && (
              <p className="text-sm" style={{ color: 'var(--s-gold)' }}>
                L&apos;inscription partira avec des points à vérifier : {liveMmr.flags.map(flagLabel).join(' · ')}.
                Les admins trancheront à la validation.
              </p>
            )}
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Le roster est figé à l&apos;envoi : les changements d&apos;équipe sur Aedral
              n&apos;affectent plus cette inscription.
            </p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        {step > 1 ? (
          <button type="button" className="btn-springs btn-ghost flex items-center gap-1.5" onClick={goBack} disabled={submitting}>
            <ChevronLeft size={15} /> Retour
          </button>
        ) : <span />}
        {step < 4 ? (
          <button type="button" className="btn-springs btn-secondary bevel-sm flex items-center gap-1.5" onClick={goNext}>
            Continuer <ChevronRight size={15} />
          </button>
        ) : (
          <button type="button" className="btn-springs btn-primary bevel-sm" onClick={submit} disabled={submitting}>
            {submitting ? 'Envoi…' : "Envoyer l'inscription"}
          </button>
        )}
      </div>
    </div>
  );
}

function flagLabel(flag: string): string {
  const labels: Record<string, string> = {
    mmr_avg_exceeded: 'moyenne MMR au-dessus du cap',
    mmr_gap_exceeded: 'écart MMR au-dessus du cap',
    mmr_player_cap_exceeded: 'joueur au-dessus du plafond MMR',
    underage: 'joueur mineur ou âge inconnu (dérogation)',
    unverified_account: 'compte non vérifié dans le roster',
    discord_guild_missing: 'joueur absent du serveur Discord de la compétition',
  };
  return labels[flag] ?? flag;
}
