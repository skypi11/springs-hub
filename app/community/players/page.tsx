'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { User, Search, Loader2, Filter, Gamepad2, Trophy } from 'lucide-react';

type PlayerCard = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
  games: string[];
  isAvailableForRecruitment: boolean;
  recruitmentRole: string;
  recruitmentMessage: string;
  rlRank: string;
  rlMmr: number | null;
  rlIconUrl: string;
  pseudoTM: string;
  tmTrophies: number | null;
  tmEchelon: number | null;
  structurePerGame: Record<string, string>;
};

const ROLE_LABELS: Record<string, string> = {
  joueur: 'Joueur',
  coach: 'Coach',
  manager: 'Manager',
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [gameFilter, setGameFilter] = useState('');
  const [recruitingFilter, setRecruitingFilter] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadPlayers();
  }, [gameFilter, recruitingFilter]);

  async function loadPlayers() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (gameFilter) params.set('game', gameFilter);
      if (recruitingFilter) params.set('recruiting', 'true');
      const res = await fetch(`/api/players?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.players ?? []);
      }
    } catch (err) {
      console.error('[Players] load error:', err);
    }
    setLoading(false);
  }

  const filtered = players.filter(p =>
    !search || p.displayName.toLowerCase().includes(search.toLowerCase()) || (p.pseudoTM && p.pseudoTM.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
      <div className="relative z-[1] space-y-8">

        {/* Header */}
        <header className="bevel relative overflow-hidden animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-blue), rgba(0,129,255,0.3), transparent 70%)' }} />
          <div className="absolute top-0 left-0 w-48 h-48 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 0% 0%, rgba(0,129,255,0.06), transparent 60%)' }} />
          <div className="relative z-[1] p-8">
            <div className="flex items-center gap-4 mb-2">
              <div className="w-10 h-10 flex items-center justify-center" style={{ background: 'rgba(0,129,255,0.08)', border: '1px solid rgba(0,129,255,0.2)' }}>
                <User size={18} style={{ color: 'var(--s-blue)' }} />
              </div>
              <h1 className="font-display text-3xl tracking-wider">JOUEURS</h1>
            </div>
            <p className="t-body ml-14" style={{ color: 'var(--s-text-dim)' }}>
              Tous les joueurs inscrits sur Springs Hub.
            </p>
          </div>
        </header>

        {/* Filtres */}
        <div className="flex items-center gap-4 flex-wrap animate-fade-in-d1">
          <div className="flex-1 relative" style={{ minWidth: '200px' }}>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
            <input type="text" className="settings-input w-full pl-9"
              placeholder="Rechercher un joueur..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={13} style={{ color: 'var(--s-text-muted)' }} />
            <button onClick={() => setGameFilter('')}
              className="tag transition-all duration-150"
              style={{
                background: !gameFilter ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: !gameFilter ? 'var(--s-text)' : 'var(--s-text-muted)',
                borderColor: !gameFilter ? 'rgba(255,255,255,0.2)' : 'var(--s-border)',
                cursor: 'pointer',
              }}>
              Tous
            </button>
            <button onClick={() => setGameFilter(gameFilter === 'rocket_league' ? '' : 'rocket_league')}
              className="tag transition-all duration-150"
              style={{
                background: gameFilter === 'rocket_league' ? 'rgba(0,129,255,0.12)' : 'transparent',
                color: gameFilter === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-text-muted)',
                borderColor: gameFilter === 'rocket_league' ? 'rgba(0,129,255,0.35)' : 'var(--s-border)',
                cursor: 'pointer',
              }}>
              RL
            </button>
            <button onClick={() => setGameFilter(gameFilter === 'trackmania' ? '' : 'trackmania')}
              className="tag transition-all duration-150"
              style={{
                background: gameFilter === 'trackmania' ? 'rgba(0,217,54,0.12)' : 'transparent',
                color: gameFilter === 'trackmania' ? 'var(--s-green)' : 'var(--s-text-muted)',
                borderColor: gameFilter === 'trackmania' ? 'rgba(0,217,54,0.35)' : 'var(--s-border)',
                cursor: 'pointer',
              }}>
              TM
            </button>
          </div>
          <button onClick={() => setRecruitingFilter(!recruitingFilter)}
            className="tag transition-all duration-150"
            style={{
              background: recruitingFilter ? 'rgba(0,217,54,0.12)' : 'transparent',
              color: recruitingFilter ? '#33ff66' : 'var(--s-text-muted)',
              borderColor: recruitingFilter ? 'rgba(0,217,54,0.35)' : 'var(--s-border)',
              cursor: 'pointer',
            }}>
            <Search size={10} style={{ marginRight: '4px' }} />
            Disponibles
          </button>
        </div>

        {/* Liste */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bevel p-10 text-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <User size={28} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucun joueur trouvé.</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4 animate-fade-in-d2">
            {filtered.map(p => {
              const avatar = p.avatarUrl || p.discordAvatar;
              return (
                <Link key={p.uid} href={`/profile/${p.uid}`}
                  className="pillar-card bevel-sm relative overflow-hidden group transition-all duration-200">
                  <div className="relative z-[1] p-4">
                    <div className="flex items-center gap-3 mb-3">
                      {avatar ? (
                        <div className="w-10 h-10 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <Image src={avatar} alt={p.displayName} fill className="object-cover" unoptimized />
                        </div>
                      ) : (
                        <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <User size={16} style={{ color: 'var(--s-text-muted)' }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{p.displayName}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {p.country && (
                            <Image src={`https://flagcdn.com/16x12/${p.country.toLowerCase()}.png`}
                              alt={p.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                          )}
                          <div className="flex gap-1">
                            {p.games.map(g => (
                              <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                                style={{ fontSize: '7px', padding: '0px 4px' }}>
                                {g === 'rocket_league' ? 'RL' : 'TM'}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Stats résumées */}
                    <div className="space-y-1.5">
                      {p.rlRank && (
                        <div className="flex items-center gap-2">
                          {p.rlIconUrl && <Image src={p.rlIconUrl} alt="" width={14} height={14} unoptimized />}
                          <span className="text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>{p.rlRank}</span>
                        </div>
                      )}
                      {p.pseudoTM && (
                        <div className="flex items-center gap-2">
                          <Gamepad2 size={11} style={{ color: 'var(--s-green)' }} />
                          <span className="text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>{p.pseudoTM}</span>
                        </div>
                      )}
                    </div>

                    {/* Badge recrutement */}
                    {p.isAvailableForRecruitment && (
                      <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid var(--s-border)' }}>
                        <div className="flex items-center gap-1.5">
                          <Search size={10} style={{ color: '#33ff66' }} />
                          <span className="text-xs font-bold" style={{ color: '#33ff66' }}>
                            Cherche {ROLE_LABELS[p.recruitmentRole] || 'équipe'}
                          </span>
                        </div>
                        {p.recruitmentMessage && (
                          <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--s-text-muted)' }}>
                            {p.recruitmentMessage}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Compteur */}
        {!loading && (
          <p className="t-mono text-xs text-center" style={{ color: 'var(--s-text-muted)' }}>
            {filtered.length} joueur{filtered.length > 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
