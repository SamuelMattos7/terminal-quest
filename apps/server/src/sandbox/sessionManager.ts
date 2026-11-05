import { randomUUID } from 'node:crypto';
import type { SandboxHandle, SandboxProvider, SandboxSpec } from './provider.js';
import { SandboxCreateError } from './provider.js';

// In-memory session ownership for plan.md §4.2. The manager tracks live
// sessions and their TTLs; the shell stream, watchers, and answers attach
// to Session in T3.2 (socket wiring).

export type SessionCloseReason = 'manual' | 'idle' | 'max_age';

export interface Session {
  id: string;
  handle: SandboxHandle;
  createdAt: number;
  lastInputAt: number;
}

export type SessionExpireReason = 'idle' | 'max_age';

export interface SessionManagerOptions {
  provider: SandboxProvider;
  maxContainers: number;
  idleTtlMs: number;
  maxAgeMs: number;
  now?: () => number;
  /** Fired when expiry invalidates a session, before Docker destruction. */
  onExpire?: (id: string, reason: SessionExpireReason) => void;
}

/** Thrown by create() when the live-session count hits the capacity cap.
 *  Converted to HTTP 429 at the API edge (T3.2). */
export class CapacityError extends Error {
  constructor(readonly limit: number) {
    super(`sandbox capacity reached (${limit} sessions)`);
    this.name = 'CapacityError';
  }
}

export interface SweepResult {
  idle: number;
  maxAge: number;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly cleanup = new Map<string, { handle: SandboxHandle; pending?: Promise<void> }>();
  private pendingCreates = 0;

  constructor(private readonly opts: SessionManagerOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  get size(): number {
    return this.sessions.size + this.cleanup.size;
  }

  async create(spec: SandboxSpec): Promise<Session> {
    if (this.size + this.pendingCreates >= this.opts.maxContainers) {
      throw new CapacityError(this.opts.maxContainers);
    }
    // Reserve synchronously, before yielding to Docker. Other users may
    // create concurrently, but cannot consume this slot a second time.
    this.pendingCreates += 1;
    try {
      const handle = await this.opts.provider.create(spec);
      const now = this.now();
      const session: Session = { id: randomUUID(), handle, createdAt: now, lastInputAt: now };
      this.sessions.set(session.id, session);
      return session;
    } catch (err) {
      if (err instanceof SandboxCreateError) {
        this.cleanup.set(randomUUID(), { handle: err.handle });
      }
      throw err;
    } finally {
      this.pendingCreates -= 1;
    }
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Record stdin activity so the idle TTL restarts. Unknown ids are ignored. */
  touch(id: string): void {
    const session = this.sessions.get(id);
    if (session !== undefined) {
      session.lastInputAt = this.now();
    }
  }

  /** Invalidate immediately; retain ownership/capacity until destruction succeeds. */
  async close(id: string, _reason: SessionCloseReason): Promise<void> {
    const session = this.sessions.get(id);
    if (session !== undefined) {
      this.sessions.delete(id);
      this.cleanup.set(id, { handle: session.handle });
    }
    const cleanup = this.cleanup.get(id);
    if (cleanup === undefined) return;
    if (cleanup.pending !== undefined) return cleanup.pending;
    // Deferring the provider call publishes the shared promise even if a
    // provider throws synchronously. Sweeps and manual closes join it.
    cleanup.pending = Promise.resolve().then(() => this.opts.provider.destroy(cleanup.handle));
    try {
      await cleanup.pending;
      this.cleanup.delete(id);
    } finally {
      delete cleanup.pending;
    }
  }

  /** Destroy sessions past idle TTL or max age. Returns per-reason counts. */
  async sweepOnce(now?: number): Promise<SweepResult> {
    const at = now ?? this.now();
    const result: SweepResult = { idle: 0, maxAge: 0 };
    const errors: unknown[] = [];
    // Snapshot retries first so a newly failed expiry is retried next tick.
    for (const id of [...this.cleanup.keys()]) {
      try {
        await this.close(id, 'manual');
      } catch (err) {
        errors.push(err);
      }
    }
    for (const session of [...this.sessions.values()]) {
      if (this.sessions.get(session.id) !== session) continue;
      const reason =
        at - session.createdAt >= this.opts.maxAgeMs
          ? 'max_age'
          : at - session.lastInputAt >= this.opts.idleTtlMs
            ? 'idle'
            : undefined;
      if (reason === undefined) continue;
      // close() removes active ownership synchronously. Notify once even
      // when Docker is unavailable, releasing sockets/watchers promptly.
      const closing = this.close(session.id, reason);
      try {
        this.opts.onExpire?.(session.id, reason);
      } catch (err) {
        errors.push(err);
      }
      try {
        await closing;
        if (reason === 'max_age') result.maxAge += 1;
        else result.idle += 1;
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'sandbox sweep failed');
    return result;
  }

  /**
   * Boot sweep: destroy every managed container that has no live session.
   * Returns the number of orphans destroyed.
   */
  async sweepOrphans(): Promise<number> {
    const live = new Set([...this.sessions.values()].map((s) => s.handle.spec.attemptId));
    const tracked = new Set([...this.cleanup.values()].map((c) => c.handle.id));
    const managed = await this.opts.provider.listManaged();
    let destroyed = 0;
    const errors: unknown[] = [];
    for (const m of managed) {
      if (!live.has(m.attemptId) && !tracked.has(m.containerId)) {
        // destroy() only needs the container id; the spec is unused.
        const id = randomUUID();
        this.cleanup.set(id, {
          handle: {
            id: m.containerId,
            spec: { attemptId: m.attemptId } as SandboxHandle['spec'],
          },
        });
        try {
          await this.close(id, 'manual');
          destroyed += 1;
        } catch (err) {
          errors.push(err);
        }
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'orphan cleanup failed');
    return destroyed;
  }

  /** Shutdown also retries cleanup for sessions that never became live. */
  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys(), ...this.cleanup.keys()];
    const results = await Promise.allSettled(ids.map((id) => this.close(id, 'manual')));
    const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    if (errors.length > 0) throw new AggregateError(errors, 'sandbox shutdown cleanup failed');
  }
}
