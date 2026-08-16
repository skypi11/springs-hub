import { describe, it, expect } from 'vitest';
import {
  collectGameIdentities,
  identityDocId,
  describeMatches,
  blockingMatches,
  crossMatchBannedIdentities,
  matchBlocksRegistration,
  type BanEvasionMatch,
  type BannedIdentityEntry,
} from './ban-evasion';

// Le cas réel qui a déclenché ce module (16/08/2026) : un joueur banni du site
// revient le lendemain sous un autre compte Discord, en reliant le MÊME compte
// Epic, et redépose la même demande de structure.

const BANNI = {
  uid: 'discord_1405633344959549651',
  discordConnections: [
    { type: 'epicgames', id: '7f263cc88b25465fb31ec552d6ee0bb1', name: 'haloufman7', verified: true },
    { type: 'playstation', id: '5296216006875145469', name: 'sofiane', verified: true },
    { type: 'spotify', id: '3166iphgu5uarizc3rvji3vr5efy', name: 'sofiane', verified: true },
  ],
  epicAccountId: 'haloufman7',
};

const REVENANT = {
  uid: 'discord_1538591069539926120',
  discordConnections: [
    { type: 'epicgames', id: '7f263cc88b25465fb31ec552d6ee0bb1', name: 'haloufman7', verified: true },
  ],
};

describe('collectGameIdentities', () => {
  it('retrouve le compte de jeu commun aux deux comptes Discord', () => {
    const a = collectGameIdentities(BANNI).filter((i) => i.type === 'epicgames');
    const b = collectGameIdentities(REVENANT).filter((i) => i.type === 'epicgames');
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].strong).toBe(true);
  });

  it('ignore ce qui n’est pas un compte de JEU', () => {
    // Deux comptes Discord ont bel et bien partagé un Spotify en base : c'est
    // quelqu'un qui a changé de Discord, pas un tricheur. Le confondre ferait
    // crier au loup sur un usage normal.
    const types = collectGameIdentities(BANNI).map((i) => i.type);
    expect(types).not.toContain('spotify');
    expect(types).toContain('epicgames');
    expect(types).toContain('playstation');
  });

  it('ne tient pour FORTE qu’une connexion vérifiée par Discord', () => {
    const ids = collectGameIdentities({
      discordConnections: [{ type: 'steam', id: '76561198000000000', name: 'x', verified: false }],
    });
    expect(ids[0].strong).toBe(false);
  });

  it('ne tient le compte Trackmania pour fort que s’il vient de l’OAuth Nadeo', () => {
    // `tmAccountId` est aussi écrit par la synchronisation des trophées, qui ne
    // lit qu'une API publique : seul `tmVerifiedAt` prouve la possession.
    const sans = collectGameIdentities({ tmAccountId: 'abc-123' });
    const avec = collectGameIdentities({ tmAccountId: 'abc-123', tmVerifiedAt: new Date() });
    expect(sans[0].strong).toBe(false);
    expect(avec[0].strong).toBe(true);
  });

  it('traite le champ Epic historique comme un signal FAIBLE', () => {
    // Il contient un pseudo en base (« haloufman7 »), pas un identifiant.
    const legacy = collectGameIdentities(BANNI).find((i) => i.type === 'epic_legacy');
    expect(legacy?.strong).toBe(false);
  });

  it('ne compte qu’une fois un SteamID présent en double', () => {
    const ids = collectGameIdentities({
      rlSteamId: '76561198058614270',
      steamLinked: { steamId64: '76561198058614270' },
      discordConnections: [{ type: 'steam', id: '76561198058614270', name: 'x', verified: true }],
    });
    expect(ids.filter((i) => i.type === 'steam')).toHaveLength(1);
  });

  it('distingue le PUUID Riot de la connexion Riot — deux valeurs, deux sens', () => {
    const ids = collectGameIdentities({
      valorantPuuid: 'puuid-xyz',
      discordConnections: [{ type: 'riotgames', id: 'riot-abc', name: 'x', verified: true }],
    });
    expect(ids.map((i) => i.type).sort()).toEqual(['riot_puuid', 'riotgames']);
  });

  it('ne renvoie rien pour un compte sans aucun jeu relié', () => {
    expect(collectGameIdentities({})).toEqual([]);
    expect(collectGameIdentities(null)).toEqual([]);
    // Une valeur vide n'est pas une empreinte : sinon tous les comptes sans
    // Steam se ressembleraient.
    expect(collectGameIdentities({ rlSteamId: '', valorantPuuid: '   ' })).toEqual([]);
  });
});

describe('identityDocId', () => {
  it('est déterministe — c’est ce qui permet la lecture directe', () => {
    expect(identityDocId({ type: 'epicgames', id: '7f263cc8' }))
      .toBe(identityDocId({ type: 'epicgames', id: ' 7f263cc8 ' }));
  });

  it('ne fabrique jamais un identifiant que Firestore refuse', () => {
    const sale = identityDocId({ type: 'steam', id: 'a/b\\c#d?e[f]' });
    expect(sale).not.toContain('/');
    expect(sale.length).toBeLessThanOrEqual(300);
    expect(/^__.*__$/.test(identityDocId({ type: '_', id: '_' }))).toBe(false);
  });

  it('ne confond pas deux plateformes portant le même identifiant', () => {
    expect(identityDocId({ type: 'steam', id: '123' }))
      .not.toBe(identityDocId({ type: 'xbox', id: '123' }));
  });
});

