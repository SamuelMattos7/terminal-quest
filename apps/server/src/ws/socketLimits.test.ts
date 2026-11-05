import { describe, expect, it, vi } from 'vitest';
import { boundedSocket, MAX_SOCKET_BUFFER_BYTES, sessionBudgets } from './socketLimits.js';
import { createBudget } from '../util/resourceLimits.js';
import type { LiveSession } from './liveSession.js';

describe('socket bounds (A03)', () => {
  it('terminates a slow peer before its buffered bytes exceed the cap', () => {
    const socket = {
      readyState: 1 as 0 | 1 | 2 | 3,
      bufferedAmount: MAX_SOCKET_BUFFER_BYTES - 2,
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
    };
    const adapter = boundedSocket(socket);
    adapter.send('é');
    expect(socket.send).toHaveBeenCalledWith('é');
    socket.bufferedAmount = MAX_SOCKET_BUFFER_BYTES;
    adapter.send('x');
    adapter.send('again');
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('does not send on closed/closing sockets', () => {
    const socket = {
      readyState: 2 as 0 | 1 | 2 | 3,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
    };
    const adapter = boundedSocket(socket);
    adapter.send('ignored');
    socket.readyState = 1;
    adapter.close(1008);
    adapter.send('ignored');
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1008);
  });

  it('shares stdin and message budgets across attachments while isolating sessions', () => {
    const live = {} as LiveSession;
    expect(sessionBudgets(live).stdin.take(64 * 1024)).toBe(true);
    expect(sessionBudgets(live).stdin.take(1)).toBe(false);
    for (let i = 0; i < 128; i++) expect(sessionBudgets(live).messages.take()).toBe(true);
    expect(sessionBudgets(live).messages.take()).toBe(false);
    expect(sessionBudgets({} as LiveSession).stdin.take(1)).toBe(true);
  });

  it('renews budgets after one second without retaining rejected traffic', () => {
    let now = 0;
    const budget = createBudget(2, () => now);
    expect(budget.take(2)).toBe(true);
    for (let i = 0; i < 1000; i++) expect(budget.take()).toBe(false);
    now = 1000;
    expect(budget.take(2)).toBe(true);
  });
});
