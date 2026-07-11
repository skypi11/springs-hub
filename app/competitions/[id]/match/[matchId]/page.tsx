'use client';

// Page de match — publique (statut, score, stream) + zone privée des
// participants (check-in capitaine, room, saisie des scores, litige).
// Le camp et les droits arrivent du SERVEUR (access) — l'UI ne décide rien.
// Polling 10 s ; tick opportuniste toutes les 30 s quand le match a une
// deadline active (archi §5 : les pages de match tiennent l'horloge vivante
// même console fermée).

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPublic, ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { getGameColor, getGameColorRgb } from '@/lib/games-registry';
import TeamCrest from '@/components/competitions/TeamCrest';
import { ChevronLeft, Copy, Radio, ShieldAlert } from 'lucide-react';

type Side = { name: string; tag: string; logoUrl: string | null } | null;
interface Game { a: number; b: number }

interface MatchPayload {
  match: {
    id: string;
    bracket: 'winners' | 'losers' | 'grand_final';
    round: number;
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
    scores: {
      a: Game[]; b: Game[];
      aSubmittedAt: string | null; bSubmittedAt: string | null;
      counterDeadline: string | null;
      final: Game[] | null;
      validatedBy: 'auto' | 'admin' | null;
    };
    dispute: { auto: boolean; resolvedBy: 'admin' | null; resolution: string | null } | null;
    forfeit: { team: 'a' | 'b' | 'both'; reason: string | null } | null;
    cast: { featured: boolean; streamUrl: string | null } | null;
    winner: 'a' | 'b' | null;
  };
  access: { side: 'a' | 'b' | null; isCaptain: boolean; isStaff: boolean; canCheckin: boolean; canSubmitScores: boolean };
  isAdmin: boolean;
  room: { name: string; password: string } | null;
}

const STATUS_FR: Record<string, string> = {
  pending: 'À venir',
  checkin: 'Check-in en cours',
  ready: 'Prêt',
  live: 'En cours',
  awaiting_scores: 'En attente des scores',
  score_review: 'Contre-saisie en cours',
  disputed: 'Litige — arbitrage admin',
  awaiting_forfeit_validation: 'En attente de décision admin',
  completed: 'Terminé',
  walkover: "Qualifié d'office",
  cancelled: 'Non joué',
};

function bracketLabel(bracket: string, round: number): string {
  if (bracket === 'grand_final') return round === 2 ? 'Belle (reset)' : 'Grande finale';
  return `${bracket === 'winners' ? 'Winners' : 'Losers'} · tour ${round}`;
}

function gamesWon(final: Game[] | null): { a: number; b: number } {
  const w = { a: 0, b: 0 };
  for (const g of final ?? []) {
    if (g.a > g.b) w.a++;
    else if (g.b > g.a) w.b++;
  }
  return w;
}

