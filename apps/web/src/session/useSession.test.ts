import type { ServerMessage } from '@terminal-quest/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client.js';
import type { SessionEventHandler } from './socket.js';
import { useSession } from './useSession.js';

const socketMocks = vi.hoisted(() => ({ instances: [] as Array<MockSessionSocket> }));

interface MockSessionSocket {
  url: string;
  handler: SessionEventHandler;
  connect: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

vi.mock('./socket.js', () => {
  class MockSocket implements MockSessionSocket {
    url: string;
    handler: SessionEventHandler;
    connect = vi.fn();
    send = vi.fn();
    close = vi.fn();

    constructor(url: string, handler: SessionEventHandler) {
      this.url = url;
      this.handler = handler;
      socketMocks.instances.push(this);
    }
  }
  return {
    SessionSocket: MockSocket,
    MAX_RECONNECT_ATTEMPTS: 3,
  };
});

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: {
      startLevel: vi.fn(),
      resetSession: vi.fn(),
      deleteSession: vi.fn(),
    },
  };
});

function lastSocket(): MockSessionSocket {
  const socket = socketMocks.instances.at(-1);
  if (socket === undefined) {
    throw new Error('no socket created');
  }
  return socket;
}

function sessionStateMessage(): ServerMessage {
  return {
    t: 'session_state',
    level: {
      id: 'w1-02-where-am-i',
      title: 'Where Am I?',
      story: 'Find yourself.',
      kind: 'lesson',
      objectives: [{ id: 'o1', text: 'Print the path', optional: false, bonus: false }],
      teaches: ['pwd'],
      parCommands: 3,
      xp: 50,
      hintCount: 3,
    },
    objectives: [{ id: 'o1', status: 'pending' }],
    hintsUsed: 0,
    hintsTotal: 3,
    completed: false,
  };
}

async function startLive(): Promise<MockSessionSocket> {
  vi.mocked(api.startLevel).mockResolvedValue({ sessionId: 's1', wsPath: '/ws/sessions/s1' });
  await useSession.getState().start('w1-02-where-am-i');
  const socket = lastSocket();
  socket.handler({ kind: 'open' });
  socket.handler({ kind: 'message', message: sessionStateMessage() });
  return socket;
}

beforeEach(() => {
  socketMocks.instances = [];
  useSession.getState().disconnect();
  vi.mocked(api.startLevel).mockReset();
  vi.mocked(api.resetSession).mockReset();
  vi.mocked(api.deleteSession).mockReset().mockResolvedValue({ ok: true });
});

