'use client';

/**
 * EventFormModal — Modal "Nouvel événement" OU "Modifier l'événement".
 *
 * Extraite de CalendarSection.tsx (chantier dette technique 29/05).
 *
 * 2 modes :
 * - CRÉATION (default, `existingEvent` non fourni) : tous les champs sont
 *   éditables (titre, type, cible, dates, contenu spécifique). Submit POST.
 * - ÉDITION (`existingEvent` fourni) : champs préremplis. La CIBLE et le
 *   TYPE sont VERROUILLÉS (modifier la cible casserait les présences déjà
 *   répondues ; changer le type casserait les champs spécifiques scrim/
 *   match/tournoi). Submit PATCH. Le créateur OU tout staff autorisé via
 *   canEditEvent peut éditer (check effectué par le caller). L'édition
 *   n'est proposée que si l'event est 'scheduled' (cohérent avec la
 *   restriction backend dans la route PATCH).
 *
 * Props volontairement self-contained : la modal ne lit pas le state global,
 * elle reçoit tout via props.
 */

import { useState, useEffect, useMemo } from 'react';
import { Loader2, Plus, Users, Save, Swords, Gamepad2, Trophy } from 'lucide-react';
import { api } from '@/lib/api-client';
import { track } from '@/lib/analytics';
import { useToast } from '@/components/ui/Toast';
import Portal from '@/components/ui/Portal';
import DateTimePicker from '@/components/ui/DateTimePicker';
import type {
  UserContext,
  EventType,
  EventScope,
  EventTarget,
} from '@/lib/event-permissions';
import { isDirigeant } from '@/lib/event-permissions';
import { ALL_GAME_DEFS, getGameColor, getGameColorRgb, getGameShortLabel } from '@/lib/games-registry';
import type { Team, Member, StructureRoles, CalendarEvent } from './CalendarSection';

interface Props {
  structureId: string;
  structureGames: string[];
  teams: Team[];
  members: Member[];
  userContext: UserContext;
  structureRoles: StructureRoles;
  // Date/heure pré-remplies, passées quand on a cliqué sur une case du calendrier.
  // Format "YYYY-MM-DDTHH:mm" (heure locale), contrat de DateTimePicker.
  // Ignorées en mode édition (les dates de l'existingEvent gagnent).
  initialStartsAt?: string;
  initialEndsAt?: string;
  /**
   * Pré-remplissage scope/type/audience staff utilisé par le click-to-create
   * depuis l'onglet STAFF de la heatmap dispos (Matt 2026-05-31).
   * Permet d'ouvrir la modal direct sur "réunion staff" avec les staff dispos
   * pré-cochés. Ignorés en mode édition.
   */
  initialScope?: EventScope;
  initialType?: EventType;
  initialStaffUserIds?: string[];
  /**
   * Mode édition : si fourni, la modal s'ouvre avec les champs préremplis
   * et soumet via PATCH au lieu de POST. La cible (target) et le type sont
   * verrouillés pour éviter de casser les présences / champs spécifiques.
   */
  existingEvent?: CalendarEvent;
  onClose: () => void;
  /** Callback unique pour création OU édition réussie (le caller raffraîchit). */
  onCreated: () => void;
}

