'use client';

// Bracket public d'une compétition — double élimination. Servi par l'API
// (`/api/competitions/[id]/matches`, Admin SDK) et rafraîchi par POLLING : le
// SDK Firestore CLIENT est bloqué sur ce projet, et l'API applique surtout le
// même gate de visibilité que la fiche (une compét masquée n'expose pas son
// bracket — un onSnapshot public l'aurait contourné). Refetch 15 s : suffisant
// pour un bracket majoritairement statique hors jour de match (Lot 3).
//
// Orientation VERTICALE (pas de scroll horizontal — règle DA) : le tournoi
// s'écoule de haut en bas, Winners → Losers → Grande finale, chaque ronde est
// une bande dont les matchs remplissent une grille responsive qui passe à la
// ligne. Les cartes de match sont la pièce maîtresse (logos, score par
// manches, vainqueur mis en avant, badges statut/cast). Le match porte
// nom/tag/logo dénormalisés (teamAInfo/teamBInfo).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiPublic } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { Radio, Swords } from 'lucide-react';

type Side = { name: string; tag: string; logoUrl: string | null } | null;

interface MatchDoc {
  id: string;
  bracket: 'winners' | 'losers' | 'grand_final';
  round: number;
  slot: number;
  bo: number;
  teamA: string | null;
  teamB: string | null;
  voidA: boolean;
  voidB: boolean;
  teamAInfo: Side;
  teamBInfo: Side;
  status: 'pending' | 'checkin' | 'ready' | 'live' | 'awaiting_scores'
    | 'score_review' | 'disputed' | 'awaiting_forfeit_validation'
    | 'completed' | 'walkover' | 'cancelled';
  winner: 'a' | 'b' | null;
  scores: { final: Array<{ a: number; b: number }> | null } | null;
  forfeit: { team: 'a' | 'b' | 'both' } | null;
  cast: { featured: boolean; streamUrl: string | null } | null;
}

const BRACKET_LABELS: Record<MatchDoc['bracket'], string> = {
  winners: 'Winners bracket',
  losers: 'Losers bracket',
  grand_final: 'Grande finale',
};

// Manches gagnées par chaque camp (depuis les scores finaux).
function gamesWon(m: MatchDoc): { a: number; b: number } {
  const final = m.scores?.final;
  if (!final) return { a: 0, b: 0 };
  let a = 0;
  let b = 0;
  for (const g of final) { if (g.a > g.b) a++; else if (g.b > g.a) b++; }
  return { a, b };
}

function roundLabel(bracket: MatchDoc['bracket'], round: number, maxRound: number): string {
  if (bracket === 'grand_final') return round === 1 ? 'Grande finale' : 'Belle (reset)';
  if (round === maxRound) return 'Finale';
  if (round === maxRound - 1) return 'Demi-finales';
  if (round === maxRound - 2) return 'Quarts';
  return `Tour ${round}`;
}

