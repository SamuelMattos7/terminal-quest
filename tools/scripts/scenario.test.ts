import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { afterEach, expect, it } from 'vitest';
import { ClientMessageSchema } from '@terminal-quest/shared';
import { runScenario, type WorkloadTiming } from './scenario.js';

const publicOrigin = 'https://quest.example.test';
const timing: WorkloadTiming = {
  rampMs: 20,
  holdMs: 100,
  quietMs: 0,
  cooldownMs: 0,
  probeDelay: () => 10,
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function target(
  probe: 'capacity' | 'rate' | 'success' = 'capacity',
  behavior: 'normal' | 'idle' | 'disconnect' = 'normal',
) {
  let guests = 0;
  let completed = 0;
  const active = new Map<string, string>();
  const origins: string[] = [];
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const send = (body: unknown) => res.end(JSON.stringify(body));
    if (req.url === '/healthz') return send({ ok: true, docker: true });
    if (req.url === '/api/guest') {
      const id = String(++guests);
      res.setHeader('Set-Cookie', `tq_session=guest${id}; HttpOnly; Secure`);
      return send({ user: { id, displayName: null, xp: 0, streakDays: 0 } });
    }
    const cookie = req.headers.cookie;
    if (!cookie?.startsWith('tq_session=guest')) {
      res.statusCode = 401;
      return send({});
    }
    if (req.method === 'DELETE') {
      const id = req.url!.split('/').at(-1)!;
      expect(active.get(id)).toBe(cookie);
      active.delete(id);
      return send({ ok: true });
    }
    if (active.size === 20 && probe !== 'success') {
      res.statusCode = 429;
      res.setHeader('Retry-After', '30');
      return send({ error: probe === 'rate' ? 'Too Many Requests' : 'sandbox capacity reached' });
    }
    const id = `s${active.size + 1}`;
    active.set(id, cookie);
    return send({ sessionId: id, wsPath: `/ws/sessions/${id}` });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => {
    const id = req.url!.split('/').at(-1)!;
    expect(req.headers.cookie).toBe(active.get(id));
    origins.push(req.headers.origin!);
    const send = (body: unknown) => socket.send(JSON.stringify(body));
    let seq = 0;
    const stdout = (d: string) => send({ t: 'stdout', d, seq: ++seq });
    send({
      t: 'session_state',
      level: {
        id: 'w1-01-first-words',
        title: 'First Words',
        story: 'Test',
        kind: 'lesson',
        objectives: [],
        teaches: ['echo'],
        parCommands: 2,
        xp: 50,
        hintCount: 3,
      },
      objectives: [],
      hintsUsed: 0,
      hintsTotal: 3,
      completed: false,
    });
    socket.on('message', (raw) => {
      const message = ClientMessageSchema.parse(JSON.parse(String(raw)));
      if (message.t !== 'stdin') return;
      if (message.d.startsWith('printf')) {
        // A command echoed by the PTY is not the command's output marker.
        stdout(message.d);
        const nonce = message.d.match(/'([a-f0-9]+)'/)![1];
        stdout(`ready_${nonce}\r\n`);
        if (behavior === 'idle') setTimeout(() => send({ t: 'closing', reason: 'idle' }), 5);
      } else if (message.d.startsWith('tq_')) {
        if (behavior === 'disconnect') {
          socket.close(1011);
          return;
        }
        stdout(message.d.slice(0, 5));
        setTimeout(() => stdout(message.d.slice(5)), 1);
      } else if (message.d.startsWith('echo hello')) {
        completed++;
        send({
          t: 'level_complete',
          result: {
            xp: 50,
            rank: 'A',
            breakdown: [],
            newBadges: [],
            unlocked: [],
            explain: [],
            skillsGained: [],
            message: 'Done',
          },
        });
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve())));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing listener');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    active,
    origins,
    completed: () => completed,
  };
}

it('sustains 20 cookie-owned sockets, matches split echoes, completes and deletes every session', async () => {
  const mock = await target();
  const report: Record<string, unknown> = {};
  await runScenario(
    {
      baseUrl: mock.baseUrl,
      origin: publicOrigin,
      out: 'unused',
      mode: 'capacity',
      idleTtlSeconds: 30,
    },
    report,
    new AbortController().signal,
    () => {},
    timing,
  );
  expect(report.workloadPassed).toBe(true);
  expect(report.holdDurationMs).toBeGreaterThanOrEqual(100);
  expect(report.cleanupErrors).toEqual([]);
  expect(mock.origins).toEqual(Array<string>(20).fill(publicOrigin));
  expect(mock.completed()).toBe(20);
  expect(mock.active.size).toBe(0);
  expect(JSON.stringify(report)).not.toContain('tq_session');
});

it('observes idle closing without hold probes and still cleans owned resources', async () => {
  const mock = await target('capacity', 'idle');
  const report: Record<string, unknown> = {};
  await runScenario(
    {
      baseUrl: mock.baseUrl,
      origin: publicOrigin,
      out: 'unused',
      mode: 'idle',
      idleTtlSeconds: 30,
    },
    report,
    new AbortController().signal,
    () => {},
    timing,
  );
  expect(report.idleExpired).toBe(true);
  expect(mock.completed()).toBe(0);
  expect(mock.active.size).toBe(0);
});

it('fails disconnected peers and cleans up after an interrupted ramp', async () => {
  const mock = await target('capacity', 'disconnect');
  const report: Record<string, unknown> = {};
  await expect(
    runScenario(
      {
        baseUrl: mock.baseUrl,
        origin: publicOrigin,
        out: 'unused',
        mode: 'capacity',
        idleTtlSeconds: 30,
      },
      report,
      new AbortController().signal,
      () => {},
      timing,
    ),
  ).rejects.toThrow();
  expect(mock.active.size).toBe(0);
  expect(report.workloadPassed).toBeUndefined();
});

it('cleans up acquired sessions when the operator interrupts the ramp', async () => {
  const mock = await target();
  const report: Record<string, unknown> = {};
  const stop = new AbortController();
  await expect(
    runScenario(
      {
        baseUrl: mock.baseUrl,
        origin: publicOrigin,
        out: 'unused',
        mode: 'capacity',
        idleTtlSeconds: 30,
      },
      report,
      stop.signal,
      (event) => {
        if (event === 'active sessions: 3/20') stop.abort();
      },
      timing,
    ),
  ).rejects.toThrow();
  expect(mock.active.size).toBe(0);
  expect(report.cleanupErrors).toEqual([]);
});

it.each(['rate', 'success'] as const)(
  'fails a false capacity result (%s) and cleans all acquired sandboxes',
  async (probe) => {
    const mock = await target(probe);
    const report: Record<string, unknown> = {};
    await expect(
      runScenario(
        {
          baseUrl: mock.baseUrl,
          origin: publicOrigin,
          out: 'unused',
          mode: 'capacity',
          idleTtlSeconds: 30,
        },
        report,
        new AbortController().signal,
        () => {},
        timing,
      ),
    ).rejects.toThrow();
    expect(report.workloadPassed).toBeUndefined();
    expect(mock.active.size).toBe(0);
  },
);
