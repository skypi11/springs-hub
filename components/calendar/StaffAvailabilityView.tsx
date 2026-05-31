'use client';

// Vue dédiée onglet "STAFF" du calendrier de structure.
//
// REFONTE Matt 2026-05-31 (v3) : reprise du pattern WeekView "joueurs" :
//   - Grille jour/heure (axe horaire vertical à gauche, jours en colonnes)
//   - Panel LATÉRAL À DROITE avec checkboxes staff (cocher pour filtrer)
//   - La heatmap d'intensité se filtre sur les staff sélectionnés
//     (rien coché = pool complet ; cocher 3 staff = heatmap intersection
//     de ces 3 staff)
//   - Click sur un slot matchable → crée une réunion staff pré-remplie
//     avec audience = staff dispos sur ce créneau (selon filtre actif)
//   - Bouton "Configurer" pour régler le minPlayersForStaffMatch
//
// Pool affiché = LARGE (fondateur + co-fonda + responsable + coach
// structure + staff d'équipes + capitaines). Source : /api/structures/[id]/staff-availability.
// Cette vue est visible UNIQUEMENT pour dirigeants + responsables (gating dans
// CalendarSection).

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Settings, Save, Users, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError } from '@/lib/api-client';
import {
  addDays,
  parisYmd,
  generateWeekGrid,
  formatSlotTime,
  addMinutesToIso,
} from '@/lib/availability';

// ─── Types ──────────────────────────────────────────────────────────────
type StaffRole = 'fondateur' | 'co_fondateur' | 'responsable' | 'coach_structure' | 'staff_team' | 'capitaine';
type StaffMember = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  roles: StaffRole[];
  slotsByWeek: Record<string, string[]>;
};
type StaffApiResponse = {
  today: string;
  weekMondays: string[];
  members: StaffMember[];
  minPlayersForStaffMatch: number;
};

const ROLE_LABEL: Record<StaffRole, string> = {
  fondateur: 'Fondateur',
  co_fondateur: 'Co-fondateur',
  responsable: 'Responsable',
  coach_structure: 'Coach structure',
  staff_team: "Staff d'équipe",
  capitaine: 'Capitaine',
};

// Hiérarchie pour afficher le rôle "principal" du staff (le plus élevé).
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

// ─── Layout ─────────────────────────────────────────────────────────────
const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const SLOT_HEIGHT = 22;
const SLOT_COUNT = 36; // 8h → 2h le lendemain = 36 créneaux de 30 min