describe('describeMatches / blockingMatches', () => {
  const entry = {
    uid: 'discord_1405633344959549651',
    label: 'sofiane123456789lan',
    reason: 'comportement problématique',
    source: 'site' as const,
    competitionId: null,
    createdAt: '2026-08-15T10:00:00.000Z',
    createdBy: 'discord_admin',
    revokedAt: null,
    revokedBy: null,
  };
  const fort: BanEvasionMatch = {
    identity: { type: 'epicgames', id: '7f26', label: 'haloufman7', strong: true },
    entry,
  };
  const faible: BanEvasionMatch = {
    identity: { type: 'epic_legacy', id: 'haloufman7', label: '', strong: false },
    entry,
  };

  it('écrit une phrase qui tient dans un bandeau', () => {
    expect(describeMatches([fort])).toBe(
      'Partage le compte Epic Games de « sofiane123456789lan », banni du site — comportement problématique.'
    );
  });

  it('dit « banni des compétitions » quand la sanction ne ferme pas le site', () => {
    const compet = { ...fort, entry: { ...entry, source: 'competition' as const } };
    expect(describeMatches([compet])).toContain('banni des compétitions');
    expect(describeMatches([compet])).not.toContain('banni du site');
  });

  it('ne dit rien quand il n’y a rien à dire', () => {
    expect(describeMatches([])).toBe('');
  });

  it('ne laisse JAMAIS un signal faible bloquer quelqu’un', () => {
    expect(blockingMatches([faible])).toHaveLength(0);
    expect(blockingMatches([fort, faible])).toEqual([fort]);
  });
});

describe('crossMatchBannedIdentities', () => {
  const banni = { ...BANNI, label: 'sofiane123456789lan', isBanned: true, banReason: 'posait problème' };
  const revenant = { ...REVENANT, label: 'sofiane_ytb' };
  const tiers = {
    uid: 'discord_999',
    label: 'quelqu’un d’autre',
    discordConnections: [{ type: 'epicgames', id: 'un-autre-compte', name: 'x', verified: true }],
  };

  it('désigne le compte neuf qui rejoue le compte de jeu d’un banni', () => {
    const trouves = crossMatchBannedIdentities([banni, revenant, tiers]);
    expect(trouves).toHaveLength(1);
    expect(trouves[0].uid).toBe(revenant.uid);
    expect(trouves[0].matches[0].entry.label).toBe('sofiane123456789lan');
    expect(trouves[0].matches[0].entry.reason).toBe('posait problème');
  });

  it('ne se signale pas lui-même', () => {
    expect(crossMatchBannedIdentities([banni]).map((m) => m.uid)).not.toContain(banni.uid);
  });

  it('ne dit rien tant que personne n’est banni', () => {
    expect(crossMatchBannedIdentities([revenant, tiers])).toEqual([]);
  });

  it('ignore un compte non-jeu partagé', () => {
    // Le cas réel de deux comptes Discord partageant un Spotify.
    const a = { uid: 'a', label: 'a', isBanned: true, discordConnections: [{ type: 'spotify', id: 's1', name: 'x', verified: true }] };
    const b = { uid: 'b', label: 'b', discordConnections: [{ type: 'spotify', id: 's1', name: 'x', verified: true }] };
    expect(crossMatchBannedIdentities([a, b])).toEqual([]);
  });
});

describe('matchBlocksRegistration', () => {
  const base = {
    uid: 'discord_banni',
    label: 'le banni',
    reason: 'triche',
    competitionId: null,
    createdAt: '2026-08-15T10:00:00.000Z',
    createdBy: 'discord_admin',
    revokedAt: null,
    revokedBy: null,
  } satisfies Omit<BannedIdentityEntry, 'source'>;
  const cible = { competitionId: 'qualif-1', circuitId: 'legends' };
  const avec = (entry: Partial<BannedIdentityEntry>): BanEvasionMatch => ({
    identity: { type: 'epicgames', id: '7f26', label: '', strong: true },
    entry: { ...base, source: 'competition', ...entry },
  });

  it('un banni du SITE ne s’inscrit à rien', () => {
    expect(matchBlocksRegistration(avec({ source: 'site' }), cible)).toBe(true);
  });

  it('un ban de compétition vaut pour toutes les compétitions', () => {
    expect(matchBlocksRegistration(avec({ sanctionType: 'ban', scope: { kind: 'global' } }), cible)).toBe(true);
  });

  it('une exclusion ne vaut que dans sa portée', () => {
    const surQualif1 = avec({ sanctionType: 'exclusion', scope: { kind: 'competition', competitionId: 'qualif-1' } });
    const surQualif2 = avec({ sanctionType: 'exclusion', scope: { kind: 'competition', competitionId: 'qualif-2' } });
    expect(matchBlocksRegistration(surQualif1, cible)).toBe(true);
    // Le point important : exclu d'un tournoi ≠ exclu de tous.
    expect(matchBlocksRegistration(surQualif2, cible)).toBe(false);
  });

  it('une exclusion de circuit couvre ses étapes', () => {
    const m = avec({ sanctionType: 'exclusion', scope: { kind: 'circuit', circuitId: 'legends' } });
    expect(matchBlocksRegistration(m, cible)).toBe(true);
    expect(matchBlocksRegistration(m, { competitionId: 'autre', circuitId: 'autre-circuit' })).toBe(false);
  });

  it('ne bloque jamais sur un signal faible, même pour un ban du site', () => {
    const m: BanEvasionMatch = {
      identity: { type: 'epic_legacy', id: 'haloufman7', label: '', strong: false },
      entry: { ...base, source: 'site' } as BanEvasionMatch['entry'],
    };
    expect(matchBlocksRegistration(m, cible)).toBe(false);
  });

  it('ne bloque plus une fois la sanction levée', () => {
    expect(matchBlocksRegistration(avec({ source: 'site', revokedAt: '2026-08-16T00:00:00.000Z' }), cible)).toBe(false);
  });
});
