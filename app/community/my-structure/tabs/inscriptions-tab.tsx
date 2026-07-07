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
import { Loader2, ChevronRight } from 'lucide-react';
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
  canWithdraw: boolean;
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
      <div className="panel-header">
        <span className="font-display text-sm tracking-wider">INSCRIPTIONS ({registrations.length})</span>
      </div>
      <div className="panel-body p-0">
        {registrations.map((r, i) => {
          const st = STATUS[r.status] ?? { label: r.status, color: 'var(--s-text-dim)' };
          return (
            <Link
              key={r.id}
              href={`/competitions/${r.competitionId}`}
              className="flex items-center gap-3 px-4 py-3 group transition-colors hover:bg-[var(--s-elevated)]"
              style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}
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
                  {r.status === 'rejected' && r.rejectionReason && (
                    <span className="truncate" style={{ color: 'var(--s-text-dim)' }}>· {r.rejectionReason}</span>
                  )}
                </div>
              </div>
              <span className="text-sm flex-shrink-0" style={{ color: st.color, fontWeight: 600 }}>
                {st.label}
              </span>
              <ChevronRight size={16} className="flex-shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--s-text-muted)' }} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
