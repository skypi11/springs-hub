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
import { normalizeEventType } from '@/lib/event-permissions';
import DiscordIcon, { AEDRAL_DISCORD_INVITE_URL } from '@/components/icons/DiscordIcon';
import VerifyAccountNudge from '@/components/verification/VerifyAccountNudge';
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
  tournoi: '#00D9B5',
  autre: 'var(--s-text-dim)',
};

const TYPE_LABEL: Record<string, string> = {
  training: 'Entraînement',
  scrim: 'Scrim',
  match: 'Match',
  tournoi: 'Tournoi',
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
    // eslint-disable-next-line react-hooks/purity -- comparaison volontaire à l'heure courante pour trouver le prochain événement ; recalculé quand calendarQ.data change
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
        {/* Banner réduit à l'identité (audit anti-slop 12/06) : la phrase de
            statut paraphrasait les 3 widgets dessous et les 2 CTA doublonnaient
            leurs liens — une info = un seul endroit. */}
        <div className="relative z-[1] px-8 py-5 flex items-center gap-5">
          {avatar && (
            <div className="w-14 h-14 relative flex-shrink-0 overflow-hidden bevel-sm"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <Image src={avatar} alt={firstName} fill className="object-cover" unoptimized />
            </div>
          )}
          <h1 className="font-display text-3xl tracking-wider leading-none min-w-0 truncate">
            SALUT <span style={{ color: 'var(--s-gold)' }}>{firstName.toUpperCase()}</span>
          </h1>
        </div>
      </header>

      {/* Nudge de vérification de compte (se masque seul si tout est vérifié) */}
      <VerifyAccountNudge />

      {/* Layout asymétrique 2/3-1/3 : le prochain event domine (info n°1 du
          joueur), exercices + structure en colonne compacte à droite. Le chrome
          complet (accent bar + glow) reste réservé au welcome banner. Audit #7. */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-fade-in-d1">
        {/* Bloc dominant : prochain event */}
        <Link
          href="/calendar"
          className="lg:col-span-2 pillar-card panel bevel-sm group transition-all duration-200 block"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        >
          <div className="p-6 h-full flex flex-col" style={{ minHeight: '200px' }}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Calendar size={15} style={{ color: 'var(--s-gold)' }} />
                <span className="t-label" style={{ color: 'var(--s-text)' }}>Prochain event</span>
              </div>
              <ChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--s-text-muted)' }} />
            </div>
            {loading ? (
              <div className="flex items-center justify-center flex-1">
                <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />
              </div>
            ) : nextEvent ? (
              <div className="flex-1 flex flex-col">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span
                    className="tag"
                    style={{
                      fontSize: '12px',
                      padding: '2px 8px',
                      color: TYPE_COLOR[normalizeEventType(nextEvent.type)] ?? 'var(--s-text)',
                      border: `1px solid ${TYPE_COLOR[normalizeEventType(nextEvent.type)] ?? 'var(--s-border)'}40`,
                      background: 'transparent',
                    }}
                  >
                    {TYPE_LABEL[normalizeEventType(nextEvent.type)] ?? nextEvent.type}
                  </span>
                  {nextEventStructure && (
                    <span className="t-mono text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
                      {nextEventStructure.tag || nextEventStructure.name}
                    </span>
                  )}
                </div>
                <h2 className="font-display tracking-wider leading-tight line-clamp-2 mb-4" style={{ fontSize: '2rem', color: 'var(--s-text)' }}>
                  {nextEvent.title}
                </h2>
                <div className="mt-auto flex items-end justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    <Clock size={14} />
                    <span>{formatDateTime(nextEvent.startsAt)}</span>
                  </div>
                  <span className="font-display text-2xl" style={{ color: 'var(--s-gold)', letterSpacing: '0.02em', lineHeight: 1 }}>
                    {formatRelative(nextEvent.startsAt)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center">
                <p className="text-sm mb-3" style={{ color: 'var(--s-text-dim)' }}>Aucun event programmé.</p>
                {primaryStructure && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--s-gold)' }}>
                    Planifier un event <ArrowRight size={11} />
                  </span>
                )}
              </div>
            )}
          </div>
        </Link>

        {/* Colonne compacte : exercices + structure en rangées */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-5">
          {/* Exercices */}
          <Link
            href="/calendar"
            className="pillar-card panel bevel-sm group transition-all duration-200 block"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ClipboardList size={14} style={{ color: 'var(--s-blue)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>Mes exercices</span>
                </div>
                <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--s-text-muted)' }} />
              </div>
              {loading ? (
                <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />
              ) : todoCount > 0 ? (
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl" style={{ color: 'var(--s-blue)', lineHeight: 1 }}>{todoCount}</span>
                  <span className="text-sm truncate" style={{ color: 'var(--s-text-dim)' }}>
                    {firstTodo ? firstTodo.title : 'à faire'}
                  </span>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Aucun exercice en cours</p>
              )}
            </div>
          </Link>

          {/* Structure */}
          <Link
            href={primaryStructure ? '/community/my-structure' : '/community/create-structure'}
            className="pillar-card panel bevel-sm group transition-all duration-200 block"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield size={14} style={{ color: 'var(--s-gold)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>Ma structure</span>
                </div>
                <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--s-text-muted)' }} />
              </div>
              {loading ? (
                <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />
              ) : primaryStructure ? (
                <div className="flex items-center gap-3">
                  {primaryStructure.logoUrl ? (
                    <div className="w-10 h-10 flex-shrink-0 relative overflow-hidden bevel-sm"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <Image src={primaryStructure.logoUrl} alt={primaryStructure.name} fill className="object-contain p-1" unoptimized />
                    </div>
                  ) : (
                    <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center bevel-sm"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <Shield size={16} style={{ color: 'var(--s-text-muted)' }} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-display tracking-wider leading-tight truncate" style={{ fontSize: '15px', color: 'var(--s-text)' }}>
                      {primaryStructure.name}
                    </p>
                    <p className="t-mono text-xs mt-0.5 truncate" style={{ color: 'var(--s-text-muted)' }}>
                      [{primaryStructure.tag}] · {primaryStructure.members?.length ?? 0} membre{(primaryStructure.members?.length ?? 0) > 1 ? 's' : ''}
                    </p>
                  </div>
                  {primaryStructure.status === 'pending_validation' && (
                    <span className="tag tag-gold flex-shrink-0" style={{ fontSize: '12px', padding: '1px 5px' }}>EN ATTENTE</span>
                  )}
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--s-text-dim)' }}>
                  Créer une structure <ArrowRight size={12} style={{ color: 'var(--s-gold)' }} />
                </span>
              )}
            </div>
          </Link>
        </div>
      </section>

      {/* Discord communautaire — ligne fine, l'élément le plus discret de l'écran
          (pub interne). Plus d'accent bar ni de glow ni d'icon-box. Audit #7. */}
      <a
        href={AEDRAL_DISCORD_INVITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="bevel-sm flex items-center gap-3 px-5 py-3 group transition-colors duration-200 animate-fade-in-d2"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <DiscordIcon size={16} />
        <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--s-text-dim)' }}>
          Rejoins la communauté Aedral sur Discord — entraide, annonces, support.
        </span>
        <span className="inline-flex items-center gap-1 text-xs flex-shrink-0 transition-all group-hover:gap-1.5" style={{ color: '#a9b2ff' }}>
          Rejoindre <ArrowRight size={12} />
        </span>
      </a>
    </div>
  );
}
