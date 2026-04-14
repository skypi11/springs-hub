'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Search, Home, Users, Trophy, Settings, Building2, Calendar,
  Swords, User as UserIcon, ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Portal from './Portal';

type StaticItem = {
  kind: 'page';
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: typeof Home;
  tint: string;
  requiresAuth?: boolean;
  requiresAdmin?: boolean;
};

type StructureItem = {
  kind: 'structure';
  id: string;
  title: string;
  subtitle: string;
  href: string;
  logoUrl: string;
  tag: string;
  memberCount: number;
};

type PlayerItem = {
  kind: 'player';
  id: string;
  title: string;
  subtitle: string;
  href: string;
  avatar: string;
  recruiting: boolean;
};

type Item = StaticItem | StructureItem | PlayerItem;

const STATIC_ITEMS: StaticItem[] = [
  { kind: 'page', id: 'home', title: 'Accueil', subtitle: 'Dashboard Springs', href: '/', icon: Home, tint: 'var(--s-violet)' },
  { kind: 'page', id: 'community', title: 'Communauté', subtitle: 'Feed, structures, joueurs', href: '/community', icon: Users, tint: 'var(--s-violet)' },
  { kind: 'page', id: 'structures', title: 'Annuaire structures', subtitle: 'Toutes les structures', href: '/community/structures', icon: Building2, tint: 'var(--s-gold)' },
  { kind: 'page', id: 'players', title: 'Annuaire joueurs', subtitle: 'Joueurs libres & recrutement', href: '/community/players', icon: UserIcon, tint: 'var(--s-violet)' },
  { kind: 'page', id: 'competitions', title: 'Compétitions', subtitle: 'Rocket League & Trackmania', href: '/competitions', icon: Trophy, tint: 'var(--s-gold)' },
  { kind: 'page', id: 'calendar', title: 'Mon calendrier', subtitle: 'Dispos, events, devoirs', href: '/calendar', icon: Calendar, tint: 'var(--s-gold)', requiresAuth: true },
  { kind: 'page', id: 'my-structure', title: 'Ma structure', subtitle: 'Dashboard fondateur', href: '/community/my-structure', icon: Building2, tint: 'var(--s-gold)', requiresAuth: true },
  { kind: 'page', id: 'settings', title: 'Mon profil', subtitle: 'Paramètres du compte', href: '/settings', icon: Settings, tint: 'var(--s-violet)', requiresAuth: true },
  { kind: 'page', id: 'admin', title: 'Panel Admin', subtitle: 'Administration Springs', href: '/admin', icon: Swords, tint: 'var(--s-gold)', requiresAdmin: true },
];

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function scoreMatch(query: string, text: string): number {
  if (!query) return 1;
  const q = normalize(query);
  const t = normalize(text);
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 50;
  // fuzzy: all letters in order
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : 0;
}