// Axe horaire identique à WeekView : 8:00 → 23:30 puis 00:00 → 01:30.
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
  canEditConfig = false,
  onCreateStaffEvent,
}: {
  structureId: string;
  members: unknown[];  // accepté pour compat de signature parent (non utilisé)
  teams: unknown[];    // idem
  structureRoles: unknown; // idem
  canEditConfig?: boolean;
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
  const toast = useToast();
  const qc = useQueryClient();

  const queryKey = ['staff-availability', structureId] as const;
  const { data, isPending: loading, error } = useQuery({
    queryKey,
    queryFn: () => api<StaffApiResponse>(`/api/structures/${structureId}/staff-availability`),
    enabled: !!firebaseUser,
    retry: false,
  });

  // Sélecteur de semaine (limité aux 2 semaines couvertes par la data).
  const [weekIdx, setWeekIdx] = useState<0 | 1>(0);

  // Sélection staff (filtre la heatmap, pattern WeekView "joueurs").
  // Vide = pool complet, rempli = intersection (= heatmap montre uniquement
  // les créneaux où TOUS les sélectionnés sont dispos... non, plus exactement :
  // on COMPTE seulement les staff sélectionnés, le palier "tous dispos" devient
  // = "tous les sélectionnés dispos"). Cohérent avec WeekView joueurs.
  const [selectedStaffUids, setSelectedStaffUids] = useState<Set<string>>(() => new Set());
  const staffPickerKey = `aedral_staff_view_selection_${structureId}`;
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

  // Panneau de config (minPlayersForStaffMatch).
  const [configOpen, setConfigOpen] = useState(false);
  const [minPlayersEdit, setMinPlayersEdit] = useState(2);
  const [configDirty, setConfigDirty] = useState(false);
  useEffect(() => {
    if (data && !configDirty) setMinPlayersEdit(data.minPlayersForStaffMatch);
  }, [data, configDirty]);
  const saveConfig = useMutation({
    mutationFn: () => api(`/api/structures/${structureId}/staff-availability`, {
      method: 'POST',
      body: { minPlayersForStaffMatch: minPlayersEdit },
    }),
    onSuccess: () => {
      toast.success('Configuration enregistrée');
      setConfigDirty(false);
      qc.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : 'Erreur'),
  });

  // Responsive : mobile passe en vue 1 jour (comme WeekView).
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

  // Reset le jour sélectionné mobile à chaque changement de semaine
  // (sinon on tombe sur un jour passé ou hors-grille).
  useEffect(() => {
    if (!grid) return;
    const todayIdx = grid.days.findIndex(d => d.gridYmd === todayYmd);
    setMobileDayIdx(todayIdx >= 0 ? todayIdx : 0);
  }, [grid, todayYmd]);

  // Sort les membres une fois (par rôle hiérarchique) — utilisé pour le panel
  // latéral et pour assurer un ordre stable.
  const sortedMembers = useMemo(() => {
    if (!data) return [] as StaffMember[];
    return [...data.members].sort((a, b) => ROLE_PRIORITY[topRole(a.roles)] - ROLE_PRIORITY[topRole(b.roles)]);
  }, [data]);

  // Comptage + uids dispos par slot iso pour la semaine sélectionnée.
  // Si selectedStaffUids vide → on compte tout le pool.
  // Sinon → on compte uniquement les staff sélectionnés (= la heatmap se
  // filtre sur eux, et le palier "tous dispos" devient "tous les sélectionnés").
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

  // Le "total" qui sert au palier "tous dispos" :
  //   - sélection vide → total du pool complet
  //   - sélection active → taille de la sélection (= "tous les sélectionnés dispos")
  const poolSize = data.members.length;
  const effectiveTotal = selectedStaffUids.size > 0 ? selectedStaffUids.size : poolSize;
  const minPlayers = data.minPlayersForStaffMatch;
  const isSelectionMode = selectedStaffUids.size > 0;

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
      {/* Header : sélecteur semaine + config */}
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
            ? `${selectedStaffUids.size} staff sélectionné${selectedStaffUids.size > 1 ? 's' : ''} sur ${poolSize}`
            : `${poolSize} membre${poolSize > 1 ? 's' : ''} staff`}
        </span>

        {canEditConfig && (
          <button type="button" onClick={() => setConfigOpen(o => !o)}
            className="bevel-sm text-xs font-semibold transition-colors flex items-center gap-1.5"
            style={{
              padding: '5px 10px',
              background: configOpen ? 'rgba(255,184,0,0.12)' : 'var(--s-elevated)',
              border: `1px solid ${configOpen ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
              color: configOpen ? 'var(--s-gold)' : 'var(--s-text-dim)',
            }}>
            <Settings size={11} />
            Configurer
          </button>
        )}
      </div>

      {/* Panneau de config */}
      {configOpen && canEditConfig && (
        <div className="bevel-sm p-3 space-y-2"
          style={{ background: 'var(--s-elevated)', border: '1px solid rgba(255,184,0,0.25)' }}>
          <label className="text-xs flex items-center gap-2" style={{ color: 'var(--s-text-dim)' }}>
            Nombre minimum de staff pour considérer un créneau « matchable » :
            <input type="number" min={1} max={20}
              value={minPlayersEdit}
              onChange={e => { setMinPlayersEdit(parseInt(e.target.value, 10) || 1); setConfigDirty(true); }}
              className="settings-input"
              style={{ width: 70, fontSize: 12, padding: '4px 8px' }} />
          </label>
          {configDirty && (
            <button type="button" onClick={() => saveConfig.mutate()}
              disabled={saveConfig.isPending}
              className="btn-springs btn-primary bevel-sm flex items-center gap-1.5 text-xs">
              {saveConfig.isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Enregistrer
            </button>
          )}
        </div>
      )}

      {/* Légende */}
      <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--s-text-muted)' }}>
        <span className="t-label">Lecture :</span>
        <div className="flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 14, height: 14, background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }} />
          <span>moins de {minPlayers} dispo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 14, height: 14, background: 'rgba(47,196,107,0.28)', border: '1px solid rgba(47,196,107,0.5)' }} />
          <span>{minPlayers}+ dispo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 14, height: 14, background: 'rgba(47,196,107,0.55)', border: '1px solid rgba(47,196,107,0.8)' }} />
          <span>{isSelectionMode ? 'tous les sélectionnés dispos' : `tout le staff dispo (${poolSize}/${poolSize})`}</span>
        </div>
        {onCreateStaffEvent && (
          <span className="ml-auto t-mono" style={{ color: 'var(--s-text-dim)' }}>
            Clique un créneau vert pour planifier une réunion staff
          </span>
        )}
      </div>

      {/* Sélecteur de jour mobile (chips 7 jours, comme WeekView). */}
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

      {/* Body : grille à gauche, panel staff à droite (lg+) ou en dessous (mobile) */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Grille jour/heure principale */}
        <div className="flex-1 min-w-0 w-full">
          {/* En-têtes jours (desktop uniquement) */}
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
            {/* Axe horaire vertical (heures pleines uniquement) */}
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
                    // Palette 3 paliers identique heatmap WeekView (gris/vert clair/vert vif).
                    // OR strictement réservé aux BLOCS CONSENSUS dans WeekView, donc ici on n'utilise
                    // QUE du vert (pas d'or) pour rester cohérent.
                    let heatBg: string | undefined;
                    if (count > 0 && effectiveTotal > 0 && count >= effectiveTotal) {
                      heatBg = 'rgba(47,196,107,0.55)'; // tous dispos
                    } else if (count > 0 && minPlayers > 0 && count >= minPlayers) {
                      heatBg = 'rgba(47,196,107,0.28)'; // matchable
                    } else if (count > 0) {
                      heatBg = 'rgba(255,255,255,0.08)'; // ≥ 1 mais sous seuil
                    }

                    // Cell cliquable si : >= minPlayers dispo, jour pas passé, callback dispo
                    const isClickable = !!onCreateStaffEvent
                      && !day.isPast
                      && count >= minPlayers
                      && minPlayers > 0;

                    const slotTitle = count > 0
                      ? `${formatSlotTime(iso)}, ${count}/${effectiveTotal} ${isSelectionMode ? 'sélectionné' + (selectedStaffUids.size > 1 ? 's' : '') : 'staff'} dispo${isClickable ? ' (clique pour planifier)' : ''}`
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

        {/* Panel staff (droite en desktop, dessous en mobile).
            Pattern identique à la liste joueurs de la WeekView : checkbox +
            avatar + nom + rôle + count. Cocher filtre la heatmap. */}
        <div className="w-full lg:w-[280px] flex-shrink-0 bevel-sm overflow-hidden"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--s-border)', background: 'var(--s-elevated)' }}>
            <Users size={13} style={{ color: 'var(--s-text-dim)' }} />
            <div className="font-display text-sm tracking-wider flex-1">
              POOL STAFF · {poolSize}
            </div>
            {isSelectionMode && (
              <button type="button" onClick={clearStaffPick}
                className="text-xs transition-colors duration-150"
                style={{ color: 'var(--s-text-muted)', padding: '2px 6px' }}>
                Tout décocher
              </button>
            )}
          </div>
          {isSelectionMode && (
            <div className="px-3 py-2 text-[12px]"
              style={{ background: 'rgba(135,206,250,0.06)', color: 'rgb(135,206,250)', borderBottom: '1px solid var(--s-border)' }}>
              La heatmap se filtre sur tes {selectedStaffUids.size} sélectionné{selectedStaffUids.size > 1 ? 's' : ''}.
            </div>
          )}
          <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
            {sortedMembers.map(m => {
              const count = (m.slotsByWeek[weekMonday] ?? []).length;
              const avatar = m.avatarUrl || m.discordAvatar;
              const main = topRole(m.roles);
              const checked = selectedStaffUids.has(m.uid);
              return (
                <label key={m.uid}
                  className="px-3 py-2.5 flex items-center gap-3 cursor-pointer transition-colors hover:bg-[var(--s-elevated)]">
                  <input type="checkbox" checked={checked}
                    onChange={() => toggleStaffPick(m.uid)}
                    className="w-4 h-4 cursor-pointer flex-shrink-0"
                    style={{ accentColor: 'var(--s-gold)' }} />
                  {avatar ? (
                    <Image src={avatar} alt={m.displayName} width={28} height={28} unoptimized
                      className="flex-shrink-0 bevel-sm"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }} />
                  ) : (
                    <div className="w-7 h-7 flex-shrink-0 bevel-sm"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>
                      {m.displayName}
                    </div>
                    <div className="text-[12px] truncate" style={{ color: 'var(--s-text-dim)' }}>
                      {ROLE_LABEL[main]}
                      {main === 'fondateur' && <span className="ml-1" style={{ color: 'var(--s-gold)' }}>★</span>}
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
