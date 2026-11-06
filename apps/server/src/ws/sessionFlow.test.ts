import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerMessageSchema } from '@terminal-quest/shared';
import { attempts, badges, events, levelProgress, skillProgress, users } from '../db/schema.js';
import { deferred, guestCookie, makeLevel, makeTestContext } from '../testUtils.js';
import type { ExecResult } from '../sandbox/provider.js';
import { noteCommand } from '../engine/objectiveTracker.js';
import { closeLiveSession, evaluateAndReport, requestHint, type FlowDeps } from './sessionFlow.js';
import * as review from '../progression/review.js';
import { HINT_NUDGE_TEXT, STUCK_MS } from '../progression/dialogue.js';

afterEach(() => vi.restoreAllMocks());

function useHintAndCommands(ctx: Awaited<ReturnType<typeof setup>>) {
  requestHint(ctx.deps, ctx.live);
  for (const command of ['ls --help', 'tux hint', 'pwd']) {
    noteCommand(ctx.live.tracker, { command, exitCode: 0, cwd: '/home/player', epoch: 1 });
  }
}

async function setup(levels = [makeLevel('a', 1, 1)]) {
  const ctx = await makeTestContext(levels);
  const { app } = ctx;
  vi.spyOn(app.provider, 'create').mockImplementation(async (spec) => ({ id: randomUUID(), spec }));
  vi.spyOn(app.provider, 'putFiles').mockResolvedValue();
  const exec = vi
    .spyOn(app.provider, 'exec')
    .mockResolvedValue({ code: 0, stdout: '', stderr: '', timedOut: false });
  vi.spyOn(app.provider, 'openShell').mockImplementation(async () => ({
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn(),
    close: vi.fn(),
  }));
  const watchers = new Map<string, (line: string) => void>();
  vi.spyOn(app.provider, 'watchFile').mockImplementation(async (_handle, path, onLine) => {
    watchers.set(path, onLine);
    return { stop: vi.fn() };
  });
  const destroy = vi.spyOn(app.provider, 'destroy').mockResolvedValue();
  const cookie = await guestCookie(app);
  expect(
    (await app.inject({ method: 'POST', url: '/api/levels/w1-01-a/start', headers: { cookie } }))
      .statusCode,
  ).toBe(200);
  const live = [...app.live.values()][0];
  if (!live) throw new Error('session missing');
  const send = vi.fn();
  live.socket = { send, close: vi.fn() };
  const deps: FlowDeps = {
    provider: app.provider,
    manager: app.manager,
    live: app.live,
    db: ctx.db,
    coachRules: app.coachRules,
    badgeList: app.badgeList,
    skills: app.levels.skills,
    levelsByWorld: app.levels.byWorld,
    levelsById: app.levels.byId,
    unlockAll: false,
    enabledWorlds: app.config.ENABLE_WORLDS,
  };
  const pause = async () => {
    const entered = deferred();
    const gate = deferred<ExecResult>();
    exec.mockImplementationOnce(async () => {
      entered.resolve();
      return gate.promise;
    });
    const pending = evaluateAndReport(deps, live);
    await entered.promise;
    return { pending, gate };
  };
  return { ...ctx, live, deps, exec, destroy, cookie, send, pause, watchers };
}

it.each(['wait', 'progress', 'close'] as const)(
  'handles an armed idle nudge when the player chooses to %s (A24)',
  async (action) => {
    const fixture = makeLevel('a', 1, 1);
    fixture.level.objectives = [
      { id: 'pwd', text: 'Run pwd.', check: { type: 'command_used', regex: '^pwd$' } },
      { id: 'ls', text: 'Run ls.', check: { type: 'command_used', regex: '^ls$' } },
    ];
    const ctx = await setup([fixture]);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(ctx.live.dialogue.lastProgressAt);
    const command = ctx.watchers.get('/run/tq/cmdlog')!;
    const nudgeCount = () =>
      ctx.send.mock.calls.filter(
        ([payload]) => payload === JSON.stringify({ t: 'tux', text: HINT_NUDGE_TEXT }),
      ).length;
    try {
      for (let i = 1; i <= 3; i += 1) command(`${i}\t1\t/home/player\tfalse`);
      await vi.advanceTimersByTimeAsync(STUCK_MS - 1);
      expect(nudgeCount()).toBe(0);
      if (action === 'progress') command('4\t0\t/home/player\tpwd');
      if (action === 'close') await closeLiveSession(ctx.deps, ctx.live, 'abandoned');
      await vi.advanceTimersByTimeAsync(1);
      expect(nudgeCount()).toBe(action === 'wait' ? 1 : 0);
      await vi.advanceTimersByTimeAsync(STUCK_MS);
      expect(nudgeCount()).toBe(action === 'wait' ? 1 : 0);
    } finally {
      vi.useRealTimers();
      await ctx.cleanup();
    }
  },
);

