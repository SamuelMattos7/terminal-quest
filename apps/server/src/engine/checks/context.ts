import type { SandboxHandle, SandboxProvider } from '../../sandbox/provider.js';

// Shared context for check evaluation (plan.md §8.2). `answers` are the
// player's `tux submit` texts (latest last); `commands` are parsed cmdlog
// rows. Both are fed by the ObjectiveTracker in T2.4; T2.3 tests pass
// fixtures directly.
export interface LoggedCommand {
  command: string;
  exitCode: number;
}

export interface CheckContext {
  seed: number;
  levelId: string;
  answers: string[];
  commands: LoggedCommand[];
}

export const CHECK_TIMEOUT_MS = 5000;
const CHECK_PATH = '/usr/bin:/bin:/opt/tq/bin';

/**
 * Run a shell snippet as root with the fixed check environment (D-004):
 * `env -i PATH=... HOME=/root TQ_SEED=...`. Times out per CHECK_TIMEOUT_MS.
 * Extra vars (e.g. a pgrep pattern) travel as argv-safe `K=V` entries so the
 * probe's own command line never contains the searched text.
 */
export async function rootShell(
  provider: SandboxProvider,
  handle: SandboxHandle,
  script: string,
  ctx: CheckContext,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const extra = Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`);
  return provider.exec(
    handle,
    [
      'env',
      '-i',
      `PATH=${CHECK_PATH}`,
      'HOME=/root',
      `TQ_SEED=${ctx.seed}`,
      ...extra,
      'bash',
      '-c',
      script,
    ],
    { user: 'root', timeoutMs: CHECK_TIMEOUT_MS },
  );
}

/** Substitute every `{{secret:name}}` with `/opt/tq/secret/name` contents. */
export async function resolveSecrets(
  provider: SandboxProvider,
  handle: SandboxHandle,
  value: string,
  ctx: CheckContext,
): Promise<string | undefined> {
  const names = [...value.matchAll(/\{\{secret:([A-Za-z0-9_-]+)\}\}/g)].map((m) => m[1] ?? '');
  let resolved = value;
  for (const name of new Set(names)) {
    const res = await rootShell(provider, handle, `cat -- "/opt/tq/secret/${name}"`, ctx);
    if (res.code !== 0) {
      return undefined;
    }
    resolved = resolved.split(`{{secret:${name}}}`).join(res.stdout.replace(/\n$/, ''));
  }
  return resolved;
}
