import { describe, it, expect } from 'vitest';
import { CREATION_PRESETS, creationPreset } from './creation-presets';
import { buildDefaultPlan } from './schedule-plan';
import { validateCompetitionPayload } from './validate';
import type { CreationPreset } from './creation-presets';

// Un préréglage qui ne s'enregistre pas, c'est un organisateur bloqué dès le
// premier clic : chacun est déroulé jusqu'à la validation serveur, comme le
// fera le formulaire.
function payloadOf(preset: CreationPreset) {
  const days = Array.from({ length: preset.dayCount }, (_, i) => ({
    date: `2026-09-${String(12 + i).padStart(2, '0')}`,
    startsAt: '15:00',
    endsAt: '22:00',
  }));
  return {
    name: preset.label,
    game: 'rocket_league',
    circuitId: null,
    format: preset.format,
    stages: preset.stages,
    eligibility: preset.eligibility,
    roster: preset.roster,
    registration: {
      opensAt: '2026-08-29T12:00:00.000Z',
      closesAt: '2026-09-09T21:59:00.000Z',
      waitlist: true,
    },
    schedule: {
      days,
      phasePlan: buildDefaultPlan(preset.format, preset.dayCount),
      ...preset.checkin,
    },
    discordGuildId: '',
  };
}

describe('CREATION_PRESETS', () => {
  it('identifiants uniques et libellés renseignés', () => {
    const ids = CREATION_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CREATION_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.dayCount).toBeGreaterThanOrEqual(1);
    }
  });

  it.each(CREATION_PRESETS.map(p => [p.label, p] as const))(
    '« %s » produit une compétition acceptée par le serveur',
    (_label, preset) => {
      const res = validateCompetitionPayload(payloadOf(preset));
      expect(res.ok ? null : res.error).toBeNull();
    },
  );

  it('les préréglages multi-étapes respectent l’invariant étape 1 = format', () => {
    for (const preset of CREATION_PRESETS) {
      if (!preset.stages) continue;
      expect(preset.stages.length).toBeGreaterThanOrEqual(2);
      expect(preset.stages[0].format).toEqual(preset.format);
      // Le nombre de qualifiées d'une étape est l'effectif exact de la suivante.
      for (let i = 1; i < preset.stages.length; i++) {
        expect(preset.stages[i].format.maxTeams).toBe(preset.stages[i - 1].transfer?.advanceCount);
      }
      // Seule la dernière étape est sans transfert.
      expect(preset.stages[preset.stages.length - 1].transfer).toBeUndefined();
    }
  });

  it('le préréglage Legends porte bien les règles de la spec', () => {
    const legends = creationPreset('legends-qualif');
    expect(legends).toBeDefined();
    expect(legends!.format.maxTeams).toBe(32);
    expect(legends!.eligibility.minAge).toBe(16);
    expect(legends!.eligibility.mmr?.maxAvg).toBe(1850);
    expect(legends!.dayCount).toBe(2);
  });

  it('les tournois ouverts exigent les comptes vérifiés, sans plafond MMR ni âge', () => {
    for (const preset of CREATION_PRESETS.filter(p => p.id !== 'legends-qualif')) {
      expect(preset.eligibility.requireVerifiedAccounts).toBe(true);
      expect(preset.eligibility.minAge).toBeNull();
      expect(preset.eligibility.mmr).toBeNull();
    }
  });

  it('identifiant inconnu : rien plutôt qu’un préréglage au hasard', () => {
    expect(creationPreset('inexistant')).toBeUndefined();
  });
});
