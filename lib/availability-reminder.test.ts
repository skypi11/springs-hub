import { describe, it, expect } from 'vitest';
import {
  toDiscordId, computeMissingPlayers, buildReminderMessage,
  nextWeekTarget, currentWeekTarget, formatWeekLabel,
} from './availability-reminder';
import { getIsoWeekId } from './availability';

const M = (uid: string, displayName: string) => ({ uid, displayName });

describe('toDiscordId', () => {
  it('extrait le snowflake d\'un uid Aedral', () => {
    expect(toDiscordId('discord_123456789')).toBe('123456789');
  });
  it('rejette les uid non-Discord ou malformés', () => {
    expect(toDiscordId('steam_123')).toBeNull();
    expect(toDiscordId('discord_abc')).toBeNull();
    expect(toDiscordId('discord_')).toBeNull();
  });
});

describe('computeMissingPlayers', () => {
  const roster = [M('discord_1', 'Noxx'), M('discord_2', 'Kylian'), M('discord_3', 'Théo')];

  it('ne garde que les joueurs sans créneau, dans l\'ordre du roster', () => {
    const missing = computeMissingPlayers(roster, new Set(['discord_2']));
    expect(missing.map(m => m.uid)).toEqual(['discord_1', 'discord_3']);
  });

  it('roster complet rempli → aucun manquant', () => {
    expect(computeMissingPlayers(roster, new Set(['discord_1', 'discord_2', 'discord_3']))).toEqual([]);
  });

  it('personne rempli → tout le roster manque', () => {
    expect(computeMissingPlayers(roster, new Set())).toHaveLength(3);
  });

  it('déduplique un uid présent deux fois (titulaire + remplaçant)', () => {
    const dup = [M('discord_1', 'Noxx'), M('discord_1', 'Noxx'), M('discord_2', 'Kylian')];
    expect(computeMissingPlayers(dup, new Set()).map(m => m.uid)).toEqual(['discord_1', 'discord_2']);
  });
});

describe('buildReminderMessage', () => {
  const base = { teamName: 'Nova Legion', weekLabel: 'semaine du lundi 20 janvier', link: 'https://aedral.com/calendar' };

  it('pinge les manquants liables et les nomme dans l\'embed', () => {
    const msg = buildReminderMessage({
      ...base,
      missing: [M('discord_364131570828836864', 'Noxx'), M('discord_215602301820502016', 'Kylian')],
    });
    expect(msg.pingUserIds).toEqual(['364131570828836864', '215602301820502016']);
    expect(msg.content).toContain('<@364131570828836864>');
    expect(msg.content).toContain('<@215602301820502016>');
    expect(msg.embedDescription).toContain('Noxx');
    expect(msg.embedDescription).toContain('Kylian');
    expect(msg.embedDescription).toContain(base.link);
  });

  it('accord singulier/pluriel', () => {
    const one = buildReminderMessage({ ...base, missing: [M('discord_1', 'Solo')] });
    expect(one.embedDescription).toContain('1 joueur ');
    expect(one.embedDescription).toContain("n'a pas encore");
    const two = buildReminderMessage({ ...base, missing: [M('discord_1', 'A'), M('discord_2', 'B')] });
    expect(two.embedDescription).toContain('2 joueurs');
    expect(two.embedDescription).toContain("n'ont pas encore");
  });

  it('un manquant sans Discord liable est nommé mais pas pingé', () => {
    const msg = buildReminderMessage({ ...base, missing: [M('steam_9', 'SansDiscord')] });
    expect(msg.pingUserIds).toEqual([]);
    expect(msg.embedDescription).toContain('SansDiscord');
    // Pas de mention → content de repli sans ping.
    expect(msg.content).not.toContain('<@');
    expect(msg.content).toContain('oublié');
  });

  it('cappe les mentions à 40 (anti ping-storm) mais nomme tout le monde', () => {
    const many = Array.from({ length: 50 }, (_, i) => M(`discord_1700000000000000${String(i).padStart(2, '0')}`, `P${i}`));
    const msg = buildReminderMessage({ ...base, missing: many });
    expect(msg.pingUserIds).toHaveLength(40);
    expect(msg.content.length).toBeLessThanOrEqual(2000);
  });
});

describe('cibles de semaine', () => {
  it('formatWeekLabel : « semaine du lundi … »', () => {
    // 2026-01-19 est un lundi.
    expect(formatWeekLabel('2026-01-19')).toBe('semaine du lundi 19 janvier');
  });

  it('nextWeekTarget depuis un dimanche → le lundi du LENDEMAIN (semaine qui suit)', () => {
    // 2026-01-18 = dimanche. Le lendemain 2026-01-19 = lundi, début de la
    // semaine visée par la relance du dimanche.
    const t = nextWeekTarget('2026-01-18');
    expect(t.mondayYmd).toBe('2026-01-19');
    expect(t.weekId).toBe(getIsoWeekId('2026-01-19'));
  });

  it('nextWeekTarget est stable quel que soit le jour de la semaine en cours', () => {
    // Depuis n'importe quel jour de la semaine du 12 janv. (lundi 12 → dim 18),
    // la « semaine qui suit » est toujours celle du 19.
    for (const day of ['2026-01-12', '2026-01-14', '2026-01-18']) {
      expect(nextWeekTarget(day).mondayYmd).toBe('2026-01-19');
    }
  });

  it('currentWeekTarget : le lundi de la semaine en cours (relance manuelle)', () => {
    // Mardi 20 janv. → semaine en cours = lundi 19.
    expect(currentWeekTarget('2026-01-20').mondayYmd).toBe('2026-01-19');
  });
});