describe('useSession', () => {
  it('starts a level: API call, socket connect, state on open', async () => {
    vi.mocked(api.startLevel).mockResolvedValue({ sessionId: 's1', wsPath: '/ws/sessions/s1' });
    await useSession.getState().start('w1-02-where-am-i');
    expect(api.startLevel).toHaveBeenCalledWith('w1-02-where-am-i');
    const socket = lastSocket();
    expect(socket.url).toBe('ws://localhost:3000/ws/sessions/s1');
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(useSession.getState().status).toBe('starting');
    socket.handler({ kind: 'open' });
    expect(useSession.getState().status).toBe('live');
    socket.handler({ kind: 'message', message: sessionStateMessage() });
    expect(useSession.getState().level?.id).toBe('w1-02-where-am-i');
    expect(useSession.getState().objectives).toEqual([{ id: 'o1', status: 'pending' }]);
  });

  it('routes stdout to the registered writer and stdin/resize to the socket', async () => {
    const socket = await startLive();
    const written: string[] = [];
    useSession.getState().setStdoutWriter((d) => written.push(d));
    socket.handler({ kind: 'message', message: { t: 'stdout', d: 'hi' } });
    expect(written).toEqual(['hi']);
    useSession.getState().sendStdin('pwd\n');
    useSession.getState().sendResize(100, 30);
    expect(socket.send).toHaveBeenCalledWith({ t: 'stdin', d: 'pwd\n' });
    expect(socket.send).toHaveBeenCalledWith({ t: 'resize', cols: 100, rows: 30 });
    useSession.getState().sendStdin('');
    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  it('tracks objectives, hints, toasts, and completion', async () => {
    const socket = await startLive();
    socket.handler({ kind: 'message', message: { t: 'objective', id: 'o1', status: 'done' } });
    expect(useSession.getState().objectives).toEqual([{ id: 'o1', status: 'done' }]);
    socket.handler({
      kind: 'message',
      message: { t: 'hint', tier: 1, text: 'try pwd', penaltyPct: 5 },
    });
    expect(useSession.getState().hints).toHaveLength(1);
    expect(useSession.getState().hintsUsed).toBe(1);
    socket.handler({ kind: 'message', message: { t: 'tux', text: 'hello' } });
    socket.handler({ kind: 'message', message: { t: 'coach', text: 'tip' } });
    expect(useSession.getState().toasts.map((t) => t.kind)).toEqual(['tux', 'coach']);
    const result: Extract<ServerMessage, { t: 'level_complete' }>['result'] = {
      xp: 55,
      rank: 'S',
      breakdown: [{ label: 'base', xp: 50 }],
      newBadges: [],
      unlocked: ['w1-03-moving-around'],
      explain: [],
      skillsGained: ['pwd'],
    };
    socket.handler({ kind: 'message', message: { t: 'level_complete', result } });
    expect(useSession.getState().status).toBe('completed');
    expect(useSession.getState().completion?.rank).toBe('S');
  });

  it('closing from the server stops the socket and records the reason', async () => {
    const socket = await startLive();
    socket.handler({ kind: 'message', message: { t: 'closing', reason: 'idle' } });
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(useSession.getState().status).toBe('closed');
    expect(useSession.getState().closeReason).toBe('idle');
  });

  it('surfaces reconnect attempts and give-up closes', async () => {
    const socket = await startLive();
    socket.handler({ kind: 'reconnecting', attempt: 2 });
    expect(useSession.getState().status).toBe('reconnecting');
    expect(useSession.getState().reconnectAttempt).toBe(2);
    socket.handler({ kind: 'closed', code: 1006, gaveUp: true });
    expect(useSession.getState().status).toBe('closed');
    expect(useSession.getState().closeReason).toBe('connection lost');
  });

  it('reset() opens a fresh session and clears completion', async () => {
    await startLive();
    vi.mocked(api.resetSession).mockResolvedValue({ sessionId: 's2', wsPath: '/ws/sessions/s2' });
    await useSession.getState().reset();
    expect(api.resetSession).toHaveBeenCalledWith('s1');
    const fresh = lastSocket();
    expect(fresh.url).toBe('ws://localhost:3000/ws/sessions/s2');
    expect(useSession.getState().sessionId).toBe('s2');
  });

  it('ignores events from a superseded socket', async () => {
    vi.mocked(api.startLevel)
      .mockResolvedValueOnce({ sessionId: 's1', wsPath: '/ws/sessions/s1' })
      .mockResolvedValueOnce({ sessionId: 's2', wsPath: '/ws/sessions/s2' });
    await useSession.getState().start('w1-01-first-words');
    const first = lastSocket();
    await useSession.getState().start('w1-02-where-am-i');
    // Late events from the first socket must not touch the new session.
    first.handler({ kind: 'open' });
    first.handler({ kind: 'message', message: sessionStateMessage() });
    expect(useSession.getState().status).toBe('starting');
    expect(useSession.getState().level).toBeNull();
  });

  it('leave() abandons the session and returns to idle', async () => {
    await startLive();
    await useSession.getState().leave();
    expect(api.deleteSession).toHaveBeenCalledWith('s1');
    expect(useSession.getState().status).toBe('idle');
    expect(useSession.getState().sessionId).toBeNull();
  });

  it('leave() still resets when abandon fails', async () => {
    await startLive();
    vi.mocked(api.deleteSession).mockRejectedValue(new Error('down'));
    await useSession.getState().leave();
    expect(useSession.getState().status).toBe('idle');
  });

  it('start() failure surfaces the API error', async () => {
    vi.mocked(api.startLevel).mockRejectedValue(new Error('nope'));
    await useSession.getState().start('w1-02-where-am-i');
    expect(useSession.getState().status).toBe('closed');
    expect(useSession.getState().error).toBe('Something went wrong.');
  });
});
