import { describe, it, expect, vi, beforeEach } from 'vitest';

// La pagination des membres ne s'exerce qu'au-delà de 1000 membres — c'est-à-dire
// jamais sur un serveur de test, et précisément le jour où ça compte (le Discord
// d'une vraie structure). On la prouve ici contre un Discord simulé.
const discordFetch = vi.fn();
vi.mock('@/lib/discord-competition', () => ({
  discordFetch: (...args: unknown[]) => discordFetch(...args),
  describeGuildAccess: vi.fn(),
  guildIdOfChannel: vi.fn(),
  isGuildMember: vi.fn(),
  roleIdsOfGuild: vi.fn(),
}));

const { guildMemberIds } = await import('./setup-check');

/** Réponse Discord : une page de N membres aux identifiants séquentiels. */
function page(startId: number, count: number) {
  return {
    ok: true,
    json: async () => Array.from({ length: count }, (_, i) => ({ user: { id: String(startId + i) } })),
  };
}

beforeEach(() => discordFetch.mockReset());

describe('liste des membres du serveur', () => {
  it('lit une page unique quand le serveur est petit', async () => {
    discordFetch.mockResolvedValueOnce(page(1, 3));
    const ids = await guildMemberIds('g1');
    expect(ids?.size).toBe(3);
    expect(discordFetch).toHaveBeenCalledTimes(1);
  });

  it('enchaîne les pages et repart du dernier identifiant', async () => {
    discordFetch
      .mockResolvedValueOnce(page(1, 1000))
      .mockResolvedValueOnce(page(1001, 1000))
      .mockResolvedValueOnce(page(2001, 250));
    const ids = await guildMemberIds('g1');
    expect(ids?.size).toBe(2250);
    expect(discordFetch).toHaveBeenCalledTimes(3);
    // La 2e page doit repartir APRÈS le dernier membre de la 1re : sans ça on
    // relit la même page en boucle et les membres suivants n'existent jamais.
    expect(discordFetch.mock.calls[1][0]).toContain('after=1000');
    expect(discordFetch.mock.calls[2][0]).toContain('after=2000');
  });

  it('rend « indéterminé » plutôt qu’une liste tronquée sur un serveur géant', async () => {
    discordFetch.mockImplementation(async (path: string) => {
      const after = Number(new URL(`https://x${path}`).searchParams.get('after') ?? 0);
      return page(after + 1, 1000);
    });
    // Un serveur qui remplit toutes les pages autorisées : conclure « absent »
    // sur une liste partielle enverrait relancer des joueurs pourtant présents.
    expect(await guildMemberIds('g1')).toBeNull();
  });

  it('rend « indéterminé » quand Discord refuse (intent désactivé)', async () => {
    discordFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Missing Access' });
    expect(await guildMemberIds('g1')).toBeNull();
  });

  it('ne boucle pas si une page arrive sans identifiant exploitable', async () => {
    discordFetch.mockResolvedValueOnce({ ok: true, json: async () => Array.from({ length: 1000 }, () => ({})) });
    const ids = await guildMemberIds('g1');
    expect(ids?.size).toBe(0);
    expect(discordFetch).toHaveBeenCalledTimes(1);
  });
});
