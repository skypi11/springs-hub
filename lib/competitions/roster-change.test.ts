// Tests du changement de roster (dérogation admin — lib PURE).

import { describe, expect, it } from 'vitest';
import { applyRosterChange, coreGuardViolation, recomputeRegistrationComputed } from './roster-change';
import type { RegistrationRosterEntry } from '@/types/competitions';

const entry = (
  uid: string,
  role: 'titulaire' | 'remplacant',
  refMmr = 1500,
  extra: Partial<RegistrationRosterEntry> = {},
): RegistrationRosterEntry => ({
  uid, role, displayName: uid,
  declaredCurrentMmr: refMmr, declaredPeakMmr: refMmr, refMmr,
  epicId: `epic-${uid}`, epicName: uid, steamId: null, trackerUrl: null,
  discordId: uid.replace('discord_', ''), discordUsername: uid, country: 'FR',
  age: 20, verified: true, onDiscordGuild: true,
  ...extra,
});

const ROSTER = [
  entry('discord_a', 'titulaire', 1500),
  entry('discord_b', 'titulaire', 1550),
  entry('discord_c', 'titulaire', 1450),
  entry('discord_d', 'remplacant', 1430),
];

const RULES = { weightCurrent: 0.7, maxAvg: 1850, maxGap: 150, maxPlayer: 1900 };

