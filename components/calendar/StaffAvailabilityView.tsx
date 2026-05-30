'use client';

// Vue dédiée onglet "STAFF" du calendrier de structure (validée Matt 2026-05-25).
// Affiche une heatmap consensus des dispos du POOL STAFF (fondateur + co-fonda
// + responsable + coach structure + staff d'équipes + capitaines). Permet aux
// dirigeants + responsables de repérer les meilleurs créneaux pour organiser
// une réunion staff.
//
// Pas de blocs de matching auto pour l'instant (juste la heatmap pour cibler
// les créneaux). On pourra ajouter un matching dédié si Matt le demande.

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Settings, Save, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError } from '@/lib/api-client';
import {
  addDays,
  generateWeekGrid,
  getIsoWeekId,
} from '@/lib/availability';

// Mêmes types que la route /api/structures/[id]/staff-availability
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

// Hiérarchie pour afficher le rôle "principal" du staff (le plus élevé)
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

// Plage horaire de la heatmap : 8h → 2h (alignée sur la heatmap équipe)
const UNIFIED_START_HOUR = 8;
const UNIFIED_END_HOUR_NEXT_DAY = 2;

type UnifiedCell = {
  iso: string;
  inSchedule: boolean;
  hour: number;
  minute: number;
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

function buildRow(day: { gridYmd: string; slots: string[] }): UnifiedCell[] {
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

// Couleurs heatmap staff, palette 3 paliers alignée sur la heatmap équipe
//   gris  : < minPlayers dispo (pas matchable)
//   VERT  : ≥ minPlayers dispo (réunion staff possible)
//   OR    : tout le staff dispo (créneau optimal)
function cellColors(count: number, total: number, minPlayers: number): { bg: string; border: string } {
  if (count === 0) {
    return { bg: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.06)' };
  }
  if (total > 0 && count >= total) {
    return { bg: '#ffb800', border: '#ffd24d' };
  }
  if (minPlayers > 0 && count >= minPlayers) {
    return { bg: '#2fc46b', border: '#5fe39a' };
  }
  return { bg: 'rgba(255,255,255,0.10)', border: 'rgba(255,255,255,0.18)' };
}

export default function StaffAvailabilityView({
  structureId,
  canEditConfig = false,
}: {
  structureId: string;
  members: unknown[];  // accepté pour compat de signature parent (non utilisé)
  teams: unknown[];    // idem
  structureRoles: unknown; // idem
  canEditConfig?: boolean;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [weekIdx, setWeekIdx] = useState<0 | 1>(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [minPlayersEdit, setMinPlayersEdit] = useState(2);
  const [configDirty, setConfigDirty] = useState(false);

  const queryKey = ['staff-availability', structureId] as const;
  const { data, isPending: loading, error } = useQuery({
    queryKey,
    queryFn: () => api<StaffApiResponse>(`/api/structures/${structureId}/staff-availability`),
    enabled: !!firebaseUser,
    retry: false,
  });

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

  // Grille pour la semaine sélectionnée
  const { rows, countsByIso } = useMemo(() => {
    if (!data || data.weekMondays.length === 0) return { rows: [] as { day: { gridYmd: string; isPast: boolean; slots: string[] }; cells: UnifiedCell[] }[], countsByIso: {} as Record<string, number> };
    const monday = data.weekMondays[weekIdx];
    if (!monday) return { rows: [], countsByIso: {} };
    const grid = generateWeekGrid(monday, data.today);
    const counts: Record<string, number> = {};
    for (const m of data.members) {
      const slots = m.slotsByWeek[monday] ?? [];
      for (const s of slots) counts[s] = (counts[s] ?? 0) + 1;
    }
    const rows = grid.days.map(day => ({ day, cells: buildRow(day) }));
    return { rows, countsByIso: counts };
  }, [data, weekIdx]);

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

  const totalStaff = data.members.length;
  const minPlayers = data.minPlayersForStaffMatch;
  const monday = data.weekMondays[weekIdx];

  return (
    <div className="space-y-4">
      {/* Header : sélecteur semaine + config */}
      <div className="flex flex-wrap items-center gap-2">
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
          {totalStaff} membre{totalStaff > 1 ? 's' : ''} staff
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
          <span style={{ display: 'inline-block', width: 14, height: 14, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)' }} />
          <span>moins de {minPlayers} dispo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 14, height: 14, background: '#2fc46b', border: '1px solid #5fe39a' }} />
          <span>{minPlayers}+ dispo, réunion possible</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 14, height: 14, background: '#ffb800', border: '1px solid #ffd24d' }} />
          <span>tout le staff dispo ({totalStaff}/{totalStaff})</span>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bevel-sm overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
        <div className="p-3 space-y-1">
          {rows.map(row => {
            const dayDate = new Date(`${row.day.gridYmd}T12:00:00`);
            const dayLabel = dayDate.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit' });
            return (
              <div key={row.day.gridYmd} className="flex items-center gap-2">
                <div className="t-mono flex-shrink-0 text-right"
                  style={{ width: 56, fontSize: 12, color: row.day.isPast ? 'var(--s-text-muted)' : 'var(--s-text-dim)', opacity: row.day.isPast ? 0.6 : 1 }}>
                  {dayLabel}
                </div>
                <div className="flex-1 grid gap-[2px]"
                  style={{ gridTemplateColumns: `repeat(${row.cells.length}, minmax(0, 1fr))` }}>
                  {row.cells.map(cell => {
                    if (!cell.inSchedule) {
                      return (
                        <div key={cell.iso} style={{
                          height: 22,
                          background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 3px, transparent 3px, transparent 6px)',
                          border: '1px solid rgba(255,255,255,0.04)',
                        }} />
                      );
                    }
                    const count = countsByIso[cell.iso] ?? 0;
                    const colors = cellColors(count, totalStaff, minPlayers);
                    const hhmm = `${pad2(cell.hour)}:${pad2(cell.minute)}`;
                    const title = `${hhmm}, ${count}/${totalStaff} staff dispo`;
                    return (
                      <div key={cell.iso} title={title}
                        style={{ height: 22, background: colors.bg, border: `1px solid ${colors.border}` }} />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Liste staff */}
      <div className="bevel-sm overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--s-border)', background: 'var(--s-elevated)' }}>
          <div className="font-display text-sm tracking-wider">POOL STAFF · {totalStaff}</div>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
          {data.members
            .slice()
            .sort((a, b) => ROLE_PRIORITY[topRole(a.roles)] - ROLE_PRIORITY[topRole(b.roles)])
            .map(m => {
              const count = (m.slotsByWeek[monday] ?? []).length;
              const avatar = m.avatarUrl || m.discordAvatar;
              const main = topRole(m.roles);
              return (
                <div key={m.uid} className="px-4 py-2.5 flex items-center gap-3">
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
                    <div className="text-[12px]" style={{ color: 'var(--s-text-dim)' }}>
                      {m.roles.map(r => ROLE_LABEL[r]).join(' · ')}
                      {main === 'fondateur' && <span className="ml-1" style={{ color: 'var(--s-gold)' }}>★</span>}
                    </div>
                  </div>
                  <div className="text-xs flex-shrink-0" style={{ color: count === 0 ? 'var(--s-text-muted)' : 'var(--s-text-dim)' }}>
                    {count === 0 ? 'Aucun créneau' : `${count} créneau${count > 1 ? 'x' : ''}`}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
