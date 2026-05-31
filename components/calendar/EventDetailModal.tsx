'use client';

/**
 * EventDetailModal — Modal "Détail d'un événement".
 *
 * Extraite de CalendarSection.tsx (chantier dette technique 29/05) pour
 * réduire le poids du fichier parent. Aucun changement de comportement vs
 * version inline.
 *
 * Props volontairement self-contained : reçoit event, currentUid, userContext,
 * structureId, teams, structureLogoUrl, membersById en lecture, et les
 * callbacks de mutation (onRespond, onStatusAction, onDelete, onReload) +
 * onClose pour la fermeture.
 *
 * Garde la logique interne d'assignation d'exercices (NewTodoForm embarqué)
 * + actions staff (terminer/rouvrir/annuler/supprimer) + édition compte-rendu
 * + replays panel (scrim/match équipe unique).
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import {
  Loader2, Clock, CheckCircle, XCircle, MapPin, Target,
  Trash2, User, ListTodo, Pencil,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import Portal from '@/components/ui/Portal';
import type {
  UserContext,
  PresenceStatus,
} from '@/lib/event-permissions';
import {
  canEditEvent,
  canDeleteEvent,
  canMarkTerminated,
  normalizeEventType,
} from '@/lib/event-permissions';
import { getGameLabel } from '@/lib/games-registry';
import ReplaysPanel from '@/components/replays/ReplaysPanel';
import { NewTodoForm, type TeamRef } from './TeamTodosPanel';
import { useTodoTemplates } from './TodoTemplatesManager';
import EventFormModal from './EventFormModal';
import {
  TYPE_INFO,
  STATUS_INFO,
  PRESENCE_INFO,
  fmtDateTime,
  fmtTime,
  type Team,
  type Member,
  type CalendarEvent,
  type AssignedTodoItem,
  type StructureRoles,
} from './CalendarSection';

interface Props {
  event: CalendarEvent;
  currentUid: string;
  userContext: UserContext;
  structureId: string;
  /** Liste des jeux pratiqués par la structure (transmis à EventFormModal en
   *  mode édition pour pré-remplir cohérent). */
  structureGames: string[];
  teams: Team[];
  /** Liste complète des members (transmise à EventFormModal en mode édition
   *  pour les sélecteurs de joueurs/staff). */
  members: Member[];
  /** Rôles structure-level (founder/coFounderIds/managerIds/coachIds), idem
   *  transmis à EventFormModal pour la cible staff. */
  structureRoles: StructureRoles;
  structureLogoUrl?: string;
  membersById: Map<string, Member>;
  onClose: () => void;
  onRespond: (eventId: string, status: PresenceStatus) => void;
  onStatusAction: (eventId: string, action: 'terminate' | 'reopen' | 'cancel') => void;
  onDelete: (eventId: string, title: string) => void;
  onReload: () => void;
}

