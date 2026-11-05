import { PassThrough, type Duplex } from 'node:stream';
import type Docker from 'dockerode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectExecOutput } from './execOutput.js';
import { dockerExec } from './dockerExec.js';
import type { SandboxHandle } from './provider.js';

afterEach(() => vi.useRealTimers());

function fixture(onTimeout = vi.fn(async () => undefined)) {
  const stream = new PassThrough();
  let stderr!: PassThrough;
  const pending = collectExecOutput(
    { inspect: vi.fn(async () => ({ ExitCode: 124 }) as Docker.ExecInspectInfo) },
    stream,
    (_out, err) => {
      stderr = err;
    },
    100,
    undefined,
    { timeoutMarker: '\nunique-timeout-marker\n', onTimeout },
  );
  return { stream, stderr, pending, onTimeout };
}

describe('exec timeout reporting (A04)', () => {
  it('recognizes the supervisor marker split across chunks and hides it from stderr', async () => {
    const ctx = fixture();
    for (const byte of Buffer.from('real stderr\n\nunique-timeout-marker\n')) {
      ctx.stderr.write(Buffer.from([byte]));
    }
    ctx.stream.emit('end');
    expect(await ctx.pending).toEqual({
      code: -1,
      timedOut: true,
      stdout: '',
      stderr: 'real stderr\n',
    });
    expect(ctx.onTimeout).not.toHaveBeenCalled();
  });

  it('preserves a legitimate exit 124 without the supervisor marker', async () => {
    const ctx = fixture();
    ctx.stderr.write('ordinary stderr');
    ctx.stream.emit('end');
    expect(await ctx.pending).toMatchObject({
      code: 124,
      timedOut: false,
      stderr: 'ordinary stderr',
    });
  });

  it('waits for termination before resolving a watchdog timeout and runs cleanup once', async () => {
    vi.useFakeTimers();
    let terminated!: () => void;
    const termination = new Promise<void>((resolve) => {
      terminated = resolve;
    });
    const ctx = fixture(vi.fn(() => termination));
    const resolved = vi.fn();
    void ctx.pending.then(resolved);
    await vi.advanceTimersByTimeAsync(100);
    ctx.stream.emit('end');
    ctx.stream.emit('close');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.onTimeout).toHaveBeenCalledTimes(1);
    expect(resolved).not.toHaveBeenCalled();
    expect(ctx.stream.destroyed).toBe(true);
    terminated();
    expect(await ctx.pending).toMatchObject({ code: -1, timedOut: true });
  });

  it('surfaces termination failure instead of reporting successful cleanup', async () => {
    vi.useFakeTimers();
    const ctx = fixture(
      vi.fn(async () => {
        throw new Error('Docker unavailable');
      }),
    );
    const rejection = expect(ctx.pending).rejects.toThrow('Docker unavailable');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });

  it('kills and waits for the sandbox if the in-container supervisor stalls', async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    const kill = vi.fn(async () => undefined);
    const wait = vi.fn(async () => undefined);
    const createExec = vi.fn(async () => ({ start: async () => stream }));
    const container = {
      exec: createExec,
      kill,
      wait,
      modem: { demuxStream: (_stream: Duplex, _out: PassThrough, _err: PassThrough) => {} },
    } as unknown as Docker.Container;
    const pending = dockerExec(
      container,
      { spec: { attemptId: 'a04', levelId: 'level' } } as SandboxHandle,
      ['sleep', '60'],
      { user: 'player', timeoutMs: 50 },
    );
    await vi.advanceTimersByTimeAsync(5050);
    expect(await pending).toMatchObject({ code: -1, timedOut: true });
    expect(createExec).toHaveBeenCalledWith(expect.objectContaining({ User: 'root' }));
    expect(kill).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(kill.mock.invocationCallOrder[0]).toBeLessThan(wait.mock.invocationCallOrder[0]!);
  });

  it.each([0, -1, NaN, Infinity])(
    'rejects an invalid deadline (%s) before starting a command',
    async (timeoutMs) => {
      const createExec = vi.fn();
      await expect(
        dockerExec(
          { exec: createExec } as unknown as Docker.Container,
          {} as SandboxHandle,
          ['true'],
          { timeoutMs },
        ),
      ).rejects.toThrow('positive and finite');
      expect(createExec).not.toHaveBeenCalled();
    },
  );
});

describe('exec transport failures (A14)', () => {
  it.each(['stream error', 'premature close', 'inspect failure', 'demux failure'] as const)(
    'rejects and releases the stream on %s',
    async (kind) => {
      const stream = new PassThrough();
      const failure = new Error(kind);
      const inspect = vi.fn(async () => {
        throw failure;
      });
      const pending = collectExecOutput(
        { inspect },
        stream,
        () => {
          if (kind === 'demux failure') throw failure;
        },
        5000,
      );
      const rejection = expect(pending).rejects.toThrow(
        kind === 'premature close' ? 'exec stream closed before EOF' : kind,
      );
      if (kind === 'stream error') stream.destroy(failure);
      if (kind === 'premature close') stream.destroy();
      if (kind === 'inspect failure') stream.emit('end');
      await rejection;
      expect(stream.destroyed).toBe(true);
    },
  );
});
