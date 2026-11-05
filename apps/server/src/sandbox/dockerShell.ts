import { StringDecoder } from 'node:string_decoder';
import type { Duplex } from 'node:stream';
import type Docker from 'dockerode';
import type { SandboxHandle, ShellStream } from './provider.js';
import { MAX_SHELL_INPUT_BUFFER_BYTES } from './streamLimits.js';
import { ResourceLimitError } from '../util/resourceLimits.js';

export async function openDockerShell(
  container: Docker.Container,
  h: SandboxHandle,
  size: { cols: number; rows: number },
): Promise<ShellStream> {
  const exec = await container.exec({
    Cmd: ['/bin/bash', '--rcfile', '/opt/tq/bashrc', '-i'],
    User: 'player',
    WorkingDir: h.spec.startCwd,
    Env: [
      'TERM=xterm-256color',
      'LANG=C.UTF-8',
      ...Object.entries(h.spec.env).map(([key, value]) => `${key}=${value}`),
    ],
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
  try {
    await exec.resize({ h: size.rows, w: size.cols });
  } catch (err) {
    stream.destroy();
    throw err;
  }

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
      if (stream.writableLength + Buffer.byteLength(data) > MAX_SHELL_INPUT_BUFFER_BYTES) {
        throw new ResourceLimitError('shell input buffer');
      }
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
