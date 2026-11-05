import type { Level } from '@terminal-quest/shared';
import type { LevelState } from '@terminal-quest/shared';

// Unlock logic for plan.md §6 rules: W1-first is always available, a level
// unlocks when the previous level in its world is completed, and world N+1
// opens once every boss of world N is completed.

export function levelStates(
  levelsByWorld: Map<number, Level[]>,
  completedIds: Set<string>,
  unlockAll: boolean,
  enabledWorlds?: readonly number[],
): Map<string, LevelState> {
  const states = new Map<string, LevelState>();
  const worlds = [...levelsByWorld.keys()]
    .filter((world) => enabledWorlds?.includes(world) ?? true)
    .sort((a, b) => a - b);
  if (unlockAll) {
    for (const world of worlds) {
      for (const level of levelsByWorld.get(world) ?? []) {
        states.set(level.id, completedIds.has(level.id) ? 'completed' : 'available');
      }
    }
    return states;
  }

  for (const world of worlds) {
    const levels = [...(levelsByWorld.get(world) ?? [])].sort((a, b) => a.order - b.order);
    let gateOpen = world === 1;
    if (world !== 1) {
      const bosses = (levelsByWorld.get(world - 1) ?? []).filter((l) => l.kind === 'boss');
      gateOpen = bosses.length > 0 && bosses.every((b) => completedIds.has(b.id));
    }
    levels.forEach((level, index) => {
      if (completedIds.has(level.id)) {
        states.set(level.id, 'completed');
        return;
      }
      if (index === 0) {
        states.set(level.id, gateOpen ? 'available' : 'locked');
        return;
      }
      const previous = levels[index - 1];
      states.set(
        level.id,
        previous !== undefined && completedIds.has(previous.id) ? 'available' : 'locked',
      );
    });
  }
  return states;
}
