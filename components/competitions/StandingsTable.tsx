'use client';

// Classement d'un round robin (par poule) ou d'un suisse (global) — la table
// OFFICIELLE, servie par /api/competitions/[id]/standings (fonctions pures du
// moteur, la ranking table native du viewer est désactivée). Présentational
// pur : les données arrivent du parent (BracketView, polling partagé).
// Grammaire Aedral niveau « ligne » : rangées à dividers, zéro chrome.

import TeamCrest from '@/components/competitions/TeamCrest';

export interface StandingsGroup {
  group: number;
  rows: Array<{
    registrationId: string;
    name: string;
    tag: string;
    logoUrl: string | null;
    rank: number;
    played: number;
    wins: number;
    losses: number;
    points: number;
    gameDiff: number;
    goalDiff: number;
    buchholz?: number;
    byes?: number;
    needsAdminTiebreak: boolean;
    withdrawn: boolean;
  }>;
}

export default function StandingsTable({ kind, groups }: {
  kind: 'round_robin' | 'swiss';
  groups: StandingsGroup[];
}) {
  if (groups.length === 0) return null;
  const isSwiss = kind === 'swiss';
  const multiPools = !isSwiss && groups.length > 1;
  const hasTiebreak = groups.some(g => g.rows.some(r => r.needsAdminTiebreak));

  return (
    <div className="space-y-5">
      {groups.map(g => (
        <div key={g.group}>
          {multiPools && (
            <p className="t-label mb-2" style={{ color: 'var(--s-text-dim)' }}>Poule {g.group}</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: isSwiss ? 460 : 400 }}>
              <thead>
                <tr className="t-label" style={{ color: 'var(--s-text-muted)' }}>
                  <th className="text-left font-normal py-1.5 pr-2" style={{ width: 28 }}>#</th>
                  <th className="text-left font-normal py-1.5">Équipe</th>
                  <th className="text-right font-normal py-1.5 px-2" title="Matchs joués">J</th>
                  <th className="text-right font-normal py-1.5 px-2" title="Victoires">V</th>
                  <th className="text-right font-normal py-1.5 px-2" title="Défaites">D</th>
                  <th className="text-right font-normal py-1.5 px-2" title="Différence de manches">+/−</th>
                  {isSwiss && (
                    <th className="text-right font-normal py-1.5 px-2" title="Buchholz — somme des points des adversaires rencontrés">Buch.</th>
                  )}
                  <th className="text-right font-normal py-1.5 pl-2" title="Points">Pts</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(r => (
                  <tr key={r.registrationId}
                    style={{ borderTop: '1px solid var(--s-border)', opacity: r.withdrawn ? 0.45 : 1 }}>
                    <td className="t-mono py-2 pr-2" style={{ color: 'var(--s-text-muted)' }}>{r.rank}</td>
                    <td className="py-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <TeamCrest url={r.logoUrl} tag={r.tag} name={r.name} size={22} />
                        <span className="truncate">{r.name}</span>
                        {r.withdrawn && (
                          <span className="t-label flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>Retirée</span>
                        )}
                        {r.needsAdminTiebreak && (
                          <span className="t-label flex-shrink-0" style={{ color: 'var(--s-gold)' }} title="Égalité à arbitrer par un admin">Égalité</span>
                        )}
                      </span>
                    </td>
                    <td className="t-mono text-right py-2 px-2" style={{ color: 'var(--s-text-dim)' }}>{r.played}</td>
                    <td className="t-mono text-right py-2 px-2">{r.wins}</td>
                    <td className="t-mono text-right py-2 px-2" style={{ color: 'var(--s-text-dim)' }}>{r.losses}</td>
                    <td className="t-mono text-right py-2 px-2" style={{ color: 'var(--s-text-dim)' }}>
                      {r.gameDiff > 0 ? `+${r.gameDiff}` : r.gameDiff}
                    </td>
                    {isSwiss && (
                      <td className="t-mono text-right py-2 px-2" style={{ color: 'var(--s-text-dim)' }}>{r.buchholz ?? 0}</td>
                    )}
                    <td className="t-mono text-right py-2 pl-2 font-semibold">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {hasTiebreak && (
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Une égalité stricte reste à arbitrer — l&apos;ordre affiché est provisoire sur les lignes marquées.
        </p>
      )}
    </div>
  );
}
