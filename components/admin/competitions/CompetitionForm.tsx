'use client';

// Création et édition d'une compétition.
//
// Parcours : on choisit d'abord un type de tournoi (préréglage complet), puis
// on ajuste sur un seul écran. L'ancien formulaire posait ses trente champs à
// plat et ne connaissait que deux formats en dur ; ici les réglages viennent
// de la registry (lib/competitions/formats), donc les quatre formats et le
// multi-étapes sont créables, et ajouter un format à la plateforme n'oblige
// plus à retoucher cet écran.
//
// Le tournoi est TOUJOURS une liste d'étapes en interne (une seule le plus
// souvent) : c'est ce qui garantit l'invariant « étape 1 = format de la
// compétition », et ce qui permet d'éditer un tournoi à poules sans que le
// serveur ait à deviner.

import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Switch } from '@/components/ui/Switch';
import { validateCompetitionPayload } from '@/lib/competitions/validate';
import { LEGENDS_CHECKIN } from '@/lib/competitions/defaults';
import {
  blocksToPhasePlan,
  buildPlanBlocks,
  buildStagedBlocks,
  spreadOverDays,
  type PlanBlock,
} from '@/lib/competitions/schedule-plan';
import { normalizeFormat } from '@/lib/competitions/format-config';
import { FORMAT_DEFS } from '@/lib/competitions/formats';
import type { CreationPreset } from '@/lib/competitions/creation-presets';
import type { CompetitionFormat, PhasePlanEntry, TournamentStage } from '@/types/competitions';
import TournamentTypeStep from './create/TournamentTypeStep';
import StagesEditor from './create/StagesEditor';
import ScheduleBoard, { type ScheduleDay } from './create/ScheduleBoard';
import DiscordSettings, { type DiscordSettingsValue } from './create/DiscordSettings';
import type { AdminCircuit, AdminCompetition } from './types';

interface FormState {
  name: string;
  circuitId: string;
  isDev: boolean;
  stages: TournamentStage[];
  requireVerified: boolean;
  minAge: string;
  mmrEnabled: boolean;
  weightCurrent: number;
  maxAvg: number;
  maxGap: number;
  maxPlayer: number;
  starters: number;
  subsMax: number;
  opensAt: string;
  closesAt: string;
  waitlist: boolean;
  days: ScheduleDay[];
  /** Journée de chaque bloc du déroulé (même ordre que les blocs). */
  dayByPhase: number[];
  generalCheckinMinutes: number;
  matchCheckinMinutes: number;
  scoreCounterMinutes: number;
  discord: DiscordSettingsValue;
}

const EMPTY_DISCORD: DiscordSettingsValue = {
  guildId: '',
  teamChannels: true,
  teamVoiceChannels: false,
  categoryName: '',
  staffRoleIds: [],
  participantRoleName: '',
  announceChannelId: '',
  createAnnounceChannel: false,
  announceChannelName: '',
  staffChannelId: '',
  createStaffChannel: false,
  staffChannelName: '',
};

