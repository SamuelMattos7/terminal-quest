import type { CoachRule, Level, ServerMessage, Skill } from '@terminal-quest/shared';
import type { Db } from '../db/client.js';
import type { Badge } from '../progression/badges.js';
import type { SessionManager } from '../sandbox/sessionManager.js';
import type { SandboxProvider } from '../sandbox/provider.js';
import type { LiveSession, LiveSessionRegistry } from './liveSession.js';

export interface FlowDeps {
  provider: SandboxProvider;
  manager: SessionManager;
  live: LiveSessionRegistry;
  coachRules: CoachRule[];
  badgeList: Badge[];
  skills: Map<string, Skill>;
  db: Db;
  levelsByWorld: Map<number, Level[]>;
  levelsById: Map<string, Level>;
  unlockAll: boolean;
  enabledWorlds: readonly number[];
}

export function send(live: LiveSession, msg: ServerMessage): void {
  if (live.closed && msg.t !== 'closing') return;
  live.socket?.send(JSON.stringify(msg));
}

export function isActive(deps: FlowDeps, live: LiveSession): boolean {
  return (
    !live.closed &&
    deps.live.get(live.session.id) === live &&
    deps.manager.get(live.session.id) === live.session
  );
}

/** Attempt-scoped ids shared by every telemetry event (T6.3). */
export function attemptScope(live: LiveSession) {
  return {
    userId: live.userId,
    levelId: live.level.id,
    attemptId: live.attemptId,
    sessionId: live.session.id,
  };
}
