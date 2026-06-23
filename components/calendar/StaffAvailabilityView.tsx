'use client';

// Vue dédiée onglet "STAFF" du calendrier de structure.
//
// REFONTE Matt 2026-05-31 (v4) :
//   - Grille jour/heure (pattern WeekView semaine)
//   - Panel staff latéral DROITE avec checkboxes — affichage rôles précis
//     (Coach équipe X, Manager équipe Y, capitaine équipe Z) + filtres par rôle
//   - Chips "Tous les fondateurs / responsables / coachs structure / coachs
//     équipe / managers équipe / capitaines" pour cocher en masse
//   - Heatmap SANS palier "tous le staff dispo" hors sélection (ça n'avait
//     pas de sens : on ne réunit jamais TOUT le staff). Au lieu de ça :
//     intensité progressive douce. Avec sélection : 2 paliers clairs
//     (gris si pas tous dispos / vert si TOUS les sélectionnés dispos).
//   - Click sur slot cliquable → crée une réunion staff pré-remplie
//
// Pool affiché = LARGE (fondateur + co-fonda + responsable + coach structure
// + staff d'équipes + capitaines). Source : /api/structures/[id]/staff-availability.
// Cette vue est visible UNIQUEMENT pour dirigeants + responsables (gating
// dans CalendarSection).

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Users, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import {
  addDays,
  parisYmd,
  generateWeekGrid,
  formatSlotTime,
  addMinutesToIso,
} from '@/lib/availability';
import { getGameColor } from '@/lib/games-registry';

// ─── Types ──────────────────────────────────────────────────────────────
type StaffRole = 'fondateur' | 'co_fondateur' | 'responsable' | 'coach_structure' | 'staff_team' | 'capitaine';

type TeamMembership = {
  teamId: string;
  teamName: string;
  teamLabel: string | null;
  teamGame: string;
  role: 'manager' | 'coach' | 'captain';
};

type StaffMember = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  roles: StaffRole[];
  teamMemberships: TeamMembership[];
  slotsByWeek: Record<string, string[]>;
};

type StaffApiResponse = {
  today: string;
  weekMondays: string[];
  members: StaffMember[];
  minPlayersForStaffMatch: number; // conservé en data, ignoré côté UI v4
};

// ─── Hiérarchie & catégories de filtre ──────────────────────────────────
const ROLE_PRIORITY: Record<StaffRole, number> = {
  fondateur: 0,
  co_fondateur: 1,
  responsable: 2,
  coach_structure: 3,
  staff_team: 4,
  capitaine: 5,
};

function topRole(roles: StaffRole[]): StaffRole {
  return [...roles].sort((a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b])[0];
}

// Catégories utilisées par les chips de filtre. Chaque catégorie a un
// prédicat qui dit si un staff member en fait partie.
type RoleCategory = {
  key: string;
  label: string;
  /** Renvoie true si ce member appartient à cette catégorie. */
  match: (m: StaffMember) => boolean;
};

const ROLE_CATEGORIES: RoleCategory[] = [
  { key: 'fondateurs', label: 'Fondateurs', match: m => m.roles.includes('fondateur') || m.roles.includes('co_fondateur') },
  { key: 'responsables', label: 'Responsables', match: m => m.roles.includes('responsable') },
  { key: 'coach_structure', label: 'Coachs structure', match: m => m.roles.includes('coach_structure') },
  { key: 'manager_team', label: "Managers d'équipe", match: m => m.teamMemberships.some(tm => tm.role === 'manager') },
  { key: 'coach_team', label: "Coachs d'équipe", match: m => m.teamMemberships.some(tm => tm.role === 'coach') },
  { key: 'capitaines', label: "Capitaines d'équipe", match: m => m.teamMemberships.some(tm => tm.role === 'captain') },
];

// ─── Layout ─────────────────────────────────────────────────────────────
const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const SLOT_HEIGHT = 22;
const SLOT_COUNT = 36; // 8h → 2h le lendemain = 36 créneaux de 30 min

