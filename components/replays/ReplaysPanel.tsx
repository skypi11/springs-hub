'use client';

import { useCallback, useEffect, useState } from 'react';
import { Film } from 'lucide-react';
import { auth } from '@/lib/firebase';
import type { UserContext } from '@/lib/event-permissions';
import { isDirigeant } from '@/lib/event-permissions';
import { canUploadReplay } from '@/lib/replay-permissions';
import ReplayUploader from './ReplayUploader';
import ReplayList, { type ReplayListItem } from './ReplayList';

/**
 * Panneau complet Replays — réutilisable pour :
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
  const [items, setItems] = useState<ReplayListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const currentUid = userContext.uid ?? '';
  const canUpload = canUploadReplay(userContext, teamId);
  const canDeleteAny = isDirigeant(userContext);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) { setLoading(false); return; }
      const params = new URLSearchParams();
      params.set('teamId', teamId);
      if (mode === 'event' && eventId) params.set('eventId', eventId);
      const res = await fetch(`/api/structures/${structureId}/replays?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems((data.replays ?? []) as ReplayListItem[]);
    } catch {
      // silent — toast sera déclenché sur les actions explicites
    } finally {
      setLoading(false);
    }
  }, [structureId, teamId, eventId, mode]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      {/* Header compact : nombre de replays */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Film size={14} style={{ color: 'var(--s-gold)' }} />
          <span className="t-label" style={{ color: 'var(--s-text)' }}>
            REPLAYS {items.length > 0 && <span style={{ color: 'var(--s-text-muted)' }}>({items.length})</span>}
          </span>
        </div>
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
