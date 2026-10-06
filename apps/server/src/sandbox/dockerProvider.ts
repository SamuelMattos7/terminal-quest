import { StringDecoder } from 'node:string_decoder';
import { PassThrough, type Duplex, type Readable } from 'node:stream';
import { posix } from 'node:path';
import Docker from 'dockerode';
import { pack } from 'tar-stream';
import { buildHostConfig, buildLabels } from './profiles.js';
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

const DEFAULT_EXEC_TIMEOUT_MS = 5000;

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

  constructor(opts?: { socketPath?: string; client?: DockerClient }) {
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
      Image: spec.image,
      Cmd: ['sleep', 'infinity'],
      User: 'player',
      WorkingDir: spec.startCwd,
      Env: toEnvList(spec.env),
      Labels: buildLabels(spec),
      HostConfig: buildHostConfig(spec),
    });
    await container.start();
    return { id: container.id, spec };
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
    const container = this.docker.getContainer(h.id);
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    return (async () => {
      const exec = await container.exec({
        Cmd: cmd,
        User: opts?.user ?? 'root',
        WorkingDir: opts?.cwd,
        Env: opts?.env === undefined ? undefined : toEnvList(opts.env),
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = (await exec.start({
        hijack: true,
        stdin: opts?.stdin !== undefined,
      })) as unknown as Duplex;

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      return await new Promise<ExecResult>((resolve) => {
        let done = false;
        const finish = (result: ExecResult): void => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(result);
          }
        };
        const timer = setTimeout(() => {
          // Docker exec has no kill API: resolve the timeout and let the
          // process die with the container (bounded by the T1.3 reaper).
          stream.destroy();
          finish({
            code: -1,
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            timedOut: true,
          });
        }, timeoutMs);
        timer.unref?.();
        const stdoutWrite = new PassThrough();
        const stderrWrite = new PassThrough();
        stdoutWrite.on('data', (c: Buffer) => {
          stdoutChunks.push(c);
        });
        stderrWrite.on('data', (c: Buffer) => {
          stderrChunks.push(c);
        });
        container.modem.demuxStream(stream, stdoutWrite, stderrWrite);
        if (opts?.stdin !== undefined) {
          stream.write(opts.stdin);
          stream.end();
        }
        stream.on('end', () => {
          void exec.inspect().then(
            (info) => {
              finish({
                code: info.ExitCode ?? -1,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                timedOut: false,
              });
            },
            () => {
              finish({
                code: -1,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                timedOut: false,
              });
            },
          );
        });
        stream.on('error', () => {
          finish({
            code: -1,
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            timedOut: false,
          });
        });
      });
    })();
  }

  async openShell(h: SandboxHandle, size: { cols: number; rows: number }): Promise<ShellStream> {
    const container = this.docker.getContainer(h.id);
    const exec = await container.exec({
      Cmd: ['/bin/bash', '--rcfile', '/opt/tq/bashrc', '-i'],
      User: 'player',
      WorkingDir: h.spec.startCwd,
      Env: ['TERM=xterm-256color', 'LANG=C.UTF-8', ...toEnvList(h.spec.env)],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = (await exec.start({
      hijack: true,
      stdin: true,
      Tty: true,
    })) as unknown as Duplex;
    await exec.resize({ h: size.rows, w: size.cols });

    const dataCbs: ((chunk: Buffer) => void)[] = [];
    const closeCbs: (() => void)[] = [];
    let closed = false;
    const decoder = new StringDecoder('utf8');
    stream.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk);
      if (text.length === 0) {
        return;
      }
      const buf = Buffer.from(text, 'utf8');
      for (const cb of dataCbs) {
        cb(buf);
      }
    });
    const fireClose = (): void => {
      if (!closed) {
        closed = true;
        for (const cb of closeCbs) {
          cb();
        }
      }
    };
    stream.on('end', fireClose);
    stream.on('close', fireClose);

    return {
      write(data: string): void {
        stream.write(data);
      },
      resize(cols: number, rows: number): void {
        void exec.resize({ h: rows, w: cols });
      },
      onData(cb: (chunk: Buffer) => void): void {
        dataCbs.push(cb);
      },
      onClose(cb: () => void): void {
        closeCbs.push(cb);
      },
      close(): void {
        stream.end();
        stream.destroy();
      },
    };
  }

  async watchFile(
    h: SandboxHandle,
    path: string,
    onLine: (line: string) => void,
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
    const stream = (await exec.start({ hijack: true, stdin: false })) as unknown as Readable;
    let pending = '';
    stream.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      let idx = pending.indexOf('\n');
      while (idx >= 0) {
        onLine(pending.slice(0, idx).replace(/\r$/, ''));
        pending = pending.slice(idx + 1);
        idx = pending.indexOf('\n');
      }
    });
    return {
      stop(): void {
        stream.destroy();
      },
    };
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
