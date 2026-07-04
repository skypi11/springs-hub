'use client';

// Formulaire de création/édition d'une compétition (Lot 0 Legends Cup).
// « Préréglage Legends Qualif » remplit format, éligibilité, roster, fenêtres
// et plan de phases conformes à la spec — il reste à saisir le nom, les dates
// et le circuit. Validation partagée avec le serveur (lib/competitions/validate.ts).

import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Switch } from '@/components/ui/Switch';
import { validateCompetitionPayload } from '@/lib/competitions/validate';
import {
  LEGENDS_FORMAT,
  LEGENDS_ELIGIBILITY,
  LEGENDS_ROSTER,
  LEGENDS_CHECKIN,
  buildLegendsPhasePlan,
} from '@/lib/competitions/defaults';
import type { PhasePlanEntry } from '@/types/competitions';
import type { AdminCircuit, AdminCompetition } from './types';

type BoOverride = { bracket: 'winners' | 'losers'; roundsFromEnd: number; bo: number };

const BO_CHOICES = [1, 3, 5, 7, 9];

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(v: string): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export default function CompetitionForm({
  initial,
  circuits,
  onCancel,
  onSaved,
}: {
  initial: AdminCompetition | null;
  circuits: AdminCircuit[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  // ── Base ──
  const [name, setName] = useState(initial?.name ?? '');
  const [circuitId, setCircuitId] = useState(initial?.circuitId ?? '');
  const [isDevComp, setIsDevComp] = useState(initial?.isDev ?? false);

  // ── Format ──
  const [maxTeams, setMaxTeams] = useState(initial?.format?.maxTeams ?? LEGENDS_FORMAT.maxTeams);
  const [boDefault, setBoDefault] = useState(initial?.format?.bo?.default ?? LEGENDS_FORMAT.bo.default);
  const [boGrandFinal, setBoGrandFinal] = useState(initial?.format?.bo?.grandFinal ?? LEGENDS_FORMAT.bo.grandFinal);
  const [bracketReset, setBracketReset] = useState(initial?.format?.bracketReset ?? true);
  const [overrides, setOverrides] = useState<BoOverride[]>(
    (initial?.format?.bo?.overrides as BoOverride[] | undefined) ?? LEGENDS_FORMAT.bo.overrides.map(o => ({ ...o })),
  );

  // ── Éligibilité ──
  const [requireVerified, setRequireVerified] = useState(initial?.eligibility?.requireVerifiedAccounts ?? true);
  // En ÉDITION, minAge null (« aucun âge minimum ») doit rester vide — le
  // défaut 16 ne s'applique qu'à la création (review adversariale Lot 0).
  const [minAge, setMinAge] = useState<string>(
    initial
      ? (initial.eligibility?.minAge != null ? String(initial.eligibility.minAge) : '')
      : String(LEGENDS_ELIGIBILITY.minAge),
  );
  const initialMmr = initial ? initial.eligibility?.mmr ?? null : LEGENDS_ELIGIBILITY.mmr;
  const [mmrEnabled, setMmrEnabled] = useState(initialMmr !== null);
  const [weightCurrent, setWeightCurrent] = useState(initialMmr?.weightCurrent ?? 0.7);
  const [maxAvg, setMaxAvg] = useState(initialMmr?.maxAvg ?? 1850);
  const [maxGap, setMaxGap] = useState(initialMmr?.maxGap ?? 150);
  const [maxPlayer, setMaxPlayer] = useState(initialMmr?.maxPlayer ?? 1900);

  // ── Roster ──
  const [starters, setStarters] = useState(initial?.roster?.starters ?? LEGENDS_ROSTER.starters);
  const [subsMax, setSubsMax] = useState(initial?.roster?.subsMax ?? LEGENDS_ROSTER.subsMax);

  // ── Inscriptions ──
  const [opensAt, setOpensAt] = useState(isoToLocalInput(initial?.registration?.opensAt));
  const [closesAt, setClosesAt] = useState(isoToLocalInput(initial?.registration?.closesAt));
  const [waitlist, setWaitlist] = useState(initial?.registration?.waitlist ?? true);

  // ── Planning ──
  const [days, setDays] = useState<Array<{ date: string; startsAt: string }>>(
    initial?.schedule?.days ?? [{ date: '', startsAt: '15:00' }, { date: '', startsAt: '15:00' }],
  );
  const [generalCheckinMinutes, setGeneralCheckinMinutes] = useState(
    initial?.schedule?.generalCheckinMinutes ?? LEGENDS_CHECKIN.generalCheckinMinutes,
  );
  const [matchCheckinMinutes, setMatchCheckinMinutes] = useState(
    initial?.schedule?.matchCheckinMinutes ?? LEGENDS_CHECKIN.matchCheckinMinutes,
  );
  const [scoreCounterMinutes, setScoreCounterMinutes] = useState(
    initial?.schedule?.scoreCounterMinutes ?? LEGENDS_CHECKIN.scoreCounterMinutes,
  );
  const [phasePlan, setPhasePlan] = useState<PhasePlanEntry[]>(
    initial?.schedule?.phasePlan ?? buildLegendsPhasePlan(),
  );

  // ── Discord ──
  const [discordGuildId, setDiscordGuildId] = useState(initial?.discord?.guildId ?? '');

  function applyLegendsPreset() {
    setMaxTeams(LEGENDS_FORMAT.maxTeams);
    setBoDefault(LEGENDS_FORMAT.bo.default);
    setBoGrandFinal(LEGENDS_FORMAT.bo.grandFinal);
    setBracketReset(LEGENDS_FORMAT.bracketReset);
    setOverrides(LEGENDS_FORMAT.bo.overrides.map(o => ({ ...o })));
    setRequireVerified(LEGENDS_ELIGIBILITY.requireVerifiedAccounts);
    setMinAge(String(LEGENDS_ELIGIBILITY.minAge));
    setMmrEnabled(true);
    setWeightCurrent(LEGENDS_ELIGIBILITY.mmr!.weightCurrent);
    setMaxAvg(LEGENDS_ELIGIBILITY.mmr!.maxAvg);
    setMaxGap(LEGENDS_ELIGIBILITY.mmr!.maxGap);
    setMaxPlayer(LEGENDS_ELIGIBILITY.mmr!.maxPlayer);
    setStarters(LEGENDS_ROSTER.starters);
    setSubsMax(LEGENDS_ROSTER.subsMax);
    setWaitlist(true);
    setGeneralCheckinMinutes(LEGENDS_CHECKIN.generalCheckinMinutes);
    setMatchCheckinMinutes(LEGENDS_CHECKIN.matchCheckinMinutes);
    setScoreCounterMinutes(LEGENDS_CHECKIN.scoreCounterMinutes);
    setPhasePlan(buildLegendsPhasePlan());
    toast.success('Préréglage Legends Qualif appliqué. Reste à saisir nom, dates et circuit.');
  }

  // Ouverture J-14 / fermeture J-3 par rapport au premier jour de compétition
  // (spec §4). Fermeture à 23:59 le soir, ouverture à midi.
  function fillRegistrationWindow() {
    const first = days[0]?.date;
    if (!first || isNaN(new Date(first).getTime())) {
      toast.error("Renseigne d'abord la date du jour 1.");
      return;
    }
    const day1 = new Date(`${first}T00:00`);
    const opens = new Date(day1);
    opens.setDate(opens.getDate() - 14);
    opens.setHours(12, 0, 0, 0);
    const closes = new Date(day1);
    closes.setDate(closes.getDate() - 3);
    closes.setHours(23, 59, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const toLocal = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setOpensAt(toLocal(opens));
    setClosesAt(toLocal(closes));
  }

  async function save() {
    const payload = {
      name,
      game: 'rocket_league',
      circuitId: circuitId || null,
      format: {
        kind: 'double_elim',
        maxTeams,
        bo: { default: boDefault, overrides, grandFinal: boGrandFinal },
        bracketReset,
      },
      eligibility: {
        requireVerifiedAccounts: requireVerified,
        minAge: minAge.trim() === '' ? null : Number(minAge),
        mmr: mmrEnabled ? { weightCurrent, maxAvg, maxGap, maxPlayer } : null,
      },
      roster: { starters, subsMax },
      registration: {
        opensAt: localInputToIso(opensAt),
        closesAt: localInputToIso(closesAt),
        waitlist,
      },
      schedule: { days, phasePlan, generalCheckinMinutes, matchCheckinMinutes, scoreCounterMinutes },
      discordGuildId,
      isDev: isDevComp,
    };
    const check = validateCompetitionPayload(payload);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
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
  }

  const selectableCircuits = circuits.filter(c => c.game === 'rocket_league');

  return (
    <div className="panel bevel">
      <div className="panel-header flex items-center justify-between">
        <span className="t-sub">{initial ? `Éditer — ${initial.name}` : 'Nouvelle compétition'}</span>
        <button type="button" className="btn-springs btn-secondary bevel-sm text-sm" onClick={applyLegendsPreset}>
          Préréglage Legends Qualif
        </button>
      </div>
      <div className="panel-body space-y-6">

        {/* Base */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="t-label block mb-2">Nom</label>
            <input
              className="settings-input w-full"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Legends Qualifier #1"
              maxLength={80}
            />
          </div>
          <div>
            <label className="t-label block mb-2">Circuit</label>
            <select
              className="settings-input w-full"
              value={circuitId}
              onChange={e => setCircuitId(e.target.value)}
            >
              <option value="">Aucun (tournoi isolé)</option>
              {selectableCircuits.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Switch label="Compétition de test (invisible du public)" value={isDevComp} onChange={setIsDevComp} />
          <p className="text-xs mt-1 px-2" style={{ color: 'var(--s-text-muted)' }}>
            Réservée au bac à sable : elle reste masquée du public (fiche, bracket,
            listes) même une fois publiée, seuls toi et les comptes de test la voient.
            Coche pour tester le cycle complet sans rien exposer.
          </p>
        </div>

        <div className="divider" />

        {/* Format */}
        <div>
          <label className="t-label block mb-3">Format — double élimination</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Équipes max</label>
              <input type="number" min={4} max={32} className="settings-input w-full"
                value={maxTeams} onChange={e => setMaxTeams(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>BO par défaut</label>
              <select className="settings-input w-full" value={boDefault}
                onChange={e => setBoDefault(Number(e.target.value))}>
                {BO_CHOICES.map(n => <option key={n} value={n}>BO{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Grande finale</label>
              <select className="settings-input w-full" value={boGrandFinal}
                onChange={e => setBoGrandFinal(Number(e.target.value))}>
                {BO_CHOICES.map(n => <option key={n} value={n}>BO{n}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <Switch label="Bracket reset" value={bracketReset} onChange={setBracketReset} />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm mb-2" style={{ color: 'var(--s-text-dim)' }}>
              BO spécifiques (comptés depuis la fin du bracket : 1 = finale, 2 = demi)
            </label>
            <div className="space-y-2">
              {overrides.map((o, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select className="settings-input" value={o.bracket}
                    onChange={e => setOverrides(prev => prev.map((p, j) => j === i ? { ...p, bracket: e.target.value as 'winners' | 'losers' } : p))}>
                    <option value="winners">Winners</option>
                    <option value="losers">Losers</option>
                  </select>
                  <input type="number" min={1} max={10} className="settings-input w-20"
                    value={o.roundsFromEnd}
                    onChange={e => setOverrides(prev => prev.map((p, j) => j === i ? { ...p, roundsFromEnd: Number(e.target.value) } : p))} />
                  <select className="settings-input" value={o.bo}
                    onChange={e => setOverrides(prev => prev.map((p, j) => j === i ? { ...p, bo: Number(e.target.value) } : p))}>
                    {BO_CHOICES.map(n => <option key={n} value={n}>BO{n}</option>)}
                  </select>
                  <button type="button" className="btn-springs btn-ghost text-sm"
                    onClick={() => setOverrides(prev => prev.filter((_, j) => j !== i))}>
                    Retirer
                  </button>
                </div>
              ))}
              <button type="button" className="btn-springs btn-ghost text-sm"
                onClick={() => setOverrides(prev => [...prev, { bracket: 'winners', roundsFromEnd: 1, bo: 7 }])}>
                Ajouter une règle BO
              </button>
            </div>
          </div>
        </div>

        <div className="divider" />

        {/* Éligibilité */}
        <div>
          <label className="t-label block mb-3">Éligibilité</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Switch label="Comptes vérifiés obligatoires" value={requireVerified} onChange={setRequireVerified} />
              <div className="flex items-center gap-3 px-2">
                <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Âge minimum</span>
                <input type="number" min={0} max={99} className="settings-input w-24"
                  value={minAge} onChange={e => setMinAge(e.target.value)} placeholder="aucun" />
              </div>
              <p className="text-xs px-2" style={{ color: 'var(--s-text-muted)' }}>
                Un joueur sous l&apos;âge minimum ne bloque pas l&apos;inscription : elle passe
                en dérogation, arbitrée par un admin.
              </p>
            </div>
            <div>
              <Switch label="Règles MMR" value={mmrEnabled} onChange={setMmrEnabled} />
              {mmrEnabled && (
                <div className="grid grid-cols-2 gap-3 mt-2 px-2">
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Poids MMR actuel (0-1)</label>
                    <input type="number" min={0} max={1} step={0.05} className="settings-input w-full"
                      value={weightCurrent} onChange={e => setWeightCurrent(Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Moyenne max (toute compo)</label>
                    <input type="number" min={0} className="settings-input w-full"
                      value={maxAvg} onChange={e => setMaxAvg(Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Écart max</label>
                    <input type="number" min={0} className="settings-input w-full"
                      value={maxGap} onChange={e => setMaxGap(Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Plafond individuel</label>
                    <input type="number" min={0} className="settings-input w-full"
                      value={maxPlayer} onChange={e => setMaxPlayer(Number(e.target.value))} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="divider" />

        {/* Roster + inscriptions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="t-label block mb-3">Roster</label>
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Titulaires</label>
                <input type="number" min={1} max={10} className="settings-input w-24"
                  value={starters} onChange={e => setStarters(Number(e.target.value))} />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Remplaçants max</label>
                <input type="number" min={0} max={10} className="settings-input w-24"
                  value={subsMax} onChange={e => setSubsMax(Number(e.target.value))} />
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="t-label">Inscriptions</label>
              <button type="button" className="btn-springs btn-ghost text-sm" onClick={fillRegistrationWindow}>
                Calculer J-14 → J-3
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Ouverture</label>
                <input type="datetime-local" className="settings-input w-full"
                  value={opensAt} onChange={e => setOpensAt(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Fermeture</label>
                <input type="datetime-local" className="settings-input w-full"
                  value={closesAt} onChange={e => setClosesAt(e.target.value)} />
              </div>
            </div>
            <div className="mt-2">
              <Switch label="Liste d'attente au-delà du cap" value={waitlist} onChange={setWaitlist} />
            </div>
          </div>
        </div>

        <div className="divider" />

        {/* Planning */}
        <div>
          <label className="t-label block mb-3">Planning</label>
          <div className="space-y-2">
            {days.map((d, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-sm w-14" style={{ color: 'var(--s-text-dim)' }}>Jour {i + 1}</span>
                <input type="date" className="settings-input"
                  value={d.date}
                  onChange={e => setDays(prev => prev.map((p, j) => j === i ? { ...p, date: e.target.value } : p))} />
                <input type="time" className="settings-input"
                  value={d.startsAt}
                  onChange={e => setDays(prev => prev.map((p, j) => j === i ? { ...p, startsAt: e.target.value } : p))} />
                {days.length > 1 && (
                  <button type="button" className="btn-springs btn-ghost text-sm"
                    onClick={() => {
                      // Retirer un jour recale les phases qui pointaient dessus
                      // sur le dernier jour restant, sinon la validation refuse
                      // le plan (« jour hors planning ») sans issue dans l'UI.
                      const newLength = days.length - 1;
                      setDays(prev => prev.filter((_, j) => j !== i));
                      setPhasePlan(prev => prev.map(p => (
                        p.day > newLength ? { ...p, day: newLength } : p
                      )));
                    }}>
                    Retirer
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn-springs btn-ghost text-sm"
              onClick={() => setDays(prev => [...prev, { date: '', startsAt: '15:00' }])}>
              Ajouter un jour
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4 max-w-lg">
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Check-in général (min)</label>
              <input type="number" min={5} max={120} className="settings-input w-full"
                value={generalCheckinMinutes} onChange={e => setGeneralCheckinMinutes(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Check-in match (min)</label>
              <input type="number" min={1} max={60} className="settings-input w-full"
                value={matchCheckinMinutes} onChange={e => setMatchCheckinMinutes(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Contre-saisie score (min)</label>
              <input type="number" min={1} max={60} className="settings-input w-full"
                value={scoreCounterMinutes} onChange={e => setScoreCounterMinutes(Number(e.target.value))} />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm mb-2" style={{ color: 'var(--s-text-dim)' }}>
              Plan de phases ({phasePlan.length})
            </label>
            <div style={{ border: '1px solid var(--s-border)' }}>
              {phasePlan.map(p => (
                <div key={p.phase} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm"
                  style={{ borderBottom: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
                  <span>{p.label}</span>
                  <select
                    className="settings-input"
                    style={{ padding: '4px 8px' }}
                    value={Math.min(p.day, days.length)}
                    onChange={e => setPhasePlan(prev => prev.map(x => (
                      x.phase === p.phase ? { ...x, day: Number(e.target.value) } : x
                    )))}
                  >
                    {days.map((_, di) => (
                      <option key={di + 1} value={di + 1}>Jour {di + 1}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
              Généré par le préréglage (nominal 32 équipes). Le déroulé réel suit le
              bracket effectif le jour du tournoi.
            </p>
          </div>
        </div>

        <div className="divider" />

        {/* Discord */}
        <div className="max-w-md">
          <label className="t-label block mb-2">Serveur Discord (ID de guilde)</label>
          <input className="settings-input w-full" value={discordGuildId}
            onChange={e => setDiscordGuildId(e.target.value)} placeholder="Optionnel en brouillon" />
          <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
            Le serveur SPRINGS E-SPORT pour la Legends Cup. Le bot doit y être invité
            avant le provisioning des salons d&apos;équipe.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="button" className="btn-springs btn-primary bevel-sm" onClick={save} disabled={saving}>
            {saving ? 'Enregistrement…' : initial ? 'Enregistrer' : 'Créer la compétition'}
          </button>
          <button type="button" className="btn-springs btn-ghost" onClick={onCancel} disabled={saving}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
