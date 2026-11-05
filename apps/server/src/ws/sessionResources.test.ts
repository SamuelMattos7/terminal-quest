import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { MAX_CLIENT_FRAME_BYTES } from '@terminal-quest/shared';
import { guestCookie, makeTestContext } from '../testUtils.js';
import { attempts, users } from '../db/schema.js';
import { ResourceLimitError } from '../util/resourceLimits.js';

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const ctx = await makeTestContext();
  const { app } = ctx;
  vi.spyOn(app.provider, 'create').mockImplementation(async (spec) => ({ id: randomUUID(), spec }));
  vi.spyOn(app.provider, 'putFiles').mockResolvedValue();
  const exec = vi
    .spyOn(app.provider, 'exec')
    .mockResolvedValue({ code: 0, stdout: '', stderr: '', timedOut: false });
  const write = vi.fn();
  let output!: (chunk: Buffer) => void;
  vi.spyOn(app.provider, 'openShell').mockImplementation(async () => ({
    write,
    resize: vi.fn(),
    close: vi.fn(),
    onClose: vi.fn(),
    onData: (callback) => {
      output = callback;
    },
  }));
  const errors: ((err: Error) => void)[] = [];
  vi.spyOn(app.provider, 'watchFile').mockImplementation(async (_h, _path, _onLine, onError) => {
    if (onError) errors.push(onError);
    return { stop: vi.fn() };
  });
  const destroy = vi.spyOn(app.provider, 'destroy').mockResolvedValue();
  const cookie = await guestCookie(app);
  await app.inject({ method: 'POST', url: '/api/levels/w1-01-first/start', headers: { cookie } });
  const live = [...app.live.values()][0];
  if (!live) throw new Error('session missing');
  const sockets: WebSocket[] = [];
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address !== 'object') throw new Error('server did not bind');
  const attach = async () => {
    // Detach the old adapter first so this readiness assertion cannot
    // accidentally accept a previous attachment during async auth.
    live.socket = undefined;
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/sessions/${live.session.id}`, {
      headers: { cookie },
    });
    sockets.push(socket);
    await once(socket, 'open');
    await vi.waitFor(() => expect(live.socket).toBeDefined());
    const pong = once(socket, 'message');
    socket.send(JSON.stringify({ t: 'ping' }));
    await pong;
    return socket;
  };
  return {
    ...ctx,
    live,
    exec,
    write,
    errors,
    destroy,
    output: (chunk: Buffer) => output(chunk),
    attach,
    cleanup: async () => {
      for (const socket of sockets) socket.terminate();
      await ctx.cleanup();
    },
  };
}

describe('session resource boundaries (A03)', () => {
  it.each(['single', 'fragmented', 'utf8'] as const)(
    'rejects oversized %s messages at the WebSocket transport',
    async (kind) => {
      const ctx = await setup();
      try {
        expect(ctx.app.websocketServer.options.maxPayload).toBe(MAX_CLIENT_FRAME_BYTES);
        const socket = await ctx.attach();
        const closed = once(socket, 'close');
        const payload = JSON.stringify({
          t: 'stdin',
          d: kind === 'utf8' ? 'é'.repeat(8192) : 'x'.repeat(16384),
        });
        if (kind === 'fragmented') {
          socket.send(payload.slice(0, 8000), { fin: false });
          socket.send(payload.slice(8000), { fin: true });
        } else socket.send(payload);
        expect((await closed)[0]).toBe(1009);
        expect(ctx.write).not.toHaveBeenCalled();
      } finally {
        await ctx.cleanup();
      }
    },
  );

  it('rate limits all message types, including malformed messages', async () => {
    const ctx = await setup();
    try {
      const socket = await ctx.attach();
      const closed = once(socket, 'close');
      for (let i = 0; i < 129; i++) socket.send('{');
      expect((await closed)[0]).toBe(1008);
      expect(ctx.write).not.toHaveBeenCalled();
      expect(ctx.exec).toHaveBeenCalledTimes(1); // setup only
    } finally {
      await ctx.cleanup();
    }
  });

  it('preserves the stdin byte budget after reconnecting', async () => {
    const ctx = await setup();
    try {
      const first = await ctx.attach();
      for (let i = 0; i < 8; i++) first.send(JSON.stringify({ t: 'stdin', d: 'é'.repeat(4096) }));
      await vi.waitFor(() => expect(ctx.write).toHaveBeenCalledTimes(8));
      const second = await ctx.attach();
      const response = once(second, 'message');
      second.send(JSON.stringify({ t: 'stdin', d: 'x' }));
      expect(JSON.parse(String((await response)[0]))).toMatchObject({
        t: 'error',
        message: 'stdin rate exceeded',
      });
      expect(ctx.write).toHaveBeenCalledTimes(8);
    } finally {
      await ctx.cleanup();
    }
  });

  it('abandons and destroys a terminal-output flood without crediting it', async () => {
    const ctx = await setup();
    try {
      for (let i = 0; i < 17; i++) ctx.output(Buffer.alloc(64 * 1024));
      expect(ctx.live.closed).toBe(true);
      await vi.waitFor(() => expect(ctx.destroy).toHaveBeenCalledTimes(1));
      expect(ctx.app.live.size).toBe(0);
      expect(ctx.db.select().from(attempts).get()?.status).toBe('abandoned');
      expect(ctx.db.select().from(users).get()?.xp).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });

  it.each([0, 1])(
    'abandons on watcher %i overflow, once even if both watchers fail',
    async (index) => {
      const ctx = await setup();
      try {
        ctx.errors[index]?.(new ResourceLimitError('watch bytes'));
        ctx.errors[1 - index]?.(new ResourceLimitError('watch bytes'));
        expect(ctx.live.closed).toBe(true);
        await vi.waitFor(() => expect(ctx.destroy).toHaveBeenCalledTimes(1));
        expect(ctx.db.select().from(attempts).get()?.status).toBe('abandoned');
        expect(ctx.app.live.size).toBe(0);
      } finally {
        await ctx.cleanup();
      }
    },
  );
});
