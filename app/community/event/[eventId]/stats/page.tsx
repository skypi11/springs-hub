'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Calendar as CalendarIcon, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { ReplayCard, AggregatedSection, type AggResponse } from '@/components/replays/ReplayStatsDrawer';

interface EventMeta {
  eventId: string;
  structureId: string;
  structureName: string;
  title: string;
  type: string;
  startsAt: string | null;
  endsAt: string | null;
  opponent: string | null;
  result: string | null;
  score: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

// Page dédiée — stats complètes d'un match (event). Ouverte en target="_blank"
// depuis la modal event pour que le coach puisse consulter les stats en
// parallèle de la rédaction du compte-rendu.
export default function EventStatsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);

  const metaQuery = useQuery({
    queryKey: ['event-meta', eventId],
    queryFn: () => api<EventMeta>(`/api/events/${eventId}/meta`),
  });

  const statsQuery = useQuery({
    queryKey: ['event-stats-agg', eventId, metaQuery.data?.structureId],
    queryFn: () => api<AggResponse>(`/api/structures/${metaQuery.data!.structureId}/events/${eventId}/replay-stats-agg`),
    enabled: !!metaQuery.data?.structureId,
  });

  if (metaQuery.isPending) {
    return (
      <div className="px-6 py-12 flex items-center justify-center gap-3" style={{ color: 'var(--s-text-muted)' }}>
        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
        <span>Chargement du match…</span>
      </div>
    );
  }

  if (metaQuery.error) {
    const status = metaQuery.error instanceof ApiError ? metaQuery.error.status : 0;
    return (
      <div className="px-6 py-12 max-w-xl mx-auto">
        <div className="flex items-start gap-3 p-4 bevel-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.30)', color: '#ef4444' }}>
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {status === 401 ? 'Connecte-toi pour accéder à ces stats.' :
                status === 403 ? "Tu n'as pas accès à ce match." :
                  status === 404 ? 'Événement introuvable.' : 'Erreur de chargement.'}
            </p>
            <Link href="/community/my-structure" className="text-xs underline mt-1 inline-block">
              Retour
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const meta = metaQuery.data!;
  const dateStr = formatDate(meta.startsAt);
  const typeLabel = ({ scrim: 'SCRIM', match: 'MATCH', training: 'ENTRAÎNEMENT', tournoi: 'TOURNOI' } as Record<string, string>)[meta.type] || meta.type.toUpperCase();

  return (
    <div className="hex-bg min-h-screen">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">

        {/* Top bar : retour + lien externe vers la structure */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link href="/community/my-structure"
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
            style={{ color: 'var(--s-text-dim)' }}>
            <ArrowLeft size={12} /> Ma structure
          </Link>
          {meta.structureName && (
            <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              {meta.structureName}
            </span>
          )}
        </div>

        {/* Header match */}
        <header className="bevel relative overflow-hidden"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="p-5">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="tag tag-gold" style={{ fontSize: '11px', padding: '2px 8px' }}>{typeLabel}</span>
              <BarChart3 size={14} style={{ color: 'var(--s-gold)' }} />
              <span className="t-label" style={{ color: 'var(--s-gold)' }}>STATS DÉTAILLÉES</span>
            </div>
            <h1 className="font-display text-3xl" style={{ color: 'var(--s-text)' }}>{meta.title}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm flex-wrap" style={{ color: 'var(--s-text-muted)' }}>
              {dateStr && (
                <span className="flex items-center gap-1.5">
                  <CalendarIcon size={12} /> {dateStr}
                </span>
              )}
              {meta.opponent && (<>
                <span>·</span>
                <span>vs <strong style={{ color: 'var(--s-text)' }}>{meta.opponent}</strong></span>
              </>)}
              {meta.score && (<>
                <span>·</span>
                <span className="t-mono">{meta.score}</span>
              </>)}
            </div>
          </div>
        </header>

        {/* Body — stats */}
        {statsQuery.isPending && (
          <div className="flex items-center gap-3 p-6 bevel-sm justify-center"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
            <span>Chargement des stats…</span>
          </div>
        )}

        {statsQuery.error && (
          <div className="p-4 bevel-sm flex items-start gap-2"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.30)', color: '#ef4444' }}>
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span className="text-sm">{(statsQuery.error as Error).message || 'Erreur de chargement des stats'}</span>
          </div>
        )}

        {statsQuery.data && statsQuery.data.parsedCount === 0 && (
          <div className="p-6 bevel-sm text-center"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
            <p className="text-sm">Aucun replay parsé pour ce match.</p>
            <p className="text-xs mt-2">
              Les replays sont envoyés à <a href="https://ballchasing.com" target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--s-blue)' }}>
                ballchasing.com <ExternalLink size={10} className="inline" />
              </a> pour le parsing — patiente quelques secondes après l&apos;upload.
            </p>
          </div>
        )}

        {statsQuery.data && statsQuery.data.parsedCount > 0 && (
          <>
            {/* Empile chaque replay parsé */}
            {statsQuery.data.replays.map((r, idx) => (
              <ReplayCard
                key={r.replayId}
                index={idx + 1}
                total={statsQuery.data!.replays.length}
                title={r.title}
                stats={r.stats}
                focused={false}
              />
            ))}
            {/* Moyenne du match (toujours affichée sur la page dédiée, même si 1 seul replay) */}
            {statsQuery.data.parsedCount >= 2 && (
              <AggregatedSection aggregated={statsQuery.data} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