export default function BracketView({ competitionId, gameColor }: { competitionId: string; gameColor: string }) {
  const { user } = useAuth();
  const { data, isError } = useQuery({
    queryKey: ['competition-bracket', competitionId, !!user],
    queryFn: () => (user ? api : apiPublic)<{ matches: MatchDoc[] }>(`/api/competitions/${competitionId}/matches`),
    refetchInterval: 15_000,   // rafraîchissement live pendant le jour de match
    staleTime: 10_000,
  });
  // null = chargement ; [] = erreur ou vide. Mémoïsé pour une dépendance
  // useMemo stable (la ref de data.matches vient de React Query, stable).
  const matches = useMemo(
    () => data?.matches ?? (isError ? [] : null),
    [data, isError],
  );

  const sections = useMemo(() => {
    if (!matches) return [];
    const order: MatchDoc['bracket'][] = ['winners', 'losers', 'grand_final'];
    return order
      .map(bracket => {
        const inBracket = matches.filter(m => m.bracket === bracket);
        if (inBracket.length === 0) return null;
        const maxRound = Math.max(...inBracket.map(m => m.round));
        const rounds = Array.from(new Set(inBracket.map(m => m.round)))
          .sort((a, b) => a - b)
          .map(round => ({
            round,
            label: roundLabel(bracket, round, maxRound),
            matches: inBracket.filter(m => m.round === round).sort((a, b) => a.slot - b.slot),
          }));
        return { bracket, rounds };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [matches]);

  if (isError) {
    return <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Le bracket n&apos;a pas pu être chargé.</p>;
  }
  if (!matches) {
    return <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Chargement du bracket…</p>;
  }
  if (sections.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Le bracket n&apos;est pas encore publié.</p>;
  }

  return (
    <div className="space-y-8">
      {sections.map(section => (
        <div key={section.bracket}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1 h-4" style={{ background: gameColor }} />
            <h3 className="t-sub" style={{ letterSpacing: '0.04em' }}>{BRACKET_LABELS[section.bracket]}</h3>
          </div>
          <div className="space-y-5">
            {section.rounds.map(r => (
              <div key={r.round}>
                <p className="t-label mb-2" style={{ color: 'var(--s-text-muted)' }}>{r.label}</p>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                  {r.matches.map(m => <MatchCard key={m.id} m={m} gameColor={gameColor} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchCard({ m, gameColor }: { m: MatchDoc; gameColor: string }) {
  const wins = gamesWon(m);
  const isLive = m.status === 'live' || m.status === 'awaiting_scores' || m.status === 'score_review';
  const isDone = m.status === 'completed' || m.status === 'walkover';
  const cancelled = m.status === 'cancelled';

  return (
    <div className="bevel-sm relative overflow-hidden" style={{
      background: 'var(--s-surface)',
      border: '1px solid var(--s-border)',
      opacity: cancelled ? 0.4 : 1,
    }}>
      {/* Bandeau haut : BO + statut/cast */}
      <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
        <span className="t-mono" style={{ fontSize: '11px', color: 'var(--s-text-muted)' }}>BO{m.bo}</span>
        {m.cast?.featured ? (
          <span className="flex items-center gap-1" style={{ fontSize: '11px', color: 'var(--s-gold)' }}>
            <Radio size={11} /> EN STREAM
          </span>
        ) : isLive ? (
          <span className="flex items-center gap-1" style={{ fontSize: '11px', color: 'var(--s-gold)' }}>
            <Swords size={11} /> EN COURS
          </span>
        ) : cancelled ? (
          <span style={{ fontSize: '11px', color: 'var(--s-text-muted)' }}>Non joué</span>
        ) : null}
      </div>

      <TeamRow side={m.teamAInfo} isVoid={m.voidA} isWinner={m.winner === 'a'} forfeit={m.forfeit?.team === 'a'}
        games={isDone ? wins.a : null} done={isDone} gameColor={gameColor} />
      <div style={{ borderTop: '1px solid var(--s-border)' }} />
      <TeamRow side={m.teamBInfo} isVoid={m.voidB} isWinner={m.winner === 'b'} forfeit={m.forfeit?.team === 'b'}
        games={isDone ? wins.b : null} done={isDone} gameColor={gameColor} />
    </div>
  );
}

function TeamRow({ side, isVoid, isWinner, forfeit, games, done, gameColor }: {
  side: Side;
  isVoid: boolean;
  isWinner: boolean;
  forfeit: boolean;
  games: number | null;
  done: boolean;
  gameColor: string;
}) {
  const label = isVoid ? '—' : side ? side.name : 'À venir';
  const dim = isVoid || (!side) || (done && !isWinner);

  return (
    <div className="flex items-center gap-2 px-3 py-2" style={{
      background: isWinner ? `color-mix(in srgb, ${gameColor} 10%, transparent)` : 'transparent',
    }}>
      {/* Barre gagnant */}
      <span style={{ width: 3, alignSelf: 'stretch', background: isWinner ? gameColor : 'transparent', flexShrink: 0, marginLeft: -12, marginRight: 4 }} />
      {side && !isVoid ? (
        side.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo R2, taille fixe
          <img src={side.logoUrl} alt="" width={20} height={20} style={{ objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <span className="flex-shrink-0" style={{ width: 20, height: 20, background: 'var(--s-elevated)' }} />
        )
      ) : (
        <span className="flex-shrink-0" style={{ width: 20, height: 20 }} />
      )}
      <span className="text-sm flex-1 min-w-0 truncate" style={{
        fontWeight: isWinner ? 700 : 500,
        color: dim ? 'var(--s-text-muted)' : 'var(--s-text)',
      }}>
        {label}
        {side?.tag && !isVoid ? <span style={{ color: 'var(--s-text-muted)', fontWeight: 400 }}> [{side.tag}]</span> : null}
      </span>
      {forfeit && <span style={{ fontSize: '10px', color: 'var(--s-text-muted)' }}>forfait</span>}
      {games !== null && (
        <span className="t-mono flex-shrink-0" style={{
          fontSize: '14px',
          fontWeight: isWinner ? 700 : 400,
          color: isWinner ? gameColor : 'var(--s-text-muted)',
          minWidth: 16, textAlign: 'right',
        }}>
          {games}
        </span>
      )}
    </div>
  );
}