it('reports a required hold file as pending after deletion and done after recreation (A17)', async () => {
  const fixture = makeLevel('a', 1, 1);
  fixture.level.objectives = [
    {
      id: 'keep-file',
      text: 'Keep important.txt.',
      hold: true,
      check: { type: 'file_exists', path: '/home/player/important.txt', kind: 'file' },
    },
    { id: 'ran-pwd', text: 'Run pwd.', check: { type: 'command_used', regex: '^pwd$' } },
  ];
  const ctx = await setup([fixture]);
  const dir = mkdtempSync(join(tmpdir(), 'tq-hold-'));
  const file = join(dir, 'important.txt');
  const check = () => evaluateAndReport(ctx.deps, ctx.live);
  const holdUpdates = () =>
    ctx.send.mock.calls
      .map(([payload]) => ServerMessageSchema.parse(JSON.parse(String(payload))))
      .flatMap((frame) =>
        frame.t === 'objective' && frame.id === 'keep-file' ? [frame.status] : [],
      );
  try {
    // The sandbox's file probe reads the fixture file without starting Docker.
    ctx.exec.mockImplementation(async () => ({
      code: existsSync(file) ? 0 : 1,
      stdout: '',
      stderr: '',
      timedOut: false,
    }));
    writeFileSync(file, 'keep me');
    await check();
    expect(holdUpdates()).toEqual(['done']);

    rmSync(file);
    await check();
    await check();
    expect(holdUpdates()).toEqual(['done', 'pending']);
    expect(ctx.live.completed).toBe(false);

    writeFileSync(file, 'restored');
    await check();
    expect(holdUpdates()).toEqual(['done', 'pending', 'done']);
    expect(ctx.live.completed).toBe(false);

    noteCommand(ctx.live.tracker, { command: 'pwd', exitCode: 0, cwd: '/home/player', epoch: 1 });
    await check();
    expect(ctx.live.completed).toBe(true);
  } finally {
    rmSync(file, { force: true });
    rmdirSync(dir);
    await ctx.cleanup();
  }
});

it('omits a disabled next world from the completion payload (A10)', async () => {
  const ctx = await setup([makeLevel('a', 1, 1, 'boss'), makeLevel('a', 2, 1)]);
  try {
    ctx.app.config.ENABLE_WORLDS.splice(1, 1);
    await evaluateAndReport(ctx.deps, ctx.live);
    const messages = ctx.send.mock.calls.map(([payload]) => JSON.parse(String(payload)) as unknown);
    expect(messages).toContainEqual(
      expect.objectContaining({
        t: 'level_complete',
        result: expect.objectContaining({ unlocked: [] }),
      }),
    );
  } finally {
    await ctx.cleanup();
  }
});

