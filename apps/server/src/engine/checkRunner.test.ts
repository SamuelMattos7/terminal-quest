import { CheckSchema, type Check } from '@terminal-quest/shared';
import { expect, it, vi } from 'vitest';
import type { SandboxHandle } from '../sandbox/provider.js';
import { runCheck } from './checkRunner.js';

const handle: SandboxHandle = {
  id: 'container',
  spec: {
    attemptId: 'attempt',
    userId: 'user',
    levelId: 'level',
    image: 'tq-base',
    profile: 'basic',
    network: 'none',
    sidecars: [],
    resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
    startCwd: '/',
    env: {},
  },
};

const fileAbsent = { type: 'file_absent', path: '/tmp/probe' } satisfies Check;
const notFileExists = {
  type: 'not',
  checks: [{ type: 'file_exists', path: '/tmp/probe', kind: 'any' }],
} satisfies Check;

const tcpListener = 'tcp LISTEN 0 128 0.0.0.0:8080 0.0.0.0:*';
const udpListener = 'udp UNCONN 0 0 [::]:8080 [::]:*';

it.each([
  { row: tcpListener, port: 8080, proto: undefined, expected: true },
  { row: tcpListener, port: 80, proto: 'tcp', expected: false },
  { row: tcpListener, port: 8079, proto: 'tcp', expected: false },
  { row: tcpListener, port: 8081, proto: 'tcp', expected: false },
  { row: tcpListener, port: 8080, proto: 'udp', expected: false },
  { row: udpListener, port: 8080, proto: 'udp', expected: true },
  { row: udpListener, port: 8080, proto: 'tcp', expected: false },
  {
    row: 'udp UNCONN 0 0 127.0.0.1:8081 127.0.0.1:8080',
    port: 8080,
    proto: 'udp',
    expected: false,
  },
] as const)(
  'returns $expected for $proto port $port with "$row"',
  async ({ row, port, proto, expected }) => {
    const stdout = `Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port\n${row}\n`;
    const provider = { exec: vi.fn().mockResolvedValue({ code: 0, stdout, stderr: '' }) };
    const ctx = { seed: 1, levelId: 'level', answers: [], commands: [] };
    const check = CheckSchema.parse({ type: 'port_listening', port, proto });
    expect(await runCheck(provider, handle, check, ctx)).toBe(expected);
  },
);

it.each([
  { check: fileAbsent, leaf: 'file_absent' },
  { check: notFileExists, leaf: 'file_exists' },
])(
  'keeps a timed-out $check.type check pending and attributes it to $leaf',
  async ({ check, leaf }) => {
    const provider = {
      exec: vi
        .fn()
        .mockResolvedValueOnce({
          code: -1,
          stdout: '',
          stderr: '',
          timedOut: true,
        })
        .mockResolvedValueOnce({
          code: check.type === 'file_absent' ? 0 : 1,
          stdout: '',
          stderr: '',
          timedOut: false,
        }),
    };
    const onTimeout = vi.fn();
    const ctx = { seed: 1, levelId: 'level', answers: [], commands: [], onTimeout };
    expect(await runCheck(provider, handle, check, ctx)).toBe(false);
    expect(onTimeout.mock.calls).toEqual([[leaf]]);
    expect(await runCheck(provider, handle, check, ctx)).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  },
);

it('attributes a timeout in script case setup and never runs the case', async () => {
  const check = CheckSchema.parse({
    type: 'script_tests',
    path: '/tmp/script',
    cases: [{ name: 'one', setup: ['touch input'], expect: { exit_code: 0 } }],
  });
  const provider = {
    exec: vi
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      })
      .mockResolvedValueOnce({ code: -1, stdout: '', stderr: '', timedOut: true }),
  };
  const onTimeout = vi.fn();
  const ctx = { seed: 1, levelId: 'level', answers: [], commands: [], onTimeout };
  expect(await runCheck(provider, handle, check, ctx)).toBe(false);
  expect(onTimeout.mock.calls).toEqual([['script_tests']]);
  expect(provider.exec).toHaveBeenCalledTimes(2);
});
