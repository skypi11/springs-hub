'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { Loader2, Users, Zap, Settings as SettingsIcon, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  formatSlotTime,
  addMinutesToIso,
  SLOT_DURATION_MINUTES,
  type MatchBlock,
} from '@/lib/availability';

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

const DAY_LABELS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Pour un slot "YYYY-MM-DDTHH:MM", détermine à quel jour de grille il appartient.
// Les slots après minuit (00:00-01:30) appartiennent au jour précédent.
function slotToGridDay(slot: string, mondayYmd: string): number | null {
  const dateYmd = slot.slice(0, 10);
  const hour = parseInt(slot.slice(11, 13), 10);
  const afterMidnight = hour < 6;
  const effectiveYmd = afterMidnight ? addDays(dateYmd, -1) : dateYmd;
  // Index 0 = lundi … 6 = dimanche
  for (let i = 0; i < 7; i++) {
    if (addDays(mondayYmd, i) === effectiveYmd) return i;
  }
  return null;
}

function countSlotsByDay(slots: string[], mondayYmd: string): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const s of slots) {
    const idx = slotToGridDay(s, mondayYmd);
    if (idx !== null) counts[idx]++;
  }
  return counts;
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

export default function TeamMatchingPanel({
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

  useEffect(() => {
    load();
  }, [load]);

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

  const weekMondays = useMemo(() => (data ? data.weeks.map(w => w.mondayYmd) : []), [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={14} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (!data) return null;

  const hasMembers = data.members.length > 0;
  const allBlocks = data.weeks.flatMap(w => w.blocks);

  return (
    <div className="space-y-4 pt-3 mt-1" style={{ borderTop: '1px dashed var(--s-border)' }}>
      {/* ═══ Config (dirigeant only) — discret, en haut ═══ */}
      {canEditConfig && (
        <div>
          <button type="button" onClick={() => setConfigOpen(v => !v)}
            className="flex items-center gap-1.5 t-label transition-opacity duration-150 hover:opacity-80"
            style={{ fontSize: '9px', color: 'var(--s-text-muted)' }}>
            <SettingsIcon size={10} />
            CONFIGURATION DU MATCHING
            {configOpen ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          </button>
          {configOpen && (
            <div className="mt-2 p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5" style={{ fontSize: '9px' }}>
                    Joueurs minimum
                  </label>
                  <input type="number" min={1} max={10}
                    value={minPlayers}
                    onChange={e => setMinPlayers(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                    className="settings-input w-full text-xs" />
                </div>
                <div>
                  <label className="t-label block mb-1.5" style={{ fontSize: '9px' }}>
                    Durée minimum (heures)
                  </label>
                  <select className="settings-input w-full text-xs"
                    value={minDurationHours}
                    onChange={e => setMinDurationHours(parseFloat(e.target.value))}>
                    {[0.5, 1, 1.5, 2, 2.5, 3, 4].map(h => (
                      <option key={h} value={h}>{h}h</option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="button" onClick={saveConfig} disabled={savingConfig}
                className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs mt-3">
                {savingConfig ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Enregistrer
              </button>
            </div>
          )}
        </div>
      )}

      {!hasMembers ? (
        <p className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>
          Ajoute des titulaires ou remplaçants pour activer le matching.
        </p>
      ) : (
        <>
          {/* ═══ SUGGESTIONS — section la plus importante ═══ */}
          <div className="bevel-sm p-4 relative overflow-hidden"
            style={{
              background: 'rgba(255,184,0,0.03)',
              border: '1px solid rgba(255,184,0,0.18)',
            }}>
            <div className="absolute top-0 left-0 right-0 h-[3px]"
              style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 80%)' }} />
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <Zap size={14} style={{ color: 'var(--s-gold)' }} />
              <p className="t-label" style={{ fontSize: '12px', color: 'var(--s-gold)' }}>
                CRÉNEAUX SUGGÉRÉS ({allBlocks.length})
              </p>
              <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
                · ≥{data.team.minPlayersForMatch} joueurs, ≥{data.team.minMatchDurationMinutes / 60}h
              </span>
            </div>
            {allBlocks.length === 0 ? (
              <p className="text-sm italic" style={{ color: 'var(--s-text-muted)' }}>
                Aucun créneau commun pour le moment — regarde la heatmap ci-dessous pour voir où les dispos se chevauchent.
              </p>
            ) : (
              <div className="space-y-2">
                {data.weeks.map((week, wi) => (
                  week.blocks.length > 0 && (
                    <div key={week.weekId}>
                      <p className="t-mono mb-1.5" style={{ fontSize: '10px', color: 'var(--s-text-muted)' }}>
                        {wi === 0 ? 'SEMAINE COURANTE' : 'SEMAINE SUIVANTE'}
                      </p>
                      <div className="space-y-1">
                        {week.blocks.map((block, bi) => {
                          const names = block.playerIds
                            .map(id => data.members.find(m => m.uid === id)?.displayName ?? id.slice(0, 8))
                            .join(', ');
                          return (
                            <div key={bi} className="flex items-center gap-2 flex-wrap px-3 py-2 bevel-sm"
                              style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}>
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
          </div>

          {/* ═══ HEATMAP des dispos par joueur ═══ */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users size={14} style={{ color: 'var(--s-text-dim)' }} />
              <p className="t-label" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
                DISPOS DES JOUEURS
              </p>
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                · violet plus foncé = plus d&apos;heures ce jour-là
              </span>
            </div>

            {/* En-tête : noms de semaines + labels jours */}
            <div className="overflow-x-auto">
              <div style={{ minWidth: '520px' }}>
                <div className="flex items-end gap-3 mb-1.5" style={{ paddingLeft: '160px' }}>
                  <div className="flex flex-col" style={{ width: '196px' }}>
                    <span className="t-label mb-1" style={{ fontSize: '10px', color: 'var(--s-text-muted)' }}>
                      S. COURANTE
                    </span>
                    <div className="flex gap-[3px]">
                      {DAY_INITIALS.map((d, i) => (
                        <div key={i} className="text-center t-mono"
                          style={{ width: '25px', fontSize: '10px', color: 'var(--s-text-muted)' }}>
                          {d}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col" style={{ width: '196px' }}>
                    <span className="t-label mb-1" style={{ fontSize: '10px', color: 'var(--s-text-muted)' }}>
                      S. SUIVANTE
                    </span>
                    <div className="flex gap-[3px]">
                      {DAY_INITIALS.map((d, i) => (
                        <div key={i} className="text-center t-mono"
                          style={{ width: '25px', fontSize: '10px', color: 'var(--s-text-muted)' }}>
                          {d}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {data.members.map(m => {
                    const counts1 = countSlotsByDay(m.slotsByWeek[weekMondays[0]] ?? [], weekMondays[0]);
                    const counts2 = countSlotsByDay(m.slotsByWeek[weekMondays[1]] ?? [], weekMondays[1]);
                    const total1 = counts1.reduce((a, b) => a + b, 0);
                    const total2 = counts2.reduce((a, b) => a + b, 0);
                    const hours1 = total1 * 0.5;
                    const hours2 = total2 * 0.5;
                    const avatar = m.avatarUrl || m.discordAvatar;

                    return (
                      <div key={m.uid} className="flex items-center gap-3 px-3 py-2"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        <div className="flex items-center gap-2 flex-shrink-0" style={{ width: '148px' }}>
                          {avatar ? (
                            <Image src={avatar} alt="" width={22} height={22} unoptimized className="flex-shrink-0 rounded-full" />
                          ) : (
                            <div className="w-[22px] h-[22px] flex-shrink-0 rounded-full" style={{ background: 'var(--s-surface)' }} />
                          )}
                          <span className="text-sm truncate min-w-0" style={{ color: 'var(--s-text)' }}>
                            {m.displayName}
                            {!m.isTitulaire && (
                              <span className="ml-1.5 t-label" style={{ fontSize: '9px', color: 'var(--s-text-muted)' }}>
                                REMP
                              </span>
                            )}
                          </span>
                        </div>

                        {/* Semaine courante */}
                        <DayStrip counts={counts1} />
                        {/* Semaine suivante */}
                        <DayStrip counts={counts2} />

                        <div className="flex-1" />

                        {/* Totaux par semaine */}
                        <div className="t-mono flex-shrink-0 text-right" style={{ fontSize: '12px', minWidth: '90px' }}>
                          <span style={{ color: total1 === 0 ? 'var(--s-text-muted)' : 'var(--s-text)' }}>
                            {total1 === 0 ? '—' : `${hours1}h`}
                          </span>
                          <span style={{ color: 'var(--s-text-muted)' }}> / </span>
                          <span style={{ color: total2 === 0 ? 'var(--s-text-muted)' : 'var(--s-text)' }}>
                            {total2 === 0 ? '—' : `${hours2}h`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Mini composant : bande de 7 cellules pour une semaine ────────────
// Couleur remplie en fonction de la densité (0 → opacity 0.05, max → 1)
// Chaque case affiche les heures dispo ce jour-là quand > 0.
function DayStrip({ counts }: { counts: number[] }) {
  // Cap de normalisation — plafonné à 12 slots = 6h sur un jour (très actif)
  const MAX = 12;
  return (
    <div className="flex gap-[3px] flex-shrink-0">
      {counts.map((c, i) => {
        const norm = Math.min(1, c / MAX);
        const filled = c > 0;
        const hours = c * 0.5;
        const bg = filled
          ? `rgba(123, 47, 190, ${0.3 + norm * 0.6})`
          : 'rgba(255,255,255,0.025)';
        const border = filled
          ? 'rgba(163, 100, 217, 0.5)'
          : 'rgba(255,255,255,0.06)';
        const textColor = filled ? '#fff' : 'var(--s-text-muted)';
        return (
          <div
            key={i}
            title={c === 0 ? `${DAY_LABELS_SHORT[i]} : non dispo` : `${DAY_LABELS_SHORT[i]} : ${hours}h dispo`}
            className="flex items-center justify-center t-mono"
            style={{
              width: '25px',
              height: '26px',
              background: bg,
              border: `1px solid ${border}`,
              fontSize: '10px',
              fontWeight: filled ? 600 : 400,
              color: textColor,
            }}
          >
            {filled ? (hours % 1 === 0 ? `${hours}` : hours.toFixed(1)) : '·'}
          </div>
        );
      })}
    </div>
  );
}
