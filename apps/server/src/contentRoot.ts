import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Locate `packages/levels/content` by walking up from this module, so the
// same code works from src (tsx dev), dist (prod build), and tests that
// don't pass an explicit root.

export function discoverContentRoot(startDir?: string): string {
  let dir = startDir ?? dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'packages', 'levels', 'content');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error('cannot locate packages/levels/content from ' + (startDir ?? '<module>'));
}