describe('applyRosterChange', () => {
  it('replace : le rôle du SORTANT est hérité, jamais celui demandé', () => {
    const incoming = entry('discord_x', 'remplacant', 1520); // rôle « demandé » ignoré
    const res = applyRosterChange(ROSTER, { op: 'replace', outUid: 'discord_b', entry: incoming });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const x = res.roster.find(r => r.uid === 'discord_x')!;
    expect(x.role).toBe('titulaire');                    // hérité de discord_b
    expect(res.roster).toHaveLength(4);
    expect(res.roster.some(r => r.uid === 'discord_b')).toBe(false);
    // Position préservée (l'ordre du snapshot est stable).
    expect(res.roster[1].uid).toBe('discord_x');
    // Effectifs invariants : 3 titulaires, 1 remplaçant.
    expect(res.roster.filter(r => r.role === 'titulaire')).toHaveLength(3);
  });

  it('replace : refus si sortant absent ou entrant déjà présent', () => {
    expect(applyRosterChange(ROSTER, { op: 'replace', outUid: 'discord_zz', entry: entry('discord_x', 'titulaire') }).ok).toBe(false);
    expect(applyRosterChange(ROSTER, { op: 'replace', outUid: 'discord_a', entry: entry('discord_d', 'titulaire') }).ok).toBe(false);
  });

  it('swap_roles : échange titulaire ↔ remplaçant, refus si mêmes rôles', () => {
    const res = applyRosterChange(ROSTER, { op: 'swap_roles', uidA: 'discord_c', uidB: 'discord_d' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.roster.find(r => r.uid === 'discord_c')!.role).toBe('remplacant');
    expect(res.roster.find(r => r.uid === 'discord_d')!.role).toBe('titulaire');

    expect(applyRosterChange(ROSTER, { op: 'swap_roles', uidA: 'discord_a', uidB: 'discord_b' }).ok).toBe(false);
    expect(applyRosterChange(ROSTER, { op: 'swap_roles', uidA: 'discord_a', uidB: 'discord_zz' }).ok).toBe(false);
  });

  it('set_captain : appartenance au roster exigée, snapshot inchangé', () => {
    const ok = applyRosterChange(ROSTER, { op: 'set_captain', uid: 'discord_d' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.roster).toEqual(ROSTER);
    expect(applyRosterChange(ROSTER, { op: 'set_captain', uid: 'discord_zz' }).ok).toBe(false);
  });
});

describe('recomputeRegistrationComputed — mêmes règles que le wizard', () => {
  it('roster sain : aucune alerte, analyse des compos présente', () => {
    const c = recomputeRegistrationComputed({
      roster: ROSTER, mmrRules: RULES, minAge: 16, starters: 3, createdByOffGuild: false,
    });
    expect(c.flags).toEqual([]);
    expect(c.worstLineupAvg).toBe(1500); // compo la plus forte : (1500+1550+1450)/3
    expect(c.worstLineupGap).toBe(120);  // pire écart alignable : 1550 − 1430
  });

  it('un entrant trop fort lève les drapeaux MMR (jamais un refus)', () => {
    const roster = ROSTER.map(r => (r.uid === 'discord_d' ? { ...r, refMmr: 2000 } : r));
    const c = recomputeRegistrationComputed({
      roster, mmrRules: RULES, minAge: 16, starters: 3, createdByOffGuild: false,
    });
    expect(c.flags).toContain('mmr_player_cap_exceeded');
    expect(c.flags).toContain('mmr_gap_exceeded');
  });

  it('entrant mineur ou âge inconnu → underage ; absent du Discord → discord_guild_missing', () => {
    const roster = ROSTER.map(r =>
      r.uid === 'discord_d' ? { ...r, age: null, onDiscordGuild: false } : r);
    const c = recomputeRegistrationComputed({
      roster, mmrRules: RULES, minAge: 16, starters: 3, createdByOffGuild: false,
    });
    expect(c.flags).toContain('underage');
    expect(c.flags).toContain('discord_guild_missing');
  });

  it('sans règles MMR : pas d\'analyse, drapeaux d\'âge seuls', () => {
    const roster = ROSTER.map(r => (r.uid === 'discord_a' ? { ...r, age: 15 } : r));
    const c = recomputeRegistrationComputed({
      roster, mmrRules: null, minAge: 16, starters: 3, createdByOffGuild: false,
    });
    expect(c.worstLineupAvg).toBe(null);
    expect(c.flags).toEqual(['underage']);
  });
});

describe('coreGuardViolation — garde du noyau (anti-remplacement total)', () => {
  const initial = ['discord_a', 'discord_b', 'discord_c']; // titulaires validés

  it('1 titulaire d’origine remplacé : conservé ≥ 2/3, autorisé', () => {
    const roster = [
      entry('discord_x', 'titulaire'), entry('discord_b', 'titulaire'),
      entry('discord_c', 'titulaire'), entry('discord_d', 'remplacant'),
    ];
    expect(coreGuardViolation(initial, roster, 3)).toBe(null);
  });

  it('2 titulaires d’origine partis : refus net avec message actionnable', () => {
    const roster = [
      entry('discord_x', 'titulaire'), entry('discord_y', 'titulaire'),
      entry('discord_c', 'titulaire'), entry('discord_d', 'remplacant'),
    ];
    const violation = coreGuardViolation(initial, roster, 3);
    expect(violation).toMatch(/noyau/);
    expect(violation).toMatch(/retrait/);
  });

  it('un titulaire d’origine descendu REMPLAÇANT compte comme conservé (même règle que le circuit)', () => {
    const roster = [
      entry('discord_x', 'titulaire'), entry('discord_y', 'titulaire'),
      entry('discord_c', 'titulaire'), entry('discord_a', 'remplacant'),
    ];
    expect(coreGuardViolation(initial, roster, 3)).toBe(null);
  });

  it('référence vide (inscription legacy jamais figée) : jamais bloquant', () => {
    expect(coreGuardViolation([], [entry('discord_z', 'titulaire')], 3)).toBe(null);
  });

  it('Valorant futur (5 titulaires) : ⌈2×5/3⌉ = 4 conservés exigés', () => {
    const init5 = ['a', 'b', 'c', 'd', 'e'];
    const kept3 = ['a', 'b', 'c', 'x', 'y'].map(u => entry(u, 'titulaire'));
    expect(coreGuardViolation(init5, kept3, 5)).not.toBe(null);
    const kept4 = ['a', 'b', 'c', 'd', 'y'].map(u => entry(u, 'titulaire'));
    expect(coreGuardViolation(init5, kept4, 5)).toBe(null);
  });
});
