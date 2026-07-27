import { describe, it, expect } from 'vitest';
import {
  matchCheckinText,
  checkinReopenedText,
  scoreAwaitingConfirmText,
  disputeOpenedText,
  adminRulingText,
  teamWithdrawnText,
  opponentWithdrawnText,
  bracketPublishedTeamText,
  organizerAnnouncementText,
} from './broadcast-messages';

const ALL = [
  matchCheckinText({ opponentName: 'Nova Legion', minutes: 5, room: { name: 'AEDRAL-12', password: 'x9f2' } }),
  matchCheckinText({ opponentName: 'Nova Legion', minutes: 5 }),
  checkinReopenedText({ opponentName: 'Nova Legion', minutes: 5, room: null }),
  scoreAwaitingConfirmText({ opponentName: 'Nova Legion', claimedScore: '3-1', minutes: 3 }),
  disputeOpenedText({ opponentName: 'Nova Legion' }),
  adminRulingText({ kind: 'forfeit', winnerName: 'A', loserName: 'B', reason: 'check-in non fait' }),
  adminRulingText({ kind: 'forced_score', winnerName: 'A', loserName: 'B', score: '3-1' }),
  teamWithdrawnText({ teamName: 'B', reason: 'roster incomplet' }),
  opponentWithdrawnText({ opponentName: 'B' }),
  bracketPublishedTeamText({ opponentName: 'B', startsAt: 'samedi 15:00' }),
  bracketPublishedTeamText({ opponentName: null }),
  organizerAnnouncementText({ competitionName: 'Qualif 1', body: '  Retard de 20 minutes.  ' }),
];

describe('voix du bot', () => {
  it("n'utilise jamais de point d'exclamation", () => {
    for (const t of ALL) expect(`${t.title} ${t.message}`).not.toContain('!');
  });

  it("n'utilise aucun emoji", () => {
    // Plages emoji usuelles (pictogrammes, symboles, drapeaux).
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const t of ALL) expect(emoji.test(`${t.title} ${t.message}`)).toBe(false);
  });

  it('ne vouvoie jamais', () => {
    for (const t of ALL) expect(t.message.toLowerCase()).not.toMatch(/\bveuillez\b|\bvotre équipe\b/);
  });

  it('a toujours un titre court et un corps non vide', () => {
    for (const t of ALL) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.title.length).toBeLessThanOrEqual(40);
      expect(t.message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('check-in', () => {
  it('joint la room quand elle est connue', () => {
    const t = matchCheckinText({ opponentName: 'Nova', minutes: 5, room: { name: 'AEDRAL-12', password: 'x9f2' } });
    expect(t.message).toContain('AEDRAL-12');
    expect(t.message).toContain('x9f2');
  });

  it('reste lisible sans room', () => {
    const t = matchCheckinText({ opponentName: 'Nova', minutes: 5 });
    expect(t.message).toContain('Nova');
    expect(t.message).not.toContain('Room');
    expect(t.message).not.toContain('undefined');
  });

  it('accepte une room sans mot de passe', () => {
    const t = matchCheckinText({ opponentName: 'Nova', minutes: 5, room: { name: 'AEDRAL-12', password: '' } });
    expect(t.message).toContain('AEDRAL-12');
    expect(t.message).not.toContain('mot de passe');
  });

  it('dit la conséquence du non-check-in', () => {
    expect(matchCheckinText({ opponentName: 'Nova', minutes: 5 }).message).toContain('forfait');
  });
});

describe('score en attente de confirmation', () => {
  it('donne le score annoncé, le délai et la conséquence du silence', () => {
    const t = scoreAwaitingConfirmText({ opponentName: 'Nova', claimedScore: '3-1', minutes: 3 });
    expect(t.message).toContain('3-1');
    expect(t.message).toContain('3 minutes');
    expect(t.message).toMatch(/retenu/);
  });
});

describe('arbitrage', () => {
  it('nomme le forfait et qui avance', () => {
    const t = adminRulingText({ kind: 'forfeit', winnerName: 'Nova', loserName: 'Aegis' });
    expect(t.title).toBe('Forfait validé');
    expect(t.message).toContain('Aegis');
    expect(t.message).toContain('Nova');
  });

  it('reprend le motif quand il est donné', () => {
    const t = adminRulingText({ kind: 'forfeit', winnerName: 'A', loserName: 'B', reason: 'roster non conforme' });
    expect(t.message).toContain('roster non conforme');
  });

  it('omet le motif absent sans laisser de ligne vide', () => {
    const t = adminRulingText({ kind: 'forced_score', winnerName: 'A', loserName: 'B', score: '3-0' });
    expect(t.message).not.toContain('Motif');
    expect(t.message.endsWith('.')).toBe(true);
  });
});

describe('bracket publié', () => {
  it("annonce l'adversaire et l'heure", () => {
    const t = bracketPublishedTeamText({ opponentName: 'Aegis', startsAt: 'samedi 15:00' });
    expect(t.message).toContain('Aegis');
    expect(t.message).toContain('samedi 15:00');
  });

  it('gère le bye sans inventer d’adversaire', () => {
    const t = bracketPublishedTeamText({ opponentName: null });
    expect(t.message).toContain('exempte');
    expect(t.message).not.toContain('null');
  });
});

describe('retraits', () => {
  it("prévient l'adversaire qu'il n'aura personne en face", () => {
    const t = opponentWithdrawnText({ opponentName: 'Aegis' });
    expect(t.message).toContain('Aegis');
    expect(t.message).toMatch(/sans jouer/);
  });

  it('ne mentionne pas de motif quand il n’y en a pas', () => {
    expect(teamWithdrawnText({ teamName: 'Aegis' }).message).not.toContain('Motif');
  });
});

describe('annonce de l’organisateur', () => {
  it('reprend le texte tel quel, sans mise en forme', () => {
    const t = organizerAnnouncementText({ competitionName: 'Qualif 1', body: '  Retard de 20 minutes.  ' });
    expect(t.title).toBe('Qualif 1');
    expect(t.message).toBe('Retard de 20 minutes.');
  });
});
