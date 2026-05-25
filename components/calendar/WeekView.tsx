'use client';

// Vue Semaine du calendrier de structure — grille jours × créneaux 30 min.
//
// Deux couches superposées :
//  1. Événements (toujours) — blocs colorés par jeu, positionnés à l'heure.
//     Clic sur un bloc → détail ; clic sur une case vide → création pré-remplie.
//  2. Dispos + consensus (quand UNE équipe est sélectionnée dans le filtre) —
//     heatmap du nombre de joueurs dispo + blocs consensus encadrés + liste
//     des joueurs avec isolation individuelle.
//
// La couche dispos n'existe que sur la semaine courante + la suivante : c'est
// la fenêtre sur laquelle les joueurs déclarent leurs créneaux.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Users, Check, CalendarClock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
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
  onEventClick: (id: string) => void;
  onSlotCreate: (startsAt: string, endsAt: string) => void;
};

export default function WeekView({
  structureId, events, teams, teamFilter, now, canCreate, onEventClick, onSlotCreate,
}: Props) {
  const { firebaseUser } = useAuth();
  const todayYmd = parisYmd(new Date(now));
  const [weekMonday, setWeekMonday] = useState(() => getMondayYmd(todayYmd));
  // Joueur isolé : si défini, la heatmap n'affiche que ses créneaux à lui.
  const [soloMember, setSoloMember] = useState<string | null>(null);

  // Sélecteur staff (refonte Matt 2026-05-25) : au lieu d'un toggle global
  // qui affichait tous les staff sans distinction, on coche staff par staff.
  // Chaque staff sélectionné se voit assigner une couleur cycliques (palette
  // de 6) — pastille de cette couleur dans le coin haut-droit de chaque slot
  // où il est dispo. Permet de voir IMMÉDIATEMENT qui est dispo (manager vs
  // coach, etc.) sans avoir à survoler.
  const [selectedStaffUids, setSelectedStaffUids] = useState<Set<string>>(() => new Set());
  const [staffPickerOpen, setStaffPickerOpen] = useState(false);
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

  // Palette cyclique de 6 couleurs distinctes pour les pastilles staff —
  // hors palette DA (or/vert réservés au consensus joueurs).
  const STAFF_COLORS = useMemo(() => [
    '#87cefa', // bleu clair
    '#ff8fa3', // rose
    '#a78bfa', // violet pâle
    '#fbbf24', // ambre/jaune
    '#34d399', // turquoise
    '#f97316', // orange
  ], []);

  const grid = useMemo(() => generateWeekGrid(weekMonday, todayYmd), [weekMonday, todayYmd]);

  // Couche dispos : une seule équipe ciblée. Les jetons spéciaux du filtre
  // (staff, structure — préfixés "__") ne sont pas des équipes et sont ignorés.
  // Si la structure n'a qu'une équipe, pas de filtre à régler — on la prend d'office.
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
  // au complet" — palette 3 paliers validée Matt 2026-05-25).
  const titularsTotal = useMemo(
    () => avail ? avail.members.filter(m => m.isTitulaire).length : 0,
    [avail],
  );

  // Compte de titulaires dispos par slot (séparé du compte total) — pour la
  // palette : seul le palier OR exige "tous les titulaires présents".
  const titularsBySlot = useMemo(() => {
    const map = new Map<string, number>();
    if (!avail || !availWeek) return map;
    for (const m of avail.members) {
      if (!m.isTitulaire) continue;
      const conflicts = new Set(m.conflictSlots);
      for (const s of m.slotsByWeek[weekMonday] ?? []) {
        if (conflicts.has(s)) continue;
        map.set(s, (map.get(s) ?? 0) + 1);
      }
    }
    return map;
  }, [avail, availWeek, weekMonday]);

  // Dispos staff par slot (overlay bleu clair) — filtré sur Coach équipe +
  // Manager équipe + Coach structure (validé Matt Q3 — pas les responsables
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
  // (filtré sur selectedStaffUids — pas le pool complet).
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
  const availabilityBySlot = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!avail || !availWeek) return map;
    for (const m of avail.members) {
      const conflicts = new Set(m.conflictSlots);
      for (const s of m.slotsByWeek[weekMonday] ?? []) {
        if (conflicts.has(s)) continue;
        const list = map.get(s);
        if (list) list.push(m.uid);
        else map.set(s, [m.uid]);
      }
    }
    return map;
  }, [avail, availWeek, weekMonday]);

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
  const rangeLabel = `${monday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — ${sunday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;

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

        {/* Sélecteur staff (refonte Matt 2026-05-25) — dropdown multi-checkbox.
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
                className="absolute -right-1 translate-x-full top-1/2 -translate-y-1/2 text-xs transition-colors duration-150"
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

        <button type="button" onClick={goToday}
          className="ml-auto bevel-sm text-xs font-semibold transition-colors hover:bg-[var(--s-hover)]"
          style={{ padding: '5px 12px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          Aujourd&apos;hui
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* Grille principale */}
        <div className="flex-1 min-w-0">
          {/* En-têtes des jours */}
          <div className="grid" style={{ gridTemplateColumns: `46px repeat(7, 1fr)` }}>
            <div />
            {grid.days.map((d, i) => {
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

          {/* Corps de grille */}
          <div className="grid" style={{ gridTemplateColumns: `46px repeat(7, 1fr)` }}>
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
            {grid.days.map(day => {
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
                    const shown = soloMember
                      ? (availUids.includes(soloMember) ? 1 : 0)
                      : availUids.length;
                    const total = avail?.members.length ?? 0;
                    const minPlayers = avail?.team.minPlayersForMatch ?? 0;
                    const titularDispoCount = titularsBySlot.get(iso) ?? 0;
                    const heat = availActive && shown > 0;
                    let heatBg: string | undefined;
                    if (heat) {
                      if (soloMember) {
                        // Mode solo : on isole 1 joueur → halo or atténué pour visualiser ses créneaux.
                        heatBg = 'rgba(255,184,0,0.35)';
                      } else if (titularsTotal > 0 && titularDispoCount >= titularsTotal) {
                        // Tous les titulaires dispos → OR (créneau optimal).
                        heatBg = 'rgba(255,184,0,0.45)';
                      } else if (minPlayers > 0 && shown >= minPlayers) {
                        // Matchable → VERT.
                        heatBg = 'rgba(47,196,107,0.35)';
                      } else {
                        // Insuffisant mais ≥ 1 → neutre clair (subtle, indique que qq'un est là).
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
                      ? `${formatSlotTime(iso)} — Dispo ${availUids.length}/${total} (dont ${titularDispoCount}/${titularsTotal} titulaires) : ${availUids.map(u => memberName.get(u) ?? '?').join(', ')}${staffTitle}`
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
                        {/* Pastilles staff sélectionnés — coin haut-droit */}
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

                  {/* Blocs consensus (contour) */}
                  {availActive && availWeek && availWeek.blocks.map((b, bi) => {
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

        {/* Panneau latéral dispos — visible seulement si une équipe est ciblée */}
        {selectedTeamId && (
          <aside className="flex-shrink-0 w-[230px] bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
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
                {/* Joueurs — clic pour isoler ses dispos dans la grille */}
                <div className="space-y-1">
                  <button type="button" onClick={() => setSoloMember(null)}
                    className="w-full flex items-center gap-2 transition-colors hover:bg-[var(--s-hover)]"
                    style={{
                      padding: '4px 6px',
                      background: soloMember === null ? 'rgba(255,184,0,0.12)' : 'transparent',
                      border: `1px solid ${soloMember === null ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                    }}>
                    <Users size={12} style={{ color: 'var(--s-gold)' }} />
                    <span style={{ fontSize: 12, color: 'var(--s-text)' }}>Toute l&apos;équipe</span>
                  </button>
                  {(avail?.members ?? []).map(m => {
                    const count = (m.slotsByWeek[weekMonday] ?? [])
                      .filter(s => !m.conflictSlots.includes(s)).length;
                    const active = soloMember === m.uid;
                    return (
                      <button key={m.uid} type="button"
                        onClick={() => setSoloMember(active ? null : m.uid)}
                        className="w-full flex items-center gap-2 transition-colors hover:bg-[var(--s-hover)]"
                        style={{
                          padding: '4px 6px',
                          background: active ? 'rgba(255,184,0,0.12)' : 'transparent',
                          border: `1px solid ${active ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                        }}>
                        <span className="flex-shrink-0" style={{
                          width: 6, height: 6,
                          background: m.isTitulaire ? 'var(--s-gold)' : 'var(--s-text-muted)',
                        }} />
                        <span className="truncate flex-1 text-left" style={{ fontSize: 12, color: 'var(--s-text)' }}>
                          {m.displayName}
                        </span>
                        <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>
                          {count > 0 ? `${count / 2}h` : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Consensus de la semaine */}
                <div>
                  <div className="t-label mb-1.5" style={{ color: 'var(--s-text-muted)' }}>
                    Créneaux consensus
                  </div>
                  {availWeek && availWeek.blocks.length > 0 ? (
                    <div className="space-y-1">
                      {availWeek.blocks.map((b, bi) => (
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
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
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
