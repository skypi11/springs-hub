'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hourglass, Check, Loader2 } from 'lucide-react';
import { apiPublic, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';

// Ce que voit un joueur arrivé quand tout est pris.
//
// Avant, on lui disait « contacte l'organisation sur le Discord ». Beaucoup ne
// le faisaient pas, et ceux qui le faisaient n'avaient aucune trace de leur
// demande. Ici il se met dans la file en un clic, voit son rang, et sera
// prévenu si une place se libère.

type Etat = {
  enAttente: number;
  complet: boolean;
  moi: {
    rang: number | null;
    statut: string | null;
    expireA: number | null;
    /** Tranché par le serveur : l'horloge du navigateur ne décide pas d'une réservation. */
    invitationActive: boolean;
  } | null;
};

export default function WaitlistJoin() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['mania-cup', 'waitlist'] as const,
    queryFn: () => apiPublic<Etat>('/api/mania-cup/waitlist'),
  });

  const agir = useMutation({
    mutationFn: (action: 'join' | 'leave') =>
      apiPublic('/api/mania-cup/waitlist', { method: 'POST', body: { action } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mania-cup', 'waitlist'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action impossible.'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#8d89a8]">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Chargement…
      </div>
    );
  }

  const moi = data?.moi;
  const invite = Boolean(moi?.invitationActive);

  // Une place lui est réservée : c'est la seule chose qui compte à l'écran, et
  // elle a une échéance. Tout le reste attendra.
  if (invite) {
    return (
      <div className="border border-[#00D936]/40 bg-[#00D936]/5 p-6">
        <h2 className="font-display text-2xl text-[#00D936]">Une place t’attend</h2>
        <p className="mt-2 text-[#c9c5d8]">
          Elle t’est réservée : personne d’autre ne peut la prendre. Remplis ton
          dossier et règle ton inscription sans tarder — sans nouvelle de ta part,
          l’organisation la proposera à la personne suivante.
        </p>
      </div>
    );
  }

  if (moi?.statut === 'waiting') {
    return (
      <div className="border border-white/10 bg-white/[0.02] p-6">
        <h2 className="font-display text-2xl">Tu es sur la liste d’attente</h2>
        <p className="mt-2 text-[#c9c5d8]">
          Tu es <strong className="text-[#00D936]">{moi.rang}
          {moi.rang === 1 ? 'er' : 'e'}</strong> sur {data?.enAttente ?? 0}. Si une place
          se libère, tu seras prévenu et elle te sera réservée le temps que tu règles.
        </p>
        <button
          onClick={() => agir.mutate('leave')}
          disabled={agir.isPending}
          className="mt-4 text-sm underline disabled:opacity-40"
          style={{ color: '#8d89a8' }}
        >
          Me retirer de la liste
        </button>
      </div>
    );
  }

  return (
    <div className="border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-display text-2xl">Toutes les places sont prises</h2>
      <p className="mt-2 text-[#c9c5d8]">
        Mets-toi sur la liste d’attente : les places qui se libèrent sont proposées
        dans l’ordre d’arrivée, et tu seras prévenu.
        {(data?.enAttente ?? 0) > 0 && (
          <> {data!.enAttente} personne{data!.enAttente > 1 ? 's' : ''} y figure
          {data!.enAttente > 1 ? 'nt' : ''} déjà.</>
        )}
      </p>
      <button
        onClick={() => agir.mutate('join')}
        disabled={agir.isPending}
        className="mt-4 inline-flex items-center gap-2 bg-[#00D936] px-5 py-2.5 font-bold text-[#07050b] disabled:opacity-40"
      >
        {agir.isPending ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : (
          <Hourglass size={16} aria-hidden />
        )}
        Me mettre sur la liste d’attente
      </button>
      <p className="mt-3 flex items-start gap-2 text-xs" style={{ color: '#8d89a8' }}>
        <Check size={13} className="mt-0.5 shrink-0" aria-hidden />
        Aucun paiement maintenant : tu ne règles que si une place te revient.
      </p>
    </div>
  );
}
