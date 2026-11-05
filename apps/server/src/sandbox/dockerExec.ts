import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type Docker from 'dockerode';
import { collectExecOutput } from './execOutput.js';
import { EXEC_SUPERVISOR, EXEC_CLEANUP_GRACE_MS } from './execSupervisor.js';
import { logger } from '../util/logger.js';
import type { ExecOptions, ExecResult, SandboxHandle } from './provider.js';

export async function dockerExec(
  container: Docker.Container,
  handle: SandboxHandle,
  cmd: string[],
  opts?: ExecOptions,
): Promise<ExecResult> {
  const timeoutMs = opts?.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('exec timeoutMs must be positive and finite');
  }
  const timeoutMarker = `\nTQ_TIMEOUT_${randomUUID()}\n`;
  // A Windows named pipe cannot half-close stdin while retaining stdout.
  // Supply finite input as argv-safe base64 chunks; the supervisor provides
  // a file descriptor with EOF. Chunking avoids Linux's per-argument limit.
  const inputChunks =
    opts?.stdin === undefined
      ? []
      : (Buffer.from(opts.stdin)
          .toString('base64')
          .match(/.{1,32768}/g) ?? []);
  // Do not leave the command/pattern in the supervisor's process argv:
  // commands such as pkill -f must not accidentally match their supervisor.
  const commandChunks =
    Buffer.from(JSON.stringify(cmd))
      .toString('base64')
      .match(/.{1,32768}/g) ?? [];
  const exec = await container.exec({
    Cmd: [
      '/usr/bin/python3',
      '-I',
      '-c',
      EXEC_SUPERVISOR,
      String(timeoutMs / 1000),
      timeoutMarker,
      opts?.user ?? 'root',
      String(opts?.stdin === undefined ? -1 : inputChunks.length),
      ...inputChunks,
      ...commandChunks,
    ],
    // Keep the supervisor protected from player signals; only the command
    // receives the requested uid/gid/supplementary groups.
    User: 'root',
    WorkingDir: opts?.cwd,
    Env:
      opts?.env === undefined ? undefined : Object.entries(opts.env).map(([k, v]) => `${k}=${v}`),
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = (await exec.start({ hijack: true, stdin: false })) as unknown as Duplex;
  return collectExecOutput(
    exec,
    stream,
    (stdout, stderr) => container.modem.demuxStream(stream, stdout, stderr),
    timeoutMs + EXEC_CLEANUP_GRACE_MS,
    undefined,
    {
      timeoutMarker,
      onTimeout: async () => {
        // Fail closed if in-container cleanup or its transport gets stuck.
        logger.warn(
          { attemptId: handle.spec.attemptId, levelId: handle.spec.levelId },
          'exec cleanup deadline exceeded; stopping sandbox',
        );
        await container.kill();
        await container.wait();
      },
    },
  );
}
