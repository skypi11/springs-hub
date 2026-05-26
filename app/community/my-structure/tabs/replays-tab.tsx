'use client';

// Onglet REPLAYS structure (2026-05-26) — vue cross-équipes de tous les replays
// uploadés sur la structure, avec filtres équipe + event.
//
// Remplace l'ancien sous-panneau "Replays" du drawer équipe (vue 1-team only).
// L'upload reste contextuel à un event (drawer event scrim/match) — cette vue
// est read-only + actions de gestion (delete/edit/stats).

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Filter, Loader2, Users, Calendar as CalIcon, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api-client';
import { isDirigeant } from '@/lib/event-permissions';
import type { UserContext } from '@/lib/event-permissions';
import ReplayList, { type ReplayListItem } from '@/components/replays/ReplayList';
import type { TeamData } from '../types';

interface Props {
  structureId: string;
  teams: TeamData[];
  userContext: UserContext;
  currentUid: string;
}

export function ReplaysTab({ structureId, teams, userContext, currentUid }: Props) {
  const qc = useQueryClient();
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [eventFilter, setEventFilter] = useState<string>('all');

  const canDeleteAny = isDirigeant(userContext);

  // Cross-équipes : on appelle l'endpoint SANS teamId → l'API renvoie tous les
  // replays des équipes visibles par l'utilisateur (filtrées côté serveur).
  const queryKey = ['structure-replays', structureId] as const;
  const { data, isPending: loading, error: queryError } = useQuery({
    queryKey,
    queryFn: () => api<{ replays: ReplayListItem[] }>(`/api/structures/${structureId}/replays`),
    // Auto-refresh tant qu'il y a des replays en parsing ballchasing
    refetchInterval: (q) => {
      const replays = (q.state.data as { replays?: ReplayListItem[] } | undefined)?.replays ?? [];
      const hasPending = replays.some(r => r.ballchasingStatus === 'pending');
      return hasPending ? 10_000 : false;
    },
  });
  const error = queryError
    ? (queryError instanceof ApiError ? queryError.message : (queryError as Error).message || 'Erreur de chargement')
    : null;
  const allReplays = data?.replays ?? [];

  // Set des eventIds présents (pour le dropdown event)
  const eventOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of allReplays) {
      if (r.eventId && !map.has(r.eventId)) {
        // On utilise le titre du replay comme fallback de label si pas d'event titre
        map.set(r.eventId, r.title || r.filename);
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [allReplays]);

  // Filtres côté client (les données fetched sont déjà scopées sur la structure)
  const filtered = useMemo(() => {
    return allReplays.filter(r => {
      if (teamFilter !== 'all' && r.teamId !== teamFilter) return false;
      if (eventFilter === 'no_event' && r.eventId) return false;
      if (eventFilter !== 'all' && eventFilter !== 'no_event' && r.eventId !== eventFilter) return false;
      return true;
    });
  }, [allReplays, teamFilter, eventFilter]);

  // Stats compteurs
  const counts = useMemo(() => {
    const total = allReplays.length;
    const parsed = allReplays.filter(r => r.ballchasingStatus === 'uploaded').length;
    const pending = allReplays.filter(r => r.ballchasingStatus === 'pending').length;
    const withEvent = allReplays.filter(r => !!r.eventId).length;
    return { total, parsed, pending, withEvent };
  }, [allReplays]);

  function reload() {
    qc.invalidateQueries({ queryKey });
  }

  // Build des titres d'events (eventId → titre) à passer à ReplayList pour
  // afficher "Lié à l'event ..." sur chaque ligne (récupère depuis nos options).
  const eventTitlesById = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const opt of eventOptions) obj[opt.id] = opt.label;
    return obj;
  }, [eventOptions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm p-5 bevel-sm" style={{ background: 'rgba(255,85,85,0.08)', border: '1px solid rgba(255,85,85,0.3)', color: '#ff9999' }}>
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in-d2">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Film size={16} style={{ color: 'var(--s-gold)' }} />
        <h2 className="font-display text-xl tracking-wider" style={{ letterSpacing: '0.05em' }}>
          REPLAYS
        </h2>
        <span className="text-xs ml-2" style={{ color: 'var(--s-text-muted)' }}>
          Bibliothèque cross-équipes. L&apos;upload se fait depuis chaque événement (scrim/match).
        </span>
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CountCard label="Total" value={counts.total} color="var(--s-text)" />
        <CountCard label="Parsés (stats)" value={counts.parsed} color="#33ff66" />
        <CountCard label="En parsing" value={counts.pending} color="var(--s-gold)" pulse={counts.pending > 0} />
        <CountCard label="Liés à un event" value={counts.withEvent} color="var(--s-blue)" />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5" style={{ color: 'var(--s-text-muted)' }}>
          <Filter size={12} />
          <span className="text-xs uppercase tracking-wider">Filtres</span>
        </div>
        <SelectChip
          icon={Users}
          value={teamFilter}
          onChange={setTeamFilter}
          options={[
            { value: 'all', label: `Toutes les équipes (${teams.length})` },
            ...[...teams].sort((a, b) => {
              const ga = a.groupOrder ?? 0, gb = b.groupOrder ?? 0;
              if (ga !== gb) return ga - gb;
              const lc = (a.label ?? '').localeCompare(b.label ?? '');
              if (lc !== 0) return lc;
              return a.name.localeCompare(b.name);
            }).map(t => ({
              value: t.id,
              label: `${t.name}${t.label ? ` — ${t.label}` : ''}`,
            })),
          ]}
        />
        <SelectChip
          icon={CalIcon}
          value={eventFilter}
          onChange={setEventFilter}
          options={[
            { value: 'all', label: 'Tous les events' },
            { value: 'no_event', label: 'Sans event lié' },
            ...eventOptions.map(opt => ({ value: opt.id, label: opt.label.slice(0, 40) })),
          ]}
        />
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="p-10 text-center bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <Film size={24} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
          <div className="font-display text-sm tracking-wider mb-1" style={{ color: 'var(--s-text-dim)' }}>
            {allReplays.length === 0 ? 'AUCUN REPLAY' : 'RIEN À AFFICHER'}
          </div>
          <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
            {allReplays.length === 0
              ? 'Les replays uploadés depuis les events de scrim/match apparaîtront ici.'
              : 'Aucun replay ne correspond à ces filtres.'}
          </p>
          {allReplays.length === 0 && (
            <Link href="/calendar" className="inline-flex items-center gap-1.5 mt-3 text-xs"
              style={{ color: 'var(--s-gold)' }}>
              Aller au calendrier <ExternalLink size={10} />
            </Link>
          )}
        </div>
      ) : (
        <ReplayList
          structureId={structureId}
          items={filtered}
          currentUid={currentUid}
          canDeleteAny={canDeleteAny}
          canEdit={true /* Le staff de la structure peut éditer les replays — fine-grained per-team check fait côté API */}
          onChanged={reload}
          showEventLink
          eventTitlesById={eventTitlesById}
        />
      )}
    </div>
  );
}

// ─── Sous-composants locaux ───────────────────────────────────────────────

function CountCard({ label, value, color, pulse }: {
  label: string;
  value: number;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div className="bevel-sm p-3"
      style={{
        background: 'var(--s-surface)',
        border: '1px solid var(--s-border)',
      }}>
      <div className="flex items-center gap-1.5 mb-1">
        {pulse && (
          <span className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ background: color }} />
        )}
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--s-text-muted)', fontSize: '11px', letterSpacing: '0.1em' }}>
          {label}
        </span>
      </div>
      <div className="font-display text-3xl" style={{ color, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function SelectChip({
  icon: Icon, value, onChange, options,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="relative inline-flex items-center gap-1.5 bevel-sm cursor-pointer"
      style={{
        background: 'var(--s-elevated)',
        border: '1px solid var(--s-border)',
        padding: '6px 10px',
      }}>
      <Icon size={12} style={{ color: 'var(--s-text-muted)' }} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent outline-none text-sm pr-1 cursor-pointer"
        style={{ color: 'var(--s-text)', maxWidth: '240px' }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value} style={{ background: 'var(--s-surface)' }}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
