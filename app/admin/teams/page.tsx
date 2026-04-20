'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import AdminUserRef from '@/components/admin/AdminUserRef';
import {
  Users2, Archive, Loader2, ExternalLink, Search, AlertTriangle,
} from 'lucide-react';

type AdminTeam = {
  id: string;
  name: string;
  label: string;
  game: string;
  status: 'active' | 'archived';
  structureId: string;
  structureName: string;
  structureTag: string;
  structureLogoUrl: string;
  structureStatus: string | null;
  playerCount: number;
  subCount: number;
  staffCount: number;
  totalRoster: number;
  logoUrl: string;
  createdAt: string | null;
  archivedAt: string | null;
};

const GAME_META: Record<string, { label: string; color: string; tagClass: string }> = {
  rocket_league: { label: 'RL', color: '#0081FF', tagClass: 'tag-blue' },
  trackmania: { label: 'TM', color: '#00D936', tagClass: 'tag-green' },
};

export default function AdminTeamsPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  const [gameFilter, setGameFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [search, setSearch] = useState('');

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const params = new URLSearchParams();
      if (gameFilter) params.set('game', gameFilter);
      if (statusFilter) params.set('status', statusFilter);
      const url = `/api/admin/teams${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams ?? []);
        setTruncated(!!data.truncated);
      }
    } catch (err) {
      console.error('[Admin/Teams] load error:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin, gameFilter, statusFilter]);

  // Filtre texte côté client (on a déjà chargé la page, recherche instant sur nom/structure/tag)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.structureName.toLowerCase().includes(q) ||
      t.structureTag.toLowerCase().includes(q) ||
      t.label.toLowerCase().includes(q)
    );
  }, [teams, search]);

  // Groupe par structure pour un rendu plus lisible quand il y en a beaucoup
  const groupedByStructure = useMemo(() => {
    const map = new Map<string, { structure: { id: string; name: string; tag: string; logoUrl: string; status: string | null }; teams: AdminTeam[] }>();
    for (const t of filtered) {
      const existing = map.get(t.structureId);
      if (existing) {
        existing.teams.push(t);
      } else {
        map.set(t.structureId, {
          structure: {
            id: t.structureId,
            name: t.structureName,
            tag: t.structureTag,
            logoUrl: t.structureLogoUrl,
            status: t.structureStatus,
          },
          teams: [t],
        });
      }
    }
    return Array.from(map.values());
  }, [filtered]);

  const stats = useMemo(() => {
    const total = teams.length;
    const empty = teams.filter(t => t.totalRoster === 0).length;
    const rlCount = teams.filter(t => t.game === 'rocket_league').length;
    const tmCount = teams.filter(t => t.game === 'trackmania').length;
    return { total, empty, rlCount, tmCount };
  }, [teams]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  return (
    <>
      {/* Titre + stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          ÉQUIPES ({stats.total})
        </h2>
        {stats.empty > 0 && (
          <span className="tag tag-gold flex items-center gap-1">
            <AlertTriangle size={10} />
            {stats.empty} vide{stats.empty > 1 ? 's' : ''}
          </span>
        )}
        <span className="tag tag-blue" style={{ fontSize: '10px' }}>{stats.rlCount} RL</span>
        <span className="tag tag-green" style={{ fontSize: '10px' }}>{stats.tmCount} TM</span>
        {truncated && <span className="tag tag-gold">Résultats tronqués (max 1000)</span>}
      </div>

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap items-center">
        {/* Status */}
        <div className="flex gap-1">
          {[
            { value: 'active', label: 'Actives' },
            { value: 'archived', label: 'Archivées' },
            { value: '', label: 'Toutes' },
          ].map(f => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className="tag transition-all duration-150"
              style={{
                background: statusFilter === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                color: statusFilter === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                borderColor: statusFilter === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
                cursor: 'pointer',
                padding: '6px 14px',
                fontSize: '11px',
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="divider" style={{ width: '1px', height: '20px' }} />
        {/* Game */}
        <div className="flex gap-1">
          {[
            { value: '', label: 'Tous jeux' },
            { value: 'rocket_league', label: 'RL' },
            { value: 'trackmania', label: 'TM' },
          ].map(f => (
            <button key={f.value} onClick={() => setGameFilter(f.value)}
              className="tag transition-all duration-150"
              style={{
                background: gameFilter === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                color: gameFilter === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                borderColor: gameFilter === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
                cursor: 'pointer',
                padding: '6px 14px',
                fontSize: '11px',
              }}>
              {f.label}
            </button>
          ))}
        </div>
        {/* Recherche */}
        <div className="flex-1 min-w-[200px] relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
          <input
            type="text"
            placeholder="Rechercher équipe, structure, tag, label…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="settings-input w-full"
            style={{ paddingLeft: '32px', fontSize: '12px' }}
          />
        </div>
      </div>

      {/* Liste groupée par structure */}
      <div className="space-y-4">
        {filtered.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>
              Aucune équipe trouvée avec ces filtres.
            </p>
          </div>
        )}

        {groupedByStructure.map(({ structure, teams: structTeams }) => (
          <div key={structure.id} className="panel">
            <div className="panel-header flex items-center justify-between">
              <div className="flex items-center gap-3">
                {structure.logoUrl ? (
                  <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                    <Image src={structure.logoUrl} alt={structure.name} fill className="object-contain" unoptimized />
                  </div>
                ) : (
                  <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                    <Users2 size={12} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/community/structure/${structure.id}`}
                      className="font-display text-base hover:underline"
                      style={{ color: 'var(--s-violet-light)' }}>
                      {structure.name}
                    </Link>
                    {structure.tag && (
                      <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>
                        {structure.tag}
                      </span>
                    )}
                    {structure.status && structure.status !== 'active' && (
                      <span className="tag" style={{ fontSize: '9px', padding: '1px 6px', background: 'rgba(255,136,0,0.1)', color: '#ff8800', borderColor: 'rgba(255,136,0,0.3)' }}>
                        {structure.status}
                      </span>
                    )}
                  </div>
                  <AdminUserRef uid={structure.id} kind="structure" layout="inline" />
                </div>
              </div>
              <span className="tag tag-neutral" style={{ fontSize: '10px' }}>
                {structTeams.length} équipe{structTeams.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="panel-body">
              <div className="divider mb-3" />
              <div className="space-y-2">
                {structTeams.map(team => {
                  const gameMeta = GAME_META[team.game];
                  const isEmpty = team.totalRoster === 0;
                  return (
                    <div key={team.id}
                      className="flex items-center gap-3 px-3 py-2"
                      style={{
                        background: 'var(--s-elevated)',
                        border: '1px solid var(--s-border)',
                      }}>
                      {/* Logo équipe */}
                      {team.logoUrl ? (
                        <div className="w-7 h-7 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-bg)' }}>
                          <Image src={team.logoUrl} alt={team.name} fill className="object-contain" unoptimized />
                        </div>
                      ) : (
                        <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-bg)' }}>
                          <Users2 size={12} style={{ color: 'var(--s-text-muted)' }} />
                        </div>
                      )}
                      {/* Nom + label */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold truncate">{team.name}</span>
                          {gameMeta && (
                            <span className={`tag ${gameMeta.tagClass}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                              {gameMeta.label}
                            </span>
                          )}
                          {team.status === 'archived' && (
                            <span className="tag tag-neutral flex items-center gap-1" style={{ fontSize: '9px', padding: '1px 5px' }}>
                              <Archive size={8} />
                              archivée
                            </span>
                          )}
                          {team.label && (
                            <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                              [{team.label}]
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Compteurs roster */}
                      <div className="flex items-center gap-4 text-xs">
                        <span title="Titulaires" style={{ color: 'var(--s-text)' }}>
                          {team.playerCount} <span style={{ color: 'var(--s-text-muted)' }}>tit.</span>
                        </span>
                        <span title="Remplaçants" style={{ color: 'var(--s-text-dim)' }}>
                          {team.subCount} <span style={{ color: 'var(--s-text-muted)' }}>rem.</span>
                        </span>
                        <span title="Staff" style={{ color: 'var(--s-text-dim)' }}>
                          {team.staffCount} <span style={{ color: 'var(--s-text-muted)' }}>staff</span>
                        </span>
                        {isEmpty && (
                          <span className="tag tag-gold flex items-center gap-1" style={{ fontSize: '9px', padding: '1px 5px' }}>
                            <AlertTriangle size={8} />
                            vide
                          </span>
                        )}
                      </div>
                      {/* Lien vers la structure pour voir le détail */}
                      <Link
                        href={`/community/structure/${team.structureId}`}
                        className="flex items-center gap-1 text-xs hover:underline"
                        style={{ color: 'var(--s-violet-light)' }}
                        title="Voir la structure">
                        <ExternalLink size={11} />
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
