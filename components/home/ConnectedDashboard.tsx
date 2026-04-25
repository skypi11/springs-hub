'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  ClipboardList,
  Shield,
  ChevronRight,
  Loader2,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import type { SpringsUser } from '@/types';

type MyEvent = {
  id: string;
  structureId: string;
  title: string;
  type: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
};

type StructureInfo = { name: string; tag: string; logoUrl: string };

type MyTodo = {
  id: string;
  title: string;
  done: boolean;
  deadline: string | null;
  structureName?: string;
  teamName?: string;
};

type MyStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl?: string;
  status: string;
  games?: string[];
  accessLevel: 'dirigeant' | 'staff';
  members?: Array<unknown>;
};

const TYPE_COLOR: Record<string, string> = {
  training: 'var(--s-text-dim)',
  scrim: 'var(--s-blue)',
  match: 'var(--s-gold)',
  springs: 'var(--s-violet)',
  autre: 'var(--s-text-dim)',
};

const TYPE_LABEL: Record<string, string> = {
  training: 'Entraînement',
  scrim: 'Scrim',
  match: 'Match',
  springs: 'Springs',
  autre: 'Autre',
};

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const target = new Date(iso);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);
  if (diffMin < 60) return diffMin <= 1 ? 'maintenant' : `dans ${diffMin} min`;
  if (diffHour < 24) return `dans ${diffHour}h`;
  if (diffDay < 7) return `dans ${diffDay}j`;
  return target.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })
    + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function ConnectedDashboard({ user }: { user: SpringsUser }) {
  const { firebaseUser } = useAuth();
  const enabled = !!firebaseUser;

  const calendarQ = useQuery({
    queryKey: ['calendar', 'me'] as const,
    queryFn: () => api<{ events: MyEvent[]; structures: Record<string, StructureInfo> }>('/api/calendar/me'),
    enabled,
  });
  const todosQ = useQuery({
    queryKey: ['todos', 'me'] as const,
    queryFn: () => api<{ todos: MyTodo[] }>('/api/todos/me'),
    enabled,
  });
  const structuresQ = useQuery({
    queryKey: ['structures', 'my'] as const,
    queryFn: () => api<{ structures: MyStructure[] }>('/api/structures/my'),
    enabled,
  });

  const loading = calendarQ.isPending || todosQ.isPending || structuresQ.isPending;

  const { nextEvent, nextEventStructure } = useMemo(() => {
    const events = calendarQ.data?.events ?? [];
    const structs = calendarQ.data?.structures ?? {};
    const now = Date.now();
    const future = events.find(e => {
      if (!e.startsAt) return false;
      if (e.status === 'cancelled') return false;
      return new Date(e.startsAt).getTime() >= now;
    });
    return {
      nextEvent: future ?? null,
      nextEventStructure: future ? structs[future.structureId] ?? null : null,
    };
  }, [calendarQ.data]);

  const pendingTodos = useMemo(() => {
    const todos = (todosQ.data?.todos ?? []).filter(t => !t.done);
    todos.sort((a, b) => {
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return ad - bd;
    });
    return todos;
  }, [todosQ.data]);

  const structures = structuresQ.data?.structures ?? [];

  const firstName = (user.displayName || user.discordUsername || 'joueur').trim();
  const avatar = user.avatarUrl || user.discordAvatar || '';
  const primaryStructure = structures[0] ?? null;
  const todoCount = pendingTodos.length;
  const firstTodo = pendingTodos[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <header
        className="bevel relative overflow-hidden animate-fade-in"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
        <div className="absolute top-0 right-0 w-[500px] h-[300px] pointer-events-none opacity-[0.05]"
          style={{ background: 'radial-gradient(ellipse at top right, var(--s-gold), transparent 70%)' }} />
        <div className="relative z-[1] px-8 py-6 flex items-center gap-5 flex-wrap">
          {avatar && (
            <div className="w-16 h-16 relative flex-shrink-0 overflow-hidden bevel-sm"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <Image src={avatar} alt={firstName} fill className="object-cover" unoptimized />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="t-label mb-1" style={{ color: 'var(--s-text-muted)' }}>SPRINGS HUB</p>
            <h1 className="font-display text-3xl tracking-wider leading-none">
              SALUT <span style={{ color: 'var(--s-gold)' }}>{firstName.toUpperCase()}</span>
            </h1>
            <p className="text-sm mt-2" style={{ color: 'var(--s-text-dim)' }}>
              {loading
                ? 'Chargement de ton dashboard…'
                : buildStatus(todoCount, nextEvent, primaryStructure)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href="/calendar" className="btn-springs btn-secondary bevel-sm">
              <Calendar size={14} />
              Calendrier
            </Link>
            <Link href="/community/my-structure" className="btn-springs btn-primary bevel-sm">
              <Shield size={14} />
              Ma structure
            </Link>
          </div>
        </div>
      </header>

      {/* 3 widgets */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-fade-in-d1">
        {/* Widget prochain event */}
        <WidgetCard
          accent="var(--s-gold)"
          icon={<Calendar size={16} style={{ color: 'var(--s-gold)' }} />}
          title="PROCHAIN EVENT"
          href="/calendar"
          loading={loading}
          empty={!nextEvent}
          emptyLabel="Aucun event programmé"
          emptyCTA={primaryStructure ? 'Planifier un event' : null}
          emptyHref={primaryStructure ? '/community/my-structure' : null}
        >
          {nextEvent && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className="tag"
                  style={{
                    fontSize: '9px',
                    padding: '2px 6px',
                    color: TYPE_COLOR[nextEvent.type] ?? 'var(--s-text)',
                    border: `1px solid ${TYPE_COLOR[nextEvent.type] ?? 'var(--s-border)'}40`,
                    background: 'transparent',
                  }}
                >
                  {TYPE_LABEL[nextEvent.type] ?? nextEvent.type}
                </span>
                {nextEventStructure && (
                  <span className="t-mono text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
                    {nextEventStructure.tag || nextEventStructure.name}
                  </span>
                )}
              </div>
              <h3 className="font-display text-lg tracking-wider leading-tight line-clamp-2" style={{ color: 'var(--s-text)' }}>
                {nextEvent.title}
              </h3>
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                <Clock size={12} />
                <span>{formatDateTime(nextEvent.startsAt)}</span>
              </div>
              <div className="t-label" style={{ color: 'var(--s-gold)' }}>
                {formatRelative(nextEvent.startsAt)}
              </div>
            </div>
          )}
        </WidgetCard>

        {/* Widget devoirs */}
        <WidgetCard
          accent="var(--s-blue)"
          icon={<ClipboardList size={16} style={{ color: 'var(--s-blue)' }} />}
          title="MES DEVOIRS"
          href="/calendar"
          loading={loading}
          empty={todoCount === 0}
          emptyLabel="Aucun devoir en cours"
          emptyCTA={null}
          emptyHref={null}
        >
          {todoCount > 0 && (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl" style={{ color: 'var(--s-blue)', letterSpacing: '0.02em', lineHeight: 1 }}>
                  {todoCount}
                </span>
                <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>
                  à faire
                </span>
              </div>
              {firstTodo && (
                <div className="pt-2" style={{ borderTop: '1px dashed var(--s-border)' }}>
                  <p className="text-sm font-semibold line-clamp-1" style={{ color: 'var(--s-text)' }}>
                    {firstTodo.title}
                  </p>
                  {firstTodo.deadline && (
                    <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                      Deadline · {formatRelative(firstTodo.deadline)}
                    </p>
                  )}
                </div>
              )}
              {todoCount > 1 && (
                <p className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  +{todoCount - 1} autre{todoCount - 1 > 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </WidgetCard>

        {/* Widget structure */}
        <WidgetCard
          accent="var(--s-gold)"
          icon={<Shield size={16} style={{ color: 'var(--s-gold)' }} />}
          title="MA STRUCTURE"
          href={primaryStructure ? '/community/my-structure' : '/community/create-structure'}
          loading={loading}
          empty={!primaryStructure}
          emptyLabel="Tu n'as pas encore de structure"
          emptyCTA="Créer une structure"
          emptyHref="/community/create-structure"
        >
          {primaryStructure && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {primaryStructure.logoUrl ? (
                  <div className="w-12 h-12 flex-shrink-0 relative overflow-hidden bevel-sm"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <Image src={primaryStructure.logoUrl} alt={primaryStructure.name} fill className="object-contain p-1" unoptimized />
                  </div>
                ) : (
                  <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center bevel-sm"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <Shield size={18} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg tracking-wider leading-tight truncate" style={{ color: 'var(--s-text)' }}>
                    {primaryStructure.name}
                  </p>
                  <p className="t-mono text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                    [{primaryStructure.tag}] · {primaryStructure.accessLevel === 'dirigeant' ? 'Dirigeant' : 'Staff'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs pt-2" style={{ borderTop: '1px dashed var(--s-border)', color: 'var(--s-text-dim)' }}>
                <span>
                  {primaryStructure.members?.length ?? 0} membre{(primaryStructure.members?.length ?? 0) > 1 ? 's' : ''}
                </span>
                {primaryStructure.status === 'pending_validation' && (
                  <span className="tag tag-gold" style={{ fontSize: '9px', padding: '1px 5px' }}>EN ATTENTE</span>
                )}
              </div>
            </div>
          )}
        </WidgetCard>
      </section>
    </div>
  );
}

function buildStatus(todoCount: number, nextEvent: MyEvent | null, structure: MyStructure | null): string {
  const parts: string[] = [];
  if (nextEvent?.startsAt) parts.push(`prochain event ${formatRelative(nextEvent.startsAt)}`);
  if (todoCount > 0) parts.push(`${todoCount} devoir${todoCount > 1 ? 's' : ''} à faire`);
  if (!structure) parts.push('aucune structure — crée la tienne');
  if (parts.length === 0) return 'Tout est calme pour le moment.';
  return parts.join(' · ');
}

function WidgetCard({
  accent,
  icon,
  title,
  href,
  loading,
  empty,
  emptyLabel,
  emptyCTA,
  emptyHref,
  children,
}: {
  accent: string;
  icon: React.ReactNode;
  title: string;
  href: string;
  loading: boolean;
  empty: boolean;
  emptyLabel: string;
  emptyCTA: string | null;
  emptyHref: string | null;
  children: React.ReactNode;
}) {
  const body = (
    <div className="pillar-card panel bevel-sm relative overflow-hidden group transition-all duration-200 block h-full"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, transparent 70%)` }} />
      <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: `radial-gradient(circle at 100% 0%, ${accent}15, transparent 70%)` }} />
      <div className="relative z-[1] p-5 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {icon}
            <span className="t-label" style={{ color: 'var(--s-text)' }}>{title}</span>
          </div>
          <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5"
            style={{ color: 'var(--s-text-muted)' }} />
        </div>
        <div className="flex-1 flex flex-col justify-center">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />
            </div>
          ) : empty ? (
            <div className="py-4">
              <p className="text-sm mb-3" style={{ color: 'var(--s-text-dim)' }}>{emptyLabel}</p>
              {emptyCTA && emptyHref && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
                  style={{ color: accent }}>
                  {emptyCTA} <ArrowRight size={11} />
                </span>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
  return (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  );
}