export default function EventDetailModal({
  event,
  currentUid,
  userContext,
  structureId,
  structureGames,
  teams,
  members,
  structureRoles,
  structureLogoUrl,
  membersById,
  onClose,
  onRespond,
  onStatusAction,
  onDelete,
  onReload,
}: Props) {
  const toast = useToast();
  const typeInfo = TYPE_INFO[normalizeEventType(event.type)] ?? TYPE_INFO.autre;
  const statusInfo = STATUS_INFO[event.status] ?? STATUS_INFO.scheduled;
  const myPresence = event.presences.find(p => p.userId === currentUid);

  // Mode édition : remplace temporairement le rendu de la modal détail par
  // EventFormModal en mode édition (existingEvent). Au close → revient à la
  // modal détail. Au save → reload events + revient à la modal détail.
  // Bouton "Modifier" disponible seulement si canEdit && event.status === 'scheduled'
  // (cohérent avec la restriction backend qui bloque les modifications de
  // titre/dates sur un event done/cancelled).
  const [editing, setEditing] = useState(false);

  const permEvent = {
    createdBy: event.createdBy,
    target: event.target,
    status: event.status,
  };
  const canEdit = canEditEvent(userContext, permEvent);
  const canDelete = canDeleteEvent(userContext, permEvent);
  const canTerminate = canMarkTerminated(userContext, permEvent);

  const [compteRendu, setCompteRendu] = useState(event.compteRendu);
  const [aTravailler, setATravailler] = useState(event.aTravailler);
  const [adversaire, setAdversaire] = useState(event.adversaire ?? '');
  const [adversaireLogoUrl, setAdversaireLogoUrl] = useState(event.adversaireLogoUrl ?? '');
  const [resultat, setResultat] = useState(event.resultat ?? '');
  const [saving, setSaving] = useState(false);
  // État pour le formulaire d'assignation d'exercices (étape 2 refonte UX) :
  // remplace l'ancien textarea 'À travailler' par des structure_todos ciblés
  // par joueur, liés à l'event courant via lockedEventId.
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [todoTeamId, setTodoTeamId] = useState<string>(() => {
    // Pré-sélection : si l'event cible 1 seule équipe, on prend celle-là.
    if (event.target.scope === 'teams' && (event.target.teamIds ?? []).length === 1) {
      return event.target.teamIds![0];
    }
    return '';
  });
  const todoTemplates = useTodoTemplates(structureId);

  // Liste des exercices déjà assignés liés à cet event (filtré par eventId
  // côté client après fetch par subTeamId). Re-fetch quand la team change.
  const qc = useQueryClient();
  const assignedTodosQuery = useQuery({
    queryKey: ['team-todos', structureId, todoTeamId, event.id] as const,
    queryFn: () => api<{ todos: AssignedTodoItem[] }>(`/api/structures/${structureId}/todos?subTeamId=${encodeURIComponent(todoTeamId)}`),
    enabled: !!todoTeamId && canEdit,
    staleTime: 30_000,
  });
  const assignedTodos = (assignedTodosQuery.data?.todos ?? []).filter(t => t.eventId === event.id);
  const reloadAssignedTodos = () => qc.invalidateQueries({ queryKey: ['team-todos', structureId, todoTeamId, event.id] });

  // Supprime un exercice avec confirmation. Erreur silencieuse côté UI
  // (toast pour feedback). DELETE est autorisé pour le staff de la team.
  const deleteAssignedTodo = async (todoId: string) => {
    if (!confirm('Supprimer cet exercice assigné ?')) return;
    try {
      await api(`/api/structures/${structureId}/todos/${todoId}`, { method: 'DELETE' });
      toast.success('Exercice supprimé');
      reloadAssignedTodos();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur réseau');
    }
  };

  async function saveNotes() {
    setSaving(true);
    try {
      await api(`/api/structures/${structureId}/events/${event.id}`, {
        method: 'PATCH',
        body: {
          compteRendu,
          aTravailler,
          adversaire,
          resultat,
          ...(event.type === 'match' ? { adversaireLogoUrl } : {}),
        },
      });
      toast.success('Enregistré');
      onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur réseau');
    }
    setSaving(false);
  }

  const targetLabel = (() => {
    if (event.target.scope === 'structure') return 'Toute la structure';
    if (event.target.scope === 'game') return getGameLabel(event.target.game);
    if (event.target.scope === 'staff') return 'Staff';
    const names = (event.target.teamIds ?? [])
      .map(id => teams.find(t => t.id === id)?.name)
      .filter(Boolean);
    return names.length ? names.join(', ') : 'Équipes';
  })();

  const presenceGroups = {
    present: event.presences.filter(p => p.status === 'present'),
    maybe: event.presences.filter(p => p.status === 'maybe'),
    absent: event.presences.filter(p => p.status === 'absent'),
    pending: event.presences.filter(p => p.status === 'pending'),
  };

  // Mode édition : on remplace temporairement le rendu de la detail modal
  // par EventFormModal préremplie. Annuler → revient à la detail modal.
  // Save → reload events + revient à la detail modal (l'user voit le résultat).
  if (editing) {
    return (
      <EventFormModal
        structureId={structureId}
        structureGames={structureGames}
        teams={teams}
        members={members}
        userContext={userContext}
        structureRoles={structureRoles}
        existingEvent={event}
        onClose={() => setEditing(false)}
        onCreated={() => { setEditing(false); onReload(); }}
      />
    );
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="bevel relative w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${typeInfo.color}, ${typeInfo.color}50, transparent 70%)` }} />

        <div className="p-6 space-y-5">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {event.type === 'match' && event.adversaire && (
                <span className="tag"
                  style={{ background: 'rgba(255,184,0,0.18)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.5)', fontSize: '12px', padding: '2px 8px' }}>
                  ⚔ MATCH OFFICIEL
                </span>
              )}
              <span className="tag" style={{ background: `${typeInfo.color}15`, color: typeInfo.color, borderColor: `${typeInfo.color}35`, fontSize: '12px', padding: '2px 8px' }}>
                {typeInfo.label}
              </span>
              <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '12px', padding: '2px 8px' }}>
                {statusInfo.label}
              </span>
            </div>

            {/* Bannière VS pour les matchs officiels, logos + noms en grand */}
            {event.type === 'match' && event.adversaire && (() => {
              const firstTeam = event.target.scope === 'teams'
                ? teams.find(t => (event.target.teamIds ?? []).includes(t.id))
                : null;
              const teamLogo = firstTeam?.logoUrl || structureLogoUrl;
              const teamLabel = firstTeam?.name || 'Équipe';
              const teamInitials = teamLabel.slice(0, 3).toUpperCase();
              const advInitials = event.adversaire.slice(0, 3).toUpperCase();
              return (
                <div className="mb-3 p-4 bevel-sm flex items-center justify-center gap-4"
                  style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.35)' }}>
                  <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                    <span className="font-display text-xl tracking-wider truncate" style={{ color: 'var(--s-text)' }}>
                      {teamLabel.toUpperCase()}
                    </span>
                    {teamLogo ? (
                      <div className="flex-shrink-0" style={{ width: '40px', height: '40px', position: 'relative' }}>
                        <Image src={teamLogo} alt={teamLabel} fill className="object-contain" unoptimized />
                      </div>
                    ) : (
                      <div className="flex-shrink-0 flex items-center justify-center font-display"
                        style={{ width: '40px', height: '40px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '12px', color: 'var(--s-text-dim)' }}>
                        {teamInitials}
                      </div>
                    )}
                  </div>
                  <span className="font-display text-2xl flex-shrink-0" style={{ color: 'var(--s-gold)' }}>VS</span>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {event.adversaireLogoUrl ? (
                      <div className="flex-shrink-0" style={{ width: '40px', height: '40px', position: 'relative' }}>
                        <Image src={event.adversaireLogoUrl} alt={event.adversaire} fill className="object-contain" unoptimized />
                      </div>
                    ) : (
                      <div className="flex-shrink-0 flex items-center justify-center font-display"
                        style={{ width: '40px', height: '40px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '12px', color: 'var(--s-text-dim)' }}>
                        {advInitials}
                      </div>
                    )}
                    <span className="font-display text-xl tracking-wider truncate" style={{ color: 'var(--s-text)' }}>
                      {event.adversaire.toUpperCase()}
                    </span>
                  </div>
                </div>
              );
            })()}

            <h2 className="font-display text-3xl mb-2">{event.title}</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                <Clock size={11} /> {fmtDateTime(event.startsAt)} → {fmtTime(event.endsAt)}
              </span>
              <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                <Target size={11} /> {targetLabel}
              </span>
              {event.location && (
                <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                  <MapPin size={11} /> {event.location}
                </span>
              )}
              {/* Créé par : utile pour savoir qui a posé l'event (qui contacter
                  en cas de question, qui a l'historique de la demande). Fallback
                  sur l'uid court si le créateur n'est plus membre de la structure. */}
              {event.createdBy && (() => {
                const creator = membersById.get(event.createdBy);
                const name = creator?.displayName?.trim()
                  || `${event.createdBy.replace(/^discord_/, '').slice(0, 8)}…`;
                return (
                  <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                    <User size={11} /> Créé par {name}
                  </span>
                );
              })()}
            </div>
          </div>

          {event.description && (
            <div>
              <p className="t-label mb-1.5">DESCRIPTION</p>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>{event.description}</p>
            </div>
          )}

          {/* Configuration de partie (Matt 2026-05-31) : visible pour scrim/match
              si au moins une info est renseignée. Le mot de passe est masqué
              côté serveur pour les non-invités, donc s'affiche uniquement pour
              les bons users. */}
          {(event.type === 'scrim' || event.type === 'match')
            && (event.gameHostedBy || event.gameName || event.gamePassword || event.gameFormat) && (() => {
              const formatLabel: Record<string, string> = {
                bo3: 'BO3', bo5: 'BO5', bo7: 'BO7', free_1h: '1h libre',
              };
              const hostLabel = event.gameHostedBy === 'us'
                ? 'On héberge'
                : event.gameHostedBy === 'opponent'
                  ? "L'adversaire héberge"
                  : null;
              return (
                <div className="bevel-sm p-3 space-y-2"
                  style={{ background: 'rgba(0,129,255,0.05)', border: '1px solid rgba(0,129,255,0.3)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="tag"
                      style={{ background: 'rgba(0,129,255,0.15)', color: 'var(--s-blue)', borderColor: 'rgba(0,129,255,0.4)', fontSize: '12px', padding: '2px 8px' }}>
                      🎮 PARTIE
                    </span>
                    {hostLabel && (
                      <span className="text-xs font-semibold" style={{ color: 'var(--s-text)' }}>
                        {hostLabel}
                      </span>
                    )}
                    {event.gameFormat && formatLabel[event.gameFormat] && (
                      <span className="tag tag-neutral" style={{ fontSize: '12px', padding: '2px 8px' }}>
                        {formatLabel[event.gameFormat]}
                      </span>
                    )}
                  </div>
                  {(event.gameName || event.gamePassword) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {event.gameName && (
                        <div>
                          <p className="t-label mb-1" style={{ color: 'var(--s-text-muted)' }}>NOM DE LA PARTIE</p>
                          <p className="t-mono text-sm break-all" style={{ color: 'var(--s-text)' }}>
                            {event.gameName}
                          </p>
                        </div>
                      )}
                      {event.gamePassword && (
                        <div>
                          <p className="t-label mb-1" style={{ color: 'var(--s-text-muted)' }}>MOT DE PASSE</p>
                          <p className="t-mono text-sm break-all" style={{ color: 'var(--s-gold)' }}>
                            {event.gamePassword}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

          {/* Ma réponse */}
          {myPresence && event.status === 'scheduled' && (
            <div>
              <p className="t-label mb-1.5">MA PRÉSENCE</p>
              <div className="flex gap-2">
                {(['present', 'maybe', 'absent'] as const).map(s => (
                  <button key={s} type="button" onClick={() => onRespond(event.id, s)}
                    className="tag transition-all duration-150"
                    style={{
                      background: myPresence.status === s ? `${PRESENCE_INFO[s].color}20` : 'transparent',
                      color: myPresence.status === s ? PRESENCE_INFO[s].color : 'var(--s-text-dim)',
                      borderColor: myPresence.status === s ? PRESENCE_INFO[s].color : 'var(--s-border)',
                      cursor: 'pointer', padding: '6px 14px', fontSize: '12px',
                    }}>
                    {PRESENCE_INFO[s].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Présences */}
          <div>
            <p className="t-label mb-2">PRÉSENCES ({event.presences.length})</p>
            <div className="grid grid-cols-2 gap-3">
              {(['present', 'maybe', 'absent', 'pending'] as const).map(status => (
                <div key={status} className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <p className="t-label mb-2" style={{ color: PRESENCE_INFO[status].color }}>
                    {PRESENCE_INFO[status].label} ({presenceGroups[status].length})
                  </p>
                  <div className="space-y-1">
                    {presenceGroups[status].length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>–</p>
                    ) : presenceGroups[status].map(p => {
                      const m = membersById.get(p.userId);
                      const displayName = m?.displayName || p.userId.slice(0, 8);
                      const avatar = m?.avatarUrl || m?.discordAvatar;
                      return (
                        <div key={p.id} className="flex items-center gap-2">
                          {avatar ? (
                            <Image src={avatar} alt={displayName} width={16} height={16} unoptimized />
                          ) : (
                            <div className="w-4 h-4" style={{ background: 'var(--s-surface)' }} />
                          )}
                          <span className="text-xs truncate" style={{ color: m ? 'var(--s-text)' : 'var(--s-text-muted)' }}>
                            {displayName}
                            {!p.wasStructureMember && <span className="ml-1" style={{ fontSize: '11px', color: 'var(--s-text-muted)', fontStyle: 'italic' }}>(ancien)</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Match/scrim : adversaire + résultat (+ logo adversaire pour match) */}
          {(event.type === 'match' || event.type === 'scrim') && canEdit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5">Adversaire</label>
                  <input type="text" className="settings-input w-full" value={adversaire} onChange={e => setAdversaire(e.target.value)} />
                </div>
                <div>
                  <label className="t-label block mb-1.5">Résultat</label>
                  <input type="text" className="settings-input w-full" value={resultat} onChange={e => setResultat(e.target.value)} />
                </div>
              </div>
              {event.type === 'match' && (
                <div>
                  <label className="t-label block mb-1.5">Logo adversaire (URL HTTPS, optionnel)</label>
                  <input type="url" className="settings-input w-full"
                    value={adversaireLogoUrl}
                    onChange={e => setAdversaireLogoUrl(e.target.value)}
                    placeholder="https://..." maxLength={500} />
                </div>
              )}
            </div>
          )}

          {/* Compte rendu / à travailler : visibles pour tous, éditables pour staff */}
          <div>
            <label className="t-label block mb-1.5">COMPTE RENDU</label>
            {canEdit ? (
              <textarea className="settings-input w-full" rows={4} value={compteRendu} onChange={e => setCompteRendu(e.target.value)} maxLength={10000} />
            ) : (
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
                {compteRendu || <em style={{ color: 'var(--s-text-muted)' }}>Aucun compte rendu.</em>}
              </p>
            )}
          </div>

          {/* ── À TRAVAILLER ──
              Refonte UX : on n'écrit plus dans le champ aTravailler de l'event
              (texte commun à toute l'équipe, pas actionnable). À la place, on
              crée des exercices (structure_todos) assignés par joueur, liés à
              cet event via lockedEventId. Les exercices apparaissent ensuite
              dans 'MES EXERCICES' du calendar de chaque joueur, cochables.

              Pour la rétrocompat : si l'event a déjà un aTravailler legacy non
              vide, on l'affiche en lecture seule (note du coach historique). */}
          <div>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <label className="t-label">EXERCICES À TRAVAILLER</label>
              {canEdit && (() => {
                // Le bouton "Assigner" n'a de sens que si l'event cible une
                // ou plusieurs équipes précises, pour les scopes structure/
                // game/staff, on ne peut pas savoir à quelle équipe rattacher
                // le todo (sub_teams sont au niveau équipe, pas structure).
                const teamIds = event.target.scope === 'teams' ? (event.target.teamIds ?? []) : [];
                if (teamIds.length === 0) {
                  return (
                    <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Disponible uniquement pour les events ciblant une équipe
                    </span>
                  );
                }
                return (
                  <button type="button"
                    onClick={() => setShowTodoForm(v => !v)}
                    className="btn-springs btn-secondary bevel-sm text-xs flex items-center gap-1.5">
                    <ListTodo size={11} />
                    {showTodoForm ? 'Fermer' : 'Assigner des exercices'}
                  </button>
                );
              })()}
            </div>

            {/* Sélecteur d'équipe si l'event cible plusieurs équipes */}
            {showTodoForm && event.target.scope === 'teams' && (event.target.teamIds ?? []).length > 1 && (
              <div className="mb-3">
                <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Équipe à qui assigner</label>
                <select className="settings-input w-full text-sm"
                  value={todoTeamId}
                  onChange={e => setTodoTeamId(e.target.value)}>
                  <option value="">Choisis une équipe</option>
                  {(event.target.teamIds ?? []).map(tid => {
                    const t = teams.find(x => x.id === tid);
                    return <option key={tid} value={tid}>{t?.name ?? tid}</option>;
                  })}
                </select>
              </div>
            )}

            {/* Form embarqué, réutilise NewTodoForm de TeamTodosPanel avec
                eventId verrouillé. Construit un TeamRef depuis Team + membersById. */}
            {showTodoForm && todoTeamId && (() => {
              const team = teams.find(t => t.id === todoTeamId);
              if (!team) return (
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Équipe introuvable.</p>
              );
              const toMembers = (ids: string[] | undefined) =>
                (ids ?? [])
                  .map(uid => {
                    const m = membersById.get(uid);
                    if (!m) return null;
                    return {
                      uid,
                      displayName: m.displayName,
                      avatarUrl: m.avatarUrl ?? '',
                      discordAvatar: m.discordAvatar ?? '',
                    };
                  })
                  .filter((m): m is NonNullable<typeof m> => m !== null);
              const teamRef: TeamRef = {
                id: team.id,
                name: team.name,
                players: toMembers(team.playerIds),
                subs: toMembers(team.subIds),
                staff: toMembers(team.staffIds),
                game: team.game,
              };
              return (
                <div className="p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <NewTodoForm
                    structureId={structureId}
                    team={teamRef}
                    events={[{ id: event.id, title: event.title, startsAt: event.startsAt }]}
                    templates={todoTemplates.templates}
                    lockedEventId={event.id}
                    onCancel={() => setShowTodoForm(false)}
                    onCreated={() => { setShowTodoForm(false); reloadAssignedTodos(); onReload(); }}
                    onTemplateSaved={() => todoTemplates.reload()}
                  />
                </div>
              );
            })()}

            {/* Liste des exercices déjà assignés à cet event (lecture seule,
                avec bouton supprimer). Re-fetched à chaque modif via
                reloadAssignedTodos. Affichée même si le form n'est pas ouvert
                pour que le coach ait toujours la visibilité. */}
            {canEdit && todoTeamId && (
              <div className="mt-3 space-y-1.5">
                <div className="t-label text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Exercices assignés sur ce scrim{assignedTodos.length > 0 ? ` (${assignedTodos.length})` : ''}
                </div>
                {assignedTodosQuery.isPending ? (
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Chargement…</p>
                ) : assignedTodos.length === 0 ? (
                  <p className="text-xs px-3 py-2 bevel-sm"
                    style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                    Aucun exercice assigné pour l&apos;instant.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {assignedTodos.map(todo => {
                      const member = membersById.get(todo.assigneeId);
                      const assigneeName = member?.displayName ?? todo.assigneeId.slice(0, 8);
                      return (
                        <li key={todo.id} className="px-3 py-2 bevel-sm flex items-center gap-3"
                          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate" style={{ color: 'var(--s-text)' }}>
                                {todo.title}
                              </span>
                              <span className="tag tag-neutral" style={{ fontSize: '12px', padding: '2px 6px' }}>
                                {todo.type}
                              </span>
                              {todo.done && (
                                <span className="tag" style={{ background: 'rgba(51,255,102,0.10)', color: '#33ff66', borderColor: 'rgba(51,255,102,0.30)', fontSize: '12px', padding: '2px 6px' }}>
                                  FAIT
                                </span>
                              )}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                              Assigné à <strong style={{ color: 'var(--s-text)' }}>{assigneeName}</strong>
                              {todo.deadline ? <> · Deadline {todo.deadline}</> : null}
                            </div>
                          </div>
                          <button type="button"
                            onClick={() => deleteAssignedTodo(todo.id)}
                            title="Supprimer cet exercice"
                            className="flex items-center justify-center transition-colors hover:bg-[var(--s-hover)] flex-shrink-0"
                            style={{ width: 28, height: 28, border: '1px solid var(--s-border)', color: '#ef4444' }}>
                            <Trash2 size={12} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Affichage legacy, uniquement si l'event a déjà un aTravailler
                rempli (créé avant la refonte). En lecture seule. */}
            {aTravailler && (
              <div className="mt-3 p-3 bevel-sm space-y-1"
                style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="t-label text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Note du coach (legacy, créée avant la migration vers les exercices)
                </div>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
                  {aTravailler}
                </p>
                {canEdit && (
                  <button type="button"
                    onClick={() => setATravailler('')}
                    className="text-xs"
                    style={{ color: 'var(--s-text-muted)', textDecoration: 'underline' }}>
                    Effacer cette note (les exercices remplaceront la suite)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Replays, uniquement pour scrim/match ciblant une seule équipe */}
          {(event.type === 'scrim' || event.type === 'match') && event.target.scope === 'teams' && (event.target.teamIds ?? []).length === 1 && (
            <div className="pt-2" style={{ borderTop: '1px solid var(--s-border)' }}>
              <div className="pt-3">
                <ReplaysPanel
                  structureId={structureId}
                  teamId={(event.target.teamIds ?? [])[0]}
                  eventId={event.id}
                  mode="event"
                  userContext={userContext}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap justify-between gap-2 pt-2" style={{ borderTop: '1px solid var(--s-border)' }}>
            <div className="flex gap-2 flex-wrap pt-3">
              {canEdit && (
                <button type="button" onClick={saveNotes} disabled={saving}
                  className="btn-springs btn-primary bevel-sm text-xs">
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                  <span>Enregistrer</span>
                </button>
              )}
              {/* Bouton "Modifier" : ouvre EventFormModal en mode édition pour
                  changer titre/dates/lieu/description (+ champs spécifiques type).
                  Visible uniquement si l'event est encore 'scheduled' — la route
                  PATCH backend bloque les modifications de ces champs sur les
                  events done/cancelled (seul le compte rendu reste éditable). */}
              {canEdit && event.status === 'scheduled' && (
                <button type="button" onClick={() => setEditing(true)}
                  className="btn-springs btn-secondary bevel-sm text-xs">
                  <Pencil size={11} />
                  <span>Modifier</span>
                </button>
              )}
              {canTerminate && event.status === 'scheduled' && (
                <button type="button" onClick={() => onStatusAction(event.id, 'terminate')}
                  className="btn-springs btn-secondary bevel-sm text-xs" style={{ color: '#33ff66', borderColor: 'rgba(51,255,102,0.3)' }}>
                  <CheckCircle size={11} /> <span>Marquer terminé</span>
                </button>
              )}
              {canTerminate && event.status === 'done' && (
                <button type="button" onClick={() => onStatusAction(event.id, 'reopen')}
                  className="btn-springs btn-secondary bevel-sm text-xs">
                  <span>Rouvrir</span>
                </button>
              )}
              {canTerminate && event.status === 'scheduled' && (
                <button type="button" onClick={() => onStatusAction(event.id, 'cancel')}
                  className="btn-springs btn-secondary bevel-sm text-xs" style={{ color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                  <XCircle size={11} /> <span>Annuler</span>
                </button>
              )}
            </div>
            <div className="flex gap-2 pt-3">
              {canDelete && (
                <button type="button" onClick={() => onDelete(event.id, event.title)}
                  className="btn-springs btn-secondary bevel-sm text-xs" style={{ color: '#ff5555', borderColor: 'rgba(255,85,85,0.3)' }}>
                  <Trash2 size={11} /> <span>Supprimer</span>
                </button>
              )}
              <button type="button" onClick={onClose}
                className="btn-springs btn-secondary bevel-sm text-xs">
                Fermer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}
