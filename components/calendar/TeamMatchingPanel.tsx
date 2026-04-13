'use client';

import { useState, useEffect, useCallback } from 'react';
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

function formatBlockLabel(block: MatchBlock): string {
  // startSlot = "YYYY-MM-DDTHH:MM" → "Lun 14/04 20:00 → 22:00 (2h)"
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

  // Config editor state (synced with data on load)
  const [minPlayers, setMinPlayers] = useState(2);
  const [minDurationHours, setMinDurationHours] = useState(1); // en heures pour l'UI (convertit en min)

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
    <div className="space-y-3 pt-3" style={{ borderTop: '1px dashed var(--s-border)' }}>
      {/* Config — dirigeants only */}
      {canEditConfig && (
        <div>
          <button type="button" onClick={() => setConfigOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150"
            style={{ color: 'var(--s-text-dim)' }}>
            <SettingsIcon size={11} />
            CONFIGURATION DU MATCHING
            {configOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
          {configOpen && (
            <div className="mt-2 p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
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
          {/* Suggestions */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Zap size={11} style={{ color: 'var(--s-gold)' }} />
              <p className="t-label" style={{ fontSize: '9px', color: 'var(--s-gold)' }}>
                CRÉNEAUX SUGGÉRÉS ({allBlocks.length})
              </p>
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                · ≥{data.team.minPlayersForMatch} joueurs, ≥{(data.team.minMatchDurationMinutes / 60)}h
              </span>
            </div>
            {allBlocks.length === 0 ? (
              <p className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>
                Aucun créneau commun pour le moment.
              </p>
            ) : (
              <div className="space-y-1.5">
                {data.weeks.map((week, wi) => (
                  week.blocks.length > 0 && (
                    <div key={week.weekId}>
                      <p className="t-mono mb-1" style={{ fontSize: '9px', color: 'var(--s-text-muted)' }}>
                        {wi === 0 ? 'SEMAINE COURANTE' : 'SEMAINE SUIVANTE'}
                      </p>
                      {week.blocks.map((block, bi) => {
                        const names = block.playerIds
                          .map(id => data.members.find(m => m.uid === id)?.displayName ?? id.slice(0, 8))
                          .join(', ');
                        return (
                          <div key={bi} className="flex items-center gap-2 px-2.5 py-1.5 bevel-sm"
                            style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.2)' }}>
                            <span className="text-xs font-semibold" style={{ color: 'var(--s-gold)' }}>
                              {formatBlockLabel(block)}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                              · {block.playerIds.length} joueur{block.playerIds.length > 1 ? 's' : ''} ({names})
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

          {/* Résumé des dispos par joueur */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Users size={11} style={{ color: 'var(--s-text-dim)' }} />
              <p className="t-label" style={{ fontSize: '9px', color: 'var(--s-text-dim)' }}>
                DISPOS DES JOUEURS (2 SEMAINES)
              </p>
            </div>
            <div className="space-y-1">
              {data.members.map(m => {
                const totalSlots = Object.values(m.slotsByWeek).reduce((acc, s) => acc + s.length, 0);
                const hours = (totalSlots * 30) / 60;
                const avatar = m.avatarUrl || m.discordAvatar;
                return (
                  <div key={m.uid} className="flex items-center gap-2 px-2 py-1"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    {avatar ? (
                      <Image src={avatar} alt="" width={16} height={16} unoptimized className="flex-shrink-0 rounded-full" />
                    ) : (
                      <div className="w-4 h-4 flex-shrink-0" style={{ background: 'var(--s-surface)' }} />
                    )}
                    <span className="text-xs flex-1 truncate" style={{ color: 'var(--s-text)' }}>
                      {m.displayName}
                      {!m.isTitulaire && (
                        <span className="ml-1.5 t-label" style={{ fontSize: '8px', color: 'var(--s-text-muted)' }}>
                          REMP
                        </span>
                      )}
                    </span>
                    <span className="t-mono text-xs flex-shrink-0" style={{ color: totalSlots === 0 ? 'var(--s-text-muted)' : 'var(--s-text-dim)' }}>
                      {totalSlots === 0 ? '— dispo' : `${hours}h dispo`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
