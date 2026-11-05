import type { LiveSession } from './liveSession.js';

export function tuxStatus(live: LiveSession): string {
  const total = live.level.objectives.length;
  const done = live.level.objectives.filter((o) => live.tracker.done.get(o.id) === true).length;
  return `Tux-9000: ${done}/${total} objectives done. Hints used: ${live.hints.tiersUsed.length}/3.`;
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
