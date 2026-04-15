'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, Users, Trophy, LogOut, Swords, Settings, Building2, Calendar, Search, Menu, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import NotificationsBell from '@/components/ui/NotificationsBell';
import DevSwitcher from '@/components/dev/DevSwitcher';

const navItems = [
  { href: '/', icon: Home, label: 'Accueil' },
  { href: '/community', icon: Users, label: 'Communauté' },
  { href: '/competitions', icon: Trophy, label: 'Compétitions' },
  { href: '/settings', icon: Settings, label: 'Mon profil' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isAdmin, loading, signInWithDiscord, signOut } = useAuth();
  const [isMac, setIsMac] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    }
  }, []);

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  function openPalette() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    }
  }

  return (
    <>
      {/* Mobile hamburger — visible <lg */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Ouvrir le menu"
        className="lg:hidden fixed top-3 left-3 z-[60] w-11 h-11 flex items-center justify-center bevel-sm transition-colors duration-150"
        style={{
          background: 'var(--s-surface)',
          border: '1px solid var(--s-border)',
          color: 'var(--s-text)',
          boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
        }}
      >
        <Menu size={20} />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[55] animate-fade-in"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-screen w-[260px] flex flex-col z-[56] lg:z-50 transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          background: 'var(--s-surface)',
          borderRight: '1px solid var(--s-border)',
        }}
        data-mobile-open={mobileOpen ? 'true' : 'false'}
      >

      {/* Logo + close button (mobile only) */}
      <div className="px-6 py-5 flex items-center justify-between">
        <Image src="/springs-logo.png" alt="Springs E-Sport" width={120} height={36} className="object-contain" priority />
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
          className="lg:hidden w-9 h-9 flex items-center justify-center bevel-sm transition-colors duration-150"
          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}
        >
          <X size={18} />
        </button>
      </div>

      <div className="mx-5 divider" />

      {/* Command palette trigger */}
      <div className="px-5 pt-4 pb-1">
        <button
          onClick={openPalette}
          className="w-full flex items-center gap-2.5 px-3 py-2 transition-colors duration-150 group"
          style={{
            background: 'var(--s-elevated)',
            border: '1px solid var(--s-border)',
            color: 'var(--s-text-muted)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--s-hover)';
            e.currentTarget.style.borderColor = 'rgba(123,47,190,0.35)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--s-elevated)';
            e.currentTarget.style.borderColor = 'var(--s-border)';
          }}
        >
          <Search size={14} style={{ flexShrink: 0 }} />
          <span className="flex-1 text-left text-sm">Rechercher…</span>
          <kbd
            className="font-mono"
            style={{
              fontSize: '10px',
              background: 'var(--s-bg)',
              border: '1px solid var(--s-border)',
              padding: '1px 5px',
              color: 'var(--s-text-dim)',
            }}
          >
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2">
          <span className="t-label">Navigation</span>
        </div>

        {navItems.map(({ href, icon: Icon, label }) => {
          // /community/my-structure a sa propre entrée — ne pas l'inclure dans "Communauté"
          const active = href === '/'
            ? pathname === '/'
            : href === '/community'
              ? pathname.startsWith('/community') && !pathname.startsWith('/community/my-structure')
              : pathname.startsWith(href);
          return (
            <Link key={href} href={href}
              className="flex items-center gap-3 px-3 py-2.5 relative transition-all duration-150"
              style={{
                background: active ? 'rgba(123,47,190,0.12)' : 'transparent',
                color: active ? '#eaeaf0' : 'var(--s-text-dim)',
                borderLeft: active ? '3px solid var(--s-violet)' : '3px solid transparent',
              }}>
              <Icon size={17} style={{ color: active ? 'var(--s-violet-light)' : 'var(--s-text-muted)', flexShrink: 0 }} />
              <span className="font-medium text-sm">{label}</span>
            </Link>
          );
        })}

        {/* Ma structure */}
        {user && (
          <Link href="/community/my-structure"
            className="flex items-center gap-3 px-3 py-2.5 relative transition-all duration-150"
            style={{
              background: pathname.startsWith('/community/my-structure') ? 'rgba(255,184,0,0.08)' : 'transparent',
              color: pathname.startsWith('/community/my-structure') ? 'var(--s-gold)' : 'var(--s-text-dim)',
              borderLeft: pathname.startsWith('/community/my-structure') ? '3px solid var(--s-gold)' : '3px solid transparent',
            }}>
            <Building2 size={17} style={{ color: pathname.startsWith('/community/my-structure') ? 'var(--s-gold)' : 'var(--s-text-muted)', flexShrink: 0 }} />
            <span className="font-medium text-sm">Ma structure</span>
          </Link>
        )}

        {/* Mon calendrier */}
        {user && (
          <Link href="/calendar"
            className="flex items-center gap-3 px-3 py-2.5 relative transition-all duration-150"
            style={{
              background: pathname.startsWith('/calendar') ? 'rgba(255,184,0,0.08)' : 'transparent',
              color: pathname.startsWith('/calendar') ? 'var(--s-gold)' : 'var(--s-text-dim)',
              borderLeft: pathname.startsWith('/calendar') ? '3px solid var(--s-gold)' : '3px solid transparent',
            }}>
            <Calendar size={17} style={{ color: pathname.startsWith('/calendar') ? 'var(--s-gold)' : 'var(--s-text-muted)', flexShrink: 0 }} />
            <span className="font-medium text-sm">Mon calendrier</span>
          </Link>
        )}

        {/* Admin */}
        {isAdmin && (
          <>
            <div className="px-3 py-2 mt-4">
              <span className="t-label" style={{ color: 'var(--s-gold)' }}>Admin</span>
            </div>
            <Link href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 transition-all duration-150"
              style={{
                background: pathname.startsWith('/admin') ? 'rgba(255,184,0,0.08)' : 'transparent',
                color: pathname.startsWith('/admin') ? 'var(--s-gold)' : 'var(--s-text-dim)',
                borderLeft: pathname.startsWith('/admin') ? '3px solid var(--s-gold)' : '3px solid transparent',
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
            <div className="w-9 h-9 rounded" style={{ background: 'var(--s-elevated)' }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 rounded-sm" style={{ background: 'var(--s-elevated)', width: '70%' }} />
              <div className="h-2 rounded-sm" style={{ background: 'var(--s-elevated)', width: '50%' }} />
            </div>
          </div>
        ) : user ? (
          <div className="group">
            <div className="flex items-center gap-2 px-3 py-2.5"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              {user.discordAvatar ? (
                <Image src={user.discordAvatar} alt={user.displayName} width={34} height={34}
                  className="flex-shrink-0" style={{ border: '2px solid rgba(123,47,190,0.4)' }} />
              ) : (
                <div className="w-9 h-9 flex items-center justify-center flex-shrink-0 text-sm font-bold"
                  style={{ background: 'var(--s-violet)', color: '#fff' }}>
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
              <NotificationsBell />
              <button onClick={signOut}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5"
                style={{ color: '#ef4444' }} title="Déconnexion">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button onClick={signInWithDiscord}
            className="btn-springs bevel-sm w-full justify-center"
            style={{ background: '#5865F2', color: '#fff', borderColor: '#5865F2' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.079.11 18.1.128 18.114c2.052 1.5 4.044 2.414 5.993 3.016a.077.077 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.6 3.95-1.505 6.002-3.016a.077.077 0 0 0 .032-.027c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            Connexion Discord
          </button>
        )}

        <DevSwitcher />
      </div>
      </aside>
    </>
  );
}
