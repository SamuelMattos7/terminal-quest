import { randomUUID } from 'node:crypto';
import type { SandboxHandle, SandboxProvider, SandboxSpec } from './provider.js';

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

export interface SessionManagerOptions {
  provider: SandboxProvider;
  maxContainers: number;
  idleTtlMs: number;
  maxAgeMs: number;
  now?: () => number;
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

  constructor(private readonly opts: SessionManagerOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  get size(): number {
    return this.sessions.size;
  }

  async create(spec: SandboxSpec): Promise<Session> {
    if (this.sessions.size >= this.opts.maxContainers) {
      throw new CapacityError(this.opts.maxContainers);
    }
    const handle = await this.opts.provider.create(spec);
    const now = this.now();
    const session: Session = { id: randomUUID(), handle, createdAt: now, lastInputAt: now };
    this.sessions.set(session.id, session);
    return session;
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

  /** Destroy the sandbox and forget the session. Unknown ids are ignored. */
  async close(id: string, _reason: SessionCloseReason): Promise<void> {
    const session = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    this.sessions.delete(id);
    await this.opts.provider.destroy(session.handle);
  }

  /** Destroy sessions past idle TTL or max age. Returns per-reason counts. */
  async sweepOnce(now?: number): Promise<SweepResult> {
    const at = now ?? this.now();
    const result: SweepResult = { idle: 0, maxAge: 0 };
    for (const session of [...this.sessions.values()]) {
      if (at - session.createdAt >= this.opts.maxAgeMs) {
        await this.close(session.id, 'max_age');
        result.maxAge += 1;
      } else if (at - session.lastInputAt >= this.opts.idleTtlMs) {
        await this.close(session.id, 'idle');
        result.idle += 1;
      }
    }
    return result;
  }

  /**
   * Boot sweep: destroy every managed container that has no live session.
   * Returns the number of orphans destroyed.
   */
  async sweepOrphans(): Promise<number> {
    const live = new Set([...this.sessions.values()].map((s) => s.handle.spec.attemptId));
    const managed = await this.opts.provider.listManaged();
    let destroyed = 0;
    for (const m of managed) {
      if (!live.has(m.attemptId)) {
        // destroy() only needs the container id; the spec is unused.
        await this.opts.provider.destroy({
          id: m.containerId,
          spec: { attemptId: m.attemptId } as SandboxHandle['spec'],
        });
        destroyed += 1;
      }
    }
    return destroyed;
  }
}
