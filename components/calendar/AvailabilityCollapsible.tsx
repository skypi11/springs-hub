'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Clock, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import AvailabilityGrid, { AVAILABILITY_QUERY_KEY, type ApiResponse } from './AvailabilityGrid';

export default function AvailabilityCollapsible() {
  const { firebaseUser } = useAuth();
  const [expanded, setExpanded] = useState(false);

  // Query partagée avec AvailabilityGrid (même queryKey) — 1 seul fetch réseau
  // même si les 2 composants sont montés.
  const { data, isPending: loading } = useQuery({
    queryKey: AVAILABILITY_QUERY_KEY,
    queryFn: () => api<ApiResponse>('/api/availability/me'),
    enabled: !!firebaseUser,
  });

  const summary = data
    ? {
        today: data.today,
        currentCount: data.current.slots.length,
        nextCount: data.next.slots.length,
      }
    : null;

  const currentLabel = summary
    ? summary.currentCount === 0
      ? 'Aucun créneau coché cette semaine'
      : `${summary.currentCount} créneau${summary.currentCount > 1 ? 'x' : ''} coché${summary.currentCount > 1 ? 's' : ''} cette semaine`
    : 'Chargement…';

  const nextLabel = summary
    ? summary.nextCount === 0
      ? null
      : `${summary.nextCount} pour la suivante`
    : null;

  return (
    <section
      className="bevel animate-fade-in relative overflow-hidden"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      <div
        className="h-[3px]"
        style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.35), transparent 70%)' }}
      />
      <div
        className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.06), transparent 60%)' }}
      />
      <div className="relative z-[1]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-4 p-5 text-left transition-colors duration-150"
          style={{ cursor: 'pointer' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,184,0,0.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div
            className="w-10 h-10 flex items-center justify-center bevel-sm flex-shrink-0"
            style={{ background: 'rgba(255,184,0,0.10)', border: '1px solid rgba(255,184,0,0.30)' }}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
            ) : (
              <Clock size={16} style={{ color: 'var(--s-gold)' }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>MES DISPOS</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
              {currentLabel}
              {nextLabel && <span style={{ color: 'var(--s-text-muted)' }}> · {nextLabel}</span>}
            </p>
          </div>
          <div
            className="flex items-center gap-2 px-3 py-1.5 transition-colors duration-150 flex-shrink-0"
            style={{
              background: 'var(--s-elevated)',
              border: '1px solid var(--s-border)',
              color: 'var(--s-text-dim)',
              fontSize: '12px',
            }}
          >
            {expanded ? (
              <>
                <ChevronDown size={14} />
                <span>Réduire</span>
              </>
            ) : (
              <>
                <ChevronRight size={14} />
                <span>Modifier</span>
              </>
            )}
          </div>
        </button>

        {expanded && (
          <div className="px-5 pb-5 pt-0" style={{ borderTop: '1px solid var(--s-border)' }}>
            <div className="mt-5">
              <AvailabilityGrid />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
