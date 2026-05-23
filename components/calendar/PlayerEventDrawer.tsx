'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import {
  X, Clock, MapPin, Target, Shield, FileText, ListTodo, ChevronRight,
  CheckCircle, XCircle, HelpCircle, Calendar as CalIcon, ExternalLink,
} from 'lucide-react';
import Portal from '@/components/ui/Portal';
import { api } from '@/lib/api-client';
import type { EventType, EventStatus, PresenceStatus } from '@/lib/event-permissions';
import { normalizeEventType } from '@/lib/event-permissions';
import type { TodoRef } from '@/lib/todos';

type MyPresence = {
  id: string;
  status: PresenceStatus;
  respondedAt: string | null;
};

export type PlayerEvent = {
  id: string;
  structureId: string;
  title: string;
  type: EventType;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  target: { scope: string; teamIds?: string[]; game?: string };
  status: EventStatus;
  adversaire: string | null;
  resultat: string | null;
  compteRendu: string;
  aTravailler: string;
  myPresence: MyPresence | null;
};

type StructureInfo = { name: string; tag: string; logoUrl: string };

type MyTodo = TodoRef & {
  structureName: string;
  structureTag: string;
  teamName: string;
  eventTitle: string | null;
};

const TYPE_INFO: Record<EventType, { label: string; color: string }> = {
  training: { label: 'Entraînement', color: 'var(--s-text-dim)' },
  scrim: { label: 'Scrim', color: 'var(--s-blue)' },
  match: { label: 'Match', color: 'var(--s-gold)' },
  tournoi: { label: 'Tournoi', color: '#00D9B5' },
  autre: { label: 'Autre', color: 'var(--s-text-dim)' },
};

const STATUS_INFO: Record<EventStatus, { label: string; color: string }> = {
  scheduled: { label: 'Programmé', color: 'var(--s-gold)' },
  done: { label: 'Terminé', color: '#33ff66' },
  cancelled: { label: 'Annulé', color: '#ff5555' },
};

const PRESENCE_BTN: { key: PresenceStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'present', label: 'Présent', icon: <CheckCircle size={13} />, color: '#33ff66' },
  { key: 'maybe', label: 'Peut-être', icon: <HelpCircle size={13} />, color: 'var(--s-gold)' },
  { key: 'absent', label: 'Absent', icon: <XCircle size={13} />, color: '#ff5555' },
];

