import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { guestCookie } from '../testUtils.js';
import { setupSessionSocket } from './sessionSocketFixture.js';
import { CheckSchema, PublicLevelSchema } from '@terminal-quest/shared';
import { events, attempts } from '../db/schema.js';
import { logger } from '../util/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('sends only the public level in the initial socket state, with hints withheld (T9.1)', async () => {
  const ctx = await setupSessionSocket();
  try {
    ctx.live.level.hints = ['PRIVATE_HINT_A', 'PRIVATE_HINT_B', 'PRIVATE_HINT_C'];
    ctx.live.level.objectives[0]!.check = CheckSchema.parse({
      type: 'answer_equals',
      value: 'PRIVATE_EXPECTED',
    });
    Object.assign(ctx.live.level, {
      future_private_field: 'PRIVATE_FUTURE',
      setup: { commands: ['PRIVATE_SETUP'] },
      solutions: { reference: 'PRIVATE_SOLUTION' },
    });
    const socket = ctx.connect();
    const [raw] = await once(socket, 'message');
    const body = JSON.parse(String(raw)) as { t: string; level: unknown };
    expect(body.t).toBe('session_state');
    expect(PublicLevelSchema.parse(body.level)).toEqual(body.level);
    expect(String(raw)).not.toContain('PRIVATE_');
    const hint = new Promise<string>((resolve) => {
      socket.on('message', (frame) => {
        if (String(frame).includes('"t":"hint"')) resolve(String(frame));
      });
    });
    socket.send('{"t":"hint"}');
    expect(JSON.parse(await hint)).toMatchObject({ t: 'hint', tier: 1, text: 'PRIVATE_HINT_A' });
  } finally {
    await ctx.cleanup();
  }
});

it.each(['0', '1'])(
  'keeps player content out of telemetry and logs with LOG_COMMANDS=%s (T9.1)',
  async (flag) => {
    vi.stubEnv('LOG_COMMANDS', flag);
    const ctx = await setupSessionSocket();
    const logs = (['info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(logger, method).mockImplementation(() => undefined),
    );
    const marker = 'PRIVATE_PLAYER_CONTENT_9f403';
    try {
      await ctx.attach();
      ctx.output(Buffer.from(marker));
      ctx.lines.get('/run/tq/cmdlog')?.(`1\t0\t/home/player\techo ${marker}`);
      ctx.lines.get('/run/tq/inbox')?.(JSON.stringify({ cmd: 'submit', text: marker }));
      expect(ctx.live.tracker.commands.some((entry) => entry.command.includes(marker))).toBe(true);
      expect(ctx.live.tracker.answers).toContain(marker);
      await vi.waitFor(() => expect(ctx.live.completed).toBe(true));
      expect(JSON.stringify(ctx.db.select().from(events).all())).not.toContain(marker);
      expect(JSON.stringify(ctx.db.select().from(attempts).all())).not.toContain(marker);
      expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toContain(marker);
    } finally {
      await ctx.cleanup();
    }
  },
);

it.each([
  undefined,
  'null',
  'http://evil.test',
  'http://localhost:5173.evil.test',
  'http://localhost:5174',
])('rejects WebSocket origin %j before attaching or replacing a socket (T9.1)', async (origin) => {
  const ctx = await setupSessionSocket();
  try {
    await ctx.attach();
    const owner = ctx.live.socket;
    const headers: Record<string, string> = { cookie: ctx.cookie };
    if (origin !== undefined) headers['Origin'] = origin;
    const denied = ctx.connect('', headers);
    const messages: unknown[] = [];
    denied.on('message', (frame) => messages.push(String(frame)));
    const code = await Promise.race([
      once(denied, 'close').then(([code]: unknown[]) => code),
      once(denied, 'message').then(() => 'attached'),
    ]);
    expect(code).toBe(4403);
    expect(messages).toEqual([]);
    expect(ctx.live.socket).toBe(owner);
    expect(ctx.write).not.toHaveBeenCalled();
  } finally {
    await ctx.cleanup();
  }
});

it('rejects a foreign cookie with a valid origin before streaming private session data (T9.1)', async () => {
  const ctx = await setupSessionSocket();
  try {
    await ctx.attach();
    const owner = ctx.live.socket;
    const cookie = await guestCookie(ctx.app);
    const denied = ctx.connect('', { cookie, Origin: 'http://localhost:5173' });
    const messages: unknown[] = [];
    denied.on('message', (frame) => messages.push(String(frame)));
    const [code] = await once(denied, 'close');
    expect(code).toBe(4401);
    expect(messages).toEqual([]);
    expect(ctx.live.socket).toBe(owner);
  } finally {
    await ctx.cleanup();
  }
});
