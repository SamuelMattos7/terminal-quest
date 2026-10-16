import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  ServerMessageSchema,
  StartSessionResponseSchema,
  type ServerMessage,
} from '@terminal-quest/shared';
import { guestCookie, makeTestContext } from '../testUtils.js';

function realContentRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(resolve(here, '..', '..', '..', '..'), 'packages', 'levels', 'content');
}

// M7 playability: solve every authored World 1 level in order over a real
// WebSocket, proving each is completable through the same path the browser
// uses — including the sequential unlock chain (no UNLOCK_ALL). Extend this
// table as later batches land (w1-07 … w1-12).
const PLAYABLE: { id: string; dir: string }[] = [
  { id: 'w1-01-first-words', dir: '01-first-words' },
  { id: 'w1-02-where-am-i', dir: '02-where-am-i' },
  { id: 'w1-03-moving-around', dir: '03-moving-around' },
  { id: 'w1-04-paths', dir: '04-paths' },
  { id: 'w1-05-peek-inside', dir: '05-peek-inside' },
  { id: 'w1-06-make-things', dir: '06-make-things' },
  { id: 'w1-07-copy-and-move', dir: '07-copy-and-move' },
  { id: 'w1-08-delete-carefully', dir: '08-delete-carefully' },
  { id: 'w1-09-reading-files', dir: '09-reading-files' },
  { id: 'w1-10-manual-labor', dir: '10-manual-labor' },
  { id: 'w1-11-time-travel', dir: '11-time-travel' },
];

async function waitFor(
  messages: () => ServerMessage[],
  predicate: (m: ServerMessage) => boolean,
  timeoutMs: number,
  label: string,
): Promise<ServerMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = messages().find(predicate);
    if (found !== undefined) {
      return found;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('World 1 playability over the socket', () => {
  it.each(PLAYABLE)(
    'solves $id end to end',
    async ({ id, dir }) => {
      // UNLOCK_ALL: the singles prove per-level socket solvability in
      // isolation; the chain test below proves the unlock progression.
      const ctx = await makeTestContext([], { UNLOCK_ALL: 1 }, realContentRoot());
      let socket: WebSocket | undefined;
      try {
        await ctx.app.listen({ port: 0, host: '127.0.0.1' });
        const address = ctx.app.server.address();
        if (typeof address !== 'object' || address === null) {
          throw new Error('server did not bind');
        }
        const cookie = await guestCookie(ctx.app);
        const started = StartSessionResponseSchema.parse(
          (
            await ctx.app.inject({
              method: 'POST',
              url: `/api/levels/${id}/start`,
              headers: { cookie },
            })
          ).json(),
        );
        socket = new WebSocket(`ws://127.0.0.1:${address.port}${started.wsPath}`, {
          headers: { cookie, Origin: 'http://localhost:5173' },
        });
        const messages: ServerMessage[] = [];
        socket.on('message', (data) => {
          const parsed = ServerMessageSchema.safeParse(JSON.parse(data.toString()));
          if (parsed.success) {
            messages.push(parsed.data);
          }
        });
        await waitFor(
          () => messages,
          (m) => m.t === 'session_state',
          15_000,
          `${id} session_state`,
        );
        const solution = readFileSync(join(realContentRoot(), 'w1', dir, 'solution.sh'), 'utf8');
        socket.send(
          JSON.stringify({ t: 'stdin', d: solution.endsWith('\n') ? solution : `${solution}\n` }),
        );
        const done = await waitFor(
          () => messages,
          (m) => m.t === 'level_complete',
          30_000,
          `${id} level_complete`,
        );
        if (done.t !== 'level_complete') {
          throw new Error('unreachable');
        }
        expect(done.result.xp).toBeGreaterThan(0);
      } finally {
        socket?.close();
        await ctx.cleanup();
      }
    },
    120_000,
  );

  it('unlocks the chain 01 -> 11 in one progression', async () => {
    const ctx = await makeTestContext([], {}, realContentRoot());
    let socket: WebSocket | undefined;
    try {
      await ctx.app.listen({ port: 0, host: '127.0.0.1' });
      const address = ctx.app.server.address();
      if (typeof address !== 'object' || address === null) {
        throw new Error('server did not bind');
      }
      const cookie = await guestCookie(ctx.app);
      let first = true;
      for (const { id, dir } of PLAYABLE) {
        // Start is rate-limited to 10/minute per user: pace the chain.
        if (!first) {
          await new Promise((r) => setTimeout(r, 7000));
        }
        first = false;
        const res = await ctx.app.inject({
          method: 'POST',
          url: `/api/levels/${id}/start`,
          headers: { cookie },
        });
        // A non-200 here means the previous level did not unlock this one
        // (403) or the start rate limit was tripped (429).
        expect(res.statusCode, `${id} start failed: ${res.statusCode}`).toBe(200);
        const started = StartSessionResponseSchema.parse(res.json());
        socket = new WebSocket(`ws://127.0.0.1:${address.port}${started.wsPath}`, {
          headers: { cookie, Origin: 'http://localhost:5173' },
        });
        const messages: ServerMessage[] = [];
        socket.on('message', (data) => {
          const parsed = ServerMessageSchema.safeParse(JSON.parse(data.toString()));
          if (parsed.success) {
            messages.push(parsed.data);
          }
        });
        await waitFor(
          () => messages,
          (m) => m.t === 'session_state',
          15_000,
          `${id} session_state`,
        );
        const solution = readFileSync(join(realContentRoot(), 'w1', dir, 'solution.sh'), 'utf8');
        socket.send(
          JSON.stringify({ t: 'stdin', d: solution.endsWith('\n') ? solution : `${solution}\n` }),
        );
        await waitFor(
          () => messages,
          (m) => m.t === 'level_complete',
          30_000,
          `${id} complete`,
        );
        socket.close();
        socket = undefined;
      }
    } finally {
      socket?.close();
      await ctx.cleanup();
    }
  }, 300_000);
});