describe('completion lifecycle races (A02/A13)', () => {
  it('coalesces a flood into one running evaluation plus one rerun (A03)', async () => {
    const ctx = await setup();
    const paused = await ctx.pause();
    try {
      const requests = Array.from({ length: 1000 }, () => evaluateAndReport(ctx.deps, ctx.live));
      expect(new Set(requests).size).toBe(1);
      ctx.exec.mockResolvedValue({ code: 1, stdout: '', stderr: '', timedOut: false });
      paused.gate.resolve({ code: 1, stdout: '', stderr: '', timedOut: false });
      await Promise.all([paused.pending, ...requests]);
      expect(ctx.exec).toHaveBeenCalledTimes(3); // setup + running + single rerun
    } finally {
      paused.gate.resolve({ code: 1, stdout: '', stderr: '', timedOut: false });
      await paused.pending;
      await ctx.cleanup();
    }
  });

  it.each(['abandon', 'reset', 'progress', 'shutdown'] as const)(
    'ignores running and queued checks after %s',
    async (action) => {
      const ctx = await setup();
      const paused = await ctx.pause();
      const queued = evaluateAndReport(ctx.deps, ctx.live);
      try {
        useHintAndCommands(ctx);
        if (action === 'shutdown') await ctx.app.close();
        else {
          const url =
            action === 'progress'
              ? '/api/progress'
              : `/api/sessions/${ctx.live.session.id}${action === 'reset' ? '/reset' : ''}`;
          expect(
            (
              await ctx.app.inject({
                method: action === 'reset' ? 'POST' : 'DELETE',
                url,
                headers: { cookie: ctx.cookie },
              })
            ).statusCode,
          ).toBe(200);
        }
        paused.gate.resolve({ code: 0, stdout: '', stderr: '', timedOut: false });
        await Promise.all([paused.pending, queued]);
        expect(ctx.live.completed).toBe(false);
        expect(ctx.db.select().from(users).get()?.xp).toBe(0);
        expect(ctx.db.select().from(levelProgress).all()).toEqual([]);
        expect(ctx.db.select().from(skillProgress).all()).toEqual([]);
        expect(ctx.db.select().from(badges).all()).toEqual([]);
        expect(
          ctx.db
            .select()
            .from(attempts)
            .all()
            .find((a) => a.id === ctx.live.attemptId),
        ).toEqual(
          action === 'progress'
            ? undefined
            : expect.objectContaining({
                status: 'abandoned',
                hintsUsed: 1,
                hintTiersJson: '[1]',
                commandsCount: 2,
                usedManual: 1,
              }),
        );
        expect(
          ctx.db
            .select()
            .from(events)
            .all()
            .filter((e) => ['level_complete', 'objective_complete'].includes(e.type)),
        ).toEqual([]);
        expect(ctx.exec).toHaveBeenCalledTimes(action === 'reset' ? 3 : 2);
        requestHint(ctx.deps, ctx.live);
        expect(ctx.live.hints.tiersUsed).toEqual([1]);
      } finally {
        paused.gate.resolve({ code: 0, stdout: '', stderr: '', timedOut: false });
        await Promise.allSettled([paused.pending, queued]);
        await ctx.cleanup();
      }
    },
  );

  it.each(['idle', 'max_age'] as const)(
    'invalidates %s expiry before slow container destruction finishes',
    async (reason) => {
      const ctx = await setup();
      const paused = await ctx.pause();
      useHintAndCommands(ctx);
      const entered = deferred();
      const destroyGate = deferred();
      ctx.destroy.mockImplementationOnce(async () => {
        entered.resolve();
        await destroyGate.promise;
      });
      const at =
        ctx.live.session.createdAt +
        (reason === 'idle' ? ctx.app.config.IDLE_TTL_SECONDS : ctx.app.config.MAX_AGE_SECONDS) *
          1000;
      const sweep = ctx.app.manager.sweepOnce(at);
      await entered.promise;
      try {
        paused.gate.resolve({ code: 0, stdout: '', stderr: '', timedOut: false });
        await paused.pending;
        destroyGate.resolve();
        await sweep;
        expect(ctx.db.select().from(attempts).get()).toMatchObject({
          status: 'expired',
          hintsUsed: 1,
          hintTiersJson: '[1]',
          commandsCount: 2,
          usedManual: 1,
        });
        expect(ctx.db.select().from(users).get()?.xp).toBe(0);
        expect(ctx.db.select().from(levelProgress).all()).toEqual([]);
        expect(ctx.live.completed).toBe(false);
        expect(
          ctx.send.mock.calls.some(([payload]) => String(payload).includes('level_complete')),
        ).toBe(false);
      } finally {
        paused.gate.resolve({ code: 0, stdout: '', stderr: '', timedOut: false });
        destroyGate.resolve();
        await Promise.allSettled([paused.pending, sweep]);
        await ctx.cleanup();
      }
    },
  );

  it('retries completion after persistence fails without falsely marking it completed', async () => {
    const ctx = await setup();
    try {
      ctx.db.$client.exec(
        "CREATE TRIGGER fail_xp BEFORE UPDATE OF xp ON users BEGIN SELECT RAISE(ABORT, 'xp write failed'); END",
      );
      await expect(evaluateAndReport(ctx.deps, ctx.live)).rejects.toThrow('xp write failed');
      expect(ctx.live.completed).toBe(false);
      expect(ctx.live.attemptFinished).toBe(false);
      expect(ctx.db.select().from(attempts).get()?.status).toBe('active');
      ctx.db.$client.exec('DROP TRIGGER fail_xp');
      await evaluateAndReport(ctx.deps, ctx.live);
      expect(ctx.live.completed).toBe(true);
      expect(ctx.db.select().from(users).get()?.xp).toBe(55);
      expect(ctx.db.select().from(levelProgress).get()?.completions).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });

  it.each(['progress', 'expiry'] as const)(
    'synchronizes %s with the final completion reads',
    async (action) => {
      const ctx = await setup();
      const entered = deferred();
      const gate = deferred<boolean>();
      vi.spyOn(review, 'wasReviewDue').mockImplementationOnce(async () => {
        entered.resolve();
        return gate.promise;
      });
      const pending = evaluateAndReport(ctx.deps, ctx.live);
      await entered.promise;
      const closing =
        action === 'progress'
          ? ctx.app
              .inject({ method: 'DELETE', url: '/api/progress', headers: { cookie: ctx.cookie } })
              .then((r) => r)
          : ctx.app.manager.sweepOnce(
              ctx.live.session.createdAt + ctx.app.config.MAX_AGE_SECONDS * 1000,
            );
      try {
        if (action === 'expiry') await closing;
        gate.resolve(false);
        await Promise.all([pending, closing]);
        expect(ctx.db.select().from(users).get()?.xp).toBe(0);
        expect(ctx.db.select().from(levelProgress).all()).toEqual([]);
        expect(ctx.db.select().from(skillProgress).all()).toEqual([]);
        expect(ctx.db.select().from(attempts).get()?.status).toBe(
          action === 'expiry' ? 'expired' : undefined,
        );
      } finally {
        gate.resolve(false);
        await Promise.allSettled([pending, closing]);
        await ctx.cleanup();
      }
    },
  );

  it('ignores late check timeouts even after shutdown closes the database', async () => {
    const ctx = await setup();
    const paused = await ctx.pause();
    try {
      await ctx.cleanup();
    } finally {
      paused.gate.resolve({ code: -1, stdout: '', stderr: '', timedOut: true });
      await expect(paused.pending).resolves.toBeUndefined();
    }
  });
});

it.each([true, false])(
  'evaluates Clean Sweep after an abandoned attempt (hint used: %s)',
  async (hinted) => {
    const ctx = await setup();
    try {
      ctx.deps.badgeList.push({
        id: 'no-hints-world',
        title: 'Clean Sweep',
        description: 'Finish a world with 0 hints used.',
        rule: 'no-hints-world',
      });
      if (hinted) {
        requestHint(ctx.deps, ctx.live);
        expect(ctx.db.select().from(attempts).get()).toMatchObject({
          status: 'active',
          hintsUsed: 1,
        });
      }
      await closeLiveSession(ctx.deps, ctx.live, 'abandoned');
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/levels/w1-01-a/start',
        headers: { cookie: ctx.cookie },
      });
      expect(response.statusCode).toBe(200);
      const retry = [...ctx.app.live.values()][0];
      if (retry === undefined) throw new Error('retry session missing');
      await evaluateAndReport(ctx.deps, retry);
      expect(
        ctx.db
          .select()
          .from(attempts)
          .all()
          .map((a) => a.status),
      ).toEqual(['abandoned', 'completed']);
      expect(
        ctx.db
          .select()
          .from(badges)
          .all()
          .map((b) => b.badgeId),
      ).toEqual(hinted ? [] : ['no-hints-world']);
    } finally {
      await ctx.cleanup();
    }
  },
);
