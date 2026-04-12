import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveEpicAccount } from './tracker-gg';

// On mock fetch globalement et on restaure entre chaque test pour l'isolation.
const originalFetch = globalThis.fetch;
const originalKey = process.env.TRN_API_KEY;

beforeEach(() => {
  process.env.TRN_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.TRN_API_KEY;
  else process.env.TRN_API_KEY = originalKey;
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(impl as typeof fetch) as typeof fetch;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('resolveEpicAccount', () => {
  it('résout un pseudo Epic en id + displayName', async () => {
    mockFetch(() =>
      jsonResponse({
        data: {
          platformInfo: {
            platformUserId: 'epic-uuid-123',
            platformUserHandle: 'NinjaPlayer',
          },
        },
      })
    );

    const res = await resolveEpicAccount('NinjaPlayer');
    expect(res).toEqual({ id: 'epic-uuid-123', displayName: 'NinjaPlayer' });
  });

  it('utilise platformUserIdentifier si platformUserHandle absent', async () => {
    mockFetch(() =>
      jsonResponse({
        data: {
          platformInfo: {
            platformUserId: 'epic-uuid-123',
            platformUserIdentifier: 'fallback-name',
          },
        },
      })
    );

    const res = await resolveEpicAccount('whatever');
    expect(res?.displayName).toBe('fallback-name');
  });

  it('utilise la saisie comme displayName si rien d\'autre', async () => {
    mockFetch(() =>
      jsonResponse({
        data: {
          platformInfo: { platformUserId: 'epic-uuid-123' },
        },
      })
    );

    const res = await resolveEpicAccount('typed-name');
    expect(res?.displayName).toBe('typed-name');
  });

  it('renvoie null si la clé API est absente', async () => {
    delete process.env.TRN_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await resolveEpicAccount('NinjaPlayer');
    expect(res).toBe(null);
    // On ne doit même pas appeler fetch sans clé
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renvoie null pour une saisie vide', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    expect(await resolveEpicAccount('')).toBe(null);
    expect(await resolveEpicAccount('   ')).toBe(null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renvoie null si l\'API répond avec un statut non-2xx', async () => {
    mockFetch(() => jsonResponse({}, false, 404));
    expect(await resolveEpicAccount('Unknown')).toBe(null);
  });

  it('renvoie null si platformUserId est absent dans la réponse', async () => {
    mockFetch(() =>
      jsonResponse({
        data: {
          platformInfo: { platformUserHandle: 'NoIdHere' },
        },
      })
    );
    expect(await resolveEpicAccount('NoIdHere')).toBe(null);
  });

  it('renvoie null si la réponse n\'a pas de structure data.platformInfo', async () => {
    mockFetch(() => jsonResponse({ foo: 'bar' }));
    expect(await resolveEpicAccount('whatever')).toBe(null);
  });

  it('renvoie null si fetch lève une erreur réseau', async () => {
    mockFetch(() => {
      throw new Error('network down');
    });
    expect(await resolveEpicAccount('NinjaPlayer')).toBe(null);
  });

  it('renvoie null si la réponse JSON est invalide', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('invalid json');
      },
    })) as unknown as typeof fetch;

    expect(await resolveEpicAccount('NinjaPlayer')).toBe(null);
  });

  it('encode correctement les caractères spéciaux dans l\'URL', async () => {
    let calledUrl = '';
    mockFetch((url) => {
      calledUrl = url;
      return jsonResponse({
        data: { platformInfo: { platformUserId: 'x' } },
      });
    });

    await resolveEpicAccount('joueur#42 fr');
    expect(calledUrl).toContain('joueur%2342%20fr');
  });

  it('passe la clé API dans le header TRN-Api-Key', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    mockFetch((_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({
        data: { platformInfo: { platformUserId: 'x' } },
      });
    });

    await resolveEpicAccount('NinjaPlayer');
    expect(capturedHeaders?.['TRN-Api-Key']).toBe('test-key');
  });
});
