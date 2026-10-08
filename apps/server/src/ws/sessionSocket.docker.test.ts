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

interface Collected {
  messages: ServerMessage[];
  closes: { code: number; reason: Buffer }[];
}

function collect(socket: WebSocket): Collected {
  const messages: ServerMessage[] = [];
  const closes: { code: number; reason: Buffer }[] = [];
  socket.on('message', (data) => {
    const parsed = ServerMessageSchema.safeParse(JSON.parse(data.toString()));
    if (parsed.success) {
      messages.push(parsed.data);
    }
  });
  socket.on('close', (code: number, reason: Buffer) => {
    closes.push({ code, reason });
  });
  return { messages, closes };
}

async function waitFor(
  collected: Collected,
  predicate: (m: ServerMessage) => boolean,
  timeoutMs: number,
  label: string,
): Promise<ServerMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = collected.messages.find(predicate);
    if (found !== undefined) {
      return found;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitClose(collected: Collected, timeoutMs: number, label: string): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (collected.closes.length > 0) {
      return collected.closes[0]?.code ?? -1;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for close (${label})`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('session socket over the w1-02 sample', () => {
  it('streams stdin, ticks objectives, and completes the level', async () => {
    const ctx = await makeTestContext([], {}, realContentRoot());
    const sockets: WebSocket[] = [];
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
            url: '/api/levels/w1-02-where-am-i/start',
            headers: { cookie },
          })
        ).json(),
      );

      const socket = new WebSocket(`ws://127.0.0.1:${address.port}${started.wsPath}`, {
        headers: { cookie, Origin: 'http://localhost:5173' },
      });
      sockets.push(socket);
      const collected = collect(socket);
      await waitFor(collected, (m) => m.t === 'session_state', 15_000, 'session_state');

      const send = (text: string): void => {
        socket.send(JSON.stringify({ t: 'stdin', d: text }));
      };
      send('pwd\n');
      await waitFor(
        collected,
        (m) => m.t === 'objective' && m.id === 'ran-pwd' && m.status === 'done',
        15_000,
        'ran-pwd',
      );
      send('ls\n');
      // Derive the seeded answer from visible output like a player would.
      const deadline = Date.now() + 15_000;
      let word: string | undefined;
      for (;;) {
        const out = collected.messages
          .filter((m) => m.t === 'stdout')
          .map((m) => (m.t === 'stdout' ? m.d : ''))
          .join('');
        const match = /welcome-([a-z]+)\.txt/.exec(out);
        if (match?.[1] !== undefined) {
          word = match[1];
          break;
        }
        if (Date.now() > deadline) {
          throw new Error('seeded word never appeared in terminal output');
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      send(`tux submit ${word}\n`);
      const done = await waitFor(
        collected,
        (m) => m.t === 'level_complete',
        20_000,
        'level_complete',
      );
      if (done.t !== 'level_complete') {
        throw new Error('unreachable');
      }
      expect(done.result.rank).toBe('S');
      expect(done.result.xp).toBe(55);
      expect(done.result.skillsGained).toEqual(['pwd', 'ls']);
    } finally {
      for (const s of sockets) {
        s.close();
      }
      ctx.cleanup();
    }
  }, 120_000);

  it('enforces ownership, origin, frame limits, and ping', async () => {
    const ctx = await makeTestContext([], {}, realContentRoot());
    const sockets: WebSocket[] = [];
    try {
      await ctx.app.listen({ port: 0, host: '127.0.0.1' });
      const address = ctx.app.server.address();
      if (typeof address !== 'object' || address === null) {
        throw new Error('server did not bind');
      }
      const base = `ws://127.0.0.1:${address.port}`;
      const cookie = await guestCookie(ctx.app);
      const other = await guestCookie(ctx.app);
      const started = StartSessionResponseSchema.parse(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w1-02-where-am-i/start',
            headers: { cookie },
          })
        ).json(),
      );

      const foreign = new WebSocket(`${base}${started.wsPath}`, {
        headers: { cookie: other, Origin: 'http://localhost:5173' },
      });
      sockets.push(foreign);
      expect(await waitClose(collect(foreign), 10_000, 'ownership')).toBe(4401);

      const badOrigin = new WebSocket(`${base}${started.wsPath}`, {
        headers: { cookie, Origin: 'http://evil.test' },
      });
      sockets.push(badOrigin);
      expect(await waitClose(collect(badOrigin), 10_000, 'origin')).toBe(4403);

      const socket = new WebSocket(`${base}${started.wsPath}`, {
        headers: { cookie, Origin: 'http://localhost:5173' },
      });
      sockets.push(socket);
      const collected = collect(socket);
      await waitFor(collected, (m) => m.t === 'session_state', 15_000, 'session_state');
      socket.send(JSON.stringify({ t: 'ping' }));
      await waitFor(collected, (m) => m.t === 'pong', 10_000, 'pong');
      socket.send(JSON.stringify({ t: 'stdin', d: 'x'.repeat(20 * 1024) }));
      await waitFor(collected, (m) => m.t === 'error', 10_000, 'oversize error');
    } finally {
      for (const s of sockets) {
        s.close();
      }
      ctx.cleanup();
    }
  }, 120_000);
});
