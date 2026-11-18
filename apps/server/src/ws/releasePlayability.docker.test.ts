import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  ServerMessageSchema,
  StartSessionResponseSchema,
  type ServerMessage,
} from '@terminal-quest/shared';
import { guestCookie, makeDockerTestContext } from '../testUtils.js';

function realContentRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(resolve(here, '..', '..', '..', '..'), 'packages', 'levels', 'content');
}

// Play through both release worlds over the browser's WebSocket path.
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
  { id: 'w1-12-boss-organize-chaos', dir: '12-boss-organize-chaos' },
];

const WORLD_TWO = readdirSync(join(realContentRoot(), 'w2'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(({ name: dir }) => ({ id: `w2-${dir}`, dir }))
  .sort((a, b) => a.dir.localeCompare(b.dir));

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

async function solve(
  socket: WebSocket,
  messages: ServerMessage[],
  id: string,
  dir: string,
): Promise<void> {
  const send = (d: string) => socket.send(JSON.stringify({ t: 'stdin', d }));
  const waitForScreen = async (label: string) => {
    const start = messages.length;
    await waitFor(
      () => messages.slice(start),
      (m) => m.t === 'stdout' && m.d.includes(label),
      15_000,
      label,
    );
  };
  if (id === 'w2-13-nano') {
    const opened = waitForScreen('GNU nano');
    send('nano server.conf\r');
    await opened;
    const savePrompt = waitForScreen('File Name to Write');
    send('\x0e\x01\x0bport=9090\rdebug=true\x0f');
    await savePrompt;
    send('\r\x18');
  } else if (id === 'w2-14-vim-survival') {
    const opened = waitForScreen('Retired relay');
    send('vim handoff.txt\r');
    await opened;
    send('/Retired relay\rddGoFiling room: ready.\x1b:wq\r');
  } else {
    const solution = readFileSync(
      join(realContentRoot(), id.slice(0, 2), dir, 'solution.sh'),
      'utf8',
    );
    send(solution.endsWith('\n') ? solution : `${solution}\n`);
  }
}

describe('Release playability over the socket', () => {
  it.each([...PLAYABLE, ...WORLD_TWO.slice(-3)])(
    'solves $id end to end',
    async ({ id, dir }) => {
      // UNLOCK_ALL: the singles prove per-level socket solvability in
      // isolation; the chain test below proves the unlock progression.
      const ctx = await makeDockerTestContext([], { UNLOCK_ALL: 1 }, realContentRoot());
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
        await solve(socket, messages, id, dir);
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
        if (id === 'w2-14-vim-survival') {
          expect(done.result.newBadges).toContain('vim-escape');
        }
      } finally {
        socket?.close();
        await ctx.cleanup();
      }
    },
    120_000,
  );

  it('unlocks both release worlds in one progression', async () => {
    expect(WORLD_TWO).toHaveLength(15);
    const ctx = await makeDockerTestContext([], {}, realContentRoot());
    let socket: WebSocket | undefined;
    try {
      await ctx.app.listen({ port: 0, host: '127.0.0.1' });
      const address = ctx.app.server.address();
      if (typeof address !== 'object' || address === null) {
        throw new Error('server did not bind');
      }
      const cookie = await guestCookie(ctx.app);
      let first = true;
      for (const { id, dir } of [...PLAYABLE, ...WORLD_TWO]) {
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
        await solve(socket, messages, id, dir);
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
  }, 600_000);
});
