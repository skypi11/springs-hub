'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Clock, X, Hourglass } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';

// La file d'attente, vue de l'organisation.
//
// Elle n'apparaît que lorsqu'il y a quelqu'un dedans : à 3 inscrits sur 64,
// un panneau vide intitulé « liste d'attente » n'apprend rien et occupe
// l'écran qu'on consulte tous les jours.

export type LigneAttente = {
  uid: string;
  rang: number;
  statut: 'waiting' | 'invited' | 'converted' | 'left';
  expireA: number | null;
  expiree: boolean;
  nom: string;
  discordId: string | null;
  demandeLe: number;
};

function quand(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function WaitlistPanel({
  lignes,
  prochain,
  delaiHeures,
  onError,
}: {
  lignes: LigneAttente[];
  /** Qui recevra l'invitation. `null` = aucune place à offrir. */
  prochain: string | null;
  delaiHeures: number;
  onError: (m: string) => void;
}) {
  const qc = useQueryClient();

  const agir = useMutation({
    mutationFn: (body: { action: string; uid?: string }) =>
      api('/api/admin/mania-cup', { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup'] }),
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Action refusée'),
  });

  if (lignes.length === 0) return null;

  const suivant = lignes.find((l) => l.uid === prochain);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/10 pb-3">
        <h2 className="font-display text-2xl">Liste d’attente</h2>
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          {lignes.length} personne{lignes.length > 1 ? 's' : ''} · les places se
          proposent dans l’ordre d’arrivée
        </p>
      </div>

      {/* Le bouton dit ce qui va se passer, et à qui. Un « inviter » seul
          laisserait deviner qui reçoit la place. */}
      <div className="mt-4">
        {suivant ? (
          <button
            onClick={() => agir.mutate({ action: 'waitlist_invite', uid: suivant.uid })}
            disabled={agir.isPending}
            className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2 disabled:opacity-40"
          >
            <UserPlus size={15} aria-hidden />
            Proposer la place à {suivant.nom}
          </button>
        ) : (
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Aucune place à proposer pour l’instant — soit tout est réglé, soit une
            invitation en cours tient déjà la dernière.
          </p>
        )}
        {suivant && (
          <p className="mt-2 text-xs" style={{ color: 'var(--s-text-muted)' }}>
            La place lui sera réservée {delaiHeures} h. Personne d’autre ne pourra la
            prendre pendant ce temps.
          </p>
        )}
      </div>

      <div className="mt-5 divide-y divide-white/5 border-t border-white/5">
        {lignes.map((l) => (
          <div key={l.uid} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <span
              className="w-6 text-xs tabular-nums"
              style={{ color: 'var(--s-text-muted)' }}
            >
              {l.rang}
            </span>
            <span className="min-w-[150px] flex-1 font-semibold">{l.nom}</span>

            {l.statut === 'invited' && !l.expiree && (
              <span className="tag tag-gold inline-flex items-center gap-1">
                <Clock size={11} aria-hidden />
                place réservée jusqu’au {l.expireA ? quand(l.expireA) : '—'}
              </span>
            )}
            {l.statut === 'invited' && l.expiree && (
              <span className="tag tag-neutral inline-flex items-center gap-1">
                <Hourglass size={11} aria-hidden /> invitation expirée
              </span>
            )}
            {l.statut === 'waiting' && (
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                demandé le {quand(l.demandeLe)}
              </span>
            )}

            <button
              onClick={() => agir.mutate({ action: 'waitlist_remove', uid: l.uid })}
              disabled={agir.isPending}
              title="Retirer de la liste d’attente"
              className="inline-flex items-center gap-1 text-xs underline disabled:opacity-40"
              style={{ color: 'var(--s-text-dim)' }}
            >
              <X size={12} aria-hidden /> retirer
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
