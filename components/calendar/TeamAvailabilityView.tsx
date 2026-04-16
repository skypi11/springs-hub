'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import {
  Loader2,
  Zap,
  Settings as SettingsIcon,
  Save,
  ChevronDown,
  ChevronUp,
  Users,
  LayoutGrid,
  User,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  formatSlotTime,
  addMinutesToIso,
  SLOT_DURATION_MINUTES,
  generateWeekGrid,
  type MatchBlock,
  type DayGrid,
} from '@/lib/availability';

// ─── Types API ──────────────────────────────────────────────────────────
type Member = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  isTitulaire: boolean;
  slotsByWeek: Record<string, string[]>;
  conflictSlots: string[];
};

type WeekData = {
  mondayYmd: string;
  weekId: string;
  blocks: MatchBlock[];
};

type ApiResponse = {
  team: {
    id: string;
    name: string;
    game: string;
    minPlayersForMatch: number;
    minMatchDurationMinutes: number;
  };
  today: string;
  weeks: WeekData[];
  members: Member[];
};

// ─── Constantes d'affichage ─────────────────────────────────────────────
// Plage horaire unifiée pour la heatmap : on couvre la plus large (sam/dim)
// et on grise les cellules hors schedule des autres jours. Le résultat est
// une matrice parfaitement rectangulaire, sans scroll horizontal.
const UNIFIED_START_HOUR = 10;
const UNIFIED_END_HOUR_NEXT_DAY = 2;
const UNIFIED_SLOT_COUNT =
  (24 - UNIFIED_START_HOUR) * 2 + UNIFIED_END_HOUR_NEXT_DAY * 2; // 32

const DAY_LABELS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

