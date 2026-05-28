'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';

// Toggle "Parser automatiquement les nouveaux replays sur ballchasing".
// Default OFF, le user active explicitement quand il veut le parsing auto.
// Quand OFF, les nouveaux uploads sont marqués bcStatus='manual' ; le parsing
// reste déclenchable à la demande via le bouton stats d'un replay (lazy
// forward) ou le bouton "Parser tous les replays" (batch).
export default function BallchasingAutoParseToggle({
  structureId,
  disabled = false,
}: {
  structureId: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const query = useQuery({
    queryKey: ['parse-prefs', structureId],
    queryFn: () => api<{ ballchasingAutoParse: boolean }>(`/api/structures/${structureId}/parse-prefs`),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (value: boolean) =>
      api<{ ballchasingAutoParse: boolean }>(`/api/structures/${structureId}/parse-prefs`, {
        method: 'PATCH',
        body: { ballchasingAutoParse: value },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['parse-prefs', structureId], data);
      setOptimistic(null);
      toast.success(data.ballchasingAutoParse
        ? 'Parsing auto activé, les futurs replays seront analysés.'
        : 'Parsing auto désactivé, les replays peuvent être analysés à la demande.');
    },
    onError: (err) => {
      setOptimistic(null);
      toast.error((err as Error).message || 'Erreur');
    },
  });

  const current = optimistic ?? query.data?.ballchasingAutoParse ?? false;
  const isPending = query.isPending || mutation.isPending;

  const onToggle = () => {
    if (disabled || isPending) return;
    const next = !current;
    setOptimistic(next);
    mutation.mutate(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={14} style={{ color: 'var(--s-gold)' }} />
            <span className="t-sub" style={{ color: 'var(--s-text)' }}>Parsing automatique des replays</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Quand activé, chaque replay uploadé est envoyé à ballchasing.com pour
            extraire les stats détaillées (boost, mouvement, positionnement, demos).
            Compte dans le quota hebdomadaire affiché ci-dessus.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
            Désactivé : tu peux toujours lancer le parsing manuellement depuis
            chaque replay ou en batch avec le bouton « Parser tous les replays ».
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled || isPending}
          aria-pressed={current}
          className="flex-shrink-0 relative transition-all duration-150"
          style={{
            width: 44, height: 24,
            background: current ? 'var(--s-gold)' : 'var(--s-elevated)',
            border: `1px solid ${current ? 'var(--s-gold)' : 'var(--s-border)'}`,
            opacity: disabled ? 0.4 : 1,
            cursor: disabled || isPending ? 'not-allowed' : 'pointer',
          }}
        >
          <span
            className="absolute top-1/2 -translate-y-1/2 transition-all"
            style={{
              left: current ? 22 : 2,
              width: 18, height: 18,
              background: current ? '#000' : 'var(--s-text-dim)',
            }}
          />
          {isPending && (
            <Loader2 size={10} className="animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ color: current ? '#000' : 'var(--s-text-dim)' }} />
          )}
        </button>
      </div>
    </div>
  );
}
