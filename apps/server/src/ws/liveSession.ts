import type { Level } from '@terminal-quest/shared';
import type { Coach } from '../engine/coach.js';
import type { HintState } from '../engine/hints.js';
import type { TrackerState } from '../engine/objectiveTracker.js';
import type { Session } from '../sandbox/sessionManager.js';
import type { ShellStream } from '../sandbox/provider.js';

// Live per-connection session state for plan.md §4.1/§6.1 (T3.2). The
// SessionManager owns TTLs and sandboxes; this registry owns everything
// the socket layer needs: engine state, the shell stream, and the socket.

export interface LiveSession {
  session: Session;
  userId: string;
  level: Level;
  seed: number;
  attemptId: string;
  attemptFinished: boolean;
  tracker: TrackerState;
  hints: HintState;
  coach: Coach;
  shell: ShellStream | undefined;
  socket: { send(payload: string): void; close(code?: number): void } | undefined;
  completed: boolean;
}

export class LiveSessionRegistry {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly byUser = new Map<string, string>();

  set(id: string, live: LiveSession): string | undefined {
    const replaced = this.byUser.get(live.userId);
    this.sessions.set(id, live);
    this.byUser.set(live.userId, id);
    return replaced !== id ? replaced : undefined;
  }

  get(id: string): LiveSession | undefined {
    return this.sessions.get(id);
  }

  getByUser(userId: string): LiveSession | undefined {
    const id = this.byUser.get(userId);
    return id === undefined ? undefined : this.sessions.get(id);
  }

  delete(id: string): void {
    const live = this.sessions.get(id);
    if (live !== undefined && this.byUser.get(live.userId) === id) {
      this.byUser.delete(live.userId);
    }
    this.sessions.delete(id);
  }

  values(): Iterable<LiveSession> {
    return this.sessions.values();
  }

  get size(): number {
    return this.sessions.size;
  }
}

// 64 KB/s stdin budget (§6.1 behavioural rules) with an injectable clock so
// tests don't depend on real time.
export const STDIN_BUDGET_BYTES_PER_SECOND = 64 * 1024;

export interface StdinLimiter {
  /** Returns true when `bytes` fit this second, false when over budget. */
  take(bytes: number): boolean;
}

export function createStdinLimiter(now: () => number = Date.now): StdinLimiter {
  let windowStart = now();
  let used = 0;
  return {
    take(bytes: number): boolean {
      const at = now();
      if (at - windowStart >= 1000) {
        windowStart = at;
        used = 0;
      }
      used += bytes;
      return used <= STDIN_BUDGET_BYTES_PER_SECOND;
    },
  };
}
