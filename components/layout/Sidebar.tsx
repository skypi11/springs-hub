'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Home, Users, Trophy, Settings, LogIn, LogOut, ChevronRight, Swords } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const navItems = [
  { href: '/', icon: Home, label: 'Accueil' },
  { href: '/community', icon: Users, label: 'Communauté' },
  { href: '/competitions', icon: Trophy, label: 'Compétitions' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isAdmin, loading, signInWithDiscord, signOut } = useAuth();

  return (
    <aside className="fixed left-0 top-0 h-screen w-[260px] flex flex-col z-50"
      style={{
        background: 'linear-gradient(180deg, #0a0a1a 0%, #08081500 100%), #09091a',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}>

      {/* Logo */}
      <div className="px-6 py-6 flex items-center gap-3">
        <div className="relative">
          <Image
            src="/springs-logo.png"
            alt="Springs E-Sport"
            width={120}
            height={36}
            className="object-contain"
            priority
          />
        </div>
      </div>

      {/* Separator */}
      <div className="mx-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)' }} />

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(160,160,192,0.5)' }}>
            Navigation
          </span>
        </div>

        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl group transition-all duration-200 relative"
              style={{
                background: active
                  ? 'linear-gradient(135deg, rgba(123,47,190,0.25), rgba(123,47,190,0.1))'
                  : 'transparent',
                color: active ? '#f0f0f8' : 'rgba(160,160,192,0.8)',
                boxShadow: active ? '0 0 20px rgba(123,47,190,0.15), inset 0 0 20px rgba(123,47,190,0.05)' : 'none',
                border: active ? '1px solid rgba(123,47,190,0.3)' : '1px solid transparent',
              }}
            >
              {/* Active left bar */}
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full"
                  style={{ background: 'linear-gradient(180deg, #7B2FBE, #FFB800)' }} />
              )}
              <Icon
                size={18}
                style={{ color: active ? '#9d4fe0' : 'rgba(160,160,192,0.6)' }}
                className="flex-shrink-0 transition-colors duration-200 group-hover:text-purple-400"
              />
              <span className="font-medium text-sm">{label}</span>
              {active && (
                <ChevronRight size={14} className="ml-auto opacity-50" style={{ color: '#9d4fe0' }} />
              )}
            </Link>
          );
        })}

        {/* Admin section */}
        {isAdmin && (
          <>
            <div className="px-3 py-2 mt-4">
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,184,0,0.5)' }}>
                Admin Springs
              </span>
            </div>
            <Link
              href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl group transition-all duration-200"
              style={{
                background: pathname.startsWith('/admin')
                  ? 'linear-gradient(135deg, rgba(255,184,0,0.15), rgba(255,184,0,0.05))'
                  : 'transparent',
                color: pathname.startsWith('/admin') ? '#FFB800' : 'rgba(160,160,192,0.8)',
                border: pathname.startsWith('/admin') ? '1px solid rgba(255,184,0,0.25)' : '1px solid transparent',
              }}
            >
              <Swords size={18} className="flex-shrink-0" />
              <span className="font-medium text-sm">Panel Admin</span>
            </Link>
          </>
        )}
      </nav>

      {/* Bottom: user */}
      <div className="p-4">
        <div className="h-px mb-4" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }} />

        {loading ? (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-9 h-9 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.07)', width: '70%' }} />
              <div className="h-2 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.05)', width: '50%' }} />
            </div>
          </div>
        ) : user ? (
          <div className="group">
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {user.discordAvatar ? (
                <Image
                  src={user.discordAvatar}
                  alt={user.displayName}
                  width={36}
                  height={36}
                  className="rounded-full flex-shrink-0"
                  style={{ border: '2px solid rgba(255,255,255,0.15)' }}
                />
              ) : (
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                  style={{ background: 'linear-gradient(135deg, #7B2FBE, #FFB800)', color: '#fff' }}>
                  {user.displayName?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: '#f0f0f8' }}>
                  {user.displayName}
                </p>
                <p className="text-xs truncate" style={{ color: 'rgba(160,160,192,0.6)' }}>
                  {isAdmin ? '⚡ Admin Springs' : user.isFan ? '🎮 Fan' : '🎮 Joueur'}
                </p>
              </div>
              <button
                onClick={signOut}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-500/10"
                title="Déconnexion"
              >
                <LogOut size={14} style={{ color: 'rgba(239,68,68,0.7)' }} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={signInWithDiscord}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #5865F2, #4752c4)',
              color: '#fff',
              boxShadow: '0 4px 20px rgba(88,101,242,0.35)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.079.11 18.1.128 18.114c2.052 1.5 4.044 2.414 5.993 3.016a.077.077 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.6 3.95-1.505 6.002-3.016a.077.077 0 0 0 .032-.027c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            Connexion Discord
          </button>
        )}
      </div>
    </aside>
  );
}
