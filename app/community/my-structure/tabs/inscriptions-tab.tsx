'use client';

// Onglet « Inscriptions » de Ma structure (04/07) : SUIVI des engagements en
// compétition de la structure — pas une vitrine. Ne liste QUE les compétitions
// où la structure a une inscription, avec le statut par équipe. L'inscription
// elle-même part de la page Compétitions (sidebar) → aucun CTA « inscrire » ici,
// pour ne pas doublonner (décision Matt 04/07).
//
// Portée par rôle (gérée côté serveur) : dirigeant/responsable voient toutes les
// inscriptions, le manager d'équipe uniquement les siennes.
//
// Le retrait d'une inscription depuis cet onglet viendra au Lot 3 (le serveur
// renvoie déjà `canWithdraw` par ligne) — consultation seule pour l'instant.

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, ChevronRight, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import GameTag from '@/components/games/GameTag';

interface Registration {
  id: string;
  teamId: string;
  teamName: string;
  game: string;
  competitionId: string;
  competitionName: string;
  competitionStatus: string;
  circuitId: string | null;
  circuitName: string | null;
  status: string;
  rejectionReason: string | null;
  bracketPublished: boolean;
  createdAt: string | null;
  roster: Array<{ displayName: string; role: 'titulaire' | 'remplacant'; isCaptain: boolean }>;
  days: Array<{ date: string; startsAt: string; endsAt: string | null }>;
  sanctions: Array<{ type: 'warn' | 'exclusion' | 'ban'; reason: string; createdAt: string | null }>;
  canWithdraw: boolean;
}

const SANCTION_LABEL: Record<string, string> = { warn: 'Avertissement', exclusion: 'Exclusion', ban: 'Ban' };

function fmtDay(d: { date: string; startsAt: string; endsAt: string | null }): string {
  let out = '';
  try {
    out = new Date(d.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch { out = d.date; }
  if (d.startsAt) out += ` · ${d.startsAt}${d.endsAt ? `–${d.endsAt}` : ''}`;
  return out;
}

// Or réservé au CTA/récompense (règle « or rationné ») : les états d'attente
// restent neutres, seuls « validée » (vert) et « refusée » (rouge) sont colorés.
const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente de validation', color: 'var(--s-text-dim)' },
  approved: { label: 'Validée', color: '#33ff66' },
  waitlisted: { label: "Liste d'attente", color: 'var(--s-text-dim)' },
  rejected: { label: 'Refusée', color: '#ff8a8a' },
  withdrawn: { label: 'Retirée', color: 'var(--s-text-muted)' },
};

export function InscriptionsTab({ structureId }: { structureId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['structure-registrations', structureId] as const,
    queryFn: () => api<{ registrations: Registration[] }>(`/api/structures/${structureId}/registrations`),
  });

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm py-8" style={{ color: 'var(--s-text-dim)' }}>
        {error instanceof ApiError ? error.message : 'Erreur de chargement.'}
      </p>
    );
  }

  const registrations = data?.registrations ?? [];

  if (registrations.length === 0) {
    return (
      <div className="panel bevel">
        <div className="panel-body py-10 text-center space-y-2">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Aucune inscription en cours pour cette structure.
          </p>
          <Link href="/competitions" className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--s-gold)' }}>
            Voir les compétitions ouvertes <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel bevel">
      <div className="panel-header flex items-center justify-between">
        <span className="font-display text-sm tracking-wider">INSCRIPTIONS ({registrations.length})</span>
        <Link href="/competitions" className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
          Compétitions <ChevronRight size={14} />
        </Link>
      </div>
      <div className="panel-body p-0">
        {registrations.map((r, i) => {
          const st = STATUS[r.status] ?? { label: r.status, color: 'var(--s-text-dim)' };
          const titulaires = r.roster.filter(p => p.role === 'titulaire');
          const remplacants = r.roster.filter(p => p.role === 'remplacant');
          const name = (p: { displayName: string; isCaptain: boolean }) => p.isCaptain ? `${p.displayName} (C)` : p.displayName;
          return (
            <div key={r.id} style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
              {/* En-tête cliquable → fiche de la Qualif (équipes + bracket). */}
              <Link
                href={`/competitions/${r.competitionId}`}
                className="flex items-center gap-3 px-4 py-3 group transition-colors hover:bg-[var(--s-elevated)]"
              >
                <GameTag gameId={r.game} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">{r.teamName}</span>
                    <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>·</span>
                    <span className="text-sm truncate" style={{ color: 'var(--s-text-dim)' }}>{r.competitionName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                    {r.circuitName && <span className="truncate">{r.circuitName}</span>}
                    {r.days.length > 0 && <span className="truncate">· {r.days.map(fmtDay).join(' · ')}</span>}
                  </div>
                </div>
                <span className="text-sm flex-shrink-0" style={{ color: st.color, fontWeight: 600 }}>
                  {st.label}
                </span>
                <ChevronRight size={16} className="flex-shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--s-text-muted)' }} />
              </Link>

              {/* Sanctions actives (avertissement / ban) — bien visibles. */}
              {r.sanctions.length > 0 && (
                <div className="px-4 pb-2 pl-[52px] space-y-1">
                  {r.sanctions.map((s, si) => (
                    <p key={si} className="text-xs flex items-center gap-1.5" style={{ color: '#ffb46b' }}>
                      <ShieldAlert size={13} className="flex-shrink-0" /> {SANCTION_LABEL[s.type] ?? s.type} : {s.reason}
                    </p>
                  ))}
                </div>
              )}

              {/* Roster FIGÉ à l'inscription (l'équipe est verrouillée après envoi). */}
              {r.roster.length > 0 && (
                <div className="px-4 pb-3 pl-[52px] space-y-1 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  {titulaires.length > 0 && (
                    <p>
                      <span style={{ color: 'var(--s-text-muted)' }}>Titulaires : </span>
                      {titulaires.map(name).join(', ')}
                    </p>
                  )}
                  {remplacants.length > 0 && (
                    <p>
                      <span style={{ color: 'var(--s-text-muted)' }}>Remplaçants : </span>
                      {remplacants.map(name).join(', ')}
                    </p>
                  )}
                  {r.status === 'rejected' && r.rejectionReason && (
                    <p style={{ color: '#ff8a8a' }}>Motif du refus : {r.rejectionReason}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
