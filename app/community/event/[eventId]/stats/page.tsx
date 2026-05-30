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

// Page dédiée, stats complètes d'un match (event). Ouverte en target="_blank"
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
    // Auto-refresh toutes les 10s tant que des replays sont encore en
    // parsing chez ballchasing. Stop dès que tout est résolu.
    refetchInterval: (q) => {
      const data = q.state.data as (AggResponse & { pendingParsingCount?: number }) | undefined;
      return data && (data.pendingParsingCount ?? 0) > 0 ? 10_000 : false;
    },
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

  // Tente de parser un score "X-Y" → couleur le bandeau victoire/défaite
  const scoreParts = meta.score?.match(/^(\d+)\s*[-–:]\s*(\d+)$/);
  const us = scoreParts ? parseInt(scoreParts[1], 10) : null;
  const them = scoreParts ? parseInt(scoreParts[2], 10) : null;
  const winState: 'win' | 'loss' | 'draw' | null = meta.result === 'win' ? 'win'
    : meta.result === 'loss' ? 'loss'
    : meta.result === 'draw' ? 'draw'
    : us != null && them != null
      ? (us > them ? 'win' : us < them ? 'loss' : 'draw')
      : null;
  const winColor = winState === 'win' ? '#33ff66' : winState === 'loss' ? '#ef4444' : 'var(--s-text-muted)';

  return (
    <div className="hex-bg min-h-screen">
      {/* Top bar sticky : retour + breadcrumb structure */}
      <div className="sticky top-0 z-30 backdrop-blur-md"
        style={{ background: 'rgba(10,10,10,0.85)', borderBottom: '1px solid var(--s-border)' }}>
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <Link href="/community/my-structure"
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
            style={{ color: 'var(--s-text-dim)' }}>
            <ArrowLeft size={12} /> Retour à ma structure
          </Link>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--s-text-muted)' }}>
            {meta.structureName && <span>{meta.structureName}</span>}
            <span style={{ opacity: 0.5 }}>·</span>
            <span className="tag tag-gold" style={{ fontSize: '12px', padding: '2px 8px' }}>{typeLabel}</span>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        {/* Header match, bandeau scoreboard style esport */}
        <header className="bevel relative overflow-hidden"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={13} style={{ color: 'var(--s-gold)' }} />
              <span className="t-label" style={{ color: 'var(--s-gold)' }}>STATS DÉTAILLÉES DU MATCH</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl mb-4" style={{ color: 'var(--s-text)' }}>{meta.title}</h1>

            {/* Scoreboard : structure vs opponent */}
            {(meta.opponent || scoreParts) && (
              <div className="bevel-sm p-4 sm:p-5 my-4 flex items-center justify-center gap-6 sm:gap-10 flex-wrap"
                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                {/* Côté nous */}
                <div className="text-right">
                  <div className="t-label" style={{ color: 'var(--s-gold)' }}>{meta.structureName || 'Nous'}</div>
                  {us != null && (
                    <div className="font-display text-5xl sm:text-6xl leading-none mt-1"
                      style={{ color: winState === 'win' ? '#33ff66' : 'var(--s-text)' }}>{us}</div>
                  )}
                </div>
                {/* VS séparateur */}
                <div className="flex flex-col items-center gap-1.5">
                  <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>VS</span>
                  {winState && (
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5"
                      style={{
                        background: `${winColor}15`,
                        color: winColor,
                        border: `1px solid ${winColor}40`,
                      }}>
                      {winState === 'win' ? 'Victoire' : winState === 'loss' ? 'Défaite' : 'Égalité'}
                    </span>
                  )}
                </div>
                {/* Côté adversaire */}
                <div className="text-left">
                  <div className="t-label" style={{ color: 'var(--s-text-dim)' }}>{meta.opponent || 'Adversaire'}</div>
                  {them != null && (
                    <div className="font-display text-5xl sm:text-6xl leading-none mt-1"
                      style={{ color: winState === 'loss' ? '#ef4444' : 'var(--s-text)' }}>{them}</div>
                  )}
                </div>
              </div>
            )}

            {/* Meta : date + lien */}
            <div className="flex items-center gap-3 text-sm flex-wrap" style={{ color: 'var(--s-text-muted)' }}>
              {dateStr && (
                <span className="flex items-center gap-1.5">
                  <CalendarIcon size={12} /> {dateStr}
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Body, stats */}
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
              </a> pour le parsing, patiente quelques secondes après l&apos;upload.
            </p>
          </div>
        )}

        {/* Bandeau : replays encore en parsing chez ballchasing, recharge auto 10s */}
        {statsQuery.data && (statsQuery.data as AggResponse & { pendingParsingCount?: number }).pendingParsingCount! > 0 && (
          <div className="p-3 bevel-sm flex items-center gap-2"
            style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.30)', color: 'var(--s-gold)' }}>
            <Loader2 size={14} className="animate-spin flex-shrink-0" />
            <span className="text-sm">
              {(statsQuery.data as AggResponse & { pendingParsingCount?: number }).pendingParsingCount} replay(s) en cours de parsing chez ballchasing, la page se recharge automatiquement.
            </span>
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