// Compte à rebours mm:ss — l'horloge vit dans un effet (pas de Date.now() au
// render, règle react-hooks/purity), tick 1 s uniquement quand une deadline
// est active.
function useCountdown(deadline: string | null): string | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- abonnement à l'horloge
       (système externe) : la valeur initiale du compte à rebours doit être
       posée immédiatement, puis tick 1 s — pattern compte à rebours assumé. */
    if (!deadline) { setRemaining(null); return; }
    const target = Date.parse(deadline);
    if (Number.isNaN(target)) { setRemaining(null); return; }
    const update = () => setRemaining(Math.max(0, target - Date.now()));
    update();
    /* eslint-enable react-hooks/set-state-in-effect */
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (remaining === null) return null;
  const s = Math.floor(remaining / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function MatchPage({ params }: { params: Promise<{ id: string; matchId: string }> }) {
  const { id, matchId } = use(params);
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: compData } = useQuery({
    queryKey: ['competition', id, !!user],
    queryFn: async () => {
      const res = await (user ? api : apiPublic)<{ competition: { name: string; game: string } }>(`/api/competitions/${id}`);
      return res.competition;
    },
    staleTime: 60_000,
  });
  const { data, isError } = useQuery({
    queryKey: ['competition-match', id, matchId, !!user],
    queryFn: () => (user ? api : apiPublic)<MatchPayload>(`/api/competitions/${id}/matches/${matchId}`),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const m = data?.match;
  const access = data?.access;
  const involved = !!access?.side || data?.isAdmin === true;
  const color = getGameColor(compData?.game ?? 'rocket_league');
  const colorRgb = getGameColorRgb(compData?.game ?? 'rocket_league');

  // Tick opportuniste : tient les deadlines vivantes même console fermée.
  useEffect(() => {
    if (!user || !m) return;
    if (m.status !== 'checkin' && m.status !== 'score_review') return;
    const fire = () => { api(`/api/competitions/${id}/tick`, { method: 'POST' }).catch(() => null); };
    const t = setInterval(fire, 30_000);
    return () => clearInterval(t);
  }, [user, m, id]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competition-match', id, matchId] });

  async function act(body: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    try {
      await api(`/api/competitions/${id}/matches/${matchId}`, { method: 'POST', body });
      if (okMsg) toast.success(okMsg);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Action impossible.');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const checkinCountdown = useCountdown(m?.status === 'checkin' ? m.checkin?.deadline ?? null : null);
  const counterCountdown = useCountdown(m?.status === 'score_review' ? m.scores.counterDeadline : null);

  if (isError && !data) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Match introuvable.</p>
      </div>
    );
  }
  if (!m) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Chargement du match…</p>
      </div>
    );
  }

  const wins = gamesWon(m.scores.final);
  const done = m.status === 'completed' || m.status === 'walkover' || m.status === 'cancelled';
  const disputeOpen = !!m.dispute && m.dispute.resolvedBy === null;
  const mySide = access?.side ?? null;
  const scorable = ['live', 'awaiting_scores', 'score_review'].includes(m.status) && !disputeOpen;
  const myEntry = mySide ? m.scores[mySide] : [];
  const otherEntry = mySide ? m.scores[mySide === 'a' ? 'b' : 'a'] : [];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 animate-fade-in">
      <Link href={`/competitions/${id}`} className="inline-flex items-center gap-1 text-sm"
        style={{ color: 'var(--s-text-dim)' }}>
        <ChevronLeft size={15} /> {compData?.name ?? 'Compétition'}
      </Link>

      {/* Héros du match — seul élément de niveau 1 de la page */}
      <div className="panel bevel relative overflow-hidden">
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${color}, rgba(${colorRgb},0.3), transparent 70%)` }} />
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-label-soft">{bracketLabel(m.bracket, m.round)}</span>
            <span className="tag tag-neutral">BO{m.bo}</span>
            <span className="tag tag-neutral">{STATUS_FR[m.status] ?? m.status}</span>
            {m.cast?.featured && !done && (
              m.cast.streamUrl ? (
                <a href={m.cast.streamUrl} target="_blank" rel="noopener noreferrer"
                  className="tag tag-gold inline-flex items-center gap-1">
                  <Radio size={11} /> En stream
                </a>
              ) : (
                <span className="tag tag-gold inline-flex items-center gap-1"><Radio size={11} /> En stream</span>
              )
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <TeamSide info={m.teamAInfo} isVoid={m.voidA} winner={m.winner === 'a'} forfeit={m.forfeit?.team === 'a' || m.forfeit?.team === 'both'} align="right" color={color} />
            <div className="text-center px-2">
              {m.scores.final ? (
                <p className="font-display text-5xl" style={{ letterSpacing: '0.04em' }}>
                  <span style={{ color: m.winner === 'a' ? color : 'var(--s-text-dim)' }}>{wins.a}</span>
                  <span style={{ color: 'var(--s-text-muted)' }}> – </span>
                  <span style={{ color: m.winner === 'b' ? color : 'var(--s-text-dim)' }}>{wins.b}</span>
                </p>
              ) : (
                <p className="font-display text-3xl" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.08em' }}>VS</p>
              )}
            </div>
            <TeamSide info={m.teamBInfo} isVoid={m.voidB} winner={m.winner === 'b'} forfeit={m.forfeit?.team === 'b' || m.forfeit?.team === 'both'} align="left" color={color} />
          </div>

          {m.scores.final && m.scores.final.length > 0 && !m.forfeit && (
            <p className="text-center t-mono text-sm" style={{ color: 'var(--s-text-dim)' }}>
              {m.scores.final.map(g => `${g.a}-${g.b}`).join(' · ')}
            </p>
          )}
          {m.forfeit && (
            <p className="text-center text-sm" style={{ color: 'var(--s-text-dim)' }}>
              {m.forfeit.team === 'both' ? 'Double forfait — les deux équipes sont éliminées.' : 'Victoire par forfait.'}
              {m.forfeit.reason ? ` ${m.forfeit.reason}` : ''}
            </p>
          )}
          {m.status === 'walkover' && (
            <p className="text-center text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Qualification d&apos;office — pas d&apos;adversaire sur ce match.
            </p>
          )}
        </div>
      </div>

      {/* Litige — visible de tous (statut public), détail sobre */}
      {m.dispute && (
        <div className="panel bevel">
          <div className="panel-body flex items-start gap-3">
            <ShieldAlert size={17} style={{ color: disputeOpen ? 'var(--s-gold)' : 'var(--s-text-muted)', marginTop: 2 }} />
            <div className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              {disputeOpen ? (
                <>
                  <p style={{ color: 'var(--s-text)' }} className="font-semibold">Litige en cours</p>
                  <p>Le match est gelé le temps de l&apos;arbitrage. Un admin de compétition tranche et débloque le bracket.</p>
                </>
              ) : (
                <>
                  <p style={{ color: 'var(--s-text)' }} className="font-semibold">Litige résolu</p>
                  {m.dispute.resolution && <p>{m.dispute.resolution}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Zone participants */}
      {involved && !done && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Check-in */}
          {m.checkin && (m.status === 'checkin' || m.status === 'awaiting_forfeit_validation') && (
            <div className="panel bevel">
              <div className="panel-header flex items-center justify-between">
                <span className="t-sub">Check-in</span>
                {checkinCountdown && <span className="t-mono text-sm" style={{ color: 'var(--s-text-dim)' }}>{checkinCountdown}</span>}
              </div>
              <div className="panel-body space-y-3">
                <CheckinRow label={m.teamAInfo?.name ?? 'Équipe A'} done={m.checkin.a.done} color={color} />
                <CheckinRow label={m.teamBInfo?.name ?? 'Équipe B'} done={m.checkin.b.done} color={color} />
                {m.status === 'awaiting_forfeit_validation' ? (
                  <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    Le délai est écoulé. Un admin statue — forfait ou relance du check-in.
                  </p>
                ) : mySide && !m.checkin[mySide].done ? (
                  access?.canCheckin ? (
                    <button className="btn-springs btn-primary bevel-sm" disabled={busy}
                      onClick={() => act({ action: 'checkin' }, 'Check-in confirmé.')}>
                      Check-in de mon équipe
                    </button>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
                      Seul le capitaine peut check-in.
                    </p>
                  )
                ) : null}
              </div>
            </div>
          )}

          {/* Room */}
          {data?.room && !done && (
            <div className="panel bevel">
              <div className="panel-header"><span className="t-sub">Room privée</span></div>
              <div className="panel-body space-y-3">
                <CopyRow label="Nom" value={data.room.name} onCopy={() => toast.info('Nom de room copié.')} />
                <CopyRow label="Mot de passe" value={data.room.password} onCopy={() => toast.info('Mot de passe copié.')} />
                <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                  Room à créer par : <span className="font-semibold" style={{ color: 'var(--s-text)' }}>
                    {(m.roomHost === 'a' ? m.teamAInfo?.name : m.teamBInfo?.name) ?? '—'}
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Saisie des scores */}
          {mySide && scorable && (
            <div className="panel bevel md:col-span-2">
              <div className="panel-header flex items-center justify-between">
                <span className="t-sub">Score du match</span>
                {counterCountdown && otherEntry.length > 0 && myEntry.length === 0 && (
                  <span className="t-mono text-sm" style={{ color: 'var(--s-gold)' }}>
                    Contre-saisie : {counterCountdown}
                  </span>
                )}
              </div>
              <div className="panel-body">
                {access?.canSubmitScores ? (
                  <ScoreEntryForm
                    bo={m.bo}
                    tagA={m.teamAInfo?.tag ?? 'A'}
                    tagB={m.teamBInfo?.tag ?? 'B'}
                    initial={myEntry}
                    busy={busy}
                    alreadySubmitted={myEntry.length > 0}
                    otherSubmitted={otherEntry.length > 0}
                    onSubmit={games => act({ action: 'submit_scores', games }, 'Score envoyé.')}
                    onDispute={() => act({ action: 'open_dispute' }, 'Litige ouvert — un admin va trancher.')}
                  />
                ) : (
                  <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
                    La saisie est réservée au capitaine et au staff de l&apos;équipe.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeamSide({ info, isVoid, winner, forfeit, align, color }: {
  info: Side; isVoid: boolean; winner: boolean; forfeit: boolean; align: 'left' | 'right'; color: string;
}) {
  return (
    <div className={`flex items-center gap-3 min-w-0 ${align === 'right' ? 'flex-row-reverse text-right justify-start' : ''}`}>
      {info && !isVoid ? <TeamCrest url={info.logoUrl} tag={info.tag} name={info.name} size={56} /> : (
        <div className="bevel-sm flex-shrink-0" style={{ width: 56, height: 56, background: 'var(--s-elevated)' }} />
      )}
      <div className="min-w-0">
        <p className="font-display text-xl truncate" style={{
          letterSpacing: '0.03em',
          color: isVoid || !info ? 'var(--s-text-muted)' : winner ? color : 'var(--s-text)',
        }}>
          {isVoid ? 'BYE' : info ? info.name.toUpperCase() : 'À DÉTERMINER'}
        </p>
        <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
          {info && !isVoid ? `[${info.tag}]` : ''}{forfeit ? ' · forfait' : ''}
        </p>
      </div>
    </div>
  );
}

function CheckinRow({ label, done, color }: { label: string; done: boolean; color: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: 'var(--s-text)' }}>{label}</span>
      <span className="font-semibold" style={{ color: done ? color : 'var(--s-text-muted)' }}>
        {done ? 'Présente' : 'En attente'}
      </span>
    </div>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span style={{ color: 'var(--s-text-muted)' }}>{label}</span>
      <span className="t-mono flex-1 text-right truncate" style={{ color: 'var(--s-text)' }}>{value}</span>
      <button
        className="p-1.5 bevel-sm"
        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
        aria-label={`Copier ${label.toLowerCase()}`}
        onClick={() => { navigator.clipboard?.writeText(value).then(onCopy).catch(() => null); }}
      >
        <Copy size={13} style={{ color: 'var(--s-text-dim)' }} />
      </button>
    </div>
  );
}

function ScoreEntryForm({ bo, tagA, tagB, initial, busy, alreadySubmitted, otherSubmitted, onSubmit, onDispute }: {
  bo: number;
  tagA: string;
  tagB: string;
  initial: Game[];
  busy: boolean;
  alreadySubmitted: boolean;
  otherSubmitted: boolean;
  onSubmit: (games: Game[]) => void;
  onDispute: () => void;
}) {
  const needed = Math.ceil(bo / 2);
  const [games, setGames] = useState<Game[]>(initial.length > 0 ? initial : Array.from({ length: needed }, () => ({ a: 0, b: 0 })));
  const [editing, setEditing] = useState(initial.length === 0);

  const wins = useMemo(() => {
    const w = { a: 0, b: 0 };
    for (const g of games) { if (g.a > g.b) w.a++; else if (g.b > g.a) w.b++; }
    return w;
  }, [games]);
  const valid = (wins.a === needed || wins.b === needed) && games.every(g => g.a !== g.b);

  if (!editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
          Saisie de ton équipe : <span className="t-mono" style={{ color: 'var(--s-text)' }}>
            {initial.map(g => `${g.a}-${g.b}`).join(' · ')}
          </span>
          {otherSubmitted
            ? ' — en attente de résolution.'
            : " — en attente de la saisie de l'équipe adverse."}
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn-springs btn-secondary bevel-sm" onClick={() => setEditing(true)}>
            Corriger ma saisie
          </button>
          <button className="btn-springs btn-ghost text-sm" disabled={busy} onClick={onDispute}>
            Signaler un problème
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
        Buts de chaque manche, dans l&apos;ordre. Vainqueur du match à {needed} manches (BO{bo}).
      </p>
      <div className="space-y-2">
        {games.map((g, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="t-label-soft w-20 flex-shrink-0">Manche {i + 1}</span>
            <ScoreInput label={tagA} value={g.a} onChange={v => setGames(gs => gs.map((x, j) => j === i ? { ...x, a: v } : x))} />
            <span style={{ color: 'var(--s-text-muted)' }}>–</span>
            <ScoreInput label={tagB} value={g.b} onChange={v => setGames(gs => gs.map((x, j) => j === i ? { ...x, b: v } : x))} />
            {games.length > needed && (
              <button className="text-sm" style={{ color: 'var(--s-text-muted)' }}
                onClick={() => setGames(gs => gs.filter((_, j) => j !== i))}>
                Retirer
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {games.length < bo && (
          <button className="btn-springs btn-ghost text-sm"
            onClick={() => setGames(gs => [...gs, { a: 0, b: 0 }])}>
            Ajouter une manche
          </button>
        )}
        <button className="btn-springs btn-primary bevel-sm" disabled={busy || !valid}
          onClick={() => onSubmit(games)}>
          {alreadySubmitted ? 'Corriger le score' : 'Envoyer le score'}
        </button>
        {!valid && (
          <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
            Il faut un vainqueur net à {needed} manches, sans manche nulle.
          </span>
        )}
      </div>
    </div>
  );
}

function ScoreInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
      <span className="t-mono" style={{ fontSize: 12 }}>{label}</span>
      <input
        type="number" min={0} max={99} value={value}
        onChange={e => onChange(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
        className="settings-input bevel-sm"
        style={{ width: 64, textAlign: 'center' }}
      />
    </label>
  );
}
