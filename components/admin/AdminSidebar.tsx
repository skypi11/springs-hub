'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Users, Users2, CalendarDays, ClipboardList,
  ShieldAlert, Bell, MessagesSquare, UploadCloud, History, Wrench,
  type LucideIcon,
} from 'lucide-react';

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  soon?: boolean;
  badge?: number;
};

type Props = {
  pendingCount?: number;
  bannedCount?: number;
};

export default function AdminSidebar({ pendingCount = 0, bannedCount = 0 }: Props) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: '/admin', icon: LayoutDashboard, label: 'Dashboard', description: 'Vue globale' },
    { href: '/admin/structures', icon: Building2, label: 'Structures', description: 'Validations et gestion', badge: pendingCount },
    { href: '/admin/users', icon: Users, label: 'Utilisateurs', description: 'Profils, bans, admins', badge: bannedCount },
    { href: '/admin/teams', icon: Users2, label: 'Équipes', description: 'Vue cross-structures' },
    { href: '/admin/calendar', icon: CalendarDays, label: 'Calendrier', description: 'Événements globaux' },
    { href: '/admin/devoirs', icon: ClipboardList, label: 'Devoirs', description: 'Stats cross-structures' },
    { href: '/admin/moderation', icon: ShieldAlert, label: 'Modération', description: 'Bans, structures critiques' },
    { href: '/admin/notifications', icon: Bell, label: 'Notifications', description: 'Envoyer, historique' },
    { href: '/admin/discord', icon: MessagesSquare, label: 'Discord', description: 'Stats OAuth, tests' },
    { href: '/admin/uploads', icon: UploadCloud, label: 'Uploads', description: 'Stockage R2' },
    { href: '/admin/audit', icon: History, label: 'Audit log', description: 'Actions admin' },
    { href: '/admin/dev', icon: Wrench, label: 'Outils dev', description: 'Debug, seed, raw', soon: true },
  ];

  return (
    <aside>
      <div
        className="bevel-sm sticky top-4"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <div
          className="h-[3px]"
          style={{ background: 'linear-gradient(90deg, var(--s-violet), rgba(163,100,217,0.3), transparent 70%)' }}
        />
        <div className="p-2">
          <div className="px-3 py-2">
            <span className="t-label">Panel admin</span>
          </div>
          {items.map((item) => {
            const Icon = item.icon;
            const active = item.href === '/admin'
              ? pathname === '/admin'
              : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.soon ? '#' : item.href}
                onClick={(e) => { if (item.soon) e.preventDefault(); }}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-all duration-150 relative"
                style={{
                  background: active ? 'rgba(123,47,190,0.12)' : 'transparent',
                  color: active ? 'var(--s-text)' : 'var(--s-text-dim)',
                  borderLeft: active ? '3px solid var(--s-violet)' : '3px solid transparent',
                  cursor: item.soon ? 'not-allowed' : 'pointer',
                  opacity: item.soon ? 0.55 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!active && !item.soon) e.currentTarget.style.background = 'var(--s-elevated)';
                }}
                onMouseLeave={(e) => {
                  if (!active && !item.soon) e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon
                  size={15}
                  className="flex-shrink-0 mt-0.5"
                  style={{ color: active ? 'var(--s-violet-light)' : 'var(--s-text-muted)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold">{item.label}</p>
                    {item.soon && (
                      <span
                        className="tag tag-neutral"
                        style={{ fontSize: '8px', padding: '0px 5px' }}
                      >
                        BIENTÔT
                      </span>
                    )}
                    {!item.soon && item.badge && item.badge > 0 ? (
                      <span
                        className="tag tag-gold"
                        style={{ fontSize: '8px', padding: '0px 5px' }}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                    {item.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