// Drawer détail d'un événement vu côté joueur invité — lecture seule sur
// l'event (édition réservée au staff), avec :
// - infos du match + bouton de présence (si scheduled)
// - compte rendu post-match
// - "À travailler" legacy (uniquement si l'event a déjà ce champ rempli ;
//   pour les nouveaux events, le staff utilise désormais les exercices
//   assignés à la place)
// - liste des exercices (structure_todos) liés à ce scrim, filtrés par
//   eventId — cliquables pour ouvrir le détail (cf. MyTodosSection).
export default function PlayerEventDrawer({
  event,
  structure,
  onClose,
  onRespond,
}: {
  event: PlayerEvent;
  structure: StructureInfo | undefined;
  onClose: () => void;
  onRespond: (structureId: string, eventId: string, status: PresenceStatus) => void;
}) {
  // Fetch tous mes todos (cache partagé avec MyTodosSection via React Query),
  // filtre par eventId pour ne garder que ceux liés à cet event.
  const todosQuery = useQuery({
    queryKey: ['todos', 'me'] as const,
    queryFn: () => api<{ todos: MyTodo[] }>('/api/todos/me'),
    staleTime: 30_000,
  });
  const linkedTodos = (todosQuery.data?.todos ?? []).filter(t => t.eventId === event.id);

  // ESC pour fermer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const typeInfo = TYPE_INFO[normalizeEventType(event.type)];
  const statusInfo = STATUS_INFO[event.status];
  const my = event.myPresence;
  // Un event est "à venir et modifiable" uniquement s'il est scheduled ET
  // que sa date n'est pas dépassée — sans ça, un scrim oublié resterait
  // modifiable indéfiniment en présence ce qui n'a pas de sens.
  const canChangePresence = event.status === 'scheduled'
    && (!event.startsAt || new Date(event.startsAt).getTime() > Date.now());

  const dateLong = event.startsAt
    ? new Date(event.startsAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const startTime = event.startsAt ? new Date(event.startsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  const endTime = event.endsAt ? new Date(event.endsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <Portal>
      {/* Backdrop cliquable */}
      <div
        onClick={onClose}
        className="animate-overlay-in"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 9500,
        }}
      />
      {/* Drawer right-anchored */}
      <aside
        className="animate-slide-in-right"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(640px, 95vw)',
          background: 'var(--s-bg)',
          borderLeft: '1px solid var(--s-border)',
          zIndex: 9501,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <header className="flex-shrink-0" style={{ borderBottom: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${typeInfo.color}, ${typeInfo.color}50, transparent 70%)` }} />
          <div className="px-5 py-4 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="tag" style={{ background: `${typeInfo.color}15`, color: typeInfo.color, borderColor: `${typeInfo.color}35`, fontSize: '12px', padding: '2px 8px' }}>
                  {typeInfo.label}
                </span>
                <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '12px', padding: '2px 8px' }}>
                  {statusInfo.label}
                </span>
              </div>
              <h2 className="font-display text-xl sm:text-2xl mb-1" style={{ color: 'var(--s-text)' }}>
                {event.title}
              </h2>
              <Link href={`/community/structure/${event.structureId}`}
                className="inline-flex items-center gap-1.5 text-xs hover:text-white transition-colors"
                style={{ color: 'var(--s-text-dim)' }}>
                {structure?.logoUrl ? (
                  <Image src={structure.logoUrl} alt={structure.name} width={12} height={12} unoptimized className="flex-shrink-0" />
                ) : (
                  <Shield size={11} style={{ color: 'var(--s-text-muted)' }} />
                )}
                {structure?.name ?? 'Structure'}
              </Link>
            </div>
            <button onClick={onClose} type="button"
              className="flex items-center justify-center transition-colors hover:bg-[var(--s-elevated)] flex-shrink-0"
              style={{ width: 32, height: 32, border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
              <X size={14} />
            </button>
          </div>
        </header>

        {/* Body scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Métadonnées : date / lieu / adversaire / score */}
          <div className="bevel-sm p-4 space-y-2.5"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text)' }}>
              <CalIcon size={13} style={{ color: 'var(--s-gold)' }} />
              <span className="capitalize">{dateLong}</span>
              {startTime && (
                <span style={{ color: 'var(--s-text-muted)' }}>
                  · {startTime}{endTime ? ` → ${endTime}` : ''}
                </span>
              )}
            </div>
            {event.location && (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text)' }}>
                <MapPin size={13} style={{ color: 'var(--s-gold)' }} />
                {event.location}
              </div>
            )}
            {(event.type === 'match' || event.type === 'scrim') && event.adversaire && (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text)' }}>
                <Target size={13} style={{ color: 'var(--s-gold)' }} />
                <span>vs <strong>{event.adversaire}</strong></span>
                {event.resultat && (
                  <span className="t-mono" style={{ color: 'var(--s-text-muted)' }}>· {event.resultat}</span>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          {event.description && (
            <section>
              <div className="t-label mb-2" style={{ color: 'var(--s-text)' }}>DESCRIPTION</div>
              <p className="text-sm whitespace-pre-wrap"
                style={{ color: 'var(--s-text-dim)', background: 'var(--s-surface)', border: '1px solid var(--s-border)', padding: '12px' }}>
                {event.description}
              </p>
            </section>
          )}

          {/* Ma présence — boutons de réponse si event scheduled ET pas passé */}
          {my && (
            <section>
              <div className="t-label mb-2" style={{ color: 'var(--s-text)' }}>
                {canChangePresence ? 'MA PRÉSENCE' : 'MA RÉPONSE'}
              </div>
              {canChangePresence ? (
                <div className="flex gap-2 flex-wrap">
                  {PRESENCE_BTN.map(({ key, label, icon, color }) => {
                    const active = my.status === key;
                    return (
                      <button key={key} type="button"
                        onClick={() => onRespond(event.structureId, event.id, key)}
                        className="flex items-center gap-2 px-3 py-2 transition-all bevel-sm"
                        style={{
                          background: active ? `${color}20` : 'var(--s-surface)',
                          border: `1px solid ${active ? color : 'var(--s-border)'}`,
                          color: active ? color : 'var(--s-text-dim)',
                          fontSize: '13px', fontWeight: active ? 600 : 400,
                          cursor: 'pointer',
                        }}>
                        {icon} {label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-3 py-2 bevel-sm"
                  style={{
                    background: 'var(--s-surface)',
                    border: '1px solid var(--s-border)',
                    color: 'var(--s-text-dim)',
                    fontSize: '13px',
                  }}>
                  Réponse : <strong style={{ color: 'var(--s-text)' }}>
                    {PRESENCE_BTN.find(p => p.key === my.status)?.label ?? my.status}
                  </strong>
                </div>
              )}
            </section>
          )}

          {/* Compte rendu (post-match) */}
          {event.compteRendu && (
            <section>
              <div className="t-label mb-2 flex items-center gap-1.5" style={{ color: 'var(--s-text)' }}>
                <FileText size={11} style={{ color: 'var(--s-gold)' }} />
                COMPTE RENDU
              </div>
              <div className="text-sm whitespace-pre-wrap p-3 bevel-sm"
                style={{ color: 'var(--s-text)', background: 'var(--s-surface)', border: '1px solid var(--s-border)', lineHeight: 1.55 }}>
                {event.compteRendu}
              </div>
            </section>
          )}

          {/* "À travailler" legacy — affiché uniquement si non vide.
              Les nouveaux events utilisent les exercices assignés ci-dessous. */}
          {event.aTravailler && (
            <section>
              <div className="t-label mb-2 flex items-center gap-1.5" style={{ color: 'var(--s-text-muted)' }}>
                NOTE DU COACH
              </div>
              <div className="text-sm whitespace-pre-wrap p-3 bevel-sm"
                style={{ color: 'var(--s-text-dim)', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', lineHeight: 1.55 }}>
                {event.aTravailler}
              </div>
            </section>
          )}

          {/* Mes exercices liés à cet event */}
          <section>
            <div className="t-label mb-2 flex items-center gap-1.5" style={{ color: 'var(--s-text)' }}>
              <ListTodo size={11} style={{ color: 'var(--s-gold)' }} />
              MES EXERCICES POUR CE SCRIM
              {linkedTodos.length > 0 && (
                <span style={{ color: 'var(--s-text-muted)' }}>({linkedTodos.length})</span>
              )}
            </div>
            {todosQuery.isPending ? (
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Chargement…</p>
            ) : linkedTodos.length === 0 ? (
              <p className="text-xs px-3 py-2 bevel-sm"
                style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                Ton coach n&apos;a pas (encore) assigné d&apos;exercices pour ce scrim.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {linkedTodos.map(todo => (
                  <li key={todo.id} className="px-3 py-2 bevel-sm flex items-center gap-3"
                    style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--s-text)' }}>
                        {todo.title}
                      </div>
                      {todo.deadline && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                          Deadline : {todo.deadline}
                        </div>
                      )}
                    </div>
                    {todo.done ? (
                      <span className="tag" style={{ background: 'rgba(51,255,102,0.10)', color: '#33ff66', borderColor: 'rgba(51,255,102,0.30)', fontSize: '10px', padding: '2px 6px' }}>
                        Fait
                      </span>
                    ) : (
                      <span className="tag tag-gold" style={{ fontSize: '10px', padding: '2px 6px' }}>
                        À faire
                      </span>
                    )}
                  </li>
                ))}
                <li className="pt-1">
                  <Link href="/calendar#my-todos"
                    className="inline-flex items-center gap-1 text-xs hover:text-white transition-colors"
                    style={{ color: 'var(--s-text-muted)' }}>
                    Voir tous mes exercices <ExternalLink size={10} />
                  </Link>
                </li>
              </ul>
            )}
          </section>
        </div>
      </aside>
    </Portal>
  );
}
