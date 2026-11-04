import type { WebSocket } from 'ws';
import type { LiveSession } from './liveSession.js';
import { createBudget } from '../util/resourceLimits.js';

export const MAX_SOCKET_BUFFER_BYTES = 256 * 1024;
export const SOCKET_MESSAGES_PER_SECOND = 128;
export const STDIN_BYTES_PER_SECOND = 64 * 1024;
export const TERMINAL_BYTES_PER_SECOND = 1024 * 1024;

const budgets = new WeakMap<LiveSession, ReturnType<typeof makeBudgets>>();
function makeBudgets() {
  return {
    messages: createBudget(SOCKET_MESSAGES_PER_SECOND),
    stdin: createBudget(STDIN_BYTES_PER_SECOND),
  };
}

/** Budgets survive socket reconnection/replacement for the same session. */
export function sessionBudgets(live: LiveSession) {
  let budget = budgets.get(live);
  if (!budget) {
    budget = makeBudgets();
    budgets.set(live, budget);
  }
  return budget;
}

export function boundedSocket(
  socket: Pick<WebSocket, 'send' | 'close' | 'terminate' | 'bufferedAmount' | 'readyState'>,
) {
  let closed = false;
  return {
    send(payload: string): void {
      if (closed || socket.readyState !== 1) return;
      if (socket.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFER_BYTES) {
        closed = true;
        // Terminate immediately: graceful close itself can wait on a slow peer.
        socket.terminate();
        return;
      }
      socket.send(payload);
    },
    close(code?: number): void {
      closed = true;
      socket.close(code);
    },
  };
}
