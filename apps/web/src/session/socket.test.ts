import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSocket, type SessionEvent } from './socket.js';

/** Minimal scriptable WebSocket stand-in. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState !== 3) {
      this.readyState = 3;
      this.emit('close', { code: 1000 });
    }
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(data: string): void {
    this.emit('message', { data });
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.emit('close', { code });
  }

  private emit(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }
  }
}

function setup(): { events: SessionEvent[]; socket: SessionSocket } {
  const events: SessionEvent[] = [];
  const socket = new SessionSocket('/ws/sessions/s1', (e) => events.push(e), {
    createSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket,
  });
  return { events, socket };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionSocket', () => {
  it('emits open and sends serialized client messages while open', () => {
    const { events, socket } = setup();
    socket.connect();
    const ws = FakeWebSocket.instances[0] as FakeWebSocket;
    expect(ws.url).toBe('/ws/sessions/s1');
    ws.open();
    expect(events).toEqual([{ kind: 'open' }]);
    socket.send({ t: 'stdin', d: 'pwd\n' });
    socket.send({ t: 'resize', cols: 80, rows: 24 });
    expect(ws.sent).toEqual([
      JSON.stringify({ t: 'stdin', d: 'pwd\n' }),
      JSON.stringify({ t: 'resize', cols: 80, rows: 24 }),
    ]);
  });

  it('drops outbound messages while the socket is not open', () => {
    const { socket } = setup();
    socket.connect();
    socket.send({ t: 'ping' });
    expect(FakeWebSocket.instances[0]?.sent).toEqual([]);
  });

  it('dispatches parsed server messages and ignores bad frames', () => {
    const { events, socket } = setup();
    socket.connect();
    const ws = FakeWebSocket.instances[0] as FakeWebSocket;
    ws.open();
    events.length = 0;
    ws.receive(JSON.stringify({ t: 'stdout', d: 'hi' }));
    ws.receive('not json');
    ws.receive(JSON.stringify({ t: 'bogus' }));
    ws.receive(JSON.stringify({ t: 'objective', id: 'o1', status: 'done' }));
    expect(events).toEqual([
      { kind: 'message', message: { t: 'stdout', d: 'hi' } },
      { kind: 'message', message: { t: 'objective', id: 'o1', status: 'done' } },
    ]);
  });

  it('reconnects with backoff after an abnormal close and resets on open', () => {
    const { events, socket } = setup();
    socket.connect();
    const first = FakeWebSocket.instances[0] as FakeWebSocket;
    first.open();
    events.length = 0;
    first.drop(1006);
    expect(events).toEqual([{ kind: 'reconnecting', attempt: 1 }]);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1] as FakeWebSocket;
    second.open();
    expect(events.at(-1)).toEqual({ kind: 'open' });
    // Counter reset: the next drop starts at attempt 1 again.
    events.length = 0;
    second.drop(1006);
    expect(events).toEqual([{ kind: 'reconnecting', attempt: 1 }]);
  });

  it('gives up after three failed reconnects', () => {
    const { events, socket } = setup();
    socket.connect();
    (FakeWebSocket.instances[0] as FakeWebSocket).open();
    events.length = 0;
    for (let i = 0; i < 3; i += 1) {
      const current = FakeWebSocket.instances.at(-1) as FakeWebSocket;
      current.drop(1006);
      vi.advanceTimersByTime(5000);
    }
    const attempts = events.filter((e) => e.kind === 'reconnecting');
    expect(attempts.map((e) => (e.kind === 'reconnecting' ? e.attempt : 0))).toEqual([1, 2, 3]);
    (FakeWebSocket.instances.at(-1) as FakeWebSocket).drop(1006);
    expect(events.at(-1)).toEqual({ kind: 'closed', code: 1006, gaveUp: true });
    expect(FakeWebSocket.instances).toHaveLength(4);
    vi.advanceTimersByTime(30000);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('never reconnects on 4401/4403 closes', () => {
    for (const code of [4401, 4403]) {
      FakeWebSocket.instances = [];
      const { events, socket } = setup();
      socket.connect();
      (FakeWebSocket.instances[0] as FakeWebSocket).open();
      events.length = 0;
      (FakeWebSocket.instances[0] as FakeWebSocket).drop(code);
      expect(events).toEqual([{ kind: 'closed', code, gaveUp: false }]);
      vi.advanceTimersByTime(30000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    }
  });

  it('close() on a live socket shuts down without reconnecting', () => {
    const { events, socket } = setup();
    socket.connect();
    (FakeWebSocket.instances[0] as FakeWebSocket).open();
    events.length = 0;
    socket.close();
    expect(events).toEqual([{ kind: 'closed', code: 1000, gaveUp: false }]);
    vi.advanceTimersByTime(30000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('close() cancels a pending reconnect', () => {
    const { events, socket } = setup();
    socket.connect();
    const ws = FakeWebSocket.instances[0] as FakeWebSocket;
    ws.open();
    events.length = 0;
    ws.drop(1006);
    expect(events).toEqual([{ kind: 'reconnecting', attempt: 1 }]);
    socket.close();
    vi.advanceTimersByTime(30000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
