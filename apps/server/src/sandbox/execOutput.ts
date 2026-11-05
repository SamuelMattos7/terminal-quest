import { PassThrough, type Duplex } from 'node:stream';
import type Docker from 'dockerode';
import type { ExecResult } from './provider.js';
import { MAX_EXEC_OUTPUT_BYTES } from './streamLimits.js';
import { ResourceLimitError } from '../util/resourceLimits.js';

export function collectExecOutput(
  exec: Pick<Docker.Exec, 'inspect'>,
  stream: Duplex,
  demux: (stdout: PassThrough, stderr: PassThrough) => void,
  timeoutMs: number,
  stdin?: string,
  control?: { timeoutMarker?: string; onTimeout?: () => Promise<void> },
): Promise<ExecResult> {
  // Fixed buffers avoid per-chunk array overhead for tiny-chunk floods.
  const out = Buffer.alloc(MAX_EXEC_OUTPUT_BYTES);
  const err = Buffer.alloc(MAX_EXEC_OUTPUT_BYTES);
  let outSize = 0;
  let errSize = 0;
  return new Promise((resolve, reject) => {
    let done = false;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.destroy();
      stdout.destroy();
      stderr.destroy();
    };
    const result = (code: number, timedOut = false): ExecResult => {
      let stderrText = err.toString('utf8', 0, errSize);
      if (control?.timeoutMarker !== undefined && stderrText.endsWith(control.timeoutMarker)) {
        timedOut = true;
        code = -1;
        stderrText = stderrText.slice(0, -control.timeoutMarker.length);
      }
      return { code, timedOut, stdout: out.toString('utf8', 0, outSize), stderr: stderrText };
    };
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve(result(code));
    };
    const fail = (error: unknown): void => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      // Do not report timeout until termination has actually completed.
      void Promise.resolve()
        .then(control?.onTimeout)
        .then(() => resolve(result(-1, true)), reject);
    }, timeoutMs);
    timer.unref?.();
    const collect = (target: Buffer, chunk: Buffer, isOut: boolean): void => {
      if (done) return;
      if (outSize + errSize + chunk.length > MAX_EXEC_OUTPUT_BYTES) {
        fail(new ResourceLimitError('exec output bytes'));
        return;
      }
      chunk.copy(target, isOut ? outSize : errSize);
      if (isOut) outSize += chunk.length;
      else errSize += chunk.length;
    };
    stdout.on('data', (chunk: Buffer) => collect(out, chunk, true));
    stderr.on('data', (chunk: Buffer) => collect(err, chunk, false));
    stream.on('end', () => {
      if (!done)
        void Promise.resolve()
          .then(() => exec.inspect())
          .then((info) => {
            if (info.ExitCode == null) fail(new Error('exec ended without an exit code'));
            else finish(info.ExitCode);
          }, fail);
    });
    stream.on('error', fail);
    stream.on('close', () => {
      if (!stream.readableEnded) fail(new Error('exec stream closed before EOF'));
    });
    try {
      demux(stdout, stderr);
      if (stdin !== undefined) {
        stream.write(stdin);
        stream.end();
      }
    } catch (err) {
      fail(err);
    }
  });
}
