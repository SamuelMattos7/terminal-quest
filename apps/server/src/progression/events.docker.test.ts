import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { StartSessionResponseSchema, type ServerMessage } from '@terminal-quest/shared';
import { events, users } from '../db/schema.js';
import { guestCookie, makeTestContext } from '../testUtils.js';

function realContentRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(resolve(here, '..', '..', '..', '..'), 'packages', 'levels', 'content');
}

async function waitFor(
  messages: ServerMessage[],
  predicate: (m: ServerMessage) => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (messages.some(predicate)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('telemetry events over a full w1-01 attempt', () => {
  it('records start, hint, objectives, completion, and abandon in order', async () => {
    const ctx = await makeTestContext([], {}, realContentRoot());
    const sockets: WebSocket[] = [];
    try {
      await ctx.app.listen({ port: 0, host: '127.0.0.1' });
      const address = ctx.app.server.address();
      if (typeof address !== 'object' || address === null) {
        throw new Error('server did not bind');
      }
      const cookie = await guestCookie(ctx.app);
      const [user] = ctx.db.select().from(users).all();
      if (user === undefined) {
        throw new Error('guest user missing');
      }
      const started = StartSessionResponseSchema.parse(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w1-01-first-words/start',
            headers: { cookie },
          })
        ).json(),
      );
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}${started.wsPath}`, {
        headers: { cookie, Origin: 'http://localhost:5173' },
      });
      sockets.push(socket);
      const messages: ServerMessage[] = [];
      socket.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()) as ServerMessage);
        } catch {
          // Ignore non-JSON noise; the collector below only matches frames.
        }
      });
      await waitFor(messages, (m) => m.t === 'session_state', 15_000, 'session_state');
      socket.send(JSON.stringify({ t: 'hint' }));
      await waitFor(messages, (m) => m.t === 'hint', 10_000, 'hint');
      socket.send(JSON.stringify({ t: 'stdin', d: 'echo hello\n' }));
      socket.send(JSON.stringify({ t: 'stdin', d: 'whoami\n' }));
      await waitFor(messages, (m) => m.t === 'level_complete', 20_000, 'level_complete');

      const abandon = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/sessions/${started.sessionId}`,
        headers: { cookie },
      });
      expect(abandon.statusCode).toBe(200);

      const rows = ctx.db.select().from(events).all();
      const types = rows.map((r) => r.type);
      expect(types).toEqual([
        'level_start',
        'hint_used',
        'objective_complete',
        'objective_complete',
        'level_complete',
        'level_abandon',
      ]);
      for (const row of rows) {
        expect(row.userId).toBe(user.id);
        expect(row.levelId).toBe('w1-01-first-words');
      }
      const attemptIds = new Set(rows.map((r) => r.attemptId));
      expect(attemptIds.size).toBe(1);
      const payloads = new Map(rows.map((r) => [r.type, JSON.parse(r.payloadJson) as unknown]));
      expect(payloads.get('hint_used')).toMatchObject({ tier: 1 });
      expect(payloads.get('level_complete')).toMatchObject({ rank: expect.any(String) });
      const objectivePayloads = rows
        .filter((r) => r.type === 'objective_complete')
        .map((r) => JSON.parse(r.payloadJson) as { objectiveId: string });
      expect(objectivePayloads.map((p) => p.objectiveId).sort()).toEqual([
        'said-hello',
        'said-name',
      ]);
    } finally {
      for (const s of sockets) {
        s.close();
      }
      await ctx.cleanup();
    }
  }, 120_000);
});
