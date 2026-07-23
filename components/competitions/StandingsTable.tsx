'use client';

// Classement d'un round robin (par poule) ou d'un suisse (global) — la table
// OFFICIELLE, servie par /api/competitions/[id]/standings (fonctions pures du
// moteur, la ranking table native du viewer est désactivée). Présentational
// pur : les données arrivent du parent (BracketView, polling partagé).
// Grammaire Aedral niveau « ligne » : rangées à dividers, zéro chrome — et
// table COMPACTE (max-width, colonnes chiffres serrées) : étirée sur toute la
// largeur, les stats se perdaient à des kilomètres du nom (retour Matt).

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

const NUM = 'px-2 py-2 text-right t-mono';

export default function StandingsTable({ kind, concluded, groups }: {
  kind: 'round_robin' | 'swiss';
  /** Tous les matchs existants sont terminaux. En cours de jeu, les marqueurs
   *  d'égalité sont masqués : l'ordre fluctue à chaque score, « à arbitrer »
   *  serait du bruit (l'arbitrage n'est proposé qu'à la fin, flux console). */
  concluded: boolean;
  groups: StandingsGroup[];
}) {
  if (groups.length === 0) return null;
  const isSwiss = kind === 'swiss';
  const multiPools = !isSwiss && groups.length > 1;
  const showTiebreaks = concluded;
  const hasTiebreak = showTiebreaks && groups.some(g => g.rows.some(r => r.needsAdminTiebreak));

  return (
    <div className="space-y-5">
      {groups.map(g => (
        <div key={g.group} style={{ maxWidth: isSwiss ? 620 : 560 }}>
          {multiPools && (
            <p className="t-label mb-2" style={{ color: 'var(--s-text-dim)' }}>Poule {g.group}</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: isSwiss ? 480 : 420 }}>
              <thead>
                <tr className="t-label" style={{ color: 'var(--s-text-muted)' }}>
                  <th className="text-left font-normal py-1.5 pr-1" style={{ width: 26 }}>#</th>
                  <th className="text-left font-normal py-1.5">Équipe</th>
                  <th className="font-normal text-right px-2 py-1.5" style={{ width: 40 }} title="Matchs joués">J</th>
                  <th className="font-normal text-right px-2 py-1.5" style={{ width: 40 }} title="Victoires">V</th>
                  <th className="font-normal text-right px-2 py-1.5" style={{ width: 40 }} title="Défaites">D</th>
                  <th className="font-normal text-right px-2 py-1.5" style={{ width: 52 }} title="Différence de manches">+/−</th>
                  {isSwiss && (
                    <th className="font-normal text-right px-2 py-1.5" style={{ width: 56 }} title="Buchholz — somme des points des adversaires rencontrés">Buch.</th>
                  )}
                  <th className="font-normal text-right pl-2 py-1.5" style={{ width: 46 }} title="Points">Pts</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(r => (
                  <tr key={r.registrationId}
                    style={{ borderTop: '1px solid var(--s-border)', opacity: r.withdrawn ? 0.45 : 1 }}>
                    <td className="t-mono py-2 pr-1" style={{ color: 'var(--s-text-muted)' }}>{r.rank}</td>
                    <td className="py-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <TeamCrest url={r.logoUrl} tag={r.tag} name={r.name} size={22} />
                        <span className="truncate">{r.name}</span>
                        {r.withdrawn && (
                          <span className="t-label flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>Retirée</span>
                        )}
                        {showTiebreaks && r.needsAdminTiebreak && (
                          <span className="t-label flex-shrink-0" style={{ color: 'var(--s-gold)' }} title="Égalité à arbitrer par un admin">Égalité</span>
                        )}
                      </span>
                    </td>
                    <td className={NUM} style={{ color: 'var(--s-text-dim)' }}>{r.played}</td>
                    <td className={NUM}>{r.wins}</td>
                    <td className={NUM} style={{ color: 'var(--s-text-dim)' }}>{r.losses}</td>
                    <td className={NUM} style={{ color: 'var(--s-text-dim)' }}>
                      {r.gameDiff > 0 ? `+${r.gameDiff}` : r.gameDiff}
                    </td>
                    {isSwiss && (
                      <td className={NUM} style={{ color: 'var(--s-text-dim)' }}>{r.buchholz ?? 0}</td>
                    )}
                    <td className="pl-2 py-2 text-right t-mono font-semibold">{r.points}</td>
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
