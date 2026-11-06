import { PassThrough, type Duplex } from 'node:stream';
import { posix } from 'node:path';
import Docker from 'dockerode';
import { pack } from 'tar-stream';
import { buildHostConfig, buildLabels } from './profiles.js';
import { dockerExec } from './dockerExec.js';
import { createLineReader } from './streamLimits.js';
import { openDockerShell } from './dockerShell.js';
import { logger } from '../util/logger.js';
import { SandboxCreateError } from './provider.js';
import type {
  DockerClient,
  ExecOptions,
  ExecResult,
  ManagedSandbox,
  PutFilesEntry,
  SandboxHandle,
  SandboxProvider,
  SandboxSpec,
  ShellStream,
} from './provider.js';

function statusCodeOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const sc = (err as { statusCode: unknown }).statusCode;
    return typeof sc === 'number' ? sc : undefined;
  }
  return undefined;
}

function toEnvList(env: Record<string, string>): string[] {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}

/** Resolve dockerode connection options. On Windows the unix default is
 *  unusable, so fall back to dockerode's default (the Desktop named pipe)
 *  unless an explicit pipe path was configured. */
export function connectOptions(socketPath?: string): ConstructorParameters<typeof Docker>[0] {
  if (socketPath === undefined || socketPath === '') {
    return {};
  }
  if (process.platform === 'win32' && socketPath.startsWith('/')) {
    return {};
  }
  const normalized = socketPath.startsWith('npipe://')
    ? socketPath.slice('npipe://'.length)
    : socketPath;
  return { socketPath: normalized };
}

function tarName(absolutePath: string): string {
  if (!absolutePath.startsWith('/')) {
    throw new Error(`putFiles path must be absolute: ${absolutePath}`);
  }
  if (posix.normalize(absolutePath) !== absolutePath) {
    throw new Error(`putFiles path must be normalized: ${absolutePath}`);
  }
  return absolutePath.slice(1);
}

export class DockerProvider implements SandboxProvider {
  private readonly docker: DockerClient;

  constructor(
    private readonly opts?: {
      socketPath?: string | undefined;
      client?: DockerClient;
      image?: string | undefined;
      runtime?: string | undefined;
    },
  ) {
    if (opts?.client !== undefined) {
      this.docker = opts.client;
    } else {
      this.docker = new Docker(connectOptions(opts?.socketPath));
    }
  }

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    // The container's own PID 1 is `sleep infinity`: it only keeps the
    // sandbox alive. All interaction (shell, setup, checks) happens via
    // exec, so a bare `bash` CMD would exit immediately and stop the box.
    const container = await this.docker.createContainer({
      Image: this.opts?.image ?? spec.image,
      Cmd: ['sleep', 'infinity'],
      User: 'player',
      WorkingDir: spec.startCwd,
      Env: toEnvList(spec.env),
      Labels: buildLabels(spec),
      HostConfig: buildHostConfig(spec, this.opts?.runtime),
    });
    const handle = { id: container.id, spec };
    try {
      await container.start();
      return handle;
    } catch (err) {
      try {
        await this.destroy(handle);
      } catch (cleanupError) {
        logger.error(
          { err: cleanupError, attemptId: spec.attemptId, levelId: spec.levelId },
          'failed-start sandbox cleanup failed',
        );
        throw new SandboxCreateError(handle, err, cleanupError);
      }
      throw err;
    }
  }

  async putFiles(h: SandboxHandle, entries: PutFilesEntry[]): Promise<void> {
    const archive = pack();
    const container = this.docker.getContainer(h.id);
    const pump = (async () => {
      for (const e of entries) {
        const name = tarName(e.path);
        const header: {
          name: string;
          mode: number;
          size: number;
          type: 'file';
          uid?: number;
          gid?: number;
        } = {
          name,
          mode: e.mode,
          size: e.content.length,
          type: 'file',
        };
        if (e.uid !== undefined) {
          header.uid = e.uid;
        }
        if (e.gid !== undefined) {
          header.gid = e.gid;
        }
        await new Promise<void>((resolve, reject) => {
          archive.entry(header, e.content, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }
      archive.finalize();
    })();
    // putArchive consumes the stream; run the pack pump concurrently and
    // surface whichever side fails first.
    await Promise.all([pump, container.putArchive(archive, { path: '/' })]);
  }

  exec(h: SandboxHandle, cmd: string[], opts?: ExecOptions): Promise<ExecResult> {
    return dockerExec(this.docker.getContainer(h.id), h, cmd, opts);
  }

  openShell(h: SandboxHandle, size: { cols: number; rows: number }): Promise<ShellStream> {
    return openDockerShell(this.docker.getContainer(h.id), h, size);
  }

  async watchFile(
    h: SandboxHandle,
    path: string,
    onLine: (line: string) => void,
    onError?: (error: Error) => void,
  ): Promise<{ stop(): void }> {
    if (!path.startsWith('/')) {
      throw new Error(`watchFile path must be absolute: ${path}`);
    }
    const container = this.docker.getContainer(h.id);
    const exec = await container.exec({
      Cmd: ['tail', '-F', '-n', '+1', path],
      User: 'root',
      AttachStdout: true,
      AttachStderr: false,
    });
    const stream = (await exec.start({ hijack: true, stdin: false })) as unknown as Duplex;
    // Non-TTY exec streams are multiplexed (8-byte frame headers); demux
    // before splitting lines, or the first line of each frame is corrupt.
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stderr.resume();
    let stopped = false;
    const stop = (): void => {
      stopped = true;
      stream.destroy();
      stdout.destroy();
      stderr.destroy();
    };
    const fail = (error: Error): void => {
      if (stopped) return;
      stop();
      logger.warn(
        { err: error, attemptId: h.spec.attemptId, levelId: h.spec.levelId, path },
        'file watcher stopped',
      );
      onError?.(error);
    };
    const read = createLineReader(onLine);
    stdout.on('data', (chunk: Buffer) => {
      if (stopped) return;
      try {
        read(chunk);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    stream.on('error', fail);
    const ended = (): void => fail(new Error('file watcher closed unexpectedly'));
    stream.on('end', ended);
    stream.on('close', ended);
    try {
      container.modem.demuxStream(stream, stdout, stderr);
    } catch (err) {
      stop();
      throw err;
    }
    return { stop };
  }

  async destroy(h: SandboxHandle): Promise<void> {
    const container = this.docker.getContainer(h.id);
    try {
      await container.stop({ t: 1 });
    } catch (err) {
      const code = statusCodeOf(err);
      if (code !== 304 && code !== 404) {
        throw err;
      }
    }
    try {
      await container.remove({ force: true, v: true });
    } catch (err) {
      if (statusCodeOf(err) !== 404) {
        throw err;
      }
    }
  }

  async listManaged(): Promise<ManagedSandbox[]> {
    const list = await this.docker.listContainers({
      all: true,
      filters: { label: ['tq.managed=true'] },
    });
    return list.map((c) => ({
      containerId: c.Id,
      attemptId: c.Labels['tq.attempt'] ?? '',
      createdAt: Number(c.Labels['tq.created'] ?? '0'),
    }));
  }
}
