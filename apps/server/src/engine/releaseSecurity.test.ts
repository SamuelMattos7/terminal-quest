import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { Check } from '@terminal-quest/shared';
import { loadLevels } from './levelLoader.js';

it('keeps release worlds within the audited basic/no-network/check contract (T9.1)', () => {
  const levels = loadLevels(
    fileURLToPath(new URL('../../../../packages/levels/content/', import.meta.url)),
  );
  const release = [...levels.byId.values()].filter((level) => level.world <= 2);
  expect(release).toHaveLength(27);
  const checkTypes = (check: Check): string[] =>
    check.type === 'all' || check.type === 'any' || check.type === 'not'
      ? check.checks.flatMap(checkTypes)
      : [check.type];
  for (const level of release) {
    expect(level.sandbox, level.id).toMatchObject({
      profile: 'basic',
      network: 'none',
      sidecars: [],
      capabilities: [],
      sudo_allow: [],
    });
    const types = level.objectives.flatMap((objective) => checkTypes(objective.check));
    for (const specialty of ['script_tests', 'login_shell_eval', 'cron_dry_run', 'crontab_entry']) {
      expect(types, level.id).not.toContain(specialty);
    }
  }
});
