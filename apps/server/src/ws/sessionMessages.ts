import { toPublicLevel, type ServerMessage } from '@terminal-quest/shared';
import type { LiveSession } from './liveSession.js';

export function sessionStateMessage(
  live: LiveSession,
): Extract<ServerMessage, { t: 'session_state' }> {
  const level = toPublicLevel(live.level, live.tracker.revealedObjectives);
  return {
    t: 'session_state',
    level,
    objectives: level.objectives.map(({ id }) => ({
      id,
      status: live.tracker.done.get(id) === true ? 'done' : 'pending',
    })),
    hintsUsed: live.hints.tiersUsed.length,
    hintsTotal: 3,
    completed: live.completed,
  };
}

export function tuxStatus(live: LiveSession): string {
  const total = live.level.objectives.length;
  const done = live.level.objectives.filter((o) => live.tracker.done.get(o.id) === true).length;
  const progress = `Tux-9000: ${done}/${total} objectives done. Hints used: ${live.hints.tiersUsed.length}/3.`;
  const active = live.level.sequential
    ? live.level.objectives
        .slice(0, live.tracker.revealedObjectives)
        .find((objective) => live.tracker.done.get(objective.id) !== true)
    : undefined;
  return active === undefined ? progress : `${progress} Current objective: ${active.text}`;
}

export function tuxExplain(live: LiveSession, text: string): string {
  const query = text.trim().split(/\s+/)[0] ?? '';
  const card =
    live.level.explain.find((c) => c.command === text.trim()) ??
    live.level.explain.find((c) => c.command.startsWith(query));
  if (card === undefined) {
    return `Tux-9000: I have nothing filed under '${query}'. Try \`tldr ${query}\` in the shell.`;
  }
  const parts = card.parts.map((p) => `${p.token}: ${p.meaning}`).join(' / ');
  return `Tux-9000: ${card.command} — ${parts}`;
}
