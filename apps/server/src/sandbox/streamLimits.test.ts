import { PassThrough, Duplex } from 'node:stream';
import type Docker from 'dockerode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLineReader, MAX_EXEC_OUTPUT_BYTES } from './streamLimits.js';
import { collectExecOutput } from './execOutput.js';
import { DockerProvider } from './dockerProvider.js';
import type { DockerClient, SandboxHandle } from './provider.js';

afterEach(() => vi.useRealTimers());

describe('watched stream bounds (A03)', () => {
  it('keeps split UTF-8 characters and CRLF intact across chunks', () => {
    const lines: string[] = [];
    const read = createLineReader((line) => lines.push(line));
    for (const byte of Buffer.from('é🐧\r\nsecond\n')) read(Buffer.from([byte]));
    expect(lines).toEqual(['é🐧', 'second']);
  });

  it('bounds newline-free data even when it arrives one byte at a time', () => {
    const read = createLineReader(() => {
      throw new Error('unexpected line');
    });
    for (let i = 0; i < 16384; i++) read(Buffer.from('x'));
    expect(() => read(Buffer.from('x'))).toThrow('watch line bytes limit');
  });

  it('accepts exactly the line byte limit and starts a fresh line', () => {
    const lines: string[] = [];
    const read = createLineReader((line) => lines.push(line));
    read(Buffer.from('é'.repeat(8192)));
    read(Buffer.from('\nok\n'));
    expect(lines.map((line) => Buffer.byteLength(line))).toEqual([16384, 2]);
  });

  it('rate limits blank/junk lines and resets the rate window', () => {
    let now = 0;
    const line = vi.fn();
    const read = createLineReader(line, () => now);
    read(Buffer.from('\n'.repeat(128)));
    expect(() => read(Buffer.from('\n'))).toThrow('watch line rate limit');
    expect(line).toHaveBeenCalledTimes(128);
    now = 1000;
    read(Buffer.from('next\n'));
    expect(line).toHaveBeenLastCalledWith('next');
  });

  it('limits cumulative bytes even when individual lines fit', () => {
    const read = createLineReader(() => undefined);
    const chunk = Buffer.from('x'.repeat(8191) + '\n');
    for (let i = 0; i < 32; i++) read(chunk);
    expect(() => read(chunk)).toThrow('watch byte rate limit');
  });

  it('stops the actual Docker watcher and reports overflow exactly once', async () => {
    const stream = new PassThrough();
    let stdout!: PassThrough;
    const container = {
      exec: async () => ({ start: async () => stream }),
      modem: {
        demuxStream: (_stream: Duplex, out: PassThrough) => {
          stdout = out;
        },
      },
    };
    const client = { getContainer: () => container } as unknown as DockerClient;
    const provider = new DockerProvider({ client });
    const onLine = vi.fn();
    const onError = vi.fn();
    const watcher = await provider.watchFile(
      { id: 'h', spec: { attemptId: 'attempt', levelId: 'level' } } as SandboxHandle,
      '/run/tq/inbox',
      onLine,
      onError,
    );
    stdout.write(Buffer.from('x'.repeat(16385)));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onLine).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
    expect(stdout.destroyed).toBe(true);
    watcher.stop();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

function outputFixture(timeoutMs = 1000) {
  const stream = new PassThrough();
  const inspect = vi.fn(async () => ({ ExitCode: 0 }) as Docker.ExecInspectInfo);
  let stdout!: PassThrough;
  let stderr!: PassThrough;
  const pending = collectExecOutput(
    { inspect },
    stream,
    (out, err) => {
      stdout = out;
      stderr = err;
    },
    timeoutMs,
  );
  return { stream, stdout, stderr, pending, inspect };
}

describe('exec collection bounds (A03)', () => {
  it('accepts the combined byte limit, preserving stdout and stderr', async () => {
    const ctx = outputFixture();
    ctx.stdout.write(Buffer.from('o'.repeat(MAX_EXEC_OUTPUT_BYTES / 2)));
    ctx.stderr.write(Buffer.from('e'.repeat(MAX_EXEC_OUTPUT_BYTES / 2)));
    ctx.stream.emit('end');
    const result = await ctx.pending;
    expect(result.code).toBe(0);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBe(
      MAX_EXEC_OUTPUT_BYTES,
    );
    expect(ctx.stdout.destroyed).toBe(true);
  });

  it.each(['stdout', 'stderr'] as const)(
    'rejects combined overflow arriving on %s and destroys streams',
    async (channel) => {
      const ctx = outputFixture();
      ctx.stdout.write(Buffer.alloc(MAX_EXEC_OUTPUT_BYTES / 2));
      ctx.stderr.write(Buffer.alloc(MAX_EXEC_OUTPUT_BYTES / 2));
      ctx[channel].write(Buffer.from('é'));
      await expect(ctx.pending).rejects.toThrow('exec output bytes limit');
      expect(ctx.stream.destroyed).toBe(true);
      expect(ctx.stdout.destroyed).toBe(true);
      expect(ctx.stderr.destroyed).toBe(true);
      expect(ctx.inspect).not.toHaveBeenCalled();
    },
  );

  it('releases streams on timeout and ignores later output', async () => {
    vi.useFakeTimers();
    const ctx = outputFixture(50);
    ctx.stdout.write(Buffer.from('before'));
    await vi.advanceTimersByTimeAsync(50);
    expect(await ctx.pending).toMatchObject({ code: -1, stdout: 'before', timedOut: true });
    expect(ctx.stream.destroyed).toBe(true);
    expect(ctx.stdout.destroyed).toBe(true);
  });
});

it('bounds queued PTY input when Docker stops consuming writes (A03)', async () => {
  const stream = new Duplex({
    read() {},
    // Deliberately never complete a write: simulate a blocked Docker pipe.
    write() {},
  });
  const container = {
    exec: async () => ({ start: async () => stream, resize: async () => undefined }),
  };
  const provider = new DockerProvider({
    client: { getContainer: () => container } as unknown as DockerClient,
  });
  const shell = await provider.openShell(
    { id: 'h', spec: { startCwd: '/', env: {} } } as SandboxHandle,
    { cols: 80, rows: 24 },
  );
  try {
    shell.write('é'.repeat(32768));
    expect(stream.writableLength).toBe(64 * 1024);
    expect(() => shell.write('x')).toThrow('shell input buffer limit');
    expect(stream.writableLength).toBe(64 * 1024);
  } finally {
    shell.close();
  }
});
