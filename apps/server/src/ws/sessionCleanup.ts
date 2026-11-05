import { endAttempt } from '../progression/attempts.js';
import { recordEvent } from '../progression/events.js';
import { logger } from '../util/logger.js';
import { attemptScope, send, type FlowDeps } from './sessionContext.js';
import type { LiveSession } from './liveSession.js';

export type CloseReason = 'replaced' | 'abandoned' | 'idle' | 'max_age' | 'server_shutdown';

/** Release each local resource independently; Docker teardown remains authoritative. */
export function invalidateLiveSession(
  deps: FlowDeps,
  live: LiveSession,
  reason: CloseReason,
): void {
  const wasClosed = live.closed;
  live.closed = true;
  deps.live.delete(live.session.id);
  const release = (action: () => void, resource: string): void => {
    try {
      action();
    } catch (err) {
      logger.warn({ err, ...attemptScope(live), resource }, 'session resource cleanup failed');
    }
  };
  if (!wasClosed) release(() => send(live, { t: 'closing', reason }), 'closing frame');
  const socket = live.socket;
  live.socket = undefined;
  release(() => socket?.close(), 'socket');
  for (const watcher of live.watchers.splice(0)) release(() => watcher.stop(), 'watcher');
  const shell = live.shell;
  live.shell = undefined;
  release(() => shell?.close(), 'shell');
  if (!live.attemptFinished) {
    endAttempt(
      deps.db,
      live.attemptId,
      reason === 'idle' || reason === 'max_age' ? 'expired' : 'abandoned',
    );
    live.attemptFinished = true;
  }
  if (!wasClosed && reason === 'abandoned') {
    recordEvent(deps.db, { ...attemptScope(live), type: 'level_abandon' });
  }
}

export async function closeLiveSession(
  deps: FlowDeps,
  live: LiveSession,
  reason: CloseReason,
): Promise<void> {
  try {
    invalidateLiveSession(deps, live, reason);
  } finally {
    await deps.manager.close(live.session.id, 'manual');
  }
}
