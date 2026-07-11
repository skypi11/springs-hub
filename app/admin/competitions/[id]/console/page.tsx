'use client';

// Console live admin — jour de match (archi §7). Pilotage complet : check-in
// général, lancement de phase PARTIEL (R5-2), rooms, forfaits, force-score,
// litiges, cast, disqualification, repêchage waitlist. Polling 10 s + tick
// 30 s (idempotent — les pages de match des participants le complètent).
// L'identité des admins ne sort jamais d'ici : tout est journalisé côté
// serveur (admin_audit_logs), les docs publics ne portent que 'admin'.

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import TeamCrest from '@/components/competitions/TeamCrest';
import { ChevronLeft, Copy, Play, Radio, RotateCcw, ShieldAlert, UserX } from 'lucide-react';

interface Game { a: number; b: number }
type Side = { name: string; tag: string; logoUrl: string | null } | null;

interface ConsoleMatch {
  id: string;
  bracket: string;
  round: number;
  slot: number;
  phase: number | null;
  bo: number;
  status: string;
  teamA: string | null;
  teamB: string | null;
  voidA: boolean;
  voidB: boolean;
  teamAInfo: Side;
  teamBInfo: Side;
  roomHost: 'a' | 'b';
  checkin: { deadline: string | null; a: { done: boolean }; b: { done: boolean } } | null;
  scores: { a: Game[]; b: Game[]; counterDeadline: string | null; final: Game[] | null; validatedBy: string | null };
  dispute: { openedBy: string; auto: boolean; resolvedBy: string | null } | null;
  forfeit: { team: 'a' | 'b' | 'both'; reason: string | null } | null;
  cast: { featured: boolean; streamUrl: string | null } | null;
  winner: 'a' | 'b' | null;
}

interface ConsoleRegistration {
  registrationId: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  status: 'approved' | 'waitlisted' | 'withdrawn';
  seed: number | null;
  generalCheckin: { done: boolean; at: string | null } | null;
}

interface ConsoleData {
  competition: {
    id: string; name: string; status: string;
    phasePlan: Array<{ phase: number; day: number; label: string }>;
    checkinMinutes: number;
    generalCheckinMinutes: number;
    withdrawn: string[];
  };
  matches: ConsoleMatch[];
  rooms: Record<string, { name: string; password: string }>;
  registrations: ConsoleRegistration[];
  finished: boolean;
  needsAdminDecision: boolean;
}

const STATUS_FR: Record<string, string> = {
  pending: 'À venir',
  checkin: 'Check-in',
  ready: 'Prêt',
  live: 'En cours',
  awaiting_scores: 'Attente scores',
  score_review: 'Contre-saisie',
  disputed: 'Litige',
  awaiting_forfeit_validation: 'Décision requise',
  completed: 'Terminé',
  walkover: "Qualifié d'office",
  cancelled: 'Non joué',
};

// Statut → couleur du point (signal visuel unique de la rangée).
const STATUS_DOT: Record<string, string> = {
  checkin: 'var(--s-gold)',
  live: 'var(--s-blue)',
  awaiting_scores: 'var(--s-blue)',
  score_review: 'var(--s-gold)',
  disputed: 'var(--s-gold)',
  awaiting_forfeit_validation: 'var(--s-gold)',
  completed: 'var(--s-green)',
  walkover: 'var(--s-text-muted)',
  cancelled: 'var(--s-text-muted)',
};

