'use client';

/**
 * useEventMutations — Hook qui regroupe les 3 mutations sur events :
 * respond (toggle ma présence), status (terminate/reopen/cancel) et delete.
 *
 * Extrait de CalendarSection.tsx (Phase 3.3 refonte technique 29/05).
 *
 * Encapsule :
 * - 3 useMutation React Query (pas exposés, on retourne juste les wrappers
 *   ergonomiques pour le call site)
 * - Toast success/error sur chaque action (uniformément via useToast)
 * - Dialog de confirmation natif Aedral via useConfirm pour DELETE (action
 *   irréversible, blocage utilisateur explicite)
 * - Callback invalidateEvents pour re-fetch après chaque write réussi
 * - Callback onDeleted optionnel (typiquement pour fermer la modal de détail
 *   quand l'event affiché vient d'être supprimé)
 *
 * Le hook ne prend PAS useAuth en dépendance : le structureId vient du composant
 * appelant, qui sait dans quelle structure on est.
 */

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import type { PresenceStatus } from '@/lib/event-permissions';

export type EventStatusAction = 'terminate' | 'reopen' | 'cancel';

export interface UseEventMutationsParams {
  structureId: string;
  /** Re-fetch les events après chaque write réussi. Typiquement
   *  `invalidateEvents` retourné par useCalendarEvents. */
  invalidateEvents: () => void;
  /** Optionnel : callback déclenché après une suppression réussie.
   *  Sert généralement à fermer la modal de détail (setOpenEventId(null)). */
  onDeleted?: () => void;
}

export interface UseEventMutationsReturn {
  handleRespond: (eventId: string, status: PresenceStatus) => void;
  handleStatusAction: (eventId: string, action: EventStatusAction) => void;
  /** Promise qui resolve quand la confirmation est traitée. Le delete réel
   *  est lancé en background (mutation fire-and-forget après confirm OK). */
  handleDelete: (eventId: string, title: string) => Promise<void>;
}

export function useEventMutations({
  structureId,
  invalidateEvents,
  onDeleted,
}: UseEventMutationsParams): UseEventMutationsReturn {
  const toast = useToast();
  const confirm = useConfirm();

  const respondMutation = useMutation({
    mutationFn: ({ eventId, status }: { eventId: string; status: PresenceStatus }) =>
      api(`/api/structures/${structureId}/events/${eventId}/presence`, {
        method: 'POST',
        body: { status },
      }),
    onSuccess: () => {
      toast.success('Réponse enregistrée');
      invalidateEvents();
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ eventId, action }: { eventId: string; action: EventStatusAction }) =>
      api(`/api/structures/${structureId}/events/${eventId}/status`, {
        method: 'POST',
        body: { action },
      }),
    onSuccess: () => {
      toast.success('OK');
      invalidateEvents();
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) =>
      api(`/api/structures/${structureId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Événement supprimé');
      onDeleted?.();
      invalidateEvents();
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });

  const handleRespond = (eventId: string, status: PresenceStatus) =>
    respondMutation.mutate({ eventId, status });

  const handleStatusAction = (eventId: string, action: EventStatusAction) =>
    statusMutation.mutate({ eventId, action });

  const handleDelete = async (eventId: string, title: string) => {
    const ok = await confirm({
      title: 'Supprimer cet événement ?',
      message: `"${title}" sera supprimé avec toutes les présences. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    deleteMutation.mutate(eventId);
  };

  return { handleRespond, handleStatusAction, handleDelete };
}
