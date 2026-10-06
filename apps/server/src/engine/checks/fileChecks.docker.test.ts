import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from '../checkRunner.js';
import {
  baseCtx,
  closeSandbox,
  openSandbox,
  setupAsRoot,
  type SandboxFixture,
} from '../sandboxFixture.js';

const D = '/tmp/t23-file';

describe('file checks', () => {
  let fx: SandboxFixture;

  beforeAll(async () => {
    fx = await openSandbox('t23-file');
    await setupAsRoot(
      fx,
      `mkdir -p ${D} && echo -n hello > ${D}/hello.txt && ` +
        `printf 'b\\na\\nc\\n' > ${D}/lines.txt && ` +
        `ln -s ${D}/hello.txt ${D}/link && ln -s /nonexistent ${D}/broken && ` +
        `mkdir -p ${D}/subdir && touch ${D}/subdir/only.txt && ` +
        `chmod 644 ${D}/hello.txt && chown player:player ${D}/hello.txt && ` +
        `echo -n seeded-word > /opt/tq/secret/t23 && echo file-with-seeded-word > ${D}/note.txt`,
    );
  }, 60_000);

  afterAll(async () => {
    await closeSandbox(fx);
  }, 60_000);

  it('file_exists passes for present files, fails for missing ones', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_exists', path: `${D}/hello.txt`, kind: 'any' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_exists', path: `${D}/nope.txt`, kind: 'any' },
        ctx,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_exists', path: `${D}/subdir`, kind: 'dir' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_exists', path: `${D}/link`, kind: 'symlink' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_exists', path: `${D}/hello.txt`, kind: 'dir' },
        ctx,
      ),
    ).toBe(false);
  });

  it('file_absent passes for missing files, fails for present and broken symlinks', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(fx.provider, fx.handle, { type: 'file_absent', path: `${D}/nope.txt` }, ctx),
    ).toBe(true);
    expect(
      await runCheck(fx.provider, fx.handle, { type: 'file_absent', path: `${D}/hello.txt` }, ctx),
    ).toBe(false);
    expect(
      await runCheck(fx.provider, fx.handle, { type: 'file_absent', path: `${D}/broken` }, ctx),
    ).toBe(false);
  });

  it('file_content compares equals/contains/matches/sha256/lines', async () => {
    const ctx = baseCtx();
    const run = (check: Parameters<typeof runCheck>[2]): Promise<boolean> =>
      runCheck(fx.provider, fx.handle, check, ctx);
    expect(
      await run({ type: 'file_content', path: `${D}/hello.txt`, equals: 'hello', trim: true }),
    ).toBe(true);
    expect(
      await run({ type: 'file_content', path: `${D}/hello.txt`, equals: 'bye', trim: true }),
    ).toBe(false);
    expect(
      await run({ type: 'file_content', path: `${D}/hello.txt`, contains: 'ell', trim: true }),
    ).toBe(true);
    expect(
      await run({ type: 'file_content', path: `${D}/hello.txt`, matches: '^h.llo$', trim: true }),
    ).toBe(true);
    const sha = createHash('sha256').update('hello', 'utf8').digest('hex');
    expect(
      await run({ type: 'file_content', path: `${D}/hello.txt`, sha256: sha, trim: true }),
    ).toBe(true);
    expect(
      await run({
        type: 'file_content',
        path: `${D}/lines.txt`,
        lines_equal_unordered: ['a', 'b', 'c'],
        trim: true,
      }),
    ).toBe(true);
    expect(
      await run({
        type: 'file_content',
        path: `${D}/lines.txt`,
        lines_equal_unordered: ['a', 'b'],
        trim: true,
      }),
    ).toBe(false);
    expect(
      await run({ type: 'file_content', path: `${D}/nope.txt`, equals: 'x', trim: true }),
    ).toBe(false);
  });

  it('file_content resolves {{secret:name}} references', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_content', path: `${D}/note.txt`, contains: '{{secret:t23}}', trim: true },
        ctx,
      ),
    ).toBe(true);
  });

  it('file_mode and file_owner verify bits and ownership', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_mode', path: `${D}/hello.txt`, mode: '644' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_mode', path: `${D}/hello.txt`, mode: '600' },
        ctx,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_owner', path: `${D}/hello.txt`, user: 'player', group: 'player' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'file_owner', path: `${D}/hello.txt`, user: 'root' },
        ctx,
      ),
    ).toBe(false);
  });

  it('symlink_target and dir_listing verify links and entries', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'symlink_target', path: `${D}/link`, target: `${D}/hello.txt` },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'symlink_target', path: `${D}/link`, target: `${D}/other.txt` },
        ctx,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'dir_listing', path: `${D}/subdir`, equals: ['only.txt'] },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'dir_listing', path: `${D}/subdir`, equals: ['only.txt', 'extra.txt'] },
        ctx,
      ),
    ).toBe(false);
  });
});