export default function CompetitionConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { firebaseUser, isAdmin, isCompetitionAdmin } = useAuth();
  const authorized = isAdmin || isCompetitionAdmin;
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<ConsoleData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [forceScoreFor, setForceScoreFor] = useState<ConsoleMatch | null>(null);
  const [forfeitFor, setForfeitFor] = useState<ConsoleMatch | null>(null);
  const [castFor, setCastFor] = useState<ConsoleMatch | null>(null);
  const [replaceFor, setReplaceFor] = useState<ConsoleRegistration | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<ConsoleData>(`/api/admin/competitions/${id}/console`);
      setData(d);
    } catch {
      // Blip réseau : on garde le dernier état affiché.
    }
  }, [id]);

  useEffect(() => {
    if (!firebaseUser || !authorized) return;
    load();
    const poll = setInterval(load, 10_000);
    const tick = setInterval(() => {
      api(`/api/competitions/${id}/tick`, { method: 'POST' }).catch(() => null);
    }, 30_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [firebaseUser, authorized, id, load]);

  async function action(body: Record<string, unknown>, okMsg: string, key?: string) {
    setBusy(key ?? String(body.action));
    try {
      await api(`/api/admin/competitions/${id}/console`, { method: 'POST', body });
      toast.success(okMsg);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Action impossible.');
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  }

  const phases = useMemo(() => {
    if (!data) return [];
    const byPhase = new Map<number | null, ConsoleMatch[]>();
    for (const m of data.matches) {
      const k = m.phase;
      if (!byPhase.has(k)) byPhase.set(k, []);
      byPhase.get(k)!.push(m);
    }
    const planned = (data.competition.phasePlan ?? [])
      .map(p => ({ phase: p.phase as number | null, label: p.label, matches: (byPhase.get(p.phase) ?? []).sort(matchOrder) }))
      .filter(p => p.matches.length > 0);
    const rest = byPhase.get(null);
    if (rest && rest.length > 0) planned.push({ phase: null, label: 'Hors plan', matches: rest.sort(matchOrder) });
    return planned;
  }, [data]);

  if (!firebaseUser || !authorized) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Console réservée aux admins de compétition.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Chargement de la console…</p>
      </div>
    );
  }

  const approved = data.registrations.filter(r => r.status === 'approved');
  const waitlisted = data.registrations.filter(r => r.status === 'waitlisted');
  const generalOpened = approved.some(r => r.generalCheckin !== null);
  const missingGeneral = approved.filter(r => r.generalCheckin && !r.generalCheckin.done);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link href="/admin/competitions" className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            <ChevronLeft size={15} /> Compétitions
          </Link>
          <h1 className="font-display text-3xl" style={{ letterSpacing: '0.03em' }}>
            CONSOLE — {data.competition.name.toUpperCase()}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="tag tag-neutral">{data.competition.status}</span>
          <button className="btn-springs btn-secondary bevel-sm text-sm" disabled={busy !== null}
            onClick={async () => {
              setBusy('tick');
              try {
                const r = await api<{ processed: Array<{ matchId: string; transition: string }> }>(`/api/competitions/${id}/tick`, { method: 'POST' });
                toast.info(r.processed.length > 0 ? `Tick : ${r.processed.length} transition(s).` : 'Tick : rien à appliquer.');
                await load();
              } catch { toast.error('Tick impossible.'); } finally { setBusy(null); }
            }}>
            Tick
          </button>
        </div>
      </div>

      {data.needsAdminDecision && (
        <div className="panel bevel">
          <div className="panel-body flex items-center gap-3 text-sm">
            <ShieldAlert size={16} style={{ color: 'var(--s-gold)' }} />
            <span style={{ color: 'var(--s-text)' }}>
              Fin de bracket sans vainqueur mécanique — le titre doit être tranché par un admin.
            </span>
          </div>
        </div>
      )}
      {data.finished && (
        <div className="panel bevel">
          <div className="panel-body text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Bracket intégralement résolu. Clôture et points de circuit : à venir (Lot 4).
          </div>
        </div>
      )}

      {/* Check-in général */}
      <div className="panel bevel">
        <div className="panel-header flex items-center justify-between">
          <span className="t-sub">Check-in général</span>
          {!generalOpened ? (
            <button className="btn-springs btn-primary bevel-sm text-sm" disabled={busy !== null}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Ouvrir le check-in général',
                  message: `Les capitaines des ${approved.length} équipes validées auront ${data.competition.generalCheckinMinutes} minutes pour confirmer. Notification in-app + salons Discord.`,
                  confirmLabel: 'Ouvrir',
                });
                if (ok) action({ action: 'open_general_checkin' }, 'Check-in général ouvert.');
              }}>
              Ouvrir
            </button>
          ) : (
            <span className="text-sm" style={{ color: missingGeneral.length > 0 ? 'var(--s-gold)' : 'var(--s-text-dim)' }}>
              {missingGeneral.length > 0 ? `${missingGeneral.length} équipe(s) manquante(s)` : 'Toutes les équipes ont confirmé'}
            </span>
          )}
        </div>
        {generalOpened && (
          <div className="panel-body">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-1 text-sm">
              {approved.map(r => (
                <div key={r.registrationId} className="flex items-center justify-between gap-2 py-1"
                  style={{ borderBottom: '1px solid var(--s-border)' }}>
                  <span className="truncate" style={{ color: 'var(--s-text)' }}>{r.name}</span>
                  <span className="flex-shrink-0 font-semibold" style={{
                    color: r.generalCheckin?.done ? 'var(--s-green)' : 'var(--s-gold)',
                  }}>
                    {r.generalCheckin?.done ? 'OK' : 'Manquante'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Phases */}
      {phases.map(p => {
        const launchable = p.matches.filter(m => m.status === 'pending' && m.teamA && m.teamB && !m.voidA && !m.voidB);
        return (
          <div key={String(p.phase)} className="panel bevel">
            <div className="panel-header flex items-center justify-between">
              <span className="t-sub">{p.label}</span>
              {launchable.length > 0 && (
                <button className="btn-springs btn-primary bevel-sm text-sm inline-flex items-center gap-1.5"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Lancer ${launchable.length} match(s)`,
                      message: `Check-in de ${data.competition.checkinMinutes} min ouvert, rooms générées, équipes notifiées (in-app + Discord). Les matchs non prêts de la phase ne sont pas touchés.`,
                      confirmLabel: 'Lancer',
                    });
                    if (ok) action({ action: 'launch_phase', matchIds: launchable.map(m => m.id) }, 'Phase lancée.');
                  }}>
                  <Play size={13} /> Lancer ({launchable.length})
                </button>
              )}
            </div>
            <div className="panel-body space-y-0">
              {p.matches.map(m => (
                <MatchRow key={m.id} m={m} room={data.rooms[m.id] ?? null} busy={busy !== null}
                  competitionId={id}
                  onLaunch={() => action({ action: 'launch_phase', matchIds: [m.id] }, `${m.id} lancé.`)}
                  onReopen={() => action({ action: 'reopen_checkin', matchId: m.id }, 'Check-in relancé.')}
                  onForfeit={() => setForfeitFor(m)}
                  onForceScore={() => setForceScoreFor(m)}
                  onCast={() => setCastFor(m)}
                  onCopy={label => toast.info(`${label} copié.`)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Équipes — waitlist, retraits */}
      <div className="panel bevel">
        <div className="panel-header"><span className="t-sub">Équipes</span></div>
        <div className="panel-body space-y-0">
          {data.registrations.map(r => (
            <div key={r.registrationId} className="flex items-center gap-3 py-2 text-sm"
              style={{ borderBottom: '1px solid var(--s-border)' }}>
              <TeamCrest url={r.logoUrl} tag={r.tag} name={r.name} size={26} />
              <span className="flex-1 min-w-0 truncate" style={{
                color: r.status === 'withdrawn' ? 'var(--s-text-muted)' : 'var(--s-text)',
                textDecoration: r.status === 'withdrawn' ? 'line-through' : 'none',
              }}>
                {r.name} <span style={{ color: 'var(--s-text-muted)' }}>[{r.tag}]{r.seed ? ` · seed ${r.seed}` : ''}</span>
              </span>
              <span className="t-label-soft flex-shrink-0">
                {r.status === 'approved' ? 'validée' : r.status === 'waitlisted' ? "liste d'attente" : 'retirée'}
              </span>
              {r.status === 'approved' && (
                <>
                  <button className="btn-springs btn-ghost text-sm inline-flex items-center gap-1" disabled={busy !== null}
                    onClick={() => setReplaceFor(r)}>
                    <RotateCcw size={12} /> Remplacer
                  </button>
                  <button className="btn-springs btn-ghost text-sm inline-flex items-center gap-1" disabled={busy !== null}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Retirer ${r.name}`,
                        message: 'Disqualification / abandon : les matchs restants passent en forfait conventionnel, le placement est figé (R5-4). Irréversible.',
                        confirmLabel: 'Retirer',
                        variant: 'danger',
                      });
                      if (ok) action({ action: 'withdraw_team', registrationId: r.registrationId, reason: 'Retrait décidé par un admin de compétition.' }, `${r.name} retirée.`);
                    }}>
                    <UserX size={12} /> Retirer
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {forceScoreFor && (
        <ForceScoreModal m={forceScoreFor} onClose={() => setForceScoreFor(null)}
          onSubmit={async (games, resolution) => {
            const ok = await action({ action: 'force_score', matchId: forceScoreFor.id, games, resolution }, 'Score imposé — bracket avancé.');
            if (ok) setForceScoreFor(null);
          }} />
      )}
      {forfeitFor && (
        <ForfeitModal m={forfeitFor} onClose={() => setForfeitFor(null)}
          onSubmit={async (team, reason) => {
            const ok = await action({ action: 'validate_forfeit', matchId: forfeitFor.id, team, reason }, 'Forfait validé — bracket avancé.');
            if (ok) setForfeitFor(null);
          }} />
      )}
      {castFor && (
        <CastModal m={castFor} onClose={() => setCastFor(null)}
          onSubmit={async (featured, streamUrl) => {
            const ok = await action({ action: 'set_cast', matchId: castFor.id, featured, streamUrl }, featured ? 'Match casté.' : 'Cast retiré.');
            if (ok) setCastFor(null);
          }} />
      )}
      {replaceFor && (
        <ReplaceModal team={replaceFor} waitlisted={waitlisted} onClose={() => setReplaceFor(null)}
          onSubmit={async newRegistrationId => {
            const ok = await action({ action: 'replace_team', oldRegistrationId: replaceFor.registrationId, newRegistrationId }, 'Remplacement effectué.');
            if (ok) setReplaceFor(null);
          }} />
      )}
    </div>
  );
}

function matchOrder(a: ConsoleMatch, b: ConsoleMatch): number {
  const rank: Record<string, number> = { winners: 0, losers: 1, grand_final: 2 };
  return (rank[a.bracket] ?? 3) - (rank[b.bracket] ?? 3) || a.round - b.round || a.slot - b.slot;
}

function sideName(s: Side, isVoid: boolean): string {
  if (isVoid) return 'BYE';
  return s ? s.name : 'À déterminer';
}

function MatchRow({ m, room, busy, onLaunch, onReopen, onForfeit, onForceScore, onCast, onCopy }: {
  m: ConsoleMatch;
  room: { name: string; password: string } | null;
  busy: boolean;
  competitionId: string;
  onLaunch: () => void;
  onReopen: () => void;
  onForfeit: () => void;
  onForceScore: () => void;
  onCast: () => void;
  onCopy: (label: string) => void;
}) {
  const terminal = ['completed', 'walkover', 'cancelled'].includes(m.status);
  const launchable = m.status === 'pending' && m.teamA && m.teamB && !m.voidA && !m.voidB;
  const disputeOpen = !!m.dispute && m.dispute.resolvedBy === null;
  const wins = (() => {
    const w = { a: 0, b: 0 };
    for (const g of m.scores.final ?? []) { if (g.a > g.b) w.a++; else if (g.b > g.a) w.b++; }
    return w;
  })();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
      style={{ borderBottom: '1px solid var(--s-border)' }}>
      <span className="t-mono flex-shrink-0" style={{ width: 46, fontSize: 12, color: 'var(--s-text-muted)' }}>{m.id}</span>
      <span className="flex-shrink-0 inline-block rounded-none" style={{
        width: 7, height: 7, background: STATUS_DOT[m.status] ?? 'var(--s-text-muted)',
      }} />
      <span className="flex-1 min-w-[220px] truncate" style={{ color: 'var(--s-text)' }}>
        <span style={{ fontWeight: m.winner === 'a' ? 700 : 400 }}>{sideName(m.teamAInfo, m.voidA)}</span>
        {m.scores.final ? (
          <span className="t-mono" style={{ color: 'var(--s-text-dim)' }}> {wins.a}–{wins.b} </span>
        ) : (
          <span style={{ color: 'var(--s-text-muted)' }}> vs </span>
        )}
        <span style={{ fontWeight: m.winner === 'b' ? 700 : 400 }}>{sideName(m.teamBInfo, m.voidB)}</span>
      </span>
      <span className="t-label-soft flex-shrink-0" style={{
        color: disputeOpen || m.status === 'awaiting_forfeit_validation' ? 'var(--s-gold)' : undefined,
      }}>
        {STATUS_FR[m.status] ?? m.status}{m.forfeit ? ` · forfait ${m.forfeit.team}` : ''}
      </span>
      {m.checkin && !terminal && (
        <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>
          CI {m.checkin.a.done ? '✓' : '·'}/{m.checkin.b.done ? '✓' : '·'}
        </span>
      )}
      {room && !terminal && (
        <button className="t-mono flex-shrink-0 inline-flex items-center gap-1" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}
          onClick={() => { navigator.clipboard?.writeText(`${room.name} / ${room.password}`).then(() => onCopy('Room')).catch(() => null); }}>
          {room.name} · {room.password} <Copy size={11} />
        </button>
      )}
      {m.cast?.featured && <Radio size={13} style={{ color: 'var(--s-gold)' }} />}

      <span className="flex items-center gap-1 flex-shrink-0 ml-auto">
        {launchable && (
          <button className="btn-springs btn-ghost text-sm" disabled={busy} onClick={onLaunch}>Lancer</button>
        )}
        {m.status === 'awaiting_forfeit_validation' && (
          <button className="btn-springs btn-ghost text-sm" disabled={busy} onClick={onReopen}>Relancer check-in</button>
        )}
        {!terminal && m.teamA && m.teamB && (
          <>
            <button className="btn-springs btn-ghost text-sm" disabled={busy} onClick={onForceScore}>Score</button>
            <button className="btn-springs btn-ghost text-sm" disabled={busy} onClick={onForfeit}>Forfait</button>
          </>
        )}
        {!terminal && <button className="btn-springs btn-ghost text-sm" disabled={busy} onClick={onCast}>Cast</button>}
      </span>
    </div>
  );
}

// ── Modals (locales, DA sobre) ───────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={onClose}>
      <div className="panel bevel w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="panel-header flex items-center justify-between">
          <span className="t-sub">{title}</span>
          <button onClick={onClose} className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Fermer</button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}

function ForceScoreModal({ m, onClose, onSubmit }: {
  m: ConsoleMatch; onClose: () => void; onSubmit: (games: Game[], resolution: string | null) => void;
}) {
  const needed = Math.ceil(m.bo / 2);
  const [games, setGames] = useState<Game[]>(Array.from({ length: needed }, () => ({ a: 0, b: 0 })));
  const [resolution, setResolution] = useState('');
  const wins = games.reduce((w, g) => {
    if (g.a > g.b) w.a++; else if (g.b > g.a) w.b++;
    return w;
  }, { a: 0, b: 0 });
  const valid = (wins.a === needed || wins.b === needed) && games.every(g => g.a !== g.b);

  return (
    <ModalShell title={`Imposer le score — ${m.id}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
          {sideName(m.teamAInfo, m.voidA)} vs {sideName(m.teamBInfo, m.voidB)} · BO{m.bo}.
          {m.dispute && m.dispute.resolvedBy === null ? ' Résout le litige en cours.' : ''}
        </p>
        {games.map((g, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="t-label-soft w-20">Manche {i + 1}</span>
            <input type="number" min={0} max={99} value={g.a} className="settings-input bevel-sm" style={{ width: 64, textAlign: 'center' }}
              onChange={e => setGames(gs => gs.map((x, j) => j === i ? { ...x, a: clamp(e.target.value) } : x))} />
            <span style={{ color: 'var(--s-text-muted)' }}>–</span>
            <input type="number" min={0} max={99} value={g.b} className="settings-input bevel-sm" style={{ width: 64, textAlign: 'center' }}
              onChange={e => setGames(gs => gs.map((x, j) => j === i ? { ...x, b: clamp(e.target.value) } : x))} />
            {games.length > needed && (
              <button className="text-sm" style={{ color: 'var(--s-text-muted)' }}
                onClick={() => setGames(gs => gs.filter((_, j) => j !== i))}>Retirer</button>
            )}
          </div>
        ))}
        {games.length < m.bo && (
          <button className="btn-springs btn-ghost text-sm" onClick={() => setGames(gs => [...gs, { a: 0, b: 0 }])}>
            Ajouter une manche
          </button>
        )}
        <textarea
          className="settings-input bevel-sm w-full" rows={2}
          placeholder="Résolution visible des équipes (ex. captures vérifiées : victoire NL)"
          value={resolution}
          onChange={e => setResolution(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button className="btn-springs btn-primary bevel-sm" disabled={!valid}
            onClick={() => onSubmit(games, resolution.trim() || null)}>
            Imposer le score
          </button>
          {!valid && <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Vainqueur net à {needed} manches requis.</span>}
        </div>
      </div>
    </ModalShell>
  );
}

function ForfeitModal({ m, onClose, onSubmit }: {
  m: ConsoleMatch; onClose: () => void; onSubmit: (team: 'a' | 'b' | 'both', reason: string | null) => void;
}) {
  const [team, setTeam] = useState<'a' | 'b' | 'both'>('a');
  const [reason, setReason] = useState('');
  return (
    <ModalShell title={`Valider un forfait — ${m.id}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={{ color: 'var(--s-text-dim)' }}>
          Score conventionnel {Math.ceil(m.bo / 2)}-0, compté dans le délta (spec §11).
          Le double forfait élimine les deux équipes (R5-1).
        </p>
        <div className="flex flex-col gap-2">
          {([['a', `Forfait de ${sideName(m.teamAInfo, m.voidA)}`], ['b', `Forfait de ${sideName(m.teamBInfo, m.voidB)}`], ['both', 'Double forfait (deux équipes absentes)']] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2" style={{ color: 'var(--s-text)' }}>
              <input type="radio" name="forfeit-team" checked={team === v} onChange={() => setTeam(v)} />
              {label}
            </label>
          ))}
        </div>
        <textarea className="settings-input bevel-sm w-full" rows={2}
          placeholder="Motif (visible des équipes)"
          value={reason} onChange={e => setReason(e.target.value)} />
        <button className="btn-springs btn-primary bevel-sm" onClick={() => onSubmit(team, reason.trim() || null)}>
          Valider le forfait
        </button>
      </div>
    </ModalShell>
  );
}

function CastModal({ m, onClose, onSubmit }: {
  m: ConsoleMatch; onClose: () => void; onSubmit: (featured: boolean, streamUrl: string | null) => void;
}) {
  const [streamUrl, setStreamUrl] = useState(m.cast?.streamUrl ?? '');
  return (
    <ModalShell title={`Cast — ${m.id}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={{ color: 'var(--s-text-dim)' }}>
          1 match casté par phase : le précédent match casté de la phase est automatiquement remplacé.
        </p>
        <input className="settings-input bevel-sm w-full" placeholder="https://twitch.tv/…"
          value={streamUrl} onChange={e => setStreamUrl(e.target.value)} />
        <div className="flex items-center gap-3">
          <button className="btn-springs btn-primary bevel-sm" onClick={() => onSubmit(true, streamUrl.trim() || null)}>
            Mettre en stream
          </button>
          {m.cast?.featured && (
            <button className="btn-springs btn-secondary bevel-sm" onClick={() => onSubmit(false, null)}>
              Retirer le cast
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function ReplaceModal({ team, waitlisted, onClose, onSubmit }: {
  team: ConsoleRegistration;
  waitlisted: ConsoleRegistration[];
  onClose: () => void;
  onSubmit: (newRegistrationId: string | null) => void;
}) {
  const [choice, setChoice] = useState<string | null>(waitlisted[0]?.registrationId ?? null);
  return (
    <ModalShell title={`Remplacer ${team.name}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={{ color: 'var(--s-text-dim)' }}>
          Possible uniquement avant le premier match joué (spec §8). Sans équipe en liste d&apos;attente, le siège devient un bye.
        </p>
        {waitlisted.length > 0 ? (
          <div className="flex flex-col gap-2">
            {waitlisted.map(w => (
              <label key={w.registrationId} className="flex items-center gap-2" style={{ color: 'var(--s-text)' }}>
                <input type="radio" name="replace-with" checked={choice === w.registrationId}
                  onChange={() => setChoice(w.registrationId)} />
                {w.name} [{w.tag}]
              </label>
            ))}
            <label className="flex items-center gap-2" style={{ color: 'var(--s-text-dim)' }}>
              <input type="radio" name="replace-with" checked={choice === null} onChange={() => setChoice(null)} />
              Personne — le siège devient un bye
            </label>
          </div>
        ) : (
          <p style={{ color: 'var(--s-text-muted)' }}>Aucune équipe en liste d&apos;attente : le siège deviendra un bye.</p>
        )}
        <button className="btn-springs btn-primary bevel-sm" onClick={() => onSubmit(choice)}>
          Remplacer
        </button>
      </div>
    </ModalShell>
  );
}

function clamp(v: string): number {
  return Math.max(0, Math.min(99, Number(v) || 0));
}
