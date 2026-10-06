import type { ExecResult, SandboxHandle, SandboxProvider } from '../sandbox/provider.js';
import type { CompiledSetup } from './setupCompiler.js';

// Executes compiled setup inside a sandbox as root (§4.1 step 1d).
// Kept separate from setupCompiler.ts so compilation stays pure and
// unit-testable without Docker.

export class SetupFailedError extends Error {
  constructor(readonly result: ExecResult) {
    super(`setup failed (exit ${result.code}, timedOut=${result.timedOut}): ${result.stderr}`);
    this.name = 'SetupFailedError';
  }
}

export async function runSetup(
  provider: SandboxProvider,
  handle: SandboxHandle,
  compiled: CompiledSetup,
  seed: number,
  timeoutMs = 60_000,
): Promise<ExecResult> {
  await provider.putFiles(handle, compiled.files);
  const result = await provider.exec(handle, ['bash', '-e', '-c', compiled.script], {
    user: 'root',
    env: { TQ_SEED: String(seed) },
    timeoutMs,
  });
  if (result.timedOut || result.code !== 0) {
    throw new SetupFailedError(result);
  }
  return result;
}