const TIME_AXIS = (() => {
  const out: { h: number; m: number }[] = [];
  for (let h = 8; h < 24; h++) { out.push({ h, m: 0 }); out.push({ h, m: 30 }); }
  for (let h = 0; h < 2; h++) { out.push({ h, m: 0 }); out.push({ h, m: 30 }); }
  return out;
})();

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export default function StaffAvailabilityView({
  structureId,
  onCreateStaffEvent,
}: {
  structureId: string;
  members: unknown[];  // accepté pour compat de signature parent (non utilisé)
  teams: unknown[];    // idem
  structureRoles: unknown; // idem
  canEditConfig?: boolean; // ignoré en v4 (plus de minPlayersForStaffMatch en UI)
  /**
   * Click-to-create : appelé quand l'user clique sur un créneau matchable.
   * Le caller ouvre EventFormModal avec target.scope='staff' + audience
   * pré-cochée selon availableStaffUids.
   */
  onCreateStaffEvent?: (params: {
    startsAt: string;
    endsAt: string;
    availableStaffUids: string[];
  }) => void;
}) {
  const { firebaseUser } = useAuth();

  const queryKey = ['staff-availability', structureId] as const;
  const { data, isPending: loading, error } = useQuery({
    queryKey,
    queryFn: () => api<StaffApiResponse>(`/api/structures/${structureId}/staff-availability`),
    enabled: !!firebaseUser,
    retry: false,
  });

  // Sélecteur de semaine (limité aux 2 semaines couvertes par la data).
  const [weekIdx, setWeekIdx] = useState<0 | 1>(0);

  // Sélection staff (vide = pool complet, sinon heatmap se filtre dessus).
  const [selectedStaffUids, setSelectedStaffUids] = useState<Set<string>>(() => new Set());
  const staffPickerKey = `aedral_staff_view_selection_${structureId}`;
  useEffect(() => {
    try {
      const stored = localStorage.getItem(staffPickerKey);
      if (stored) {
        const arr = JSON.parse(stored) as string[];
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydratation one-shot depuis localStorage (système externe), pattern voulu
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

  // Toggle d'une catégorie : si TOUS les membres de la cat sont déjà cochés
  // → on les décoche tous ; sinon → on les coche tous (additif).
  const toggleCategoryPick = (categoryUids: string[]) => {
    setSelectedStaffUids(prev => {
      const next = new Set(prev);
      const allIn = categoryUids.length > 0 && categoryUids.every(u => next.has(u));
      if (allIn) {
        for (const u of categoryUids) next.delete(u);
      } else {
        for (const u of categoryUids) next.add(u);
      }
      persistStaffSelection(next);
      return next;
    });
  };

  // Responsive : mobile passe en vue 1 jour.
  const [isWide, setIsWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setIsWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  const [mobileDayIdx, setMobileDayIdx] = useState(0);

  // Grille pour la semaine sélectionnée.
  const todayYmd = data?.today ?? parisYmd(new Date());
  const weekMonday = data?.weekMondays[weekIdx] ?? null;
  const grid = useMemo(() => {
    if (!weekMonday) return null;
    return generateWeekGrid(weekMonday, todayYmd);
  }, [weekMonday, todayYmd]);

  useEffect(() => {
    if (!grid) return;
    const todayIdx = grid.days.findIndex(d => d.gridYmd === todayYmd);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recentre la vue mobile sur aujourd'hui quand la grille/semaine change, sync voulu
    setMobileDayIdx(todayIdx >= 0 ? todayIdx : 0);
  }, [grid, todayYmd]);

  // Sort les membres par rôle (hiérarchique) puis par nom.
  const sortedMembers = useMemo(() => {
    if (!data) return [] as StaffMember[];
    return [...data.members].sort((a, b) => {
      const ra = ROLE_PRIORITY[topRole(a.roles)];
      const rb = ROLE_PRIORITY[topRole(b.roles)];
      if (ra !== rb) return ra - rb;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [data]);

  // Catégories enrichies avec la liste des UIDs qui en font partie.
  const categoriesWithUids = useMemo(() => {
    return ROLE_CATEGORIES.map(cat => {
      const uids = sortedMembers.filter(cat.match).map(m => m.uid);
      const allSelected = uids.length > 0 && uids.every(u => selectedStaffUids.has(u));
      return { ...cat, uids, count: uids.length, allSelected };
    });
  }, [sortedMembers, selectedStaffUids]);

  // Comptage + uids dispos par slot iso pour la semaine sélectionnée.
  // Filtré sur sélection si présente.
  const { countsByIso, uidsByIso } = useMemo(() => {
    const counts: Record<string, number> = {};
    const uids: Record<string, string[]> = {};
    if (!data || !weekMonday) return { countsByIso: counts, uidsByIso: uids };
    const filterActive = selectedStaffUids.size > 0;
    for (const m of data.members) {
      if (filterActive && !selectedStaffUids.has(m.uid)) continue;
      const slots = m.slotsByWeek[weekMonday] ?? [];
      for (const s of slots) {
        counts[s] = (counts[s] ?? 0) + 1;
        if (!uids[s]) uids[s] = [];
        uids[s].push(m.uid);
      }
    }
    return { countsByIso: counts, uidsByIso: uids };
  }, [data, weekMonday, selectedStaffUids]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-center py-10">
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Impossible de charger les dispos staff.
        </p>
      </div>
    );
  }
  if (data.members.length === 0) {
    return (
      <div className="text-center py-10">
        <Users size={24} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Aucun staff identifié pour cette structure.
        </p>
      </div>
    );
  }

  const poolSize = data.members.length;
  const selectionSize = selectedStaffUids.size;
  const isSelectionMode = selectionSize > 0;

  if (!grid || !weekMonday) {
    return (
      <div className="text-center py-10">
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Aucune semaine couverte par les dispos.
        </p>
      </div>
    );
  }

  // Jours affichés : tous (desktop) ou juste celui sélectionné (mobile).
  const displayedDays = isWide ? grid.days : [grid.days[mobileDayIdx] ?? grid.days[0]];

  return (
    <div className="space-y-3">
      {/* Header : sélecteur semaine + récap sélection */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bevel-sm overflow-hidden" style={{ border: '1px solid var(--s-border)' }}>
          {data.weekMondays.map((m, i) => {
            const date = new Date(`${m}T12:00:00`);
            const end = new Date(`${addDays(m, 6)}T12:00:00`);
            const label = `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} → ${end.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;
            return (
              <button key={m} type="button" onClick={() => setWeekIdx(i as 0 | 1)}
                className="text-xs font-semibold transition-colors duration-150"
                style={{
                  padding: '5px 12px',
                  background: weekIdx === i ? 'rgba(255,184,0,0.15)' : 'var(--s-elevated)',
                  color: weekIdx === i ? 'var(--s-gold)' : 'var(--s-text-dim)',
                }}>
                {label}
              </button>
            );
          })}
        </div>

        <span className="text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>
          {isSelectionMode
            ? `${selectionSize} staff sélectionné${selectionSize > 1 ? 's' : ''} sur ${poolSize}`
            : `${poolSize} membre${poolSize > 1 ? 's' : ''} staff`}
        </span>
      </div>

      {/* Chips de filtre par rôle — coche/décoche en masse */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="t-label flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>Filtres rapides :</span>
        {categoriesWithUids.filter(c => c.count > 0).map(cat => {
          return (
            <button key={cat.key} type="button"
              onClick={() => toggleCategoryPick(cat.uids)}
              className="bevel-sm text-xs font-semibold transition-colors flex items-center gap-1.5"
              style={{
                padding: '4px 10px',
                background: cat.allSelected ? 'rgba(135,206,250,0.15)' : 'var(--s-elevated)',
                border: `1px solid ${cat.allSelected ? 'rgba(135,206,250,0.45)' : 'var(--s-border)'}`,
                color: cat.allSelected ? 'rgb(135,206,250)' : 'var(--s-text-dim)',
                cursor: 'pointer',
              }}>
              {cat.allSelected && <Check size={11} />}
              {cat.label}
              <span className="t-mono" style={{ opacity: 0.7 }}>({cat.count})</span>
            </button>
          );
        })}
        {isSelectionMode && (
          <button type="button" onClick={clearStaffPick}
            className="text-xs transition-colors duration-150 ml-1"
            style={{ color: 'var(--s-text-muted)', padding: '4px 8px' }}>
            Tout décocher
          </button>
        )}
      </div>

      {/* Légende */}
      <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--s-text-muted)' }}>
        <span className="t-label">Lecture :</span>
        {isSelectionMode ? (
          <>
            <div className="flex items-center gap-1.5">
              <span style={{ display: 'inline-block', width: 14, height: 14, background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }} />
              <span>pas tous dispos</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ display: 'inline-block', width: 14, height: 14, background: 'rgba(47,196,107,0.55)', border: '1px solid rgba(47,196,107,0.8)' }} />
              <span>{selectionSize} sélectionné{selectionSize > 1 ? 's' : ''} tous dispos</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span style={{ display: 'inline-block', width: 14, height: 14, background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }} />
              <span>0 dispo</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ display: 'inline-block', width: 14, height: 14, background: 'rgba(47,196,107,0.15)', border: '1px solid rgba(47,196,107,0.3)' }} />
              <span>1+ dispo (intensité = nombre)</span>
            </div>
          </>
        )}
        {onCreateStaffEvent && (
          <span className="ml-auto t-mono" style={{ color: 'var(--s-text-dim)' }}>
            Clique un créneau vert pour planifier une réunion staff
          </span>
        )}
      </div>

      {/* Sélecteur de jour mobile */}
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
                  fontSize: 11,
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

      {/* Body : grille à gauche, panel staff à droite */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Grille jour/heure principale */}
        <div className="flex-1 min-w-0 w-full">
          {/* En-têtes jours (desktop) */}
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
              return (
                <div key={day.gridYmd} className="relative"
                  style={{ height: SLOT_COUNT * SLOT_HEIGHT, borderLeft: '1px solid var(--s-border)' }}>
                  {TIME_AXIS.map((t, idx) => {
                    const iso = day.slots[idx];
                    const count = countsByIso[iso] ?? 0;

                    // Palette v4 : 2 modes distincts
                    //   - SÉLECTION ACTIVE : gris si pas TOUS dispos, vert vif si tous
                    //     dispos. Pas de palier intermédiaire (n'a pas de sens : on
                    //     veut savoir si on peut réunir CES staff précis).
                    //   - PAS DE SÉLECTION : intensité progressive douce, plus il y a
                    //     de staff, plus c'est vert. Pas de palier "tout le staff" qui
                    //     n'a pas de sens (on ne réunit jamais TOUS les staff).
                    let heatBg: string | undefined;
                    if (isSelectionMode) {
                      if (count >= selectionSize && selectionSize > 0) {
                        heatBg = 'rgba(47,196,107,0.55)'; // tous les sélectionnés dispos
                      }
                      // sinon : pas de fond (gris elevated par défaut)
                    } else if (count > 0) {
                      // Intensité progressive : 1 staff = 0.10, 2 = 0.18, 3+ = 0.28
                      const intensity = Math.min(0.10 + (count - 1) * 0.06, 0.32);
                      heatBg = `rgba(47,196,107,${intensity})`;
                    }

                    // Cell cliquable si :
                    //   - mode sélection : TOUS les sélectionnés dispos (vert vif)
                    //   - mode pool : ≥ 1 staff dispo
                    //   ET jour pas passé ET callback dispo
                    const isClickable = !!onCreateStaffEvent
                      && !day.isPast
                      && (isSelectionMode
                          ? (count >= selectionSize && selectionSize > 0)
                          : count > 0);

                    const slotTitle = count > 0
                      ? `${formatSlotTime(iso)}, ${count}${isSelectionMode ? `/${selectionSize}` : ''} ${isSelectionMode ? 'sélectionné' + (selectionSize > 1 ? 's' : '') : 'staff'} dispo${isClickable ? ' (clique pour planifier)' : ''}`
                      : formatSlotTime(iso);

                    const handleClick = () => {
                      if (!isClickable || !onCreateStaffEvent) return;
                      onCreateStaffEvent({
                        startsAt: iso,
                        endsAt: addMinutesToIso(iso, 60),
                        availableStaffUids: uidsByIso[iso] ?? [],
                      });
                    };

                    return (
                      <div key={idx}
                        onClick={handleClick}
                        title={slotTitle}
                        className={`relative transition-colors ${heatBg ? '' : 'bg-[var(--s-elevated)]'} ${isClickable ? 'hover:brightness-125' : ''}`}
                        style={{
                          position: 'absolute', left: 0, right: 0,
                          top: idx * SLOT_HEIGHT, height: SLOT_HEIGHT,
                          background: heatBg,
                          borderTop: `1px solid ${t.m === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)'}`,
                          cursor: isClickable ? 'pointer' : 'default',
                          opacity: day.isPast ? 0.45 : 1,
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel staff (droite desktop / dessous mobile).
            Pattern WeekView joueurs : checkbox + avatar + nom + rôles détaillés. */}
        <div className="w-full lg:w-[320px] flex-shrink-0 bevel-sm overflow-hidden"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--s-border)', background: 'var(--s-elevated)' }}>
            <Users size={13} style={{ color: 'var(--s-text-dim)' }} />
            <div className="font-display text-sm tracking-wider flex-1">
              POOL STAFF · {poolSize}
            </div>
          </div>
          {isSelectionMode && (
            <div className="px-3 py-2 text-[12px]"
              style={{ background: 'rgba(135,206,250,0.06)', color: 'rgb(135,206,250)', borderBottom: '1px solid var(--s-border)' }}>
              La heatmap se filtre sur tes {selectionSize} sélectionné{selectionSize > 1 ? 's' : ''}.
            </div>
          )}
          <div className="divide-y max-h-[680px] overflow-y-auto" style={{ borderColor: 'var(--s-border)' }}>
            {sortedMembers.map(m => {
              const count = (m.slotsByWeek[weekMonday] ?? []).length;
              const avatar = m.avatarUrl || m.discordAvatar;
              const checked = selectedStaffUids.has(m.uid);
              const isFounder = m.roles.includes('fondateur');
              return (
                <label key={m.uid}
                  className="px-3 py-2.5 flex items-start gap-3 cursor-pointer transition-colors hover:bg-[var(--s-elevated)]">
                  <input type="checkbox" checked={checked}
                    onChange={() => toggleStaffPick(m.uid)}
                    className="w-4 h-4 cursor-pointer flex-shrink-0 mt-1"
                    style={{ accentColor: 'var(--s-gold)' }} />
                  {avatar ? (
                    <Image src={avatar} alt={m.displayName} width={32} height={32} unoptimized
                      className="flex-shrink-0 bevel-sm"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }} />
                  ) : (
                    <div className="w-8 h-8 flex-shrink-0 bevel-sm"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-1" style={{ color: 'var(--s-text)' }}>
                      {m.displayName}
                      {isFounder && <span style={{ color: 'var(--s-gold)' }}>★</span>}
                    </div>
                    {/* Rôles : structure-level en clair, puis chaque team membership
                        avec son rôle précis et son jeu (badge couleur du jeu). */}
                    <div className="text-[12px] mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1" style={{ color: 'var(--s-text-dim)' }}>
                      {m.roles.includes('fondateur') && <span>Fondateur</span>}
                      {m.roles.includes('co_fondateur') && <span>Co-fondateur</span>}
                      {m.roles.includes('responsable') && <span>Responsable</span>}
                      {m.roles.includes('coach_structure') && <span>Coach structure</span>}
                      {m.teamMemberships.map((tm, i) => {
                        const roleLbl = tm.role === 'manager' ? 'Manager' : tm.role === 'coach' ? 'Coach' : 'Capitaine';
                        const teamLbl = tm.teamLabel ? `${tm.teamName} ${tm.teamLabel}` : tm.teamName;
                        const gameColor = getGameColor(tm.teamGame);
                        return (
                          <span key={`${tm.teamId}-${i}`} className="inline-flex items-center gap-1">
                            <span style={{
                              display: 'inline-block',
                              width: 6, height: 6, borderRadius: '50%',
                              background: gameColor,
                              flexShrink: 0,
                            }} />
                            <span>{roleLbl} {teamLbl}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="text-xs flex-shrink-0 flex items-center gap-1" style={{ color: count === 0 ? 'var(--s-text-muted)' : 'var(--s-text-dim)' }}>
                    {count > 0 && <Check size={11} style={{ color: '#2fc46b' }} />}
                    {count === 0 ? '—' : count}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