export default function CommandPalette() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [structures, setStructures] = useState<StructureItem[]>([]);
  const [players, setPlayers] = useState<PlayerItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelected(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    }
    function onOpen() { setOpen(true); }
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-command-palette', onOpen);
    };
  }, [open, close]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      try {
        const [sRes, pRes] = await Promise.all([
          fetch('/api/structures').then((r) => r.json()).catch(() => ({ structures: [] })),
          fetch('/api/players').then((r) => r.json()).catch(() => ({ players: [] })),
        ]);
        setStructures(
          (sRes.structures || []).slice(0, 50).map((s: {
            id: string; name: string; tag: string; logoUrl: string; memberCount: number;
          }) => ({
            kind: 'structure' as const,
            id: s.id,
            title: s.name,
            subtitle: `${s.tag ? `[${s.tag}] · ` : ''}${s.memberCount} membre${s.memberCount > 1 ? 's' : ''}`,
            href: `/community/structure/${s.id}`,
            logoUrl: s.logoUrl,
            tag: s.tag,
            memberCount: s.memberCount,
          })),
        );
        setPlayers(
          (pRes.players || []).slice(0, 100).map((p: {
            uid: string; displayName: string; discordAvatar: string; avatarUrl: string;
            isAvailableForRecruitment: boolean; recruitmentRole: string;
          }) => ({
            kind: 'player' as const,
            id: p.uid,
            title: p.displayName,
            subtitle: p.isAvailableForRecruitment
              ? `Disponible${p.recruitmentRole ? ` · ${p.recruitmentRole}` : ''}`
              : 'Joueur',
            href: `/profile/${p.uid}`,
            avatar: p.avatarUrl || p.discordAvatar,
            recruiting: p.isAvailableForRecruitment,
          })),
        );
        setLoaded(true);
      } catch {
        setLoaded(true);
      }
    })();
  }, [open, loaded]);

  const results = useMemo(() => {
    const visibleStatic = STATIC_ITEMS.filter((it) => {
      if (it.requiresAdmin) return isAdmin;
      if (it.requiresAuth) return !!user;
      return true;
    });

    const all: Item[] = [...visibleStatic, ...structures, ...players];

    if (!query.trim()) {
      return {
        pages: visibleStatic,
        structures: structures.slice(0, 6),
        players: players.slice(0, 6),
        flat: [...visibleStatic, ...structures.slice(0, 6), ...players.slice(0, 6)] as Item[],
      };
    }

    const scored = all
      .map((it) => ({ it, score: Math.max(scoreMatch(query, it.title), scoreMatch(query, it.subtitle) - 10) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((x) => x.it);

    const pages = scored.filter((it): it is StaticItem => it.kind === 'page');
    const structs = scored.filter((it): it is StructureItem => it.kind === 'structure');
    const plays = scored.filter((it): it is PlayerItem => it.kind === 'player');

    return {
      pages,
      structures: structs,
      players: plays,
      flat: [...pages, ...structs, ...plays],
    };
  }, [query, structures, players, user, isAdmin]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (selected >= results.flat.length && results.flat.length > 0) {
      setSelected(0);
    }
  }, [selected, results.flat.length]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const go = useCallback(
    (item: Item) => {
      router.push(item.href);
      close();
    },
    [router, close],
  );

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, Math.max(0, results.flat.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results.flat[selected];
      if (item) go(item);
    }
  }

  if (!open) return null;

  const { pages, structures: sRes, players: pRes, flat } = results;
  let idx = 0;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
        onClick={close}
      >
        <div
          className="w-full max-w-2xl bevel-sm flex flex-col"
          style={{
            background: 'var(--s-surface)',
            border: '1px solid var(--s-border)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(123,47,190,0.12)',
            maxHeight: '70vh',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <Search size={18} style={{ color: 'var(--s-text-muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Rechercher une page, une structure, un joueur…"
              className="flex-1 bg-transparent outline-none"
              style={{ color: 'var(--s-text)', fontSize: '15px' }}
            />
            <kbd
              className="font-mono hidden sm:inline"
              style={{
                fontSize: '11px',
                color: 'var(--s-text-muted)',
                background: 'var(--s-elevated)',
                border: '1px solid var(--s-border)',
                padding: '2px 6px',
              }}
            >
              Esc
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="flex-1 overflow-y-auto py-2">
            {flat.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p style={{ color: 'var(--s-text-dim)', fontSize: '14px' }}>
                  Aucun résultat pour &laquo;&nbsp;{query}&nbsp;&raquo;
                </p>
              </div>
            ) : (
              <>
                {pages.length > 0 && (
                  <div className="mb-2">
                    <div className="px-5 py-2">
                      <span className="t-label">Pages</span>
                    </div>
                    {pages.map((p) => {
                      const myIdx = idx++;
                      return (
                        <ResultRow
                          key={`p-${p.id}`}
                          idx={myIdx}
                          selected={selected === myIdx}
                          onClick={() => go(p)}
                          onHover={() => setSelected(myIdx)}
                        >
                          <div
                            className="w-9 h-9 flex items-center justify-center flex-shrink-0"
                            style={{
                              background: `color-mix(in srgb, ${p.tint} 12%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${p.tint} 28%, transparent)`,
                            }}
                          >
                            <p.icon size={16} style={{ color: p.tint }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate" style={{ color: 'var(--s-text)' }}>
                              {p.title}
                            </p>
                            <p className="text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
                              {p.subtitle}
                            </p>
                          </div>
                          <ArrowRight size={14} style={{ color: 'var(--s-text-muted)', flexShrink: 0 }} />
                        </ResultRow>
                      );
                    })}
                  </div>
                )}

                {sRes.length > 0 && (
                  <div className="mb-2">
                    <div className="px-5 py-2">
                      <span className="t-label">Structures</span>
                    </div>
                    {sRes.map((s) => {
                      const myIdx = idx++;
                      return (
                        <ResultRow
                          key={`s-${s.id}`}
                          idx={myIdx}
                          selected={selected === myIdx}
                          onClick={() => go(s)}
                          onHover={() => setSelected(myIdx)}
                        >
                          {s.logoUrl ? (
                            <Image
                              src={s.logoUrl}
                              alt={s.title}
                              width={36}
                              height={36}
                              className="flex-shrink-0 object-cover"
                              style={{ border: '1px solid var(--s-border)' }}
                            />
                          ) : (
                            <div
                              className="w-9 h-9 flex items-center justify-center flex-shrink-0 font-display"
                              style={{
                                background: 'var(--s-elevated)',
                                border: '1px solid var(--s-border)',
                                color: 'var(--s-gold)',
                                fontSize: '14px',
                              }}
                            >
                              {s.tag ? s.tag.slice(0, 2).toUpperCase() : s.title[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate" style={{ color: 'var(--s-text)' }}>
                              {s.title}
                            </p>
                            <p className="text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
                              {s.subtitle}
                            </p>
                          </div>
                          <ArrowRight size={14} style={{ color: 'var(--s-text-muted)', flexShrink: 0 }} />
                        </ResultRow>
                      );
                    })}
                  </div>
                )}

                {pRes.length > 0 && (
                  <div className="mb-2">
                    <div className="px-5 py-2">
                      <span className="t-label">Joueurs</span>
                    </div>
                    {pRes.map((p) => {
                      const myIdx = idx++;
                      return (
                        <ResultRow
                          key={`pl-${p.id}`}
                          idx={myIdx}
                          selected={selected === myIdx}
                          onClick={() => go(p)}
                          onHover={() => setSelected(myIdx)}
                        >
                          {p.avatar ? (
                            <Image
                              src={p.avatar}
                              alt={p.title}
                              width={36}
                              height={36}
                              className="flex-shrink-0 object-cover"
                              style={{ border: '1px solid var(--s-border)' }}
                            />
                          ) : (
                            <div
                              className="w-9 h-9 flex items-center justify-center flex-shrink-0 font-bold"
                              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text)' }}
                            >
                              {p.title[0]?.toUpperCase() ?? '?'}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate" style={{ color: 'var(--s-text)' }}>
                              {p.title}
                            </p>
                            <p
                              className="text-xs truncate"
                              style={{ color: p.recruiting ? 'var(--s-gold)' : 'var(--s-text-muted)' }}
                            >
                              {p.subtitle}
                            </p>
                          </div>
                          <ArrowRight size={14} style={{ color: 'var(--s-text-muted)', flexShrink: 0 }} />
                        </ResultRow>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between gap-3 px-5 py-2.5"
            style={{ borderTop: '1px solid var(--s-border)', background: 'var(--s-bg)' }}
          >
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--s-text-muted)' }}>
              <span className="flex items-center gap-1.5">
                <kbd className="font-mono" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', padding: '1px 5px', fontSize: '10px' }}>↑↓</kbd>
                naviguer
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="font-mono" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', padding: '1px 5px', fontSize: '10px' }}>↵</kbd>
                ouvrir
              </span>
            </div>
            <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Springs Hub</span>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function ResultRow({
  idx,
  selected,
  onClick,
  onHover,
  children,
}: {
  idx: number;
  selected: boolean;
  onClick: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-idx={idx}
      onClick={onClick}
      onMouseEnter={onHover}
      className="w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors duration-100"
      style={{
        background: selected ? 'rgba(123,47,190,0.14)' : 'transparent',
        borderLeft: selected ? '2px solid var(--s-violet)' : '2px solid transparent',
      }}
    >
      {children}
    </button>
  );
}
