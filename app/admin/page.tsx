'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2, Users, AlertCircle, ArrowRight, Loader2, Hammer,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

type Stats = {
  totalStructures: number;
  pendingStructures: number;
  activeStructures: number;
  totalUsers: number;
  bannedUsers: number;
  adminCount: number;
};

type StatCardProps = {
  icon: LucideIcon;
  label: string;
  value: number | string;
  accent: string;
  emphasis?: boolean;
};

function StatCard({ icon: Icon, label, value, accent, emphasis }: StatCardProps) {
  return (
    <div
      className="pillar-card panel relative overflow-hidden transition-all duration-200"
      style={{
        borderColor: emphasis ? accent + '40' : 'var(--s-border)',
      }}
    >
      <div
        className="h-[3px]"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55, transparent 70%)` }}
      />
      <div
        className="absolute top-0 right-0 w-[140px] h-[140px] pointer-events-none"
        style={{
          opacity: emphasis ? 0.12 : 0.06,
          background: `radial-gradient(circle at top right, ${accent}, transparent 70%)`,
        }}
      />
      <div className="relative z-[1] p-5">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="p-1.5"
            style={{ background: accent + '15', border: `1px solid ${accent}35` }}
          >
            <Icon size={13} style={{ color: accent }} />
          </div>
          <span className="t-label" style={{ color: 'var(--s-text-dim)' }}>
            {label}
          </span>
        </div>
        <p className="font-display text-3xl" style={{ color: 'var(--s-text)', letterSpacing: '0.02em' }}>
          {value}
        </p>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!firebaseUser || !isAdmin) return;
      try {
        const idToken = await firebaseUser.getIdToken();
        const [sRes, uRes] = await Promise.all([
          fetch('/api/admin/structures', { headers: { Authorization: `Bearer ${idToken}` } }),
          fetch('/api/admin/users', { headers: { Authorization: `Bearer ${idToken}` } }),
        ]);
        const sData = sRes.ok ? await sRes.json() : { structures: [] };
        const uData = uRes.ok ? await uRes.json() : { users: [] };
        const structures = sData.structures ?? [];
        const users = uData.users ?? [];
        setStats({
          totalStructures: structures.length,
          pendingStructures: structures.filter((s: { status: string }) => s.status === 'pending_validation').length,
          activeStructures: structures.filter((s: { status: string }) => s.status === 'active').length,
          totalUsers: users.length,
          bannedUsers: users.filter((u: { isBanned: boolean }) => u.isBanned).length,
          adminCount: users.filter((u: { isAdmin: boolean }) => u.isAdmin).length,
        });
      } catch (err) {
        console.error('[Admin/Dashboard] load error:', err);
      }
      setLoading(false);
    }
    load();
  }, [firebaseUser, isAdmin]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  const s = stats ?? {
    totalStructures: 0, pendingStructures: 0, activeStructures: 0,
    totalUsers: 0, bannedUsers: 0, adminCount: 0,
  };

  return (
    <>
      {/* Alerte pending prominente */}
      {s.pendingStructures > 0 && (
        <Link
          href="/admin/structures"
          className="bevel-sm animate-fade-in block relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(255,184,0,0.12), rgba(255,184,0,0.04))',
            border: '1px solid rgba(255,184,0,0.35)',
            padding: '14px 18px',
          }}
        >
          <div className="flex items-center gap-3">
            <AlertCircle size={18} style={{ color: 'var(--s-gold)', flexShrink: 0 }} />
            <div className="flex-1">
              <div className="font-semibold text-sm" style={{ color: 'var(--s-gold)' }}>
                {s.pendingStructures} demande{s.pendingStructures > 1 ? 's' : ''} de structure en attente
              </div>
              <div className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                Clique pour aller valider ou refuser.
              </div>
            </div>
            <ArrowRight size={14} style={{ color: 'var(--s-gold)' }} />
          </div>
        </Link>
      )}

      {/* Stats principales */}
      <div>
        <div className="section-label mb-4">
          <span>Vue globale</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            icon={Building2}
            label="Structures actives"
            value={s.activeStructures}
            accent="#33ff66"
          />
          <StatCard
            icon={AlertCircle}
            label="En attente"
            value={s.pendingStructures}
            accent="#FFB800"
            emphasis={s.pendingStructures > 0}
          />
          <StatCard
            icon={Users}
            label="Utilisateurs"
            value={s.totalUsers}
            accent="#0081FF"
          />
        </div>
      </div>

      {/* Sous-stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={Building2}
          label="Total structures"
          value={s.totalStructures}
          accent="#7B2FBE"
        />
        <StatCard
          icon={Users}
          label="Bannis"
          value={s.bannedUsers}
          accent="#ff5555"
          emphasis={s.bannedUsers > 0}
        />
        <StatCard
          icon={Users}
          label="Admins"
          value={s.adminCount}
          accent="#a364d9"
        />
      </div>

      {/* Note refonte en cours */}
      <div
        className="bevel-sm relative overflow-hidden"
        style={{
          background: 'var(--s-surface)',
          border: '1px solid var(--s-border)',
        }}
      >
        <div
          className="h-[3px]"
          style={{ background: 'linear-gradient(90deg, var(--s-violet), rgba(163,100,217,0.3), transparent 70%)' }}
        />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Hammer size={13} style={{ color: 'var(--s-violet-light)' }} />
            <span className="t-label">Refonte en cours</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Les sections marquées <span className="tag tag-neutral" style={{ fontSize: '8px', padding: '0px 5px' }}>BIENTÔT</span> dans la nav ne sont pas encore branchées. Priorité sur <strong style={{ color: 'var(--s-text)' }}>Audit log</strong> et <strong style={{ color: 'var(--s-text)' }}>Modération</strong>.
          </p>
        </div>
      </div>
    </>
  );
}
