import { describe, it, expect } from 'vitest';
import { decideTraceReglement } from './mania-cup-rulebook-trace';

// Le cas qui a motivé ce fichier est le troisième : c'est celui qui produisait
// une trace MENSONGÈRE, et l'ancien code le ratait en silence.

describe('trace d’acceptation du règlement', () => {
  it('pose la trace à la première acceptation', () => {
    expect(
      decideTraceReglement({ versionAcceptee: 2, tracePrecedente: null, uid: 'discord_1' })
    ).toEqual({ trace: { version: 2, byUid: 'discord_1' }, ajouterAHistorique: true });
  });

  it('ne réécrit rien quand le joueur re-enregistre sans que le règlement ait changé', () => {
    expect(
      decideTraceReglement({
        versionAcceptee: 2,
        tracePrecedente: { version: 2 },
        uid: 'discord_1',
      })
    ).toBeNull();
  });

  it('met la trace à jour quand le joueur accepte une version plus récente', () => {
    // Le défaut : l'ancienne règle gardait la version 1 parce qu'une trace
    // existait déjà. Le joueur se retrouvait engagé par un texte qu'il n'avait
    // pas lu, et opposable par un texte qu'il n'avait pas accepté.
    expect(
      decideTraceReglement({
        versionAcceptee: 3,
        tracePrecedente: { version: 1 },
        uid: 'discord_1',
      })
    ).toEqual({ trace: { version: 3, byUid: 'discord_1' }, ajouterAHistorique: true });
  });

  it('n’écrit rien tant qu’aucun règlement n’est publié', () => {
    expect(
      decideTraceReglement({ versionAcceptee: null, tracePrecedente: null, uid: 'discord_1' })
    ).toBeNull();
  });

  it('traite une trace ancienne sans numéro de version comme à refaire', () => {
    // Une inscription antérieure à la trace versionnée : on ne sait pas ce
    // qu'elle a accepté, donc on enregistre ce qu'on sait aujourd'hui.
    expect(
      decideTraceReglement({ versionAcceptee: 2, tracePrecedente: {}, uid: 'discord_1' })
    ).toEqual({ trace: { version: 2, byUid: 'discord_1' }, ajouterAHistorique: true });
  });
});
