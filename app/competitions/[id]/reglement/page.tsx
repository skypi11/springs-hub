'use client';

// Page publique du règlement d'une compétition (spec Legends §13bis).
// Accessible sans compte : le règlement est un document contractuel — les
// équipes l'acceptent à l'inscription, la version acceptée est tracée.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { ScrollText } from 'lucide-react';
import { apiPublic, ApiError } from '@/lib/api-client';
import GameTag from '@/components/games/GameTag';
import { Skeleton } from '@/components/ui/Skeleton';

interface RulebookResponse {
  competition: { id: string; name: string; game: string; status: string };
  rulebook: { markdown: string; version: number; updatedAt: string | null } | null;
}

export default function ReglementPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<RulebookResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiPublic<RulebookResponse>(`/api/competitions/${params.id}/rulebook`)
      .then(res => { if (!cancelled) setData(res); })
      .catch(err => {
        if (!cancelled) setNotFound(err instanceof ApiError && err.status === 404);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id]);

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto">
        <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
          Compétition introuvable.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <ScrollText size={18} style={{ color: 'var(--s-text-dim)' }} />
          <h1 className="font-display text-2xl" style={{ letterSpacing: '0.03em' }}>
            RÈGLEMENT
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
          <GameTag gameId={data.competition.game} size="sm" />
          <span>{data.competition.name}</span>
          {data.rulebook && (
            <span style={{ color: 'var(--s-text-muted)' }}>
              · version {data.rulebook.version}
              {data.rulebook.updatedAt
                ? ` du ${new Date(data.rulebook.updatedAt).toLocaleDateString('fr-FR')}`
                : ''}
            </span>
          )}
        </div>
      </div>

      <div className="divider" />

      {data.rulebook ? (
        <div className="prose-springs text-sm max-w-none">
          <ReactMarkdown>{data.rulebook.markdown}</ReactMarkdown>
        </div>
      ) : (
        <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
          Le règlement de cette compétition n&apos;est pas encore publié.
        </p>
      )}
    </div>
  );
}