/** Format "YYYY-MM-DDTHH:mm" en heure locale pour les inputs DateTimePicker.
 *  Les ISO strings de Firestore sont en UTC ; on les convertit en local. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventFormModal({
  structureId,
  structureGames,
  teams,
  members,
  userContext,
  structureRoles,
  initialStartsAt,
  initialEndsAt,
  initialScope,
  initialType,
  initialStaffUserIds,
  existingEvent,
  onClose,
  onCreated,
}: Props) {
  const toast = useToast();
  const isEditMode = !!existingEvent;

  // Pré-remplissage en mode édition : on lit l'event existant. En mode création,
  // valeurs vides (sauf initialStartsAt/EndsAt si click sur case calendrier).
  const [title, setTitle] = useState(existingEvent?.title ?? '');
  const [type, setType] = useState<EventType>(existingEvent?.type ?? initialType ?? 'training');
  const [description, setDescription] = useState(existingEvent?.description ?? '');
  const [location, setLocation] = useState(existingEvent?.location ?? '');
  const [startsAt, setStartsAt] = useState(
    existingEvent ? isoToLocalInput(existingEvent.startsAt) : (initialStartsAt ?? '')
  );
  const [endsAt, setEndsAt] = useState(
    existingEvent ? isoToLocalInput(existingEvent.endsAt) : (initialEndsAt ?? '')
  );
  // Scope/cible : pré-remplis depuis l'event en édition (mais le UI les verrouillera).
  // initialScope est utilisé pour le click-to-create depuis l'onglet STAFF (= 'staff').
  const [scope, setScope] = useState<EventScope>(
    existingEvent?.target.scope ?? initialScope ?? (isDirigeant(userContext) ? 'structure' : 'teams')
  );
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(
    existingEvent?.target.scope === 'teams' ? (existingEvent.target.teamIds ?? []) : []
  );
  const [game, setGame] = useState<string>(
    existingEvent?.target.scope === 'game' ? (existingEvent.target.game ?? '') : ''
  );
  const [adversaire, setAdversaire] = useState(existingEvent?.adversaire ?? '');
  const [adversaireLogoUrl, setAdversaireLogoUrl] = useState(existingEvent?.adversaireLogoUrl ?? '');
  const [resultat, setResultat] = useState(existingEvent?.resultat ?? '');
  // Configuration de partie (scrim/match uniquement, Matt 2026-05-31).
  // '' (string vide) = non renseigné côté UI → null côté serveur au submit.
  const [gameHostedBy, setGameHostedBy] = useState<'us' | 'opponent' | ''>(
    existingEvent?.gameHostedBy ?? ''
  );
  const [gameName, setGameName] = useState(existingEvent?.gameName ?? '');
  const [gamePassword, setGamePassword] = useState(existingEvent?.gamePassword ?? '');
  const [gameFormat, setGameFormat] = useState<'bo3' | 'bo5' | 'bo7' | 'free_1h' | ''>(
    existingEvent?.gameFormat ?? ''
  );
  const [tournoiNom, setTournoiNom] = useState(existingEvent?.tournoiNom ?? '');
  const [tournoiFormat, setTournoiFormat] = useState(existingEvent?.tournoiFormat ?? '');
  const [tournoiUrl, setTournoiUrl] = useState(existingEvent?.tournoiUrl ?? '');
  const [tournoiInscriptionUrl, setTournoiInscriptionUrl] = useState(existingEvent?.tournoiInscriptionUrl ?? '');
  const [tournoiReglementUrl, setTournoiReglementUrl] = useState(existingEvent?.tournoiReglementUrl ?? '');
  const [markDone, setMarkDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sélection fine des joueurs ("feuille de match"), seulement quand UNE équipe
  // est ciblée. Clé = uid ; true = invité + pingé, false = exclu.
  const [playerSelection, setPlayerSelection] = useState<Record<string, boolean>>({});

  // Sélection fine du staff (scope='staff'). Clé = uid ; obligatoire au moins un coché.
  // Pré-coché depuis initialStaffUserIds (click-to-create depuis heatmap STAFF) :
  // tous les staff dispos sur le créneau cliqué sont auto-cochés, l'user peut décocher.
  const [staffSelection, setStaffSelection] = useState<Record<string, boolean>>(() => {
    if (initialStaffUserIds && initialStaffUserIds.length > 0) {
      const init: Record<string, boolean> = {};
      for (const uid of initialStaffUserIds) init[uid] = true;
      return init;
    }
    return {};
  });

  // Qui peut créer un événement scope='staff' : dirigeants + managers (pas les coachs).
  const canCreateStaffEvent = isDirigeant(userContext) || userContext.isManager;

  // Audience staff dérivée côté client : 4 groupes (dirigeants/managers/coachs/capitaines).
  // Fusion rôles structure + staff d'équipe via sub_teams.staffRoles + capitaines.
  const staffAudienceGroups = useMemo(() => {
    const dir = new Set<string>();
    if (structureRoles.founderId) dir.add(structureRoles.founderId);
    for (const id of structureRoles.coFounderIds ?? []) if (id) dir.add(id);

    const mgr = new Set<string>();
    for (const id of structureRoles.managerIds ?? []) if (id) mgr.add(id);
    const coach = new Set<string>();
    for (const id of structureRoles.coachIds ?? []) if (id) coach.add(id);
    const captain = new Set<string>();

    for (const t of teams) {
      const staffIds = t.staffIds ?? [];
      const staffRoles = t.staffRoles ?? {};
      for (const uid of staffIds) {
        if (!uid) continue;
        const r = staffRoles[uid] ?? 'coach';
        if (r === 'manager') mgr.add(uid);
        else coach.add(uid);
      }
      if (t.captainId) captain.add(t.captainId);
    }

    // Dédupe inter-groupes : on privilégie le rôle le plus haut.
    // Hiérarchie : dirigeant > manager > coach > capitaine.
    for (const id of dir) { mgr.delete(id); coach.delete(id); captain.delete(id); }
    for (const id of mgr) { coach.delete(id); captain.delete(id); }
    for (const id of coach) captain.delete(id);

    return {
      dirigeants: Array.from(dir),
      managers: Array.from(mgr),
      coaches: Array.from(coach),
      captains: Array.from(captain),
    };
  }, [structureRoles, teams]);

  // Helper : résout un uid → {displayName, avatarUrl} via la liste members.
  function memberInfo(uid: string): { displayName: string; avatarUrl: string } {
    const m = members.find(m => m.userId === uid);
    return {
      displayName: m?.displayName || uid.replace(/^discord_/, ''),
      avatarUrl: m?.avatarUrl || m?.discordAvatar || '',
    };
  }

  // Roster de l'équipe unique sélectionnée (si applicable), titulaires + remplaçants + staff
  const singleTeamRoster = useMemo(() => {
    if (scope !== 'teams' || selectedTeamIds.length !== 1) return null;
    const team = teams.find(t => t.id === selectedTeamIds[0]);
    if (!team) return null;
    const titulaires = team.playerIds ?? [];
    const remplacants = team.subIds ?? [];
    const staff = team.staffIds ?? [];
    // Dédupe en préservant l'ordre (un staff qui est aussi joueur apparaît en joueur)
    const seen = new Set<string>();
    const order: Array<{ uid: string; role: 'titulaire' | 'remplacant' | 'staff' }> = [];
    for (const uid of titulaires) if (uid && !seen.has(uid)) { seen.add(uid); order.push({ uid, role: 'titulaire' }); }
    for (const uid of remplacants) if (uid && !seen.has(uid)) { seen.add(uid); order.push({ uid, role: 'remplacant' }); }
    for (const uid of staff) if (uid && !seen.has(uid)) { seen.add(uid); order.push({ uid, role: 'staff' }); }
    return { team, entries: order };
  }, [scope, selectedTeamIds, teams]);

  // Quand le roster change, tout pré-cocher par défaut.
  useEffect(() => {
    if (!singleTeamRoster) {
      setPlayerSelection({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const e of singleTeamRoster.entries) next[e.uid] = true;
    setPlayerSelection(next);
  }, [singleTeamRoster]);

  // Quand on passe en scope='staff', pré-cocher tout le monde par défaut.
  useEffect(() => {
    if (scope !== 'staff') {
      setStaffSelection({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const uid of staffAudienceGroups.dirigeants) next[uid] = true;
    for (const uid of staffAudienceGroups.managers) next[uid] = true;
    for (const uid of staffAudienceGroups.coaches) next[uid] = true;
    setStaffSelection(next);
  }, [scope, staffAudienceGroups]);

  // Les équipes dispos au ciblage :
  //   - dirigeant → toutes
  //   - sinon → uniquement celles dont l'user est staff
  const selectableTeams = isDirigeant(userContext)
    ? teams
    : teams.filter(t =>
        userContext.staffedTeamIds.includes(t.id) ||
        (userContext.captainOfTeamIds ?? []).includes(t.id)
      );

  function toggleTeam(id: string) {
    setSelectedTeamIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (!title.trim()) return toast.error('Titre obligatoire');
    if (!startsAt || !endsAt) return toast.error('Dates obligatoires');

    const startIso = new Date(startsAt).toISOString();
    const endIso = new Date(endsAt).toISOString();

    // ─── MODE ÉDITION : PATCH sans toucher à la cible ni au type ──────────
    // La cible/type sont figés (cf. doc en haut). On envoie uniquement les
    // champs éditables. Le back filtre déjà selon event.type pour les champs
    // spécifiques (adversaire pour match/scrim, tournoi* pour tournoi).
    if (isEditMode && existingEvent) {
      setSubmitting(true);
      try {
        await api(`/api/structures/${structureId}/events/${existingEvent.id}`, {
          method: 'PATCH',
          body: {
            title: title.trim(),
            description,
            location,
            startsAt: startIso,
            endsAt: endIso,
            // Champs spécifiques : envoyés uniquement si pertinents pour le type
            // existant. Le back filtre, mais on évite d'envoyer du bruit.
            ...(type === 'match' || type === 'scrim'
              ? {
                  adversaire: adversaire || '',
                  resultat: resultat || '',
                  // Configuration de partie (Matt 2026-05-31) : envoyer en édition aussi.
                  // String vide = clear (back interprète "" comme null).
                  gameHostedBy: gameHostedBy || '',
                  gameName: gameName || '',
                  gamePassword: gamePassword || '',
                  gameFormat: gameFormat || '',
                }
              : {}),
            ...(type === 'match'
              ? { adversaireLogoUrl: adversaireLogoUrl || '' }
              : {}),
            ...(type === 'tournoi'
              ? {
                tournoiNom: tournoiNom || '',
                tournoiFormat: tournoiFormat || '',
                tournoiUrl: tournoiUrl || '',
                tournoiInscriptionUrl: tournoiInscriptionUrl || '',
                tournoiReglementUrl: tournoiReglementUrl || '',
              }
              : {}),
          },
        });
        toast.success('Événement modifié');
        onCreated();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erreur réseau');
      }
      setSubmitting(false);
      return;
    }

    // ─── MODE CRÉATION : POST avec target complète + validation feuille de match ──

    // Si feuille de match active (1 équipe) : si certains joueurs sont décochés,
    // on envoie userIds avec la sous-sélection. Si tout est coché, on omet le
    // champ pour garder le comportement par défaut côté back.
    let userIdsOverride: string[] | undefined = undefined;
    if (scope === 'teams' && singleTeamRoster && singleTeamRoster.entries.length > 0) {
      const keep = singleTeamRoster.entries
        .map(e => e.uid)
        .filter(uid => playerSelection[uid]);
      if (keep.length === 0) {
        return toast.error('Coche au moins un joueur.');
      }
      if (keep.length < singleTeamRoster.entries.length) {
        userIdsOverride = keep;
      }
    }

    // scope='staff' : sélection user-par-user obligatoire, au moins un coché.
    let staffUserIds: string[] = [];
    if (scope === 'staff') {
      const pool = [
        ...staffAudienceGroups.dirigeants,
        ...staffAudienceGroups.managers,
        ...staffAudienceGroups.coaches,
        ...staffAudienceGroups.captains,
      ];
      staffUserIds = pool.filter(uid => staffSelection[uid]);
      if (staffUserIds.length === 0) {
        return toast.error('Coche au moins un membre du staff.');
      }
    }

    const target: EventTarget = scope === 'structure'
      ? { scope: 'structure' }
      : scope === 'game'
        ? { scope: 'game', game }
        : scope === 'staff'
          ? { scope: 'staff', userIds: staffUserIds }
          : { scope: 'teams', teamIds: selectedTeamIds, ...(userIdsOverride ? { userIds: userIdsOverride } : {}) };

    if (scope === 'teams' && selectedTeamIds.length === 0) {
      return toast.error('Choisis au moins une équipe');
    }
    if (scope === 'game' && !game) {
      return toast.error('Choisis un jeu');
    }

    setSubmitting(true);
    try {
      await api(`/api/structures/${structureId}/events`, {
        method: 'POST',
        body: {
          title: title.trim(),
          type,
          description,
          location,
          startsAt: startIso,
          endsAt: endIso,
          target,
          adversaire: adversaire || undefined,
          adversaireLogoUrl: type === 'match' && adversaireLogoUrl ? adversaireLogoUrl : undefined,
          resultat: resultat || undefined,
          // Configuration de partie : envoyée uniquement pour scrim/match (serveur ignore sinon)
          gameHostedBy: (type === 'scrim' || type === 'match') ? (gameHostedBy || undefined) : undefined,
          gameName: (type === 'scrim' || type === 'match') ? (gameName || undefined) : undefined,
          gamePassword: (type === 'scrim' || type === 'match') ? (gamePassword || undefined) : undefined,
          gameFormat: (type === 'scrim' || type === 'match') ? (gameFormat || undefined) : undefined,
          tournoiNom: type === 'tournoi' ? (tournoiNom || undefined) : undefined,
          tournoiFormat: type === 'tournoi' ? (tournoiFormat || undefined) : undefined,
          tournoiUrl: type === 'tournoi' ? (tournoiUrl || undefined) : undefined,
          tournoiInscriptionUrl: type === 'tournoi' ? (tournoiInscriptionUrl || undefined) : undefined,
          tournoiReglementUrl: type === 'tournoi' ? (tournoiReglementUrl || undefined) : undefined,
          markDoneImmediately: markDone,
        },
      });
      toast.success('Événement créé');
      track('event_created', {
        type,
        scope,
        teamsCount: scope === 'teams' ? selectedTeamIds.length : 0,
      });
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur réseau');
    }
    setSubmitting(false);
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="bevel relative w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold)50, transparent 70%)' }} />
        <div className="p-6 space-y-4">
          <h2 className="font-display text-2xl">
            {isEditMode ? "MODIFIER L'ÉVÉNEMENT" : 'NOUVEL ÉVÉNEMENT'}
          </h2>

          <div>
            <label className="t-label block mb-1.5">Titre *</label>
            <input type="text" className="settings-input w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="Entraînement mardi soir" maxLength={120} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="t-label block mb-1.5">
                Type {isEditMode && <span style={{ color: 'var(--s-text-muted)', fontSize: 12 }}>(verrouillé)</span>}
              </label>
              <select
                className="settings-input w-full"
                value={type}
                onChange={e => setType(e.target.value as EventType)}
                disabled={isEditMode}
                style={isEditMode ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
              >
                <option value="training">Entraînement</option>
                <option value="scrim">Scrim</option>
                <option value="match">Match</option>
                <option value="tournoi">Tournoi</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div>
              <label className="t-label block mb-1.5">Lieu (optionnel)</label>
              <input type="text" className="settings-input w-full" value={location} onChange={e => setLocation(e.target.value)} placeholder="Discord, IRL..." maxLength={200} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="t-label block mb-1.5">Début *</label>
              <DateTimePicker
                value={startsAt}
                onChange={setStartsAt}
                placeholder="Choisir début..."
                presetMode="start"
              />
            </div>
            <div>
              <label className="t-label block mb-1.5">Fin *</label>
              <DateTimePicker
                value={endsAt}
                onChange={setEndsAt}
                placeholder="Choisir fin..."
                presetMode="end"
                anchorIso={startsAt}
                min={startsAt}
              />
            </div>
          </div>

          {/* Cible : verrouillée en mode édition (changer la cible casserait
              les présences déjà répondues). Affiche un résumé read-only à la
              place du picker. Sinon : picker complet (création). */}
          {isEditMode ? (
            <div>
              <label className="t-label block mb-1.5">
                Cible <span style={{ color: 'var(--s-text-muted)', fontSize: 12 }}>(verrouillée)</span>
              </label>
              <div
                className="bevel-sm p-3"
                style={{
                  background: 'var(--s-elevated)',
                  border: '1px solid var(--s-border)',
                  fontSize: 12,
                  color: 'var(--s-text-dim)',
                }}
              >
                {(() => {
                  const t = existingEvent!.target;
                  if (t.scope === 'structure') return 'Toute la structure';
                  if (t.scope === 'staff') return `Staff (${(t.userIds ?? []).length} membres)`;
                  if (t.scope === 'game') return `Tous les joueurs ${getGameShortLabel(t.game ?? '')}`;
                  if (t.scope === 'teams') {
                    const names = (t.teamIds ?? [])
                      .map(id => teams.find(team => team.id === id)?.name ?? id)
                      .join(' · ');
                    return `Équipe(s) : ${names || '?'}`;
                  }
                  return '?';
                })()}
              </div>
              <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                Pour changer la cible, supprime cet événement et recrée-en un nouveau.
              </p>
            </div>
          ) : (
          <div>
            <label className="t-label block mb-1.5">Cible *</label>
            <div className="flex gap-2 mb-2">
              {isDirigeant(userContext) && (
                <button type="button" onClick={() => setScope('structure')}
                  className="tag transition-all duration-150"
                  style={{
                    background: scope === 'structure' ? 'rgba(255,184,0,0.15)' : 'transparent',
                    color: scope === 'structure' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                    borderColor: scope === 'structure' ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                    cursor: 'pointer', padding: '6px 12px', fontSize: '12px',
                  }}>
                  Toute la structure
                </button>
              )}
              <button type="button" onClick={() => setScope('teams')}
                className="tag transition-all duration-150"
                style={{
                  background: scope === 'teams' ? 'rgba(255,184,0,0.15)' : 'transparent',
                  color: scope === 'teams' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                  borderColor: scope === 'teams' ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                  cursor: 'pointer', padding: '6px 12px', fontSize: '12px',
                }}>
                Équipes
              </button>
              {isDirigeant(userContext) && (
                <button type="button" onClick={() => setScope('game')}
                  className="tag transition-all duration-150"
                  style={{
                    background: scope === 'game' ? 'rgba(255,184,0,0.15)' : 'transparent',
                    color: scope === 'game' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                    borderColor: scope === 'game' ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                    cursor: 'pointer', padding: '6px 12px', fontSize: '12px',
                  }}>
                  Un jeu
                </button>
              )}
              {canCreateStaffEvent && (
                <button type="button" onClick={() => setScope('staff')}
                  className="tag transition-all duration-150"
                  style={{
                    background: scope === 'staff' ? 'rgba(255,184,0,0.15)' : 'transparent',
                    color: scope === 'staff' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                    borderColor: scope === 'staff' ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                    cursor: 'pointer', padding: '6px 12px', fontSize: '12px',
                  }}>
                  Staff
                </button>
              )}
            </div>

            {scope === 'teams' && (
              <div className="flex flex-wrap gap-2 p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                {selectableTeams.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe disponible.</p>
                ) : selectableTeams.map(t => {
                  const isSelected = selectedTeamIds.includes(t.id);
                  const rgb = getGameColorRgb(t.game);
                  const fg = getGameColor(t.game);
                  return (
                    <button key={t.id} type="button" onClick={() => toggleTeam(t.id)}
                      className="tag transition-all duration-150"
                      style={{
                        background: isSelected ? `rgba(${rgb}, 0.15)` : 'transparent',
                        color: isSelected ? fg : 'var(--s-text-dim)',
                        borderColor: isSelected ? `rgba(${rgb}, 0.4)` : 'var(--s-border)',
                        cursor: 'pointer', padding: '4px 10px', fontSize: '12px',
                      }}>
                      {t.name} · {getGameShortLabel(t.game)}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Feuille de match : sous-sélection de joueurs quand UNE seule équipe ciblée */}
            {scope === 'teams' && singleTeamRoster && singleTeamRoster.entries.length > 0 && (
              <div className="mt-3 p-3 bevel-sm space-y-3"
                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users size={12} style={{ color: 'var(--s-text-dim)' }} />
                    <span className="t-label">Feuille de match</span>
                    <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      {singleTeamRoster.entries.filter(e => playerSelection[e.uid]).length}/{singleTeamRoster.entries.length}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button type="button"
                      className="tag tag-neutral"
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of singleTeamRoster.entries) next[e.uid] = true;
                        setPlayerSelection(next);
                      }}>
                      Tous
                    </button>
                    <button type="button"
                      className="tag tag-neutral"
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of singleTeamRoster.entries) next[e.uid] = e.role === 'titulaire';
                        setPlayerSelection(next);
                      }}>
                      Titulaires
                    </button>
                    <button type="button"
                      className="tag tag-neutral"
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of singleTeamRoster.entries) next[e.uid] = false;
                        setPlayerSelection(next);
                      }}>
                      Aucun
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {singleTeamRoster.entries.map(entry => {
                    const m = members.find(x => x.userId === entry.uid);
                    const name = m?.displayName || entry.uid;
                    const checked = !!playerSelection[entry.uid];
                    const roleLabel = entry.role === 'titulaire' ? 'TIT' : entry.role === 'remplacant' ? 'SUB' : 'STAFF';
                    const roleColor = entry.role === 'titulaire'
                      ? 'var(--s-gold)'
                      : entry.role === 'remplacant'
                        ? 'var(--s-text-dim)'
                        : 'var(--s-gold)';
                    return (
                      <label key={entry.uid}
                        className="flex items-center gap-2 p-2 cursor-pointer transition-colors duration-150"
                        style={{
                          background: checked ? 'rgba(255,184,0,0.08)' : 'transparent',
                          border: `1px solid ${checked ? 'rgba(255,184,0,0.3)' : 'var(--s-border)'}`,
                        }}>
                        <input type="checkbox" checked={checked}
                          onChange={e => setPlayerSelection(prev => ({ ...prev, [entry.uid]: e.target.checked }))} />
                        <span className="text-xs flex-1 truncate" style={{ color: checked ? 'var(--s-text)' : 'var(--s-text-dim)' }}>
                          {name}
                        </span>
                        <span className="t-label" style={{ color: roleColor, fontSize: '12px' }}>
                          {roleLabel}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Seuls les joueurs cochés seront invités et pingés dans Discord.
                </p>
              </div>
            )}

            {scope === 'game' && (
              <div className="flex gap-2">
                {ALL_GAME_DEFS.filter(g => structureGames.includes(g.id)).map(g => {
                  const isSelected = game === g.id;
                  return (
                    <button key={g.id} type="button" onClick={() => setGame(g.id)}
                      className="tag"
                      style={{
                        cursor: 'pointer',
                        padding: '4px 10px',
                        fontSize: '12px',
                        background: isSelected ? `rgba(${g.colorRgb}, 0.1)` : 'rgba(255,255,255,0.04)',
                        color: isSelected ? g.colorLight : 'var(--s-text-dim)',
                        borderColor: isSelected ? `rgba(${g.colorRgb}, 0.25)` : 'var(--s-border)',
                      }}>
                      {g.label}
                    </button>
                  );
                })}
              </div>
            )}

            {scope === 'staff' && (() => {
              const groups: Array<{
                key: 'dirigeants' | 'managers' | 'coaches' | 'captains';
                label: string;
                color: string;
                uids: string[];
              }> = [
                { key: 'dirigeants', label: 'Dirigeants', color: 'var(--s-gold)', uids: staffAudienceGroups.dirigeants },
                { key: 'managers', label: 'Responsables / Managers', color: 'var(--s-gold)', uids: staffAudienceGroups.managers },
                { key: 'coaches', label: 'Coachs', color: 'var(--s-blue)', uids: staffAudienceGroups.coaches },
                { key: 'captains', label: 'Capitaines', color: 'var(--s-green)', uids: staffAudienceGroups.captains },
              ];
              const allUids = [
                ...staffAudienceGroups.dirigeants,
                ...staffAudienceGroups.managers,
                ...staffAudienceGroups.coaches,
                ...staffAudienceGroups.captains,
              ];
              const total = allUids.length;
              const checkedCount = allUids.filter(uid => staffSelection[uid]).length;
              return (
                <div className="mt-0 p-3 bevel-sm space-y-3"
                  style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Users size={12} style={{ color: 'var(--s-text-dim)' }} />
                      <span className="t-label">Invités staff</span>
                      <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        {checkedCount}/{total}
                      </span>
                    </div>
                    {total > 0 && (
                      <div className="flex gap-1">
                        <button type="button"
                          className="tag tag-neutral"
                          style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                          onClick={() => {
                            const next: Record<string, boolean> = {};
                            for (const g of groups) for (const uid of g.uids) next[uid] = true;
                            setStaffSelection(next);
                          }}>
                          Tout
                        </button>
                        <button type="button"
                          className="tag tag-neutral"
                          style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                          onClick={() => setStaffSelection({})}>
                          Aucun
                        </button>
                      </div>
                    )}
                  </div>

                  {total === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Aucun membre staff (dirigeants/responsables/coachs/capitaines) dans cette structure.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {groups.map(g => {
                        if (g.uids.length === 0) return null;
                        const groupChecked = g.uids.filter(uid => staffSelection[uid]).length;
                        const allChecked = groupChecked === g.uids.length;
                        return (
                          <div key={g.key} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="t-label" style={{ color: g.color, fontSize: '12px' }}>
                                  {g.label}
                                </span>
                                <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                                  {groupChecked}/{g.uids.length}
                                </span>
                              </div>
                              <button type="button"
                                className="tag tag-neutral"
                                style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                                onClick={() => {
                                  setStaffSelection(prev => {
                                    const next = { ...prev };
                                    if (allChecked) for (const uid of g.uids) next[uid] = false;
                                    else for (const uid of g.uids) next[uid] = true;
                                    return next;
                                  });
                                }}>
                                {allChecked ? 'Décocher' : 'Tout cocher'}
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {g.uids.map(uid => {
                                const checked = !!staffSelection[uid];
                                const info = memberInfo(uid);
                                return (
                                  <label key={uid}
                                    className="flex items-center gap-2 p-2 cursor-pointer transition-colors duration-150"
                                    style={{
                                      background: checked ? 'rgba(255,184,0,0.08)' : 'transparent',
                                      border: `1px solid ${checked ? 'rgba(255,184,0,0.3)' : 'var(--s-border)'}`,
                                    }}>
                                    <input type="checkbox" checked={checked}
                                      onChange={e => setStaffSelection(prev => ({ ...prev, [uid]: e.target.checked }))} />
                                    <span className="text-xs flex-1 truncate"
                                      style={{ color: checked ? 'var(--s-text)' : 'var(--s-text-dim)' }}>
                                      {info.displayName}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    Événement privé, seuls les invités cochés le voient et sont notifiés. Invisible pour les joueurs.
                  </p>
                </div>
              );
            })()}
          </div>
          )}

          <div>
            <label className="t-label block mb-1.5">Description (optionnel)</label>
            <textarea className="settings-input w-full" rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} />
          </div>

          {type === 'match' && (
            <div className="bevel-sm p-3 space-y-3"
              style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.3)' }}>
              <div className="flex items-center gap-2">
                <span className="tag"
                  style={{ background: 'rgba(255,184,0,0.15)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)', fontSize: '12px', padding: '2px 8px' }}>
                  <Swords size={11} /> MATCH OFFICIEL
                </span>
                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  Affiché avec mise en avant côté site et Discord.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5">Adversaire</label>
                  <input type="text" className="settings-input w-full" value={adversaire}
                    onChange={e => setAdversaire(e.target.value)} placeholder="Nom de l'équipe adverse" />
                </div>
                <div>
                  <label className="t-label block mb-1.5">Résultat (optionnel)</label>
                  <input type="text" className="settings-input w-full" value={resultat}
                    onChange={e => setResultat(e.target.value)} placeholder="3-2, WIN..." />
                </div>
              </div>
              <div>
                <label className="t-label block mb-1.5">Logo adversaire (URL HTTPS, optionnel)</label>
                <input type="url" className="settings-input w-full" value={adversaireLogoUrl}
                  onChange={e => setAdversaireLogoUrl(e.target.value)}
                  placeholder="https://..." maxLength={500} />
                <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                  Affiché dans la card et dans l&apos;embed Discord. HTTPS uniquement.
                </p>
              </div>
            </div>
          )}

          {type === 'scrim' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="t-label block mb-1.5">Adversaire (optionnel)</label>
                <input type="text" className="settings-input w-full" value={adversaire}
                  onChange={e => setAdversaire(e.target.value)} />
              </div>
              <div>
                <label className="t-label block mb-1.5">Résultat (optionnel)</label>
                <input type="text" className="settings-input w-full" value={resultat}
                  onChange={e => setResultat(e.target.value)} placeholder="3-2, WIN..." />
              </div>
            </div>
          )}

          {/* Configuration de partie (Matt 2026-05-31) : qui héberge la lobby,
              nom + mdp partie, format. Visible pour scrim ET match. Format
              free_1h disponible uniquement pour scrim. Le mot de passe est
              servi UNIQUEMENT aux invités côté API (filtré serveur). */}
          {(type === 'scrim' || type === 'match') && (
            <div className="bevel-sm p-3 space-y-3"
              style={{ background: 'rgba(0,129,255,0.04)', border: '1px solid rgba(0,129,255,0.25)' }}>
              <div className="flex items-center gap-2">
                <span className="tag"
                  style={{ background: 'rgba(0,129,255,0.15)', color: 'var(--s-blue)', borderColor: 'rgba(0,129,255,0.4)', fontSize: '12px', padding: '2px 8px' }}>
                  <Gamepad2 size={11} /> PARTIE
                </span>
                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  Infos d&apos;accès à la lobby (visibles uniquement aux invités).
                </span>
              </div>

              {/* Qui héberge la lobby */}
              <div>
                <label className="t-label block mb-1.5">Qui héberge la partie ?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button"
                    onClick={() => setGameHostedBy(gameHostedBy === 'us' ? '' : 'us')}
                    className="bevel-sm text-xs font-semibold transition-colors"
                    style={{
                      padding: '8px 12px',
                      background: gameHostedBy === 'us' ? 'rgba(0,129,255,0.15)' : 'var(--s-elevated)',
                      border: `1px solid ${gameHostedBy === 'us' ? 'rgba(0,129,255,0.5)' : 'var(--s-border)'}`,
                      color: gameHostedBy === 'us' ? 'var(--s-blue)' : 'var(--s-text-dim)',
                      cursor: 'pointer',
                    }}>
                    On héberge
                  </button>
                  <button type="button"
                    onClick={() => setGameHostedBy(gameHostedBy === 'opponent' ? '' : 'opponent')}
                    className="bevel-sm text-xs font-semibold transition-colors"
                    style={{
                      padding: '8px 12px',
                      background: gameHostedBy === 'opponent' ? 'rgba(0,129,255,0.15)' : 'var(--s-elevated)',
                      border: `1px solid ${gameHostedBy === 'opponent' ? 'rgba(0,129,255,0.5)' : 'var(--s-border)'}`,
                      color: gameHostedBy === 'opponent' ? 'var(--s-blue)' : 'var(--s-text-dim)',
                      cursor: 'pointer',
                    }}>
                    L&apos;adversaire héberge
                  </button>
                </div>
              </div>

              {/* Nom de la game + mot de passe */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5">Nom de la partie</label>
                  <input type="text" className="settings-input w-full" value={gameName}
                    onChange={e => setGameName(e.target.value)}
                    placeholder={gameHostedBy === 'opponent' ? "Donné par l'adversaire" : 'ex: Aedral vs ...'}
                    maxLength={60} />
                </div>
                <div>
                  <label className="t-label block mb-1.5">Mot de passe (optionnel)</label>
                  <input type="text" className="settings-input w-full" value={gamePassword}
                    onChange={e => setGamePassword(e.target.value)}
                    placeholder={gameHostedBy === 'opponent' ? "Donné par l'adversaire" : 'Mot de passe lobby'}
                    maxLength={60} />
                </div>
              </div>

              {/* Format : BO3/BO5/BO7 + free_1h pour scrim uniquement */}
              <div>
                <label className="t-label block mb-1.5">Format</label>
                <div className="flex flex-wrap gap-2">
                  {(['bo3', 'bo5', 'bo7'] as const).map(f => (
                    <button key={f} type="button"
                      onClick={() => setGameFormat(gameFormat === f ? '' : f)}
                      className="bevel-sm text-xs font-semibold transition-colors"
                      style={{
                        padding: '6px 14px',
                        background: gameFormat === f ? 'rgba(0,129,255,0.15)' : 'var(--s-elevated)',
                        border: `1px solid ${gameFormat === f ? 'rgba(0,129,255,0.5)' : 'var(--s-border)'}`,
                        color: gameFormat === f ? 'var(--s-blue)' : 'var(--s-text-dim)',
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                      }}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                  {type === 'scrim' && (
                    <button type="button"
                      onClick={() => setGameFormat(gameFormat === 'free_1h' ? '' : 'free_1h')}
                      className="bevel-sm text-xs font-semibold transition-colors"
                      style={{
                        padding: '6px 14px',
                        background: gameFormat === 'free_1h' ? 'rgba(0,129,255,0.15)' : 'var(--s-elevated)',
                        border: `1px solid ${gameFormat === 'free_1h' ? 'rgba(0,129,255,0.5)' : 'var(--s-border)'}`,
                        color: gameFormat === 'free_1h' ? 'var(--s-blue)' : 'var(--s-text-dim)',
                        cursor: 'pointer',
                      }}>
                      1h libre
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {type === 'tournoi' && (
            <div className="bevel-sm p-3 space-y-3"
              style={{ background: 'rgba(0,217,181,0.05)', border: '1px solid rgba(0,217,181,0.3)' }}>
              <div className="flex items-center gap-2">
                <span className="tag"
                  style={{ background: 'rgba(0,217,181,0.15)', color: '#00D9B5', borderColor: 'rgba(0,217,181,0.4)', fontSize: '12px', padding: '2px 8px' }}>
                  <Trophy size={11} /> TOURNOI
                </span>
                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  Compétition externe ou interne, détails optionnels.
                </span>
              </div>
              <div>
                <label className="t-label block mb-1.5">Nom du tournoi</label>
                <input type="text" className="settings-input w-full" value={tournoiNom}
                  onChange={e => setTournoiNom(e.target.value)}
                  placeholder="Nom du tournoi" maxLength={200} />
              </div>
              <div>
                <label className="t-label block mb-1.5">Format (optionnel)</label>
                <input type="text" className="settings-input w-full" value={tournoiFormat}
                  onChange={e => setTournoiFormat(e.target.value)}
                  placeholder="ex: BO3 single elim" maxLength={200} />
              </div>
              <div>
                <label className="t-label block mb-1.5">Lien du tournoi (optionnel)</label>
                <input type="url" className="settings-input w-full" value={tournoiUrl}
                  onChange={e => setTournoiUrl(e.target.value)}
                  placeholder="https://..." maxLength={500} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5">Lien d&apos;inscription (optionnel)</label>
                  <input type="url" className="settings-input w-full" value={tournoiInscriptionUrl}
                    onChange={e => setTournoiInscriptionUrl(e.target.value)}
                    placeholder="https://..." maxLength={500} />
                </div>
                <div>
                  <label className="t-label block mb-1.5">Lien du règlement (optionnel)</label>
                  <input type="url" className="settings-input w-full" value={tournoiReglementUrl}
                    onChange={e => setTournoiReglementUrl(e.target.value)}
                    placeholder="https://..." maxLength={500} />
                </div>
              </div>
            </div>
          )}

          {/* "Créer directement comme terminé" : uniquement en création
              (rétroactif), pas en édition d'un event existant. */}
          {!isEditMode && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="markDone" checked={markDone} onChange={e => setMarkDone(e.target.checked)} />
              <label htmlFor="markDone" className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                Créer directement comme terminé (rétroactif)
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-springs btn-secondary bevel-sm">
              Annuler
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="btn-springs btn-primary bevel-sm">
              {submitting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : isEditMode ? (
                <Save size={12} />
              ) : (
                <Plus size={12} />
              )}
              <span>{isEditMode ? 'Enregistrer' : 'Créer'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}
