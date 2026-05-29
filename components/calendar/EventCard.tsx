'use client';

/**
 * EventCard — card d'événement dans la vue Liste du calendar.
 *
 * Extrait de CalendarSection.tsx (Phase 2 refonte technique 29/05).
 * Composant pur sans state interne : reçoit l'event + callbacks (onClick
 * pour ouvrir le détail, onRespond pour répondre à la présence directement
 * sans ouvrir la modal).
 *
 * Affiche : date block compact, type+statut tags, titre, target/lieu,
 * bannière VS pour les matchs, compteurs présences, boutons quick-reply.
 */

import Image from 'next/image';
import { Target, MapPin, ChevronRight } from 'lucide-react';
import type { PresenceStatus } from '@/lib/event-permissions';
import { normalizeEventType } from '@/lib/event-permissions';
import { getGameLabel } from '@/lib/games-registry';
import {
  TYPE_INFO,
  STATUS_INFO,
  PRESENCE_INFO,
  fmtTime,
  type CalendarEvent,
  type Team,
} from './CalendarSection';

interface Props {
  event: CalendarEvent;
  currentUid: string;
  teams: Team[];
  structureLogoUrl?: string;
  onClick: () => void;
  onRespond: (eventId: string, status: PresenceStatus) => void;
}

export default function EventCard({
  event,
  currentUid,
  teams,
  structureLogoUrl,
  onClick,
  onRespond,
}: Props) {
  const typeInfo = TYPE_INFO[normalizeEventType(event.type)] ?? TYPE_INFO.autre;
  const statusInfo = STATUS_INFO[event.status] ?? STATUS_INFO.scheduled;
  const myPresence = event.presences.find(p => p.userId === currentUid);
  const counts = {
    present: event.presences.filter(p => p.status === 'present').length,
    absent: event.presences.filter(p => p.status === 'absent').length,
    maybe: event.presences.filter(p => p.status === 'maybe').length,
    pending: event.presences.filter(p => p.status === 'pending').length,
  };

  const targetLabel = (() => {
    if (event.target.scope === 'structure') return 'Toute la structure';
    if (event.target.scope === 'game') return getGameLabel(event.target.game);
    if (event.target.scope === 'staff') return 'Staff';
    const names = (event.target.teamIds ?? [])
      .map(id => teams.find(t => t.id === id)?.name)
      .filter(Boolean);
    return names.length ? names.join(', ') : 'Équipes';
  })();

  return (
    <div
      onClick={onClick}
      className="bevel-sm relative overflow-hidden cursor-pointer transition-all duration-150 hover:border-white/20"
      style={{ background: 'var(--s-elevated)', border: `1px solid var(--s-border)` }}>
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${typeInfo.color}, ${typeInfo.color}50, transparent 70%)` }} />

      <div className="p-4 flex gap-4">
        {/* Date block */}
        <div className="flex-shrink-0 text-center" style={{ minWidth: '56px' }}>
          <p className="font-display text-xl leading-none" style={{ color: typeInfo.color }}>
            {event.startsAt ? new Date(event.startsAt).getDate() : '–'}
          </p>
          <p className="t-label mt-1">
            {event.startsAt
              ? new Date(event.startsAt).toLocaleDateString('fr-FR', { month: 'short' }).toUpperCase()
              : ''}
          </p>
          <p className="t-mono mt-1" style={{ color: 'var(--s-text-dim)' }}>
            {fmtTime(event.startsAt)}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="tag" style={{ background: `${typeInfo.color}15`, color: typeInfo.color, borderColor: `${typeInfo.color}35`, fontSize: '12px', padding: '1px 6px' }}>
              {typeInfo.label}
            </span>
            {event.status !== 'scheduled' && (
              <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '12px', padding: '1px 6px' }}>
                {statusInfo.label}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{event.title}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="t-mono flex items-center gap-1" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
              <Target size={9} /> {targetLabel}
            </span>
            {event.location && (
              <span className="t-mono flex items-center gap-1" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
                <MapPin size={9} /> {event.location}
              </span>
            )}
            {event.type === 'scrim' && event.adversaire && (
              <span className="t-mono" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
                vs {event.adversaire}
              </span>
            )}
          </div>
          {event.type === 'match' && event.adversaire && (() => {
            const firstTeam = event.target.scope === 'teams'
              ? teams.find(t => (event.target.teamIds ?? []).includes(t.id))
              : null;
            const teamLogo = firstTeam?.logoUrl || structureLogoUrl;
            const teamLabel = firstTeam?.name || 'Équipe';
            const teamInitials = teamLabel.slice(0, 3).toUpperCase();
            const advInitials = event.adversaire.slice(0, 3).toUpperCase();
            return (
              <div className="mt-2 inline-flex items-center gap-3 px-3 py-2 max-w-full"
                style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.3)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {teamLogo ? (
                    <div className="flex-shrink-0" style={{ width: '28px', height: '28px', position: 'relative' }}>
                      <Image src={teamLogo} alt={teamLabel} fill className="object-contain" unoptimized />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 flex items-center justify-center font-display"
                      style={{ width: '28px', height: '28px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '12px', color: 'var(--s-text-dim)' }}>
                      {teamInitials}
                    </div>
                  )}
                  <span className="font-display tracking-wider truncate" style={{ fontSize: '13px', color: 'var(--s-text)' }}>
                    {teamLabel.toUpperCase()}
                  </span>
                </div>
                <span className="font-display flex-shrink-0" style={{ fontSize: '12px', color: 'var(--s-gold)', letterSpacing: '0.1em' }}>VS</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-display tracking-wider truncate" style={{ fontSize: '13px', color: 'var(--s-text)' }}>
                    {event.adversaire.toUpperCase()}
                  </span>
                  {event.adversaireLogoUrl ? (
                    <div className="flex-shrink-0" style={{ width: '28px', height: '28px', position: 'relative' }}>
                      <Image src={event.adversaireLogoUrl} alt={event.adversaire} fill className="object-contain" unoptimized />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 flex items-center justify-center font-display"
                      style={{ width: '28px', height: '28px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '12px', color: 'var(--s-text-dim)' }}>
                      {advInitials}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Presence counts + my response */}
        <div className="flex-shrink-0 flex flex-col items-end gap-2" onClick={e => e.stopPropagation()}>
          <div className="flex gap-1.5">
            <span className="tag" style={{ background: 'rgba(51,255,102,0.1)', color: '#33ff66', borderColor: 'rgba(51,255,102,0.3)', fontSize: '12px', padding: '1px 5px' }}>
              {counts.present}
            </span>
            <span className="tag" style={{ background: 'rgba(255,184,0,0.1)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.3)', fontSize: '12px', padding: '1px 5px' }}>
              {counts.maybe}
            </span>
            <span className="tag" style={{ background: 'rgba(255,85,85,0.1)', color: '#ff5555', borderColor: 'rgba(255,85,85,0.3)', fontSize: '12px', padding: '1px 5px' }}>
              {counts.absent}
            </span>
          </div>
          {myPresence && event.status === 'scheduled' && (
            <div className="flex gap-1">
              {(['present', 'maybe', 'absent'] as const).map(s => (
                <button key={s} type="button"
                  onClick={() => onRespond(event.id, s)}
                  title={PRESENCE_INFO[s].label}
                  className="transition-all duration-150"
                  style={{
                    width: '20px', height: '20px',
                    background: myPresence.status === s ? `${PRESENCE_INFO[s].color}20` : 'transparent',
                    border: `1px solid ${myPresence.status === s ? PRESENCE_INFO[s].color : 'var(--s-border)'}`,
                    color: myPresence.status === s ? PRESENCE_INFO[s].color : 'var(--s-text-muted)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}>
                  {s === 'present' ? '✓' : s === 'maybe' ? '?' : '✗'}
                </button>
              ))}
            </div>
          )}
          <ChevronRight size={12} style={{ color: 'var(--s-text-muted)' }} />
        </div>
      </div>
    </div>
  );
}
