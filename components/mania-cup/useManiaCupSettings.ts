'use client';

import { useQuery } from '@tanstack/react-query';
import { apiPublic } from '@/lib/api-client';
import { DEFAULT_SETTINGS, type ManiaCupSettings } from '@/lib/mania-cup-settings';

// Réglages de l'événement côté client (tarifs, jauge, liens de billetterie).
//
// Renvoie toujours un objet exploitable : tant que la requête n'a pas répondu,
// ce sont les valeurs par défaut. Une page publique ne doit jamais afficher un
// tarif vide ou « NaN € » le temps d'un chargement.
export function useManiaCupSettings(): ManiaCupSettings {
  const { data } = useQuery({
    queryKey: ['mania-cup', 'settings'] as const,
    queryFn: () => apiPublic<{ settings: ManiaCupSettings }>('/api/mania-cup/settings'),
    staleTime: 60_000,
  });
  return data?.settings ?? DEFAULT_SETTINGS;
}
