import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { expect, vi } from 'vitest';
import WebSocket from 'ws';
import { guestCookie, makeTestContext } from '../testUtils.js';

export async function setupSessionSocket() {
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
  const lines = new Map<string, (line: string) => void>();
  vi.spyOn(app.provider, 'watchFile').mockImplementation(async (_h, path, onLine, onError) => {
    lines.set(path, onLine);
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
  const connect = (
    query = '',
    headers: Record<string, string> = { cookie, Origin: 'http://localhost:5173' },
  ) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws/sessions/${live.session.id}${query}`,
      {
        headers,
      },
    );
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
    cookie,
    live,
    exec,
    write,
    resize,
    errors,
    destroy,
    lines,
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
