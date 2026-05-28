'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Film, BarChart3, ExternalLink } from 'lucide-react';
import type { UserContext } from '@/lib/event-permissions';
import { isDirigeant } from '@/lib/event-permissions';
import { canUploadReplay } from '@/lib/replay-permissions';
import { api } from '@/lib/api-client';
import ReplayUploader from './ReplayUploader';
import ReplayList, { type ReplayListItem } from './ReplayList';

/**
 * Panneau complet Replays, réutilisable pour :
 *  - la modale d'un event scrim/match (mode="event")   → liste filtrée par eventId
 *  - l'onglet REPLAYS du drawer équipe (mode="library") → liste filtrée par teamId,
 *    tous les replays de l'équipe (avec ou sans event lié)
 */
export default function ReplaysPanel({
  structureId,
  teamId,
  eventId,
  mode,
  userContext,
  eventTitlesById,
}: {
  structureId: string;
  teamId: string;
  eventId?: string | null;
  mode: 'event' | 'library';
  userContext: UserContext;
  eventTitlesById?: Record<string, string>;
}) {
  const qc = useQueryClient();
  const currentUid = userContext.uid ?? '';
  const canUpload = canUploadReplay(userContext, teamId);
  const canDeleteAny = isDirigeant(userContext);

  const queryKey = ['replays', structureId, teamId, mode, eventId ?? null] as const;
  const { data, isPending: loading } = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('teamId', teamId);
      if (mode === 'event' && eventId) params.set('eventId', eventId);
      return api<{ replays: ReplayListItem[] }>(`/api/structures/${structureId}/replays?${params.toString()}`);
    },
    // Auto-refresh toutes les 10s tant qu'au moins un replay est en cours
    // de parsing ballchasing. Coupe le poll dès que tout est ready/failed
    // pour économiser les lectures Firestore.
    refetchInterval: (q) => {
      const replays = (q.state.data as { replays?: ReplayListItem[] } | undefined)?.replays ?? [];
      const hasPending = replays.some(r => r.ballchasingStatus === 'pending');
      return hasPending ? 10_000 : false;
    },
  });
  const items = data?.replays ?? [];
  const load = () => qc.invalidateQueries({ queryKey });

  // Au moins un replay parsé → on peut proposer le bouton "Voir toutes les stats du match"
  const hasAnyParsed = items.some(r => r.ballchasingStatus === 'uploaded');

  return (
    <div className="space-y-3">
      {/* Header compact : nombre de replays + actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Film size={14} style={{ color: 'var(--s-gold)' }} />
          <span className="t-label" style={{ color: 'var(--s-text)' }}>
            REPLAYS {items.length > 0 && <span style={{ color: 'var(--s-text-muted)' }}>({items.length})</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Bouton page dédiée, ouvre dans un nouvel onglet pour que le coach
              puisse consulter les stats en parallèle de la rédaction du compte-rendu */}
          {mode === 'event' && eventId && hasAnyParsed && (
            <Link
              href={`/community/event/${eventId}/stats`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-springs btn-secondary bevel-sm text-xs flex items-center gap-1.5"
              title="Ouvre les stats détaillées dans un nouvel onglet"
            >
              <BarChart3 size={12} />
              Stats du match
              <ExternalLink size={10} style={{ opacity: 0.6 }} />
            </Link>
          )}
          {canUpload && mode === 'event' && (
            <ReplayUploader
              structureId={structureId}
              teamId={teamId}
              eventId={eventId ?? null}
              onUploaded={load}
              compact
            />
          )}
        </div>
      </div>

      {/* En bibliothèque (drawer équipe), on affiche la zone d'upload large */}
      {canUpload && mode === 'library' && (
        <ReplayUploader
          structureId={structureId}
          teamId={teamId}
          eventId={null}
          onUploaded={load}
        />
      )}

      {/* Liste */}
      {loading ? (
        <p className="text-xs text-center py-4" style={{ color: 'var(--s-text-muted)' }}>
          Chargement…
        </p>
      ) : (
        <ReplayList
          structureId={structureId}
          items={items}
          currentUid={currentUid}
          canDeleteAny={canDeleteAny}
          canEdit={canUpload}
          onChanged={load}
          emptyLabel={mode === 'event' ? 'Aucun replay attaché à cet event.' : 'Aucun replay dans la bibliothèque.'}
          showEventLink={mode === 'library'}
          eventTitlesById={eventTitlesById}
        />
      )}
    </div>
  );
}