type UnifiedCell = {
  iso: string;           // "YYYY-MM-DDTHH:MM"
  inSchedule: boolean;   // true si ce slot existe dans la grille réelle du jour
  hour: number;          // 10..23, 0, 1 (pour l'affichage des labels)
  minute: number;        // 0 ou 30
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Construit les 32 slots unifiés pour un jour donné (gridYmd = date propriétaire). */
function buildUnifiedRow(day: DayGrid): UnifiedCell[] {
  const cells: UnifiedCell[] = [];
  const scheduleSet = new Set(day.slots);
  for (let h = UNIFIED_START_HOUR; h < 24; h++) {
    for (const m of [0, 30]) {
      const iso = `${day.gridYmd}T${pad2(h)}:${pad2(m)}`;
      cells.push({ iso, inSchedule: scheduleSet.has(iso), hour: h, minute: m });
    }
  }
  if (UNIFIED_END_HOUR_NEXT_DAY > 0) {
    const next = addDaysYmd(day.gridYmd, 1);
    for (let h = 0; h < UNIFIED_END_HOUR_NEXT_DAY; h++) {
      for (const m of [0, 30]) {
        const iso = `${next}T${pad2(h)}:${pad2(m)}`;
        cells.push({ iso, inSchedule: scheduleSet.has(iso), hour: h, minute: m });
      }
    }
  }
  return cells;
}

function formatDayLabel(day: DayGrid): string {
  const [y, mo, d] = day.gridYmd.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return `${DAY_LABELS_SHORT[(day.dayOfWeek - 1) % 7]} ${date.getUTCDate()}`;
}

function formatBlockLabel(block: MatchBlock): string {
  const startDate = new Date(block.startSlot.slice(0, 10) + 'T12:00:00');
  const dayLabel = DAY_LABELS_SHORT[(startDate.getDay() + 6) % 7];
  const dayNum = startDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const startHHMM = formatSlotTime(block.startSlot);
  const endSlot = addMinutesToIso(block.endSlot, SLOT_DURATION_MINUTES);
  const endHHMM = formatSlotTime(endSlot);
  const hours = Math.floor(block.durationMinutes / 60);
  const mins = block.durationMinutes % 60;
  const dur = mins === 0 ? `${hours}h` : `${hours}h${mins}`;
  return `${dayLabel} ${dayNum} · ${startHHMM} → ${endHHMM} (${dur})`;
}

// ─── Composant principal ────────────────────────────────────────────────
export default function TeamAvailabilityView({
  structureId,
  teamId,
  canEditConfig,
}: {
  structureId: string;
  teamId: string;
  canEditConfig: boolean;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [mode, setMode] = useState<'consensus' | 'per-player'>('consensus');
  const [weekIdx, setWeekIdx] = useState<0 | 1>(0);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [minPlayers, setMinPlayers] = useState(2);
  const [minDurationHours, setMinDurationHours] = useState(1);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(
        `/api/structures/teams/availability?structureId=${encodeURIComponent(structureId)}&teamId=${encodeURIComponent(teamId)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (res.ok) {
        const d = (await res.json()) as ApiResponse;
        setData(d);
        setMinPlayers(d.team.minPlayersForMatch);
        setMinDurationHours(d.team.minMatchDurationMinutes / 60);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Erreur de chargement');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setLoading(false);
  }, [firebaseUser, structureId, teamId, toast]);

  useEffect(() => { load(); }, [load]);

  async function saveConfig() {
    if (!firebaseUser) return;
    setSavingConfig(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'updateMatchConfig',
          structureId,
          teamId,
          minPlayersForMatch: minPlayers,
          minMatchDurationMinutes: Math.round(minDurationHours * 60),
        }),
      });
      if (res.ok) {
        toast.success('Configuration enregistrée');
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setSavingConfig(false);
  }

  // Grille unifiée pour la semaine courante affichée
  const { rows, slotCountsByIso } = useMemo(() => {
    if (!data) return { rows: [], slotCountsByIso: {} };
    const week = data.weeks[weekIdx];
    if (!week) return { rows: [], slotCountsByIso: {} };
    const grid = generateWeekGrid(week.mondayYmd, data.today);

    const counts: Record<string, number> = {};
    for (const m of data.members) {
      const slots = m.slotsByWeek[week.mondayYmd] ?? [];
      for (const s of slots) counts[s] = (counts[s] ?? 0) + 1;
    }

    const rows = grid.days.map(day => ({
      day,
      cells: buildUnifiedRow(day),
    }));
    return { rows, slotCountsByIso: counts };
  }, [data, weekIdx]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }
  if (!data) return null;

  const hasMembers = data.members.length > 0;
  const totalMembers = data.members.length;
  const allBlocks = data.weeks.flatMap(w => w.blocks);
  const currentWeek = data.weeks[weekIdx];
  const selectedSlotInfo = selectedSlot
    ? {
        iso: selectedSlot,
        available: data.members.filter(m =>
          (m.slotsByWeek[currentWeek.mondayYmd] ?? []).includes(selectedSlot)
        ),
        unavailable: data.members.filter(m =>
          !(m.slotsByWeek[currentWeek.mondayYmd] ?? []).includes(selectedSlot)
        ),
        conflicted: data.members.filter(m => m.conflictSlots.includes(selectedSlot)),
      }
    : null;

  return (
    <div className="space-y-5">
      {/* ═══ Config dirigeant ═══ */}
      {canEditConfig && (
        <div>
          <button type="button" onClick={() => setConfigOpen(v => !v)}
            className="flex items-center gap-1.5 t-label transition-opacity duration-150 hover:opacity-80"
            style={{ fontSize: '12px', color: 'var(--s-text-muted)', cursor: 'pointer' }}>
            <SettingsIcon size={12} />
            CONFIGURATION DU MATCHING
            {configOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {configOpen && (
            <div className="mt-2 p-4 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5" style={{ fontSize: '12px' }}>
                    Joueurs minimum
                  </label>
                  <input type="number" min={1} max={10}
                    value={minPlayers}
                    onChange={e => setMinPlayers(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                    className="settings-input w-full text-sm" />
                </div>
                <div>
                  <label className="t-label block mb-1.5" style={{ fontSize: '12px' }}>
                    Durée minimum
                  </label>
                  <select className="settings-input w-full text-sm"
                    value={minDurationHours}
                    onChange={e => setMinDurationHours(parseFloat(e.target.value))}>
                    {[0.5, 1, 1.5, 2, 2.5, 3, 4].map(h => (
                      <option key={h} value={h}>{h}h</option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="button" onClick={saveConfig} disabled={savingConfig}
                className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-sm mt-3">
                {savingConfig ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Enregistrer
              </button>
            </div>
          )}
        </div>
      )}

      {!hasMembers ? (
        <p className="text-sm italic" style={{ color: 'var(--s-text-muted)' }}>
          Ajoute des titulaires ou remplaçants pour activer le matching.
        </p>
      ) : (
        <>
          {/* ═══ SUGGESTIONS MATCHING ═══ */}
          <section className="bevel-sm p-4 relative overflow-hidden"
            style={{
              background: 'rgba(255,184,0,0.04)',
              border: '1px solid rgba(255,184,0,0.20)',
            }}>
            <div className="absolute top-0 left-0 right-0 h-[3px]"
              style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 80%)' }} />
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Zap size={14} style={{ color: 'var(--s-gold)' }} />
              <p className="t-label" style={{ fontSize: '12px', color: 'var(--s-gold)' }}>
                CRÉNEAUX SUGGÉRÉS ({allBlocks.length})
              </p>
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                ≥ {data.team.minPlayersForMatch} joueurs · ≥ {data.team.minMatchDurationMinutes / 60}h
              </span>
            </div>
            {allBlocks.length === 0 ? (
              <p className="text-sm italic" style={{ color: 'var(--s-text-muted)' }}>
                Aucun créneau commun pour le moment — regarde la heatmap ci-dessous.
              </p>
            ) : (
              <div className="space-y-2">
                {data.weeks.map((week, wi) => (
                  week.blocks.length > 0 && (
                    <div key={week.weekId}>
                      <p className="t-mono mb-1.5" style={{ fontSize: '11px', color: 'var(--s-text-muted)' }}>
                        {wi === 0 ? 'SEMAINE COURANTE' : 'SEMAINE SUIVANTE'}
                      </p>
                      <div className="space-y-1.5">
                        {week.blocks.map((block, bi) => {
                          const names = block.playerIds
                            .map(id => data.members.find(m => m.uid === id)?.displayName ?? id.slice(0, 8))
                            .join(', ');
                          return (
                            <div key={bi} className="flex items-center gap-2 flex-wrap px-3 py-2 bevel-sm"
                              style={{ background: 'rgba(255,184,0,0.09)', border: '1px solid rgba(255,184,0,0.28)' }}>
                              <span className="text-sm font-semibold" style={{ color: 'var(--s-gold)' }}>
                                {formatBlockLabel(block)}
                              </span>
                              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                                · {block.playerIds.length} joueur{block.playerIds.length > 1 ? 's' : ''} ({names})
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
          </section>

          {/* ═══ HEATMAP CONTROLS ═══ */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Week toggle */}
            <div className="flex items-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <SegButton active={weekIdx === 0} onClick={() => { setWeekIdx(0); setSelectedSlot(null); }}>
                S. COURANTE
              </SegButton>
              <SegButton active={weekIdx === 1} onClick={() => { setWeekIdx(1); setSelectedSlot(null); }}>
                S. SUIVANTE
              </SegButton>
            </div>
            {/* Mode toggle */}
            <div className="flex items-center ml-auto" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <SegButton active={mode === 'consensus'} onClick={() => setMode('consensus')}>
                <LayoutGrid size={12} className="inline mr-1.5" />
                CONSENSUS
              </SegButton>
              <SegButton active={mode === 'per-player'} onClick={() => setMode('per-player')}>
                <User size={12} className="inline mr-1.5" />
                PAR JOUEUR
              </SegButton>
            </div>
          </div>

          {/* ═══ HEATMAP CONSENSUS ═══ */}
          {mode === 'consensus' && (
            <ConsensusHeatmap
              rows={rows}
              slotCountsByIso={slotCountsByIso}
              totalMembers={totalMembers}
              minPlayers={data.team.minPlayersForMatch}
              selectedSlot={selectedSlot}
              onSelectSlot={setSelectedSlot}
            />
          )}

          {/* Détail d'un slot sélectionné */}
          {mode === 'consensus' && selectedSlotInfo && selectedSlotInfo.available.length + selectedSlotInfo.unavailable.length > 0 && (
            <SlotDetailCard
              iso={selectedSlotInfo.iso}
              available={selectedSlotInfo.available}
              unavailable={selectedSlotInfo.unavailable}
              conflicted={selectedSlotInfo.conflicted}
              onClose={() => setSelectedSlot(null)}
            />
          )}

          {/* ═══ HEATMAP PAR JOUEUR ═══ */}
          {mode === 'per-player' && (
            <PerPlayerHeatmap
              rows={rows}
              members={data.members}
              mondayYmd={currentWeek.mondayYmd}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Sous-composants ────────────────────────────────────────────────────

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-label transition-all duration-150"
      style={{
        fontSize: '11px',
        padding: '7px 12px',
        background: active ? 'var(--s-gold)' : 'transparent',
        color: active ? '#0a0a0f' : 'var(--s-text-dim)',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function ConsensusHeatmap({
  rows,
  slotCountsByIso,
  totalMembers,
  minPlayers,
  selectedSlot,
  onSelectSlot,
}: {
  rows: { day: DayGrid; cells: UnifiedCell[] }[];
  slotCountsByIso: Record<string, number>;
  totalMembers: number;
  minPlayers: number;
  selectedSlot: string | null;
  onSelectSlot: (iso: string | null) => void;
}) {
  // Labels d'heure tous les 2 slots (colonnes 0, 4, 8, 12, 16, 20, 24, 28) = toutes les 2h
  const headerHours: { col: number; label: string }[] = [];
  // On utilise la première ligne pour déterminer les heures affichées (elles sont identiques pour tous les jours)
  if (rows.length > 0) {
    rows[0].cells.forEach((c, i) => {
      if (i % 4 === 0) {
        headerHours.push({ col: i, label: `${c.hour}h` });
      }
    });
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Users size={13} style={{ color: 'var(--s-text-dim)' }} />
        <p className="t-label" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
          HEATMAP CONSENSUS
        </p>
        <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          · click un créneau pour voir qui est dispo
        </span>
      </div>

      <div style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', padding: '10px 12px' }}>
        {/* Header : labels d'heure */}
        <div className="flex items-center mb-1.5" style={{ paddingLeft: 52 }}>
          <div className="relative flex-1" style={{ height: 14 }}>
            {headerHours.map(h => (
              <span
                key={h.col}
                className="t-mono absolute"
                style={{
                  left: `${(h.col / UNIFIED_SLOT_COUNT) * 100}%`,
                  fontSize: '10px',
                  color: 'var(--s-text-muted)',
                  transform: 'translateX(-50%)',
                }}
              >
                {h.label}
              </span>
            ))}
          </div>
        </div>

        {/* Lignes jours */}
        <div className="space-y-[3px]">
          {rows.map(row => (
            <DayHeatmapRow
              key={row.day.gridYmd}
              day={row.day}
              cells={row.cells}
              slotCountsByIso={slotCountsByIso}
              totalMembers={totalMembers}
              minPlayers={minPlayers}
              selectedSlot={selectedSlot}
              onSelectSlot={onSelectSlot}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mt-3 pt-3 flex-wrap" style={{ borderTop: '1px solid var(--s-border)' }}>
          <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>CHAQUE CASE = 30 MIN</span>
          <div className="flex items-center gap-1.5">
            <LegendSwatch color="rgba(255,255,255,0.04)" />
            <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>0 joueur</span>
          </div>
          <div className="flex items-center gap-1.5">
            <LegendSwatch color="rgba(123,47,190,0.45)" />
            <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>quelques joueurs</span>
          </div>
          <div className="flex items-center gap-1.5">
            <LegendSwatch color="rgba(255,184,0,0.8)" border="var(--s-gold)" />
            <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>seuil match ({minPlayers}+)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function LegendSwatch({ color, border }: { color: string; border?: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 14,
      height: 12,
      background: color,
      border: `1px solid ${border || 'rgba(255,255,255,0.12)'}`,
    }} />
  );
}

function DayHeatmapRow({
  day,
  cells,
  slotCountsByIso,
  totalMembers,
  minPlayers,
  selectedSlot,
  onSelectSlot,
}: {
  day: DayGrid;
  cells: UnifiedCell[];
  slotCountsByIso: Record<string, number>;
  totalMembers: number;
  minPlayers: number;
  selectedSlot: string | null;
  onSelectSlot: (iso: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* Label jour */}
      <div
        className="t-mono flex-shrink-0 text-right"
        style={{
          width: 44,
          fontSize: '11px',
          color: day.isPast ? 'var(--s-text-muted)' : 'var(--s-text-dim)',
          opacity: day.isPast ? 0.6 : 1,
        }}
      >
        {formatDayLabel(day)}
      </div>

      {/* Slots row */}
      <div
        className="flex-1 grid gap-[2px]"
        style={{
          gridTemplateColumns: `repeat(${UNIFIED_SLOT_COUNT}, minmax(0, 1fr))`,
        }}
      >
        {cells.map(cell => {
          const count = slotCountsByIso[cell.iso] ?? 0;
          const isSelected = selectedSlot === cell.iso;
          return (
            <HeatmapCell
              key={cell.iso}
              cell={cell}
              count={count}
              totalMembers={totalMembers}
              minPlayers={minPlayers}
              isPastDay={day.isPast}
              isSelected={isSelected}
              onClick={() => {
                if (!cell.inSchedule || day.isPast) return;
                onSelectSlot(isSelected ? null : cell.iso);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function HeatmapCell({
  cell,
  count,
  totalMembers,
  minPlayers,
  isPastDay,
  isSelected,
  onClick,
}: {
  cell: UnifiedCell;
  count: number;
  totalMembers: number;
  minPlayers: number;
  isPastDay: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  if (!cell.inSchedule) {
    return (
      <div
        style={{
          height: 22,
          background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 3px, transparent 3px, transparent 6px)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}
      />
    );
  }

  const ratio = totalMembers > 0 ? count / totalMembers : 0;
  const meetsThreshold = count >= minPlayers && minPlayers > 0;

  let bg: string;
  let border: string;
  if (count === 0) {
    bg = 'rgba(255,255,255,0.035)';
    border = 'rgba(255,255,255,0.06)';
  } else if (meetsThreshold) {
    // Au-dessus du seuil → or
    const op = 0.55 + ratio * 0.4;
    bg = `rgba(255,184,0,${op})`;
    border = 'rgba(255,184,0,0.85)';
  } else {
    // Sous le seuil → violet progressif
    const op = 0.25 + ratio * 0.5;
    bg = `rgba(123,47,190,${op})`;
    border = 'rgba(163,100,217,0.55)';
  }

  const hhmm = `${pad2(cell.hour)}:${pad2(cell.minute)}`;
  const title = `${hhmm} — ${count}/${totalMembers} joueur${count > 1 ? 's' : ''} dispo${count > 1 ? 's' : ''}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPastDay}
      title={title}
      style={{
        height: 22,
        background: bg,
        border: isSelected
          ? '2px solid #fff'
          : `1px solid ${border}`,
        cursor: isPastDay ? 'default' : 'pointer',
        padding: 0,
        opacity: isPastDay ? 0.4 : 1,
        transition: 'transform 0.1s ease',
      }}
      aria-label={title}
    />
  );
}

function SlotDetailCard({
  iso,
  available,
  unavailable,
  conflicted,
  onClose,
}: {
  iso: string;
  available: Member[];
  unavailable: Member[];
  conflicted: Member[];
  onClose: () => void;
}) {
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 16);
  const [y, mo, d] = datePart.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  const dayName = DAY_LABELS_SHORT[((date.getUTCDay() + 6) % 7)];
  const endTimeParis = addMinutesToIso(iso, SLOT_DURATION_MINUTES).slice(11, 16);

  const conflictedIds = new Set(conflicted.map(m => m.uid));

  return (
    <section className="bevel-sm p-4 relative" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <p className="t-label" style={{ fontSize: '12px', color: 'var(--s-text-muted)' }}>CRÉNEAU SÉLECTIONNÉ</p>
          <p className="font-display text-xl" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>
            {dayName} {date.getUTCDate()} · {timePart} → {endTimeParis}
          </p>
        </div>
        <button type="button" onClick={onClose}
          className="text-xs transition-opacity duration-150 hover:opacity-80"
          style={{ color: 'var(--s-text-muted)', cursor: 'pointer' }}>
          Fermer
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="t-label mb-2" style={{ color: 'var(--s-gold)' }}>
            DISPO ({available.length})
          </p>
          {available.length === 0 ? (
            <p className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>Personne</p>
          ) : (
            <div className="space-y-1.5">
              {available.map(m => (
                <MemberLine key={m.uid} member={m} conflicted={conflictedIds.has(m.uid)} />
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="t-label mb-2" style={{ color: 'var(--s-text-muted)' }}>
            PAS DISPO ({unavailable.length})
          </p>
          {unavailable.length === 0 ? (
            <p className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>Personne</p>
          ) : (
            <div className="space-y-1.5">
              {unavailable.map(m => (
                <MemberLine key={m.uid} member={m} conflicted={conflictedIds.has(m.uid)} dim />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MemberLine({ member, conflicted, dim }: { member: Member; conflicted: boolean; dim?: boolean }) {
  const avatar = member.avatarUrl || member.discordAvatar;
  return (
    <div className="flex items-center gap-2" style={{ opacity: dim ? 0.65 : 1 }}>
      {avatar ? (
        <Image src={avatar} alt="" width={20} height={20} unoptimized className="rounded-full flex-shrink-0" />
      ) : (
        <div className="w-[20px] h-[20px] rounded-full flex-shrink-0" style={{ background: 'var(--s-surface)' }} />
      )}
      <span className="text-sm truncate" style={{ color: 'var(--s-text)' }}>
        {member.displayName}
      </span>
      {!member.isTitulaire && (
        <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>REMP</span>
      )}
      {conflicted && (
        <span className="t-label" style={{ color: '#ff9955' }}>EVENT</span>
      )}
    </div>
  );
}

// ─── Mode vue par joueur ─────────────────────────────────────────────────
function PerPlayerHeatmap({
  rows,
  members,
  mondayYmd,
}: {
  rows: { day: DayGrid; cells: UnifiedCell[] }[];
  members: Member[];
  mondayYmd: string;
}) {
  // Pre-calc totaux par joueur
  const totalsByPlayer = useMemo(() => {
    const out: Record<string, { hours: number; conflictHours: number }> = {};
    for (const m of members) {
      const slots = m.slotsByWeek[mondayYmd] ?? [];
      const conflictSet = new Set(m.conflictSlots);
      let conflictSlots = 0;
      for (const s of slots) if (conflictSet.has(s)) conflictSlots++;
      out[m.uid] = {
        hours: slots.length * 0.5,
        conflictHours: conflictSlots * 0.5,
      };
    }
    return out;
  }, [members, mondayYmd]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <User size={13} style={{ color: 'var(--s-text-dim)' }} />
        <p className="t-label" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
          DISPOS JOUEUR PAR JOUEUR
        </p>
        <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          · hachuré = créneau déjà pris par un event
        </span>
      </div>
      <div className="space-y-3">
        {members.map(m => (
          <PlayerHeatmapCard
            key={m.uid}
            member={m}
            rows={rows}
            mondayYmd={mondayYmd}
            totals={totalsByPlayer[m.uid]}
          />
        ))}
      </div>
    </section>
  );
}

function PlayerHeatmapCard({
  member,
  rows,
  mondayYmd,
  totals,
}: {
  member: Member;
  rows: { day: DayGrid; cells: UnifiedCell[] }[];
  mondayYmd: string;
  totals: { hours: number; conflictHours: number } | undefined;
}) {
  const availableSet = useMemo(() => new Set(member.slotsByWeek[mondayYmd] ?? []), [member, mondayYmd]);
  const conflictSet = useMemo(() => new Set(member.conflictSlots), [member.conflictSlots]);
  const avatar = member.avatarUrl || member.discordAvatar;

  return (
    <div className="bevel-sm p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-center gap-2 mb-2">
        {avatar ? (
          <Image src={avatar} alt="" width={22} height={22} unoptimized className="rounded-full flex-shrink-0" />
        ) : (
          <div className="w-[22px] h-[22px] rounded-full flex-shrink-0" style={{ background: 'var(--s-surface)' }} />
        )}
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>
          {member.displayName}
        </span>
        {!member.isTitulaire && (
          <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>REMP</span>
        )}
        <span className="ml-auto t-mono flex-shrink-0" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
          {totals ? `${totals.hours}h dispo${totals.conflictHours > 0 ? ` · ${totals.conflictHours}h d'event` : ''}` : '—'}
        </span>
      </div>
      <div className="space-y-[2px]">
        {rows.map(row => (
          <div key={row.day.gridYmd} className="flex items-center gap-1.5">
            <div
              className="t-mono flex-shrink-0 text-right"
              style={{ width: 36, fontSize: '10px', color: 'var(--s-text-muted)', opacity: row.day.isPast ? 0.5 : 1 }}
            >
              {DAY_LABELS_SHORT[(row.day.dayOfWeek - 1) % 7].slice(0, 1)}
              <span style={{ marginLeft: 2 }}>{parseInt(row.day.gridYmd.slice(-2), 10)}</span>
            </div>
            <div
              className="flex-1 grid gap-[1px]"
              style={{
                gridTemplateColumns: `repeat(${UNIFIED_SLOT_COUNT}, minmax(0, 1fr))`,
              }}
            >
              {row.cells.map(cell => {
                if (!cell.inSchedule) {
                  return (
                    <div
                      key={cell.iso}
                      style={{
                        height: 14,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.03)',
                      }}
                    />
                  );
                }
                const avail = availableSet.has(cell.iso);
                const conflict = conflictSet.has(cell.iso);
                let bg: string;
                let border: string;
                if (avail && conflict) {
                  bg = 'repeating-linear-gradient(135deg, rgba(255,153,85,0.6) 0px, rgba(255,153,85,0.6) 3px, rgba(123,47,190,0.4) 3px, rgba(123,47,190,0.4) 6px)';
                  border = 'rgba(255,153,85,0.7)';
                } else if (avail) {
                  bg = 'rgba(123,47,190,0.55)';
                  border = 'rgba(163,100,217,0.7)';
                } else if (conflict) {
                  bg = 'repeating-linear-gradient(135deg, rgba(255,153,85,0.22) 0px, rgba(255,153,85,0.22) 3px, transparent 3px, transparent 6px)';
                  border = 'rgba(255,153,85,0.35)';
                } else {
                  bg = 'rgba(255,255,255,0.035)';
                  border = 'rgba(255,255,255,0.06)';
                }
                const hhmm = `${pad2(cell.hour)}:${pad2(cell.minute)}`;
                return (
                  <div
                    key={cell.iso}
                    title={`${hhmm} — ${avail ? 'dispo' : 'pas dispo'}${conflict ? ' · event en cours' : ''}`}
                    style={{
                      height: 14,
                      background: bg,
                      border: `1px solid ${border}`,
                      opacity: row.day.isPast ? 0.4 : 1,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