export default function CompetitionForm({ initial, circuits, onCancel, onSaved }: {
  initial: AdminCompetition | null;
  circuits: AdminCircuit[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(initial ? stateFromCompetition(initial) : null);

  if (!form) {
    return (
      <TournamentTypeStep
        onCancel={onCancel}
        onPick={preset => setForm(stateFromPreset(preset, circuits))}
      />
    );
  }

  return (
    <CompetitionFormBody
      form={form}
      setForm={setForm}
      initial={initial}
      circuits={circuits}
      saving={saving}
      onCancel={onCancel}
      onRestart={() => setForm(null)}
      onSubmit={async payload => {
        setSaving(true);
        try {
          if (initial) {
            await api(`/api/admin/competitions/${initial.id}`, { method: 'PATCH', body: payload });
            toast.success('Compétition enregistrée.');
          } else {
            await api('/api/admin/competitions', { method: 'POST', body: payload });
            toast.success('Compétition créée en brouillon.');
          }
          onSaved();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}

function CompetitionFormBody({ form, setForm, initial, circuits, saving, onCancel, onRestart, onSubmit }: {
  form: FormState;
  setForm: (next: FormState) => void;
  initial: AdminCompetition | null;
  circuits: AdminCircuit[];
  saving: boolean;
  onCancel: () => void;
  /** Retour à l'écran de choix du type de tournoi (création seulement). */
  onRestart: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const patch = (values: Partial<FormState>) => setForm({ ...form, ...values });

  // Le déroulé couvre TOUTES les étapes : la structure d'une phase finale est
  // connue dès la création, seuls les noms d'équipes manquent — planifier
  // « poules le samedi, phase finale le dimanche » doit être possible ici.
  const blocks = useMemo(
    () => buildStagedBlocks(form.stages, stage => stage.name?.trim() || FORMAT_DEFS[stage.format.kind].label),
    [form.stages],
  );
  // Le déroulé se réaligne tout seul quand le format change (le nombre de
  // blocs bouge) : jamais de plan qui décrit un tournoi qui n'existe plus.
  const dayByPhase = fitAssignment(form.dayByPhase, blocks, form.days.length);
  const phasePlan = blocksToPhasePlan(blocks, dayByPhase);

  const payload = buildPayload(form, phasePlan, initial);
  const check = validateCompetitionPayload(payload);

  const totalMatches = form.stages.reduce(
    (sum, s) => sum + buildPlanBlocks(s.format).reduce((n, b) => n + b.matchCount, 0),
    0,
  );
  const selectableCircuits = circuits.filter(c => c.game === 'rocket_league');

  return (
    <div className="panel bevel">
      <div className="panel-header flex items-center justify-between gap-2 flex-wrap">
        <span className="t-sub">{initial ? `Éditer — ${initial.name}` : 'Nouveau tournoi'}</span>
        {!initial && (
          <button type="button" className="btn-springs btn-ghost text-sm" onClick={onRestart}>
            Changer de format
          </button>
        )}
      </div>

      {/* Largeur de lecture bornée : sur un écran large, les champs s'étiraient
          et laissaient un couloir vide entre le libellé et la valeur. */}
      <div className="panel-body space-y-6" style={{ maxWidth: 1080 }}>
        {/* Identité */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="t-label-soft block mb-2">Nom</label>
            <input className="settings-input w-full" value={form.name} maxLength={80}
              placeholder="Legends Qualifier #1"
              onChange={e => patch({ name: e.target.value })} />
          </div>
          <div>
            <label className="t-label-soft block mb-2">Circuit</label>
            <select className="settings-input w-full" value={form.circuitId}
              onChange={e => patch({ circuitId: e.target.value })}>
              <option value="">Aucun (tournoi isolé)</option>
              {selectableCircuits.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <Switch label="Compétition de test (invisible du public)" value={form.isDev}
            onChange={v => patch({ isDev: v })} />
          <p className="text-xs mt-1 px-2" style={{ color: 'var(--s-text-muted)' }}>
            Reste masquée même une fois publiée : fiche, bracket et listes. Pour dérouler
            le cycle complet sans rien exposer.
          </p>
        </div>

        <div className="divider" />

        {/* Format et étapes */}
        <StagesEditor
          stages={form.stages}
          hasCircuit={form.circuitId !== ''}
          onChange={stages => patch({ stages })}
        />

        <div className="divider" />

        {/* Déroulé */}
        <ScheduleBoard
          blocks={blocks}
          state={{ days: form.days, dayByPhase }}
          onChange={next => patch({
            days: next.days,
            dayByPhase: fitAssignment(next.dayByPhase, blocks, next.days.length),
          })}
        />

        <div className="divider" />

        {/* Inscriptions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <label className="t-label-soft">Inscriptions</label>
              <button type="button" className="quiet-link text-sm"
                onClick={() => {
                  const range = registrationWindow(form.days[0]?.date);
                  if (range) patch(range);
                }}>
                Calculer J-14 → J-3
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Ouverture</label>
                <input type="datetime-local" className="settings-input w-full" value={form.opensAt}
                  onChange={e => patch({ opensAt: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Fermeture</label>
                <input type="datetime-local" className="settings-input w-full" value={form.closesAt}
                  onChange={e => patch({ closesAt: e.target.value })} />
              </div>
            </div>
            <div className="mt-2">
              <Switch label="Liste d'attente au-delà du cap" value={form.waitlist}
                onChange={v => patch({ waitlist: v })} />
            </div>
          </div>

          <div>
            <label className="t-label-soft block mb-3">Roster</label>
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Titulaires</label>
                <input type="number" min={1} max={10} className="settings-input" style={{ width: 96 }}
                  value={form.starters} onChange={e => patch({ starters: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Remplaçants max</label>
                <input type="number" min={0} max={10} className="settings-input" style={{ width: 96 }}
                  value={form.subsMax} onChange={e => patch({ subsMax: Number(e.target.value) })} />
              </div>
            </div>
          </div>
        </div>

        <div className="divider" />

        {/* Éligibilité */}
        <div>
          <label className="t-label-soft block mb-3">Éligibilité</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Switch label="Comptes vérifiés obligatoires" value={form.requireVerified}
                onChange={v => patch({ requireVerified: v })} />
              <div className="flex items-center gap-3 px-2">
                <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Âge minimum</span>
                {/* Largeur en style inline : `.settings-input` fixe width:100%
                    et gagne sur les utilitaires Tailwind (piège du repo). */}
                <input type="number" min={0} max={99} className="settings-input" placeholder="aucun"
                  style={{ width: 96 }}
                  value={form.minAge} onChange={e => patch({ minAge: e.target.value })} />
              </div>
              <p className="text-xs px-2" style={{ color: 'var(--s-text-muted)' }}>
                Un joueur sous l&apos;âge minimum ne bloque pas l&apos;inscription : elle passe
                en dérogation, arbitrée par un admin.
              </p>
            </div>
            <div>
              <Switch label="Plafond MMR" value={form.mmrEnabled} onChange={v => patch({ mmrEnabled: v })} />
              {form.mmrEnabled && (
                <div className="grid grid-cols-2 gap-3 mt-2 px-2">
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Poids MMR actuel (0-1)</label>
                    <input type="number" min={0} max={1} step={0.05} className="settings-input w-full"
                      value={form.weightCurrent} onChange={e => patch({ weightCurrent: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Moyenne max (toute compo)</label>
                    <input type="number" min={0} className="settings-input w-full"
                      value={form.maxAvg} onChange={e => patch({ maxAvg: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Écart max</label>
                    <input type="number" min={0} className="settings-input w-full"
                      value={form.maxGap} onChange={e => patch({ maxGap: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Plafond individuel</label>
                    <input type="number" min={0} className="settings-input w-full"
                      value={form.maxPlayer} onChange={e => patch({ maxPlayer: Number(e.target.value) })} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="divider" />

        {/* Jour de match */}
        <div>
          <label className="t-label-soft block mb-3">Jour de match</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Check-in général (min)</label>
              <input type="number" min={5} max={120} className="settings-input w-full"
                value={form.generalCheckinMinutes}
                onChange={e => patch({ generalCheckinMinutes: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Check-in match (min)</label>
              <input type="number" min={1} max={60} className="settings-input w-full"
                value={form.matchCheckinMinutes}
                onChange={e => patch({ matchCheckinMinutes: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Contre-saisie score (min)</label>
              <input type="number" min={1} max={60} className="settings-input w-full"
                value={form.scoreCounterMinutes}
                onChange={e => patch({ scoreCounterMinutes: Number(e.target.value) })} />
            </div>
          </div>

        </div>

        <div className="divider" />

        <DiscordSettings
          value={form.discord}
          competitionName={form.name.trim()}
          teamCount={form.stages[0].format.maxTeams}
          onChange={discord => patch({ discord })}
        />

        {/* Récapitulatif + enregistrement */}
        <div className="flex flex-wrap items-center gap-3 pt-2" style={{ borderTop: '1px solid var(--s-border)' }}>
          <div className="flex-1 min-w-[240px] pt-3">
            <p className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
              {form.stages[0].format.maxTeams} équipes · {totalMatches} matchs ·{' '}
              {form.days.length === 1 ? '1 jour' : `${form.days.length} jours`}
              {form.stages.length > 1 ? ` · ${form.stages.length} étapes` : ''}
            </p>
            {!check.ok && (
              <p className="text-sm mt-1" style={{ color: 'var(--s-text)' }}>{check.error}</p>
            )}
          </div>
          <div className="flex items-center gap-3 pt-3">
            <button type="button" className="btn-springs btn-ghost" onClick={onCancel} disabled={saving}>
              Annuler
            </button>
            <button type="button" className="btn-springs btn-primary bevel-sm"
              disabled={saving || !check.ok}
              onClick={() => onSubmit(payload)}>
              {saving ? 'Enregistrement…' : initial ? 'Enregistrer' : 'Créer le tournoi'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── État ────────────────────────────────────────────────────────────────────

function stateFromPreset(preset: CreationPreset, circuits: AdminCircuit[]): FormState {
  const blocks = buildPlanBlocks(preset.format);
  const stages: TournamentStage[] = preset.stages
    ? preset.stages.map(s => ({ ...s }))
    : [{ kind: preset.format.kind, format: preset.format }];
  // Le préréglage Legends vise un circuit : s'il n'en existe qu'un, autant le
  // pré-sélectionner plutôt que de le faire chercher.
  const circuitId = preset.wantsCircuit && circuits.length === 1 ? circuits[0].id : '';
  return {
    name: '',
    circuitId,
    isDev: false,
    stages,
    requireVerified: preset.eligibility.requireVerifiedAccounts,
    minAge: preset.eligibility.minAge != null ? String(preset.eligibility.minAge) : '',
    mmrEnabled: preset.eligibility.mmr !== null,
    weightCurrent: preset.eligibility.mmr?.weightCurrent ?? 0.7,
    maxAvg: preset.eligibility.mmr?.maxAvg ?? 1850,
    maxGap: preset.eligibility.mmr?.maxGap ?? 150,
    maxPlayer: preset.eligibility.mmr?.maxPlayer ?? 1900,
    starters: preset.roster.starters,
    subsMax: preset.roster.subsMax,
    opensAt: '',
    closesAt: '',
    waitlist: true,
    days: Array.from({ length: preset.dayCount }, () => ({ date: '', startsAt: '15:00', endsAt: '22:00' })),
    dayByPhase: spreadOverDays(blocks, preset.dayCount),
    ...preset.checkin,
    discord: { ...EMPTY_DISCORD },
  };
}

function stateFromCompetition(comp: AdminCompetition): FormState {
  const format = normalizeFormat((comp.format ?? {}) as CompetitionFormat);
  const stages: TournamentStage[] = comp.stages?.length
    ? comp.stages.map(s => ({ ...s }))
    : [{ kind: format.kind, format }];
  const days: ScheduleDay[] = comp.schedule?.days?.length
    ? comp.schedule.days.map(d => ({ ...d }))
    : [{ date: '', startsAt: '15:00', endsAt: '22:00' }];
  const blocks = buildPlanBlocks(stages[0].format);
  const stored = comp.schedule?.phasePlan ?? [];
  // On repart des journées enregistrées quand le plan correspond encore au
  // format ; sinon (format retouché hors formulaire) on répartit à neuf.
  const dayByPhase = stored.length === blocks.length
    ? blocks.map((b, i) => stored[i]?.day ?? 1)
    : spreadOverDays(blocks, days.length);

  return {
    name: comp.name ?? '',
    circuitId: comp.circuitId ?? '',
    isDev: comp.isDev === true,
    stages,
    requireVerified: comp.eligibility?.requireVerifiedAccounts ?? true,
    minAge: comp.eligibility?.minAge != null ? String(comp.eligibility.minAge) : '',
    mmrEnabled: (comp.eligibility?.mmr ?? null) !== null,
    weightCurrent: comp.eligibility?.mmr?.weightCurrent ?? 0.7,
    maxAvg: comp.eligibility?.mmr?.maxAvg ?? 1850,
    maxGap: comp.eligibility?.mmr?.maxGap ?? 150,
    maxPlayer: comp.eligibility?.mmr?.maxPlayer ?? 1900,
    starters: comp.roster?.starters ?? 3,
    subsMax: comp.roster?.subsMax ?? 2,
    opensAt: isoToLocalInput(comp.registration?.opensAt),
    closesAt: isoToLocalInput(comp.registration?.closesAt),
    waitlist: comp.registration?.waitlist ?? true,
    days,
    dayByPhase,
    generalCheckinMinutes: comp.schedule?.generalCheckinMinutes ?? LEGENDS_CHECKIN.generalCheckinMinutes,
    matchCheckinMinutes: comp.schedule?.matchCheckinMinutes ?? LEGENDS_CHECKIN.matchCheckinMinutes,
    scoreCounterMinutes: comp.schedule?.scoreCounterMinutes ?? LEGENDS_CHECKIN.scoreCounterMinutes,
    // Options absentes = comportement historique : salons d'équipe créés, rôle
    // dérivé du nom, aucune annonce publique.
    discord: {
      ...EMPTY_DISCORD,
      guildId: comp.discord?.guildId ?? '',
      teamChannels: comp.discord?.options?.teamChannels !== false,
      teamVoiceChannels: comp.discord?.options?.teamVoiceChannels === true,
      categoryName: comp.discord?.options?.categoryName ?? '',
      staffRoleIds: comp.discord?.options?.staffRoleIds ?? [],
      participantRoleName: comp.discord?.options?.participantRoleName ?? '',
      announceChannelId: comp.discord?.options?.announceChannelId ?? '',
      createAnnounceChannel: comp.discord?.options?.createAnnounceChannel === true,
      announceChannelName: comp.discord?.options?.announceChannelName ?? '',
      staffChannelId: comp.discord?.options?.staffChannelId ?? '',
      createStaffChannel: comp.discord?.options?.createStaffChannel === true,
      staffChannelName: comp.discord?.options?.staffChannelName ?? '',
    },
  };
}

function buildPayload(form: FormState, phasePlan: PhasePlanEntry[], initial: AdminCompetition | null) {
  const multi = form.stages.length > 1;
  return {
    name: form.name,
    game: 'rocket_league',
    circuitId: form.circuitId || null,
    // Invariant multi-étapes : le format de la compétition EST celui de
    // l'étape 1 — une seule source, aucune divergence possible.
    format: form.stages[0].format,
    stages: multi ? form.stages : null,
    // Repasser un tournoi à étapes en tournoi simple doit EFFACER la séquence
    // enregistrée : sans ce drapeau, le serveur la conserverait.
    ...(initial?.stages?.length && !multi ? { clearStages: true } : {}),
    eligibility: {
      requireVerifiedAccounts: form.requireVerified,
      minAge: form.minAge.trim() === '' ? null : Number(form.minAge),
      mmr: form.mmrEnabled
        ? {
            weightCurrent: form.weightCurrent,
            maxAvg: form.maxAvg,
            maxGap: form.maxGap,
            maxPlayer: form.maxPlayer,
          }
        : null,
    },
    roster: { starters: form.starters, subsMax: form.subsMax },
    registration: {
      opensAt: localInputToIso(form.opensAt),
      closesAt: localInputToIso(form.closesAt),
      waitlist: form.waitlist,
    },
    schedule: {
      days: form.days,
      phasePlan,
      generalCheckinMinutes: form.generalCheckinMinutes,
      matchCheckinMinutes: form.matchCheckinMinutes,
      scoreCounterMinutes: form.scoreCounterMinutes,
    },
    discordGuildId: form.discord.guildId,
    discordOptions: {
      teamChannels: form.discord.teamChannels,
      teamVoiceChannels: form.discord.teamVoiceChannels,
      categoryName: form.discord.categoryName.trim() || null,
      staffRoleIds: form.discord.staffRoleIds,
      participantRoleName: form.discord.participantRoleName.trim() || null,
      announceChannelId: form.discord.announceChannelId.trim() || null,
      createAnnounceChannel: form.discord.createAnnounceChannel,
      announceChannelName: form.discord.announceChannelName.trim() || null,
      staffChannelId: form.discord.staffChannelId.trim() || null,
      createStaffChannel: form.discord.createStaffChannel,
      staffChannelName: form.discord.staffChannelName.trim() || null,
    },
    isDev: form.isDev,
  };
}

/** Aligne les journées sur les blocs courants : un changement de format fait
 *  varier leur nombre, et un plan qui ne décrit plus le tournoi serait refusé
 *  à l'enregistrement sans que rien ne l'explique à l'écran. */
function fitAssignment(current: number[], blocks: PlanBlock[], dayCount: number): number[] {
  const days = Math.max(1, dayCount);
  if (current.length !== blocks.length) return spreadOverDays(blocks, days);
  return current.map(d => Math.min(Math.max(1, d), days));
}

/** Ouverture J-14 à midi, fermeture J-3 à 23:59 (spec §4). */
function registrationWindow(firstDay: string | undefined): { opensAt: string; closesAt: string } | null {
  if (!firstDay || isNaN(new Date(firstDay).getTime())) return null;
  const day1 = new Date(`${firstDay}T00:00`);
  const opens = new Date(day1);
  opens.setDate(opens.getDate() - 14);
  opens.setHours(12, 0, 0, 0);
  const closes = new Date(day1);
  closes.setDate(closes.getDate() - 3);
  closes.setHours(23, 59, 0, 0);
  return { opensAt: toLocalInput(opens), closesAt: toLocalInput(closes) };
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : toLocalInput(d);
}

function localInputToIso(v: string): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
