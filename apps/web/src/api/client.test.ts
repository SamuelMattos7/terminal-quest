import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './client.js';

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const guestBody = { user: { id: 'u1', displayName: null, xp: 0, streakDays: 0 } };

function stubFetch(res: Response | Error): { calls: RequestInfo[][] } {
  const calls: RequestInfo[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((...args: [RequestInfo]) => {
      calls.push(args);
      if (res instanceof Error) {
        return Promise.reject(res);
      }
      return Promise.resolve(res.clone());
    }),
  );
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('POSTs to /api/guest with same-origin credentials and parses the user', async () => {
    const { calls } = stubFetch(jsonResponse(guestBody));
    const out = await api.guest();
    expect(out).toEqual(guestBody);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe('/api/guest');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
  });

  it('parses the worlds response', async () => {
    const body = {
      worlds: [
        {
          id: 1,
          title: 'The Lobby',
          blurb: 'Welcome.',
          levels: [
            {
              id: 'w1-01-first-words',
              title: 'First words',
              kind: 'lesson',
              difficulty: 1,
              estimatedMinutes: 5,
              state: 'available',
            },
          ],
        },
      ],
    };
    stubFetch(jsonResponse(body));
    await expect(api.worlds()).resolves.toEqual(body);
  });

  it('rejects malformed payloads instead of returning junk', async () => {
    stubFetch(jsonResponse({ user: { id: 'u1' } }));
    const err = await api.guest().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Bad response from server.');
  });

  it('surfaces the server error message and status', async () => {
    stubFetch(jsonResponse({ error: 'level locked' }, 403));
    const err = await api.startLevel('w1-02-x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe('level locked');
  });

  it('reads Retry-After on 429 responses', async () => {
    stubFetch(jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '12' }));
    const err = await api.startLevel('w1-02-x').catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).retryAfterSeconds).toBe(12);
  });

  it('maps network failure to status 0', async () => {
    stubFetch(new Error('boom'));
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it('URL-encodes level ids', async () => {
    const { calls } = stubFetch(jsonResponse({ sessionId: 's1', wsPath: '/ws/sessions/s1' }));
    await api.resetSession('a/b?c');
    const [url] = calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/a%2Fb%3Fc/reset');
  });

  it('PATCHes the display name as JSON', async () => {
    const { calls } = stubFetch(jsonResponse(guestBody));
    await api.updateDisplayName('Tux');
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe('/api/me');
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe(JSON.stringify({ displayName: 'Tux' }));
  });

  it('DELETEs progress and parses the badges list', async () => {
    stubFetch(jsonResponse({ ok: true }));
    await expect(api.deleteProgress()).resolves.toEqual({ ok: true });
    const body = { badges: [{ id: 'b1', title: 'B', description: 'D', earnedAt: null }] };
    stubFetch(jsonResponse(body));
    await expect(api.badges()).resolves.toEqual(body);
  });

  it('PUTs spellbook notes and downloads the markdown export', async () => {
    const { calls } = stubFetch(jsonResponse({ ok: true }));
    await api.saveSpellbookNote('pwd', 'my note');
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe('/api/spellbook/pwd/note');
    expect(init?.method).toBe('PUT');
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('# Spellbook', { status: 200 }))),
    );
    await expect(api.spellbookExport()).resolves.toBe('# Spellbook');
  });

  it('surfaces export failures with status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ error: 'unauthorized' }, 401))),
    );
    const err = await api.spellbookExport().catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(401);
  });
});
