import type { Check } from '@terminal-quest/shared';
import type { SandboxHandle, SandboxProvider } from '../../sandbox/provider.js';
import { rootShell, type CheckContext } from './context.js';

type PortListening = Extract<Check, { type: 'port_listening' }>;
type Exec = Extract<Check, { type: 'exec' }>;

export async function checkPortListening(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: PortListening,
  ctx: CheckContext,
): Promise<boolean> {
  const res = await rootShell(provider, handle, 'ss -lntu', ctx);
  if (res.code !== 0) {
    return false;
  }
  const proto = check.proto ?? 'tcp';
  return res.stdout
    .split('\n')
    .some(
      (line) => line.includes(`:${check.port}`) && (proto === 'udp' || line.includes('LISTEN')),
    );
}

export async function checkExec(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: Exec,
  ctx: CheckContext,
): Promise<boolean> {
  let cmd: string[];
  if (check.script !== undefined) {
    const rel = check.script.replace(/^\/+/, '');
    if (rel === '' || rel.split('/').includes('..')) {
      return false;
    }
    cmd = ['bash', `/opt/tq/checks/${ctx.levelId}/${rel}`];
  } else if (check.inline !== undefined) {
    cmd = ['bash', '-c', check.inline];
  } else {
    return false;
  }
  // Exec scripts receive TQ_SEED in the fixed check environment.
  const res = await provider.exec(
    handle,
    ['env', '-i', 'PATH=/usr/bin:/bin:/opt/tq/bin', 'HOME=/root', `TQ_SEED=${ctx.seed}`, ...cmd],
    { user: 'root', timeoutMs: 5000 },
  );
  if (res.timedOut || res.code !== (check.expect_exit ?? 0)) {
    return false;
  }
  if (check.stdout_matches !== undefined && !new RegExp(check.stdout_matches).test(res.stdout)) {
    return false;
  }
  return true;
}
