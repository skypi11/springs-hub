'use client';

// Vue Semaine du calendrier de structure, grille jours × créneaux 30 min.
//
// Deux couches superposées :
//  1. Événements (toujours), blocs colorés par jeu, positionnés à l'heure.
//     Clic sur un bloc → détail ; clic sur une case vide → création pré-remplie.
//  2. Dispos + consensus (quand UNE équipe est sélectionnée dans le filtre) ,
//     heatmap du nombre de joueurs dispo + blocs consensus encadrés + liste
//     des joueurs avec isolation individuelle.
//
// La couche dispos n'existe que sur la semaine courante + la suivante : c'est
// la fenêtre sur laquelle les joueurs déclarent leurs créneaux.

import { useEffect, useMemo, useState } from 'react';
import { isDirigeant, type UserContext } from '@/lib/event-permissions';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Users, Check, CalendarClock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import {
  addDays, getMondayYmd, parisYmd, generateWeekGrid, addMinutesToIso,
  formatSlotTime, type MatchBlock,
} from '@/lib/availability';
import type { CalendarEvent, Team } from './CalendarSection';
import { TYPE_INFO } from './CalendarSection';
import { eventGameColor, eventTargetLabel } from './MonthView';

const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const SLOT_HEIGHT = 22;        // hauteur d'un créneau de 30 min (px)
const SLOT_COUNT = 36;         // 8h → 2h = 36 créneaux
// Marge à droite de chaque colonne, jamais couverte par les blocs événements :
// garantit qu'on peut toujours cliquer pour créer, même quand le créneau est plein.
const CREATE_GUTTER = 18;

// Axe horaire : 8:00 → 23:30 puis 00:00 → 01:30 (aligné sur DAY_SCHEDULES).
const TIME_AXIS = (() => {
  const out: { h: number; m: number }[] = [];
  for (let h = 8; h < 24; h++) { out.push({ h, m: 0 }); out.push({ h, m: 30 }); }
  for (let h = 0; h < 2; h++) { out.push({ h, m: 0 }); out.push({ h, m: 30 }); }
  return out;
})();

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

// Index de créneau (0..35) pour une heure donnée. Les heures 2h–8h (hors grille)
// sont rabattues sur le créneau 0 ; après 2h c'est déjà la nuit du jour suivant.
function slotIndexForTime(h: number, m: number): number {
  const half = m >= 30 ? 1 : 0;
  if (h >= 8) return (h - 8) * 2 + half;
  if (h < 2) return 32 + h * 2 + half;
  return 0;
}

// ─── Types API dispos ───────────────────────────────────────────────────
type AvailMember = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  isTitulaire: boolean;
  slotsByWeek: Record<string, string[]>;
  conflictSlots: string[];
};
type StaffRoleKind = 'coach_team' | 'manager_team' | 'coach_structure' | 'responsable';
type AvailStaff = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  role: StaffRoleKind;
  slotsByWeek: Record<string, string[]>;
};
type AvailResponse = {
  team: { id: string; name: string; game: string; minPlayersForMatch: number; minMatchDurationMinutes: number };
  today: string;
  weeks: { mondayYmd: string; weekId: string; blocks: MatchBlock[] }[];
  members: AvailMember[];
  staff: AvailStaff[];
};

const STAFF_ROLE_LABELS: Record<StaffRoleKind, string> = {
  coach_team: "Coach d'équipe",
  manager_team: "Manager d'équipe",
  coach_structure: 'Coach structure',
  responsable: 'Responsable',
};

type Props = {
  structureId: string;
  events: CalendarEvent[];        // déjà filtrés par le filtre équipe
  teams: Team[];
  teamFilter: string[];
  now: number;
  canCreate: boolean;
  userContext: UserContext;       // pour gater le bouton "Configurer consensus"
  onEventClick: (id: string) => void;
  onSlotCreate: (startsAt: string, endsAt: string) => void;
};

