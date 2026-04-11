'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Shield, Users, Search, Loader2, Filter } from 'lucide-react';

type StructureCard = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  games: string[];
  recruiting: { active: boolean; positions: { game: string; role: string }[] };
  memberCount: number;
};

export default function StructuresPage() {
  const [structures, setStructures] = useState<StructureCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [gameFilter, setGameFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadStructures();
  }, [gameFilter]);

  async function loadStructures() {
    setLoading(true);
    try {
      const params = gameFilter ? `?game=${gameFilter}` : '';
      const res = await fetch(`/api/structures${params}`);
      if (res.ok) {
        const data = await res.json();
        setStructures(data.structures ?? []);
      }
    } catch (err) {
      console.error('[Structures] load error:', err);
    }
    setLoading(false);
  }

  const filtered = structures.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.tag.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
      <div className="relative z-[1] space-y-8">

        {/* Header */}
        <header className="bevel relative overflow-hidden animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="absolute top-0 left-0 w-48 h-48 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 0% 0%, rgba(255,184,0,0.06), transparent 60%)' }} />
          <div className="relative z-[1] p-8">
            <div className="flex items-center gap-4 mb-2">
              <div className="w-10 h-10 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
                <Shield size={18} style={{ color: 'var(--s-gold)' }} />
              </div>
              <h1 className="font-display text-3xl tracking-wider">STRUCTURES</h1>
            </div>
            <p className="t-body ml-14" style={{ color: 'var(--s-text-dim)' }}>
              Toutes les structures actives de la communauté Springs.
            </p>
          </div>
        </header>

        {/* Filtres */}
        <div className="flex items-center gap-4 animate-fade-in-d1">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
            <input type="text" className="settings-input w-full pl-9"
              placeholder="Rechercher une structure..."
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
            <button onClick={() => setGameFilter('rocket_league')}
              className="tag transition-all duration-150"
              style={{
                background: gameFilter === 'rocket_league' ? 'rgba(0,129,255,0.12)' : 'transparent',
                color: gameFilter === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-text-muted)',
                borderColor: gameFilter === 'rocket_league' ? 'rgba(0,129,255,0.35)' : 'var(--s-border)',
                cursor: 'pointer',
              }}>
              Rocket League
            </button>
            <button onClick={() => setGameFilter('trackmania')}
              className="tag transition-all duration-150"
              style={{
                background: gameFilter === 'trackmania' ? 'rgba(0,217,54,0.12)' : 'transparent',
                color: gameFilter === 'trackmania' ? 'var(--s-green)' : 'var(--s-text-muted)',
                borderColor: gameFilter === 'trackmania' ? 'rgba(0,217,54,0.35)' : 'var(--s-border)',
                cursor: 'pointer',
              }}>
              Trackmania
            </button>
          </div>
        </div>

        {/* Liste */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bevel p-10 text-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <Shield size={28} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucune structure trouvée.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-5 animate-fade-in-d2">
            {filtered.map(s => {
              const isRecruiting = s.recruiting?.active;
              return (
                <Link key={s.id} href={`/community/structure/${s.id}`}
                  className="pillar-card bevel relative overflow-hidden group transition-all duration-200">
                  {/* Accent bar */}
                  <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${s.games.includes('rocket_league') ? 'var(--s-blue)' : 'var(--s-green)'}, transparent 70%)` }} />
                  {/* Glow */}
                  <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ background: `radial-gradient(circle at 100% 0%, ${s.games.includes('rocket_league') ? 'rgba(0,129,255,0.07)' : 'rgba(0,217,54,0.07)'}, transparent 70%)` }} />
                  <div className="relative z-[1] p-5">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 flex-shrink-0 relative overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        {s.logoUrl ? (
                          <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Shield size={18} style={{ color: 'var(--s-text-muted)' }} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-display text-base tracking-wider truncate">{s.name}</h3>
                          <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 5px', flexShrink: 0 }}>{s.tag}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {s.games.map(g => (
                            <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                              style={{ fontSize: '8px', padding: '1px 5px' }}>
                              {g === 'rocket_league' ? 'RL' : 'TM'}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Users size={11} style={{ color: 'var(--s-text-muted)' }} />
                        <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>{s.memberCount} membre{s.memberCount > 1 ? 's' : ''}</span>
                      </div>
                      {isRecruiting && (
                        <span className="tag tag-green" style={{ fontSize: '8px', padding: '1px 6px' }}>RECRUTE</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
