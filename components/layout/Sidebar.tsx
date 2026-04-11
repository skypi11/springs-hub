'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Home, Users, Trophy, LogIn, LogOut, Swords } from 'lucide-react';
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
      style={{ background: 'var(--s-surface)', borderRight: '1px solid var(--s-border)' }}>

      {/* Logo */}
      <div className="px-6 py-5 flex items-center gap-3">
        <Image src="/springs-logo.png" alt="Springs E-Sport" width={120} height={36} className="object-contain" priority />
      </div>

      {/* Separator */}
      <div className="mx-4 divider" />

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <div className="px-3 py-2">
          <span className="t-label" style={{ fontSize: '10px' }}>Navigation</span>
        </div>

        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link key={href} href={href}
              className="flex items-center gap-3 px-3 py-2.5 relative transition-colors duration-150"
              style={{
                borderRadius: 'var(--s-radius)',
                background: active ? 'rgba(123,47,190,0.1)' : 'transparent',
                color: active ? 'var(--s-text)' : 'var(--s-text-dim)',
                border: active ? '1px solid rgba(123,47,190,0.2)' : '1px solid transparent',
              }}>
              {active && <div className="nav-active-bar" />}
              <Icon size={17} style={{ color: active ? '#a364d9' : 'var(--s-text-muted)', flexShrink: 0 }} />
              <span className="font-medium text-sm">{label}</span>
            </Link>
          );
        })}

        {/* Admin */}
        {isAdmin && (
          <>
            <div className="px-3 py-2 mt-4">
              <span className="t-label" style={{ fontSize: '10px', color: 'var(--s-gold)' }}>Admin</span>
            </div>
            <Link href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-150"
              style={{
                borderRadius: 'var(--s-radius)',
                background: pathname.startsWith('/admin') ? 'rgba(255,184,0,0.08)' : 'transparent',
                color: pathname.startsWith('/admin') ? 'var(--s-gold)' : 'var(--s-text-dim)',
                border: pathname.startsWith('/admin') ? '1px solid rgba(255,184,0,0.2)' : '1px solid transparent',
              }}>
              <Swords size={17} style={{ flexShrink: 0 }} />
              <span className="font-medium text-sm">Panel Admin</span>
            </Link>
          </>
        )}
      </nav>

      {/* Bottom: user */}
      <div className="p-4">
        <div className="divider mb-4" />

        {loading ? (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full" style={{ background: 'var(--s-elevated)' }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 rounded-sm" style={{ background: 'var(--s-elevated)', width: '70%' }} />
              <div className="h-2 rounded-sm" style={{ background: 'var(--s-border)', width: '50%' }} />
            </div>
          </div>
        ) : user ? (
          <div className="group">
            <div className="flex items-center gap-3 px-3 py-2.5 transition-colors"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)' }}>
              {user.discordAvatar ? (
                <Image src={user.discordAvatar} alt={user.displayName} width={32} height={32}
                  className="flex-shrink-0" style={{ borderRadius: 'var(--s-radius)', border: '1px solid var(--s-border)' }} />
              ) : (
                <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 text-sm font-bold"
                  style={{ background: 'var(--s-violet)', color: '#fff', borderRadius: 'var(--s-radius)' }}>
                  {user.displayName?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>
                  {user.displayName}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
                  {isAdmin ? 'Admin Springs' : 'Joueur'}
                </p>
              </div>
              <button onClick={signOut}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-sm"
                style={{ color: '#ef4444' }} title="Déconnexion">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button onClick={signInWithDiscord}
            className="btn-springs w-full justify-center"
            style={{ background: '#5865F2', color: '#fff', borderColor: '#5865F2' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.079.11 18.1.128 18.114c2.052 1.5 4.044 2.414 5.993 3.016a.077.077 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.6 3.95-1.505 6.002-3.016a.077.077 0 0 0 .032-.027c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            Connexion Discord
          </button>
        )}
      </div>
    </aside>
  );
}
