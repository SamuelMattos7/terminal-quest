import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { MAX_CLIENT_FRAME_BYTES } from '@terminal-quest/shared';
import { guestCookie, makeTestContext } from '../testUtils.js';
import { attempts, events, users } from '../db/schema.js';
import { ResourceLimitError } from '../util/resourceLimits.js';
import { logger } from '../util/logger.js';
import * as auth from '../auth.js';
import { SOCKET_MESSAGES_PER_SECOND } from './socketLimits.js';

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
  const resize = vi.fn(async () => undefined);
  let output!: (chunk: Buffer) => void;
  let shellClosed!: (error?: Error) => void;
  vi.spyOn(app.provider, 'openShell').mockImplementation(async () => ({
    write,
    resize,
    close: vi.fn(),
    onClose: (callback) => {
      shellClosed = callback;
    },
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
  const connect = () => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/sessions/${live.session.id}`, {
      headers: { cookie },
    });
    sockets.push(socket);
    return socket;
  };
  const attach = async (confirmWithPing = true) => {
    const socket = connect();
    const [state] = await once(socket, 'message');
    expect(JSON.parse(String(state))).toMatchObject({ t: 'session_state' });
    if (!confirmWithPing) return socket;
    const pong = new Promise<void>((resolve) => {
      const receive = (frame: WebSocket.RawData) => {
        if (String(frame) !== '{"t":"pong"}') return;
        socket.off('message', receive);
        resolve();
      };
      socket.on('message', receive);
    });
    socket.send(JSON.stringify({ t: 'ping' }));
    await pong;
    return socket;
  };
  return {
    ...ctx,
    live,
    exec,
    write,
    resize,
    errors,
    destroy,
    output: (chunk: Buffer) => output(chunk),
    shellClosed: (error?: Error) => shellClosed(error),
    connect,
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
      vi.spyOn(Date, 'now').mockReturnValue(Date.now());
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

describe('session socket replacement (A15)', () => {
  it('closes the old socket and rejects its queued input without detaching the replacement', async () => {
    const ctx = await setup();
    try {
      const first = await ctx.attach();
      const [oldTransport] = ctx.app.websocketServer.clients;
      if (!oldTransport) throw new Error('server socket missing');
      const close = oldTransport.close.bind(oldTransport);
      vi.spyOn(oldTransport, 'close').mockImplementation((code, reason) => {
        // Simulate queued frames as the replaced transport begins to close.
        oldTransport.emit('message', Buffer.from('{"t":"stdin","d":"stale"}'));
        oldTransport.emit('message', Buffer.from('{"t":"resize","cols":90,"rows":30}'));
        oldTransport.emit('message', Buffer.from('{"t":"hint"}'));
        close(code, reason);
      });
      const closed = once(first, 'close');
      const second = await ctx.attach();
      expect((await closed)[0]).toBe(4409);
      second.send('{"t":"stdin","d":"current"}');
      await vi.waitFor(() => expect(ctx.write.mock.calls).toEqual([['current']]));
      expect(ctx.resize).not.toHaveBeenCalled();
      expect(ctx.live.hints.tiersUsed).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('preserves the message budget when a new socket takes over', async () => {
    const ctx = await setup();
    try {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now());
      const first = await ctx.attach(false);
      const [transport] = ctx.app.websocketServer.clients;
      if (!transport) throw new Error('server socket missing');
      for (let i = 0; i < SOCKET_MESSAGES_PER_SECOND; i++) {
        transport.emit('message', Buffer.from('{"t":"ping"}'));
      }
      const firstClosed = once(first, 'close');
      const second = await ctx.attach(false);
      const secondClosed = once(second, 'close');
      second.send('{"t":"stdin","d":"over budget"}');
      expect((await secondClosed)[0]).toBe(1008);
      expect((await firstClosed)[0]).toBe(4409);
      expect(ctx.write).not.toHaveBeenCalled();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('session runtime errors (A14)', () => {
  it('logs a resize rejection, sends a safe error, and keeps the socket usable', async () => {
    const ctx = await setup();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const err = new Error('private Docker details');
    try {
      const socket = await ctx.attach();
      ctx.resize.mockRejectedValueOnce(err);
      const response = once(socket, 'message');
      socket.send(JSON.stringify({ t: 'resize', cols: 90, rows: 30 }));
      expect(JSON.parse(String((await response)[0]))).toEqual({
        t: 'error',
        message: 'terminal resize failed',
      });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          err,
          attemptId: ctx.live.attemptId,
          levelId: ctx.live.level.id,
          sessionId: ctx.live.session.id,
        }),
        'terminal resize failed',
      );
      const pong = once(socket, 'message');
      socket.send(JSON.stringify({ t: 'ping' }));
      expect(JSON.parse(String((await pong)[0]))).toEqual({ t: 'pong' });
    } finally {
      await ctx.cleanup();
    }
  });

  it('logs attachment failures and closes the socket with a safe reason', async () => {
    const ctx = await setup();
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const err = new Error('private database details');
    vi.spyOn(auth, 'userFromToken').mockRejectedValueOnce(err);
    try {
      const [code, reason] = await once(ctx.connect(), 'close');
      expect([code, String(reason)]).toEqual([1011, 'session connection failed']);
      expect(ctx.live.socket).toBeUndefined();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          err,
          attemptId: ctx.live.attemptId,
          levelId: ctx.live.level.id,
          sessionId: ctx.live.session.id,
        }),
        'session socket attachment failed',
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it.each(['shell', 'cmdlog'])(
    'reports a broken %s stream and abandons the attempt',
    async (source) => {
      const ctx = await setup();
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const err = new Error('private transport details');
      try {
        const socket = await ctx.attach();
        const response = once(socket, 'message');
        const closed = once(socket, 'close');
        if (source === 'shell') ctx.shellClosed(err);
        else ctx.errors[1]?.(err);
        expect(JSON.parse(String((await response)[0]))).toEqual({
          t: 'error',
          message: 'terminal disconnected; start a new attempt',
        });
        await closed;
        expect(ctx.destroy).toHaveBeenCalledTimes(1);
        expect(ctx.db.select().from(attempts).get()?.status).toBe('abandoned');
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            err,
            source,
            attemptId: ctx.live.attemptId,
            levelId: ctx.live.level.id,
            sessionId: ctx.live.session.id,
          }),
          'session runtime failed',
        );
      } finally {
        await ctx.cleanup();
      }
    },
  );

  it('reports a failed evaluation, records file-check timeouts, and permits retry', async () => {
    const ctx = await setup();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const err = new Error('Docker exec inspection failed');
    try {
      const socket = await ctx.attach();
      ctx.exec
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ code: -1, stdout: '', stderr: '', timedOut: true });
      const response = once(socket, 'message');
      socket.send(JSON.stringify({ t: 'check' }));
      expect(JSON.parse(String((await response)[0]))).toEqual({
        t: 'error',
        message: 'evaluation failed',
      });
      const scope = {
        attemptId: ctx.live.attemptId,
        levelId: ctx.live.level.id,
        sessionId: ctx.live.session.id,
      };
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ err, ...scope }),
        'session evaluation failed',
      );
      socket.send(JSON.stringify({ t: 'check' }));
      await vi.waitFor(() => {
        const timeouts = ctx.db
          .select()
          .from(events)
          .all()
          .filter((event) => event.type === 'check_timeout');
        expect(timeouts).toEqual([
          expect.objectContaining({
            attemptId: scope.attemptId,
            levelId: scope.levelId,
            payloadJson: JSON.stringify({ objectiveId: 'did-it', checkType: 'file_exists' }),
          }),
        ]);
      });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ ...scope, checkType: 'file_exists' }),
        'check timed out',
      );
      expect(ctx.live.completed).toBe(false);
      socket.send(JSON.stringify({ t: 'check' }));
      await vi.waitFor(() => expect(ctx.live.completed).toBe(true));
    } finally {
      await ctx.cleanup();
    }
  });
});