export default function WeekView({
  structureId, events, teams, teamFilter, now, canCreate, userContext, onEventClick, onSlotCreate,
}: Props) {
  const { firebaseUser } = useAuth();
  const todayYmd = parisYmd(new Date(now));
  const [weekMonday, setWeekMonday] = useState(() => getMondayYmd(todayYmd));
  // Joueur isolé : si défini, la heatmap n'affiche que ses créneaux à lui.
  // v3 (2026-05-26) : sélection multi-joueurs (remplace l'ancien `soloMember`).
  // Quand des joueurs sont cochés :
  //   - la heatmap se filtre sur eux uniquement
  //   - les blocs consensus sont recalculés en INTERSECTION (tous dispos en même temps)
  // Si Set vide = toute l'équipe (comportement original).
  const [selectedPlayerUids, setSelectedPlayerUids] = useState<Set<string>>(() => new Set());
  function togglePlayerPick(uid: string) {
    setSelectedPlayerUids(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }
  function clearPlayerPick() {
    setSelectedPlayerUids(new Set());
  }

  // Sélecteur staff (refonte Matt 2026-05-25) : au lieu d'un toggle global
  // qui affichait tous les staff sans distinction, on coche staff par staff.
  // Chaque staff sélectionné se voit assigner une couleur cycliques (palette
  // de 6), pastille de cette couleur dans le coin haut-droit de chaque slot
  // où il est dispo. Permet de voir IMMÉDIATEMENT qui est dispo (manager vs
  // coach, etc.) sans avoir à survoler.
  const [selectedStaffUids, setSelectedStaffUids] = useState<Set<string>>(() => new Set());
  const [staffPickerOpen, setStaffPickerOpen] = useState(false);
  // Toggle pour masquer la heatmap consensus (utile quand on regarde uniquement
  // les pastilles staff sans être pollué par le fond coloré).
  const [consensusVisible, setConsensusVisible] = useState(true);
  const consensusKey = `aedral_week_consensus_visible_${structureId}`;
  useEffect(() => {
    try {
      const stored = localStorage.getItem(consensusKey);
      if (stored === 'false') setConsensusVisible(false);
    } catch { /* SSR */ }
  }, [consensusKey]);
  function toggleConsensus() {
    setConsensusVisible(prev => {
      const next = !prev;
      try { localStorage.setItem(consensusKey, String(next)); } catch { /* noop */ }
      return next;
    });
  }
  const staffPickerKey = `aedral_week_staff_selection_${structureId}`;
  useEffect(() => {
    try {
      const stored = localStorage.getItem(staffPickerKey);
      if (stored) {
        const arr = JSON.parse(stored) as string[];
        if (Array.isArray(arr)) setSelectedStaffUids(new Set(arr));
      }
    } catch { /* SSR ou parse fail */ }
  }, [staffPickerKey]);
  const persistStaffSelection = (next: Set<string>) => {
    try { localStorage.setItem(staffPickerKey, JSON.stringify(Array.from(next))); } catch { /* noop */ }
  };
  const toggleStaffPick = (uid: string) => {
    setSelectedStaffUids(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      persistStaffSelection(next);
      return next;
    });
  };
  const clearStaffPick = () => {
    setSelectedStaffUids(new Set());
    persistStaffSelection(new Set());
  };

  // Palette cyclique de 6 couleurs distinctes pour les pastilles staff ,
  // hors palette consensus (or = créneau optimal, vert = matchable).
  // L'ambre/jaune et le turquoise originaux clashaient visuellement avec
  // l'or et le vert de la heatmap → remplacés par cyan + magenta.
  const STAFF_COLORS = useMemo(() => [
    '#87cefa', // bleu clair
    '#ff8fa3', // rose
    '#a78bfa', // violet pâle
    '#22d3ee', // cyan
    '#f472b6', // magenta
    '#f97316', // orange
  ], []);

  const grid = useMemo(() => generateWeekGrid(weekMonday, todayYmd), [weekMonday, todayYmd]);

  // Responsive : en mobile/tablette (<lg), la grille 7 colonnes est illisible.
  // On bascule en "Vue Jour", un seul jour à la fois, sélectionnable via une
  // bande de 7 chips au-dessus de la grille. Le panneau latéral Dispos passe
  // sous la grille (au lieu de à droite).
  const [isWide, setIsWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setIsWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  // Jour sélectionné en mode mobile (index 0..6 dans grid.days).
  // Reset au jour courant à chaque changement de semaine pour éviter de tomber
  // sur un jour passé ou hors-grille.
  const [mobileDayIdx, setMobileDayIdx] = useState(0);
  useEffect(() => {
    const todayIdx = grid.days.findIndex(d => d.gridYmd === todayYmd);
    setMobileDayIdx(todayIdx >= 0 ? todayIdx : 0);
  }, [grid, todayYmd]);
  // Jours affichés : tous (desktop) ou juste le sélectionné (mobile).
  const displayedDays = isWide ? grid.days : [grid.days[mobileDayIdx] ?? grid.days[0]];

  // Couche dispos : une seule équipe ciblée. Les jetons spéciaux du filtre
  // (staff, structure, préfixés "__") ne sont pas des équipes et sont ignorés.
  // Si la structure n'a qu'une équipe, pas de filtre à régler, on la prend d'office.
  const realTeamSelection = teamFilter.filter(id => !id.startsWith('__'));
  const selectedTeamId = realTeamSelection.length === 1
    ? realTeamSelection[0]
    : (teamFilter.length === 0 && teams.length === 1 ? teams[0].id : null);

  const { data: avail, isLoading: availLoading } = useQuery({
    queryKey: ['team-availability', structureId, selectedTeamId],
    queryFn: () => api<AvailResponse>(
      `/api/structures/teams/availability?structureId=${structureId}&teamId=${selectedTeamId}`
    ),
    enabled: !!firebaseUser && !!selectedTeamId,
    retry: false,
  });

  // La semaine affichée fait-elle partie des 2 semaines couvertes par les dispos ?
  const availWeek = avail?.weeks.find(w => w.mondayYmd === weekMonday) ?? null;
  const availActive = !!selectedTeamId && !!availWeek;

  // Total titulaires de l'équipe (pour distinguer "matchable" vs "titulaires
  // au complet", palette 3 paliers validée Matt 2026-05-25).
  const titularsTotal = useMemo(
    () => avail ? avail.members.filter(m => m.isTitulaire).length : 0,
    [avail],
  );

  // Compte de titulaires dispos par slot, utilisé pour le palier "tous titulaires"
  // de la heatmap. Si des joueurs sont sélectionnés, on filtre dessus.
  const titularsBySlot = useMemo(() => {
    const map = new Map<string, number>();
    if (!avail || !availWeek) return map;
    for (const m of avail.members) {
      if (!m.isTitulaire) continue;
      if (selectedPlayerUids.size > 0 && !selectedPlayerUids.has(m.uid)) continue;
      const conflicts = new Set(m.conflictSlots);
      for (const s of m.slotsByWeek[weekMonday] ?? []) {
        if (conflicts.has(s)) continue;
        map.set(s, (map.get(s) ?? 0) + 1);
      }
    }
    return map;
  }, [avail, availWeek, weekMonday, selectedPlayerUids]);

  // Dispos staff par slot (overlay bleu clair), filtré sur Coach équipe +
  // Manager équipe + Coach structure (validé Matt Q3, pas les responsables
  // ni dirigeants). Les responsables ont leur propre vue dédiée (onglet STAFF).
  const RELEVANT_STAFF_ROLES = new Set<StaffRoleKind>(['coach_team', 'manager_team', 'coach_structure']);
  const relevantStaff = useMemo(
    () => avail ? avail.staff.filter(s => RELEVANT_STAFF_ROLES.has(s.role)) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [avail],
  );
  // Couleur attribuée à chaque staff sélectionné (par index dans la liste
  // relevantStaff, stable et déterministe pour un user donné).
  const staffColorByUid = useMemo(() => {
    const m = new Map<string, string>();
    relevantStaff.forEach((s, i) => {
      m.set(s.uid, STAFF_COLORS[i % STAFF_COLORS.length]);
    });
    return m;
  }, [relevantStaff, STAFF_COLORS]);

  // Pour chaque slot, la liste des staff SÉLECTIONNÉS qui sont dispos
  // (filtré sur selectedStaffUids, pas le pool complet).
  const selectedStaffBySlot = useMemo(() => {
    const map = new Map<string, AvailStaff[]>();
    if (!avail || !availWeek || selectedStaffUids.size === 0) return map;
    for (const s of relevantStaff) {
      if (!selectedStaffUids.has(s.uid)) continue;
      for (const iso of s.slotsByWeek[weekMonday] ?? []) {
        const list = map.get(iso);
        if (list) list.push(s);
        else map.set(iso, [s]);
      }
    }
    return map;
  }, [avail, availWeek, weekMonday, relevantStaff, selectedStaffUids]);

  // Heatmap : pour chaque slot iso, qui est dispo (hors conflit d'event).
  // Si des joueurs sont sélectionnés, on ne compte qu'eux.
  const availabilityBySlot = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!avail || !availWeek) return map;
    for (const m of avail.members) {
      if (selectedPlayerUids.size > 0 && !selectedPlayerUids.has(m.uid)) continue;
      const conflicts = new Set(m.conflictSlots);
      for (const s of m.slotsByWeek[weekMonday] ?? []) {
        if (conflicts.has(s)) continue;
        const list = map.get(s);
        if (list) list.push(m.uid);
        else map.set(s, [m.uid]);
      }
    }
    return map;
  }, [avail, availWeek, weekMonday, selectedPlayerUids]);

  // Nombre effectif de titulaires considérés, pour le palier "tous dispos".
  // Si sélection active : compte des sélectionnés qui sont titulaires.
  // Sinon : compte total des titulaires de l'équipe.
  const titularsTotalEffective = useMemo(() => {
    if (!avail) return 0;
    if (selectedPlayerUids.size === 0) return titularsTotal;
    return avail.members.filter(m => m.isTitulaire && selectedPlayerUids.has(m.uid)).length;
  }, [avail, selectedPlayerUids, titularsTotal]);

  // Blocs consensus EFFECTIFS, soit ceux pré-calculés serveur (toute l'équipe),
  // soit recalculés en INTERSECTION quand des joueurs sont sélectionnés.
  // Intersection = tous les sélectionnés doivent être dispos sur le slot.
  const effectiveBlocks = useMemo<MatchBlock[]>(() => {
    if (!avail || !availWeek) return [];
    if (selectedPlayerUids.size === 0) return availWeek.blocks;

    // Slot durée min en nombre de créneaux 30min
    const minSlots = Math.ceil(avail.team.minMatchDurationMinutes / 30);
    if (minSlots <= 0) return [];

    // Pour chaque slot, vérifier que TOUS les sélectionnés sont dispos
    const targets = avail.members.filter(m => selectedPlayerUids.has(m.uid));
    if (targets.length === 0) return [];

    const targetSlots = targets.map(m => ({
      slots: new Set(m.slotsByWeek[weekMonday] ?? []),
      conflicts: new Set(m.conflictSlots),
    }));

    // Récolte tous les slots OK (intersection), triés par ordre ISO
    const okSlots: string[] = [];
    const firstSlots = targetSlots[0].slots;
    for (const iso of firstSlots) {
      if (targetSlots[0].conflicts.has(iso)) continue;
      const allOk = targetSlots.every(t => t.slots.has(iso) && !t.conflicts.has(iso));
      if (allOk) okSlots.push(iso);
    }
    okSlots.sort();

    // Groupe les slots contigus (+30 min) en blocs
    const blocks: MatchBlock[] = [];
    let current: string[] = [];
    const targetUids = targets.map(t => t.uid);
    for (const iso of okSlots) {
      if (current.length === 0) {
        current.push(iso);
      } else {
        const last = current[current.length - 1];
        const lastTs = new Date(last).getTime();
        const nextTs = new Date(iso).getTime();
        if (nextTs - lastTs === 30 * 60_000) {
          current.push(iso);
        } else {
          if (current.length >= minSlots) {
            blocks.push({
              startSlot: current[0],
              endSlot: current[current.length - 1],
              durationMinutes: current.length * 30,
              playerIds: targetUids,
            });
          }
          current = [iso];
        }
      }
    }
    if (current.length >= minSlots) {
      blocks.push({
        startSlot: current[0],
        endSlot: current[current.length - 1],
        durationMinutes: current.length * 30,
        playerIds: targetUids,
      });
    }
    return blocks;
  }, [avail, availWeek, weekMonday, selectedPlayerUids]);

  const memberName = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of avail?.members ?? []) m.set(x.uid, x.displayName);
    return m;
  }, [avail]);

  // Événements groupés par jour grille, avec placement (lane) calculé.
  const eventsByDay = useMemo(() => {
    const gridYmds = new Set(grid.days.map(d => d.gridYmd));
    const byDay = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      if (!ev.startsAt || ev.status === 'cancelled') continue;
      const d = new Date(ev.startsAt);
      // Une soirée qui déborde après minuit reste rattachée au jour précédent.
      const base = d.getHours() < 2 ? new Date(d.getTime() - 86_400_000) : d;
      const ymd = `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
      if (!gridYmds.has(ymd)) continue;
      const list = byDay.get(ymd);
      if (list) list.push(ev);
      else byDay.set(ymd, [ev]);
    }
    return byDay;
  }, [events, grid]);

  const goPrev = () => setWeekMonday(m => addDays(m, -7));
  const goNext = () => setWeekMonday(m => addDays(m, 7));
  const goToday = () => setWeekMonday(getMondayYmd(todayYmd));

  const monday = new Date(weekMonday + 'T12:00:00');
  const sunday = new Date(addDays(weekMonday, 6) + 'T12:00:00');
  const rangeLabel = `${monday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}, ${sunday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;

  return (
    <div className="space-y-3">
      {/* Navigation semaine */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={goPrev} aria-label="Semaine précédente"
          className="flex items-center justify-center bevel-sm transition-colors hover:bg-[var(--s-hover)]"
          style={{ width: 30, height: 30, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={goNext} aria-label="Semaine suivante"
          className="flex items-center justify-center bevel-sm transition-colors hover:bg-[var(--s-hover)]"
          style={{ width: 30, height: 30, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          <ChevronRight size={16} />
        </button>
        <span className="font-display text-lg tracking-wider" style={{ color: 'var(--s-text)' }}>{rangeLabel}</span>

        {/* Sélecteur staff (refonte Matt 2026-05-25), dropdown multi-checkbox.
            Style aligné sur le filtre équipe "Afficher : ..." pour cohérence UX.
            Visible quand une équipe est sélectionnée et qu'au moins 1 staff
            existe pour cette équipe. */}
        {availActive && relevantStaff.length > 0 && (
          <div className="relative ml-2">
            <button type="button" onClick={() => setStaffPickerOpen(o => !o)}
              className="flex items-center gap-1.5 transition-all duration-150"
              style={{
                background: selectedStaffUids.size > 0 ? 'rgba(135,206,250,0.15)' : 'var(--s-elevated)',
                color: selectedStaffUids.size > 0 ? 'rgb(135,206,250)' : 'var(--s-text-dim)',
                border: `1px solid ${selectedStaffUids.size > 0 ? 'rgba(135,206,250,0.45)' : 'var(--s-border)'}`,
                cursor: 'pointer', padding: '4px 10px', fontSize: '12px',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
              <Users size={11} />
              <span>Staff {selectedStaffUids.size}/{relevantStaff.length}</span>
              <ChevronRight size={11} style={{ transform: staffPickerOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            {selectedStaffUids.size > 0 && (
              <button type="button" onClick={clearStaffPick}
                className="static lg:absolute lg:-right-1 lg:translate-x-full lg:top-1/2 lg:-translate-y-1/2 ml-2 lg:ml-0 text-xs transition-colors duration-150"
                style={{ color: 'var(--s-text-muted)', padding: '2px 6px' }}>
                Réinitialiser
              </button>
            )}
            {staffPickerOpen && (
              <>
                <div className="fixed inset-0 z-[20]" onClick={() => setStaffPickerOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-[30] w-[280px] max-h-[320px] overflow-y-auto bevel-sm"
                  style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                  <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--s-border)' }}>
                    <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>Coche le staff à afficher</p>
                  </div>
                  <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
                    {relevantStaff.map(s => {
                      const checked = selectedStaffUids.has(s.uid);
                      const color = staffColorByUid.get(s.uid) ?? '#fff';
                      return (
                        <label key={s.uid} className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-[var(--s-elevated)]">
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleStaffPick(s.uid)}
                            className="w-4 h-4 cursor-pointer"
                            style={{ accentColor: color }} />
                          <span style={{
                            display: 'inline-block',
                            width: 10, height: 10, borderRadius: '50%',
                            background: color,
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
                          }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{s.displayName}</div>
                            <div className="text-[10px]" style={{ color: 'var(--s-text-dim)' }}>{STAFF_ROLE_LABELS[s.role]}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Toggle CONSENSUS, masque uniquement les blocs encadrés or (les créneaux
            où ≥ minPlayers sont dispos en continu). La heatmap reste visible.
            Utile pour voir uniquement les dispos brutes sans validation. */}
        {availActive && (
          <button type="button" onClick={toggleConsensus}
            className="bevel-sm transition-colors hover:bg-[var(--s-hover)]"
            title={consensusVisible
              ? 'Masquer les blocs consensus encadrés or'
              : 'Afficher les blocs consensus (créneaux où l\'équipe peut jouer ensemble)'}
            style={{
              padding: '5px 10px',
              fontSize: '12px',
              background: consensusVisible ? 'rgba(255,184,0,0.10)' : 'var(--s-elevated)',
              border: `1px solid ${consensusVisible ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
              color: consensusVisible ? 'var(--s-gold)' : 'var(--s-text-dim)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
            Consensus : {consensusVisible ? 'ON' : 'OFF'}
          </button>
        )}

        <button type="button" onClick={goToday}
          className="ml-auto bevel-sm text-xs font-semibold transition-colors hover:bg-[var(--s-hover)]"
          style={{ padding: '5px 12px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          Aujourd&apos;hui
        </button>
      </div>

      {/* Sélecteur de jour mobile, 7 chips (LUN..DIM) qui ciblent le jour
          affiché dans la grille. Inutile en desktop où les 7 jours sont visibles
          côte-à-côte. */}
      {!isWide && (
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {grid.days.map((d, i) => {
            const isToday = d.gridYmd === todayYmd;
            const isSelected = i === mobileDayIdx;
            const date = new Date(d.gridYmd + 'T12:00:00');
            return (
              <button key={d.gridYmd} type="button"
                onClick={() => setMobileDayIdx(i)}
                className="flex flex-col items-center justify-center bevel-sm transition-colors"
                style={{
                  padding: '6px 2px',
                  background: isSelected
                    ? 'rgba(255,184,0,0.15)'
                    : (isToday ? 'rgba(255,184,0,0.06)' : 'var(--s-elevated)'),
                  border: `1px solid ${isSelected
                    ? 'rgba(255,184,0,0.55)'
                    : (isToday ? 'rgba(255,184,0,0.25)' : 'var(--s-border)')}`,
                  opacity: d.isPast && !isSelected ? 0.5 : 1,
                  cursor: 'pointer',
                }}>
                <span className="t-label" style={{
                  fontSize: 9,
                  color: isSelected ? 'var(--s-gold)' : (isToday ? 'var(--s-gold)' : 'var(--s-text-muted)'),
                }}>
                  {DAY_LABELS[i]}
                </span>
                <span className="font-display" style={{
                  fontSize: 16,
                  color: isSelected ? 'var(--s-gold)' : 'var(--s-text)',
                  lineHeight: 1.1,
                }}>
                  {date.getDate()}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Grille principale */}
        <div className="flex-1 min-w-0 w-full">
          {/* En-têtes des jours, desktop uniquement (le strip mobile au-dessus
              fait office de header en <lg). */}
          {isWide && (
            <div className="grid" style={{ gridTemplateColumns: `46px repeat(${displayedDays.length}, 1fr)` }}>
              <div />
              {displayedDays.map(d => {
                const i = grid.days.indexOf(d);
                const isToday = d.gridYmd === todayYmd;
                const date = new Date(d.gridYmd + 'T12:00:00');
                return (
                  <div key={d.gridYmd} className="text-center pb-1.5"
                    style={{ opacity: d.isPast ? 0.5 : 1 }}>
                    <div className="t-label" style={{ color: isToday ? 'var(--s-gold)' : 'var(--s-text-muted)' }}>
                      {DAY_LABELS[i]}
                    </div>
                    <div className="font-display flex items-center justify-center mx-auto"
                      style={{
                        fontSize: 15,
                        width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto',
                        background: isToday ? 'var(--s-gold)' : 'transparent',
                        color: isToday ? '#0a0a0a' : 'var(--s-text-dim)',
                      }}>
                      {date.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Corps de grille */}
          <div className="grid" style={{ gridTemplateColumns: `46px repeat(${displayedDays.length}, 1fr)` }}>
            {/* Axe horaire */}
            <div className="relative" style={{ height: SLOT_COUNT * SLOT_HEIGHT }}>
              {TIME_AXIS.map((t, idx) => (
                t.m === 0 ? (
                  <div key={idx} className="t-mono absolute right-1.5"
                    style={{ top: idx * SLOT_HEIGHT - 6, fontSize: 12, color: 'var(--s-text-muted)' }}>
                    {pad2(t.h)}:00
                  </div>
                ) : null
              ))}
            </div>

            {/* Colonnes jours */}
            {displayedDays.map(day => {
              const dayEvents = eventsByDay.get(day.gridYmd) ?? [];
              const placements = layoutDayEvents(dayEvents);
              return (
                <div key={day.gridYmd} className="relative"
                  style={{ height: SLOT_COUNT * SLOT_HEIGHT, borderLeft: '1px solid var(--s-border)' }}>
                  {/* Cases de fond (créneaux 30 min).
                      Palette 3 paliers alignée avec la heatmap de l'équipe
                      (validée Matt 2026-05-25) :
                        gris  : < minPlayers dispo (pas matchable)
                        VERT  : ≥ minPlayers dispo (matcher possible)
                        OR    : tous les titulaires dispos (créneau optimal) */}
                  {TIME_AXIS.map((t, idx) => {
                    const iso = day.slots[idx];
                    const availUids = availActive ? (availabilityBySlot.get(iso) ?? []) : [];
                    // En mode sélection, availUids est DÉJÀ filtré sur les sélectionnés
                    // (cf. availabilityBySlot), donc shown = nombre brut.
                    const shown = availUids.length;
                    const total = avail?.members.length ?? 0;
                    const minPlayers = avail?.team.minPlayersForMatch ?? 0;
                    const titularDispoCount = titularsBySlot.get(iso) ?? 0;
                    // Palette refondue 2026-05-26 : OR strictement réservé aux BLOCS CONSENSUS
                    // (encadrés). La heatmap reste sur des paliers gris/vert clair/vert vif ,
                    // jamais d'or → plus aucune confusion visuelle avec les blocs consensus.
                    // Si des joueurs sont sélectionnés : palier "tous dispos" = tous LES SÉLECTIONNÉS,
                    // pas toute l'équipe. Sinon (rien sélectionné) : tous les titulaires.
                    const heat = availActive && shown > 0;
                    let heatBg: string | undefined;
                    if (heat) {
                      const isSelectionMode = selectedPlayerUids.size > 0;
                      const allTargetsDispo = isSelectionMode
                        ? shown >= selectedPlayerUids.size
                        : (titularsTotalEffective > 0 && titularDispoCount >= titularsTotalEffective);
                      if (allTargetsDispo) {
                        // Tous les cibles dispos → VERT VIF (créneau optimal pour le set ciblé).
                        heatBg = 'rgba(47,196,107,0.55)';
                      } else if (!isSelectionMode && minPlayers > 0 && shown >= minPlayers) {
                        // Matchable (≥ minPlayers), uniquement en mode équipe entière.
                        heatBg = 'rgba(47,196,107,0.28)';
                      } else {
                        // Insuffisant mais ≥ 1 → neutre clair (qq'un est là).
                        heatBg = 'rgba(255,255,255,0.08)';
                      }
                    }
                    // Overlay staff (refonte Matt 2026-05-25) : pastilles 6px
                    // dans le coin haut-droit, une par staff SÉLECTIONNÉ et
                    // dispo. Couleur attribuée par staff (palette cyclique).
                    // Visuel : on voit en 1 coup d'œil combien de staff + lesquels.
                    const staffHere = availActive ? (selectedStaffBySlot.get(iso) ?? []) : [];
                    const hasStaff = staffHere.length > 0;
                    const staffTitle = hasStaff
                      ? ` · Staff dispo : ${staffHere.map(s => `${s.displayName} (${STAFF_ROLE_LABELS[s.role]})`).join(', ')}`
                      : '';
                    const slotTitle = availActive && availUids.length > 0
                      ? `${formatSlotTime(iso)}, Dispo ${availUids.length}/${total} (dont ${titularDispoCount}/${titularsTotal} titulaires) : ${availUids.map(u => memberName.get(u) ?? '?').join(', ')}${staffTitle}`
                      : (hasStaff ? `${formatSlotTime(iso)}${staffTitle}` : (canCreate ? 'Cliquer pour créer un événement' : undefined));
                    // Pastilles : max 3 visibles + "+N" si plus
                    const visiblePastilles = staffHere.slice(0, 3);
                    const extraPastilles = staffHere.length - visiblePastilles.length;
                    return (
                      <div key={idx}
                        onClick={() => {
                          if (canCreate && iso) onSlotCreate(iso, addMinutesToIso(iso, 120));
                        }}
                        title={slotTitle}
                        className={`relative transition-colors ${heat ? '' : 'bg-[var(--s-elevated)]'} ${canCreate && !heat ? 'hover:bg-[var(--s-hover)]' : ''}`}
                        style={{
                          position: 'absolute', left: 0, right: 0,
                          top: idx * SLOT_HEIGHT, height: SLOT_HEIGHT,
                          background: heatBg,
                          borderTop: `1px solid ${t.m === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)'}`,
                          cursor: canCreate ? 'pointer' : 'default',
                        }}>
                        {/* Pastilles staff sélectionnés, coin haut-droit */}
                        {hasStaff && (
                          <div className="absolute top-0.5 right-0.5 flex items-center gap-[2px] pointer-events-none z-[2]">
                            {visiblePastilles.map(s => (
                              <span key={s.uid} style={{
                                display: 'inline-block',
                                width: 6, height: 6, borderRadius: '50%',
                                background: staffColorByUid.get(s.uid) ?? '#fff',
                                boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
                              }} />
                            ))}
                            {extraPastilles > 0 && (
                              <span style={{
                                fontSize: 8,
                                color: 'var(--s-text-dim)',
                                background: 'rgba(0,0,0,0.5)',
                                padding: '0 2px',
                                lineHeight: '8px',
                              }}>+{extraPastilles}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Blocs consensus (contour OR), masqués quand toggle off.
                      Utilise effectiveBlocks : toute l'équipe par défaut, OU intersection
                      des joueurs sélectionnés. */}
                  {consensusVisible && availActive && effectiveBlocks.map((b, bi) => {
                    const range = blockRange(b, day.slots);
                    if (!range) return null;
                    return (
                      <div key={bi} className="pointer-events-none"
                        style={{
                          position: 'absolute', left: 1, right: 1,
                          top: range.start * SLOT_HEIGHT,
                          height: (range.end - range.start + 1) * SLOT_HEIGHT,
                          border: '1.5px solid var(--s-gold)',
                          background: 'rgba(255,184,0,0.06)',
                        }}>
                        <span className="t-label absolute top-0.5 left-1" style={{ color: 'var(--s-gold)', fontSize: 10 }}>
                          ✓ {b.playerIds.length}
                        </span>
                      </div>
                    );
                  })}

                  {/* Blocs événements */}
                  {placements.map(p => {
                    const color = eventGameColor(p.event, teams);
                    const typeInfo = TYPE_INFO[p.event.type] ?? TYPE_INFO.autre;
                    const target = eventTargetLabel(p.event, teams);
                    const slots = p.endIdx - p.startIdx;
                    return (
                      <button key={p.event.id} type="button"
                        onClick={e => { e.stopPropagation(); onEventClick(p.event.id); }}
                        title={`${p.event.title} · ${target} · ${typeInfo.label}`}
                        className="text-left overflow-hidden transition-transform hover:z-[3]"
                        style={{
                          position: 'absolute',
                          top: p.startIdx * SLOT_HEIGHT + 1,
                          height: Math.max(SLOT_HEIGHT - 2, slots * SLOT_HEIGHT - 2),
                          left: `calc((100% - ${CREATE_GUTTER}px) * ${p.lane / p.laneCount} + 1px)`,
                          width: `calc((100% - ${CREATE_GUTTER}px) / ${p.laneCount} - 2px)`,
                          background: 'var(--s-surface)',
                          border: '1px solid var(--s-border)',
                          borderLeft: `3px solid ${color}`,
                          padding: '1px 4px',
                          zIndex: 2,
                        }}>
                        <span className="block truncate font-semibold" style={{ fontSize: 12, color: 'var(--s-text)' }}>
                          {p.event.title}
                        </span>
                        {slots >= 2 && (
                          <span className="block truncate" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>
                            {target}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Panneau latéral dispos, visible seulement si une équipe est ciblée */}
        {selectedTeamId && (
          <aside className="w-full lg:w-[230px] lg:flex-shrink-0 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            <div className="px-3 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--s-border)' }}>
              <CalendarClock size={13} style={{ color: 'var(--s-gold)' }} />
              <span className="t-label">Dispos {avail?.team.name ? `· ${avail.team.name}` : ''}</span>
            </div>

            {availLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={15} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
              </div>
            ) : !availActive ? (
              <p className="px-3 py-4 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                Les disponibilités ne sont déclarées que sur la semaine courante et la suivante.
              </p>
            ) : (
              <div className="p-2 space-y-3">
                {/* Joueurs, checkbox pour multi-sélection.
                    Heatmap + consensus se recalculent sur les joueurs cochés (intersection).
                    Aucun coché = toute l'équipe (comportement par défaut). */}
                <div className="space-y-1">
                  <button type="button" onClick={clearPlayerPick}
                    className="w-full flex items-center gap-2 transition-colors hover:bg-[var(--s-hover)]"
                    style={{
                      padding: '4px 6px',
                      background: selectedPlayerUids.size === 0 ? 'rgba(47,196,107,0.10)' : 'transparent',
                      border: `1px solid ${selectedPlayerUids.size === 0 ? 'rgba(47,196,107,0.30)' : 'var(--s-border)'}`,
                    }}>
                    <Users size={12} style={{ color: selectedPlayerUids.size === 0 ? '#33ff66' : 'var(--s-text-dim)' }} />
                    <span style={{ fontSize: 12, color: 'var(--s-text)' }}>Toute l&apos;équipe</span>
                    {selectedPlayerUids.size > 0 && (
                      <span className="ml-auto text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        réinit
                      </span>
                    )}
                  </button>
                  {(avail?.members ?? []).map(m => {
                    const count = (m.slotsByWeek[weekMonday] ?? [])
                      .filter(s => !m.conflictSlots.includes(s)).length;
                    const checked = selectedPlayerUids.has(m.uid);
                    return (
                      <label key={m.uid}
                        className="w-full flex items-center gap-2 transition-colors hover:bg-[var(--s-hover)] cursor-pointer"
                        style={{
                          padding: '4px 6px',
                          background: checked ? 'rgba(47,196,107,0.10)' : 'transparent',
                          border: `1px solid ${checked ? 'rgba(47,196,107,0.30)' : 'var(--s-border)'}`,
                        }}>
                        <input type="checkbox"
                          checked={checked}
                          onChange={() => togglePlayerPick(m.uid)}
                          className="cursor-pointer flex-shrink-0"
                          style={{ accentColor: '#33ff66', width: 12, height: 12 }} />
                        <span className="flex-shrink-0" style={{
                          width: 6, height: 6,
                          background: m.isTitulaire ? 'var(--s-gold)' : 'var(--s-text-muted)',
                        }} title={m.isTitulaire ? 'Titulaire' : 'Remplaçant'} />
                        <span className="truncate flex-1 text-left" style={{ fontSize: 12, color: 'var(--s-text)' }}>
                          {m.displayName}
                        </span>
                        <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>
                          {count > 0 ? `${count / 2}h` : '—'}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {/* Consensus de la semaine, utilise effectiveBlocks
                    (toute l'équipe par défaut, ou intersection si joueurs sélectionnés) */}
                <div>
                  <div className="t-label mb-1.5" style={{ color: 'var(--s-text-muted)' }}>
                    Créneaux consensus
                    {selectedPlayerUids.size > 0 && (
                      <span className="ml-1" style={{ color: 'var(--s-gold)' }}>
                        · {selectedPlayerUids.size} joueur{selectedPlayerUids.size > 1 ? 's' : ''} sélectionné{selectedPlayerUids.size > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {effectiveBlocks.length > 0 ? (
                    <div className="space-y-1">
                      {effectiveBlocks.map((b, bi) => (
                        <div key={bi} className="flex items-center gap-1.5"
                          style={{ padding: '3px 6px', background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}>
                          <Check size={11} style={{ color: 'var(--s-gold)', flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: 'var(--s-text)' }}>
                            {blockLabel(b)}
                          </span>
                          <span className="t-mono ml-auto" style={{ fontSize: 12, color: 'var(--s-gold)' }}>
                            {b.playerIds.length}j
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Aucun créneau commun cette semaine.
                    </p>
                  )}
                </div>

                {/* Configuration consensus, accessible aux admin structure
                    + manager de cette équipe précise. Validé Matt 2026-05-25. */}
                {(() => {
                  const selectedTeam = teams.find(t => t.id === selectedTeamId);
                  const myStaffRole = firebaseUser
                    ? (selectedTeam?.staffRoles ?? {})[firebaseUser.uid]
                    : undefined;
                  const isAdmin = isDirigeant(userContext) || userContext.isManager;
                  const canEditConsensus = isAdmin || myStaffRole === 'manager';
                  if (!canEditConsensus || !avail) return null;
                  return (
                    <ConsensusConfigInline
                      structureId={structureId}
                      teamId={avail.team.id}
                      initialMinPlayers={avail.team.minPlayersForMatch}
                      initialMinDurationMinutes={avail.team.minMatchDurationMinutes}
                    />
                  );
                })()}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Légende, palette refondue : or strictement réservé aux blocs consensus,
          heatmap en paliers de vert (pas d'or pour éviter la confusion visuelle) */}
      {availActive && (
        <div className="flex items-center gap-4 flex-wrap text-xs pt-1"
          style={{ color: 'var(--s-text-muted)' }}>
          <span className="font-bold uppercase tracking-wider" style={{ letterSpacing: '0.08em' }}>Légende :</span>
          <LegendItem swatch={{ background: 'rgba(47,196,107,0.55)' }} label={selectedPlayerUids.size > 0 ? 'Tous sélectionnés dispo' : 'Tous titulaires dispo'} />
          {selectedPlayerUids.size === 0 && (
            <LegendItem swatch={{ background: 'rgba(47,196,107,0.28)' }} label={`≥ ${avail?.team.minPlayersForMatch ?? '?'} dispo (matchable)`} />
          )}
          <LegendItem swatch={{ background: 'rgba(255,255,255,0.08)' }} label="1 ou + (insuffisant)" />
          <LegendItem swatch={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }} label="Personne" />
          {consensusVisible && (
            <LegendItem swatch={{ background: 'transparent', border: '1.5px solid var(--s-gold)' }} label="Bloc consensus (or)" />
          )}
          {selectedStaffUids.size > 0 && (
            <>
              <span style={{ color: 'var(--s-text-dim)' }}>·</span>
              <span className="inline-flex items-center gap-1.5">
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#87cefa', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }} />
                <span>Pastille staff</span>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Petit composant interne pour la légende, swatch coloré + label
function LegendItem({ swatch, label }: {
  swatch: { background: string; border?: string };
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{
        display: 'inline-block',
        width: 14, height: 10,
        background: swatch.background,
        border: swatch.border ?? '1px solid rgba(255,255,255,0.05)',
      }} />
      <span>{label}</span>
    </span>
  );
}

// ─── Helpers de placement ───────────────────────────────────────────────

type Placement = {
  event: CalendarEvent;
  startIdx: number;
  endIdx: number;
  lane: number;
  laneCount: number;
};

// Place les événements d'un jour en "lanes" côte à côte quand ils se chevauchent.
function layoutDayEvents(dayEvents: CalendarEvent[]): Placement[] {
  const items = dayEvents
    .map(ev => {
      const start = new Date(ev.startsAt!);
      const end = ev.endsAt ? new Date(ev.endsAt) : new Date(start.getTime() + 3_600_000);
      const startIdx = slotIndexForTime(start.getHours(), start.getMinutes());
      const durSlots = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1_800_000));
      const endIdx = Math.min(SLOT_COUNT, startIdx + durSlots);
      return { event: ev, startIdx, endIdx };
    })
    .sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);

  const laneEnd: number[] = [];
  const placed = items.map(it => {
    let lane = laneEnd.findIndex(e => e <= it.startIdx);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(it.endIdx); }
    else laneEnd[lane] = it.endIdx;
    return { ...it, lane };
  });
  const laneCount = Math.max(1, laneEnd.length);
  return placed.map(p => ({ ...p, laneCount }));
}

// Position d'un bloc consensus dans une colonne jour, ou null s'il n'y est pas.
function blockRange(block: MatchBlock, daySlots: string[]): { start: number; end: number } | null {
  const start = daySlots.indexOf(block.startSlot);
  const end = daySlots.indexOf(block.endSlot);
  if (start === -1 || end === -1) return null;
  return { start, end };
}

// "Mar · 20:00-22:00"
function blockLabel(block: MatchBlock): string {
  const d = new Date(block.startSlot.slice(0, 10) + 'T12:00:00');
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short' });
  const endPlus = addMinutesToIso(block.endSlot, 30);
  return `${day} · ${formatSlotTime(block.startSlot)}-${formatSlotTime(endPlus)}`;
}

// ─── Réglage consensus inline (panneau dispos) ──────────────────────────
// Validé Matt 2026-05-25 : remplace le bouton "Configurer" séparé dans le
// drawer équipe, accessible directement sous "Créneaux consensus".
// Gating de permission fait par le parent (admin structure OU manager équipe).
function ConsensusConfigInline({
  structureId,
  teamId,
  initialMinPlayers,
  initialMinDurationMinutes,
}: {
  structureId: string;
  teamId: string;
  initialMinPlayers: number;
  initialMinDurationMinutes: number;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [minPlayers, setMinPlayers] = useState(initialMinPlayers);
  const [minDurationH, setMinDurationH] = useState(initialMinDurationMinutes / 60);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) {
      setMinPlayers(initialMinPlayers);
      setMinDurationH(initialMinDurationMinutes / 60);
    }
  }, [initialMinPlayers, initialMinDurationMinutes, dirty]);

  const save = useMutation({
    mutationFn: () => api('/api/structures/teams', {
      method: 'POST',
      body: {
        action: 'updateMatchConfig',
        structureId,
        teamId,
        minPlayersForMatch: minPlayers,
        minMatchDurationMinutes: Math.round(minDurationH * 60),
      },
    }),
    onSuccess: () => {
      toast.success('Consensus mis à jour');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['team-availability', structureId, teamId] });
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : 'Erreur'),
  });

  return (
    <div className="mt-1" style={{ borderTop: '1px solid var(--s-border)', paddingTop: 8 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 transition-colors hover:bg-[var(--s-hover)]"
        style={{
          padding: '4px 6px',
          background: open ? 'rgba(255,184,0,0.06)' : 'transparent',
          color: open ? 'var(--s-gold)' : 'var(--s-text-dim)',
          border: '1px solid var(--s-border)',
        }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          ⚙ Régler le consensus
        </span>
        <span style={{ fontSize: 10, color: 'var(--s-text-muted)' }}>
          {open ? '×' : '+'}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 p-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <div>
            <label className="block mb-1" style={{ fontSize: 10, color: 'var(--s-text-muted)', textTransform: 'uppercase' }}>
              Min joueurs pour matcher
            </label>
            <input type="number" min={1} max={10}
              value={minPlayers}
              onChange={e => { setMinPlayers(parseInt(e.target.value, 10) || 1); setDirty(true); }}
              className="settings-input w-full"
              style={{ fontSize: 12, padding: '4px 8px' }} />
          </div>
          <div>
            <label className="block mb-1" style={{ fontSize: 10, color: 'var(--s-text-muted)', textTransform: 'uppercase' }}>
              Durée min du match (heures)
            </label>
            <input type="number" min={0.5} max={8} step={0.5}
              value={minDurationH}
              onChange={e => { setMinDurationH(parseFloat(e.target.value) || 1); setDirty(true); }}
              className="settings-input w-full"
              style={{ fontSize: 12, padding: '4px 8px' }} />
          </div>
          {dirty && (
            <button type="button" onClick={() => save.mutate()}
              disabled={save.isPending}
              className="btn-springs btn-primary bevel-sm flex items-center justify-center gap-1.5 w-full"
              style={{ fontSize: 11, padding: '6px 10px' }}>
              {save.isPending ? <Loader2 size={11} className="animate-spin" /> : null}
              Enregistrer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
