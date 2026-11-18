import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { LoadDockerStatsSchema, LoadManagedIdsSchema } from '@terminal-quest/shared';

const exec = promisify(execFile);

export async function command(file: string, args: string[]): Promise<string> {
  const { stdout } = await exec(file, args, { timeout: 10_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

export function memoryKiB(text: string, key: string): number {
  const match = new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm').exec(text);
  if (!match) throw new Error(`missing ${key} in proc memory data`);
  return Number(match[1]);
}

export function cpuTicks(text: string): { total: number; idle: number } {
  const match = /^cpu\s+([\d ]+)$/m.exec(text);
  if (!match) throw new Error('missing CPU counters in /proc/stat');
  const ticks = match[1].trim().split(/\s+/).map(Number);
  if (ticks.length < 8) throw new Error('incomplete CPU counters');
  return { total: ticks.slice(0, 8).reduce((sum, n) => sum + n, 0), idle: ticks[3] + ticks[4] };
}

export function cpuPercent(
  previous: ReturnType<typeof cpuTicks>,
  next: ReturnType<typeof cpuTicks>,
) {
  const total = next.total - previous.total;
  if (total <= 0) throw new Error('host CPU counters did not advance');
  return (100 * (total - (next.idle - previous.idle))) / total;
}

export function csvRow(values: (string | number)[]): string {
  return values.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',') + '\n';
}

export async function hostSample(serverPid: number) {
  const results = await Promise.allSettled([
    readFile('/proc/meminfo', 'utf8'),
    readFile('/proc/stat', 'utf8'),
    readFile(`/proc/${serverPid}/status`, 'utf8'),
    command('docker', ['ps', '-aq', '--filter', 'label=tq.managed=true']),
    command('docker', ['ps', '-q', '--filter', 'label=tq.managed=true']),
    command('docker', ['stats', '--no-stream', '--format', '{{json .}}']),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((r) => r.reason),
      'host sample failed',
    );
  const [memory, cpu, status, allIds, runningIds, stats] = results.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
  const lines = (text: string) => (text ? text.split(/\r?\n/) : []);
  return {
    memoryUsedMiB: (memoryKiB(memory, 'MemTotal') - memoryKiB(memory, 'MemAvailable')) / 1024,
    memoryAvailableMiB: memoryKiB(memory, 'MemAvailable') / 1024,
    rssMiB: memoryKiB(status, 'VmRSS') / 1024,
    cpu: cpuTicks(cpu),
    managedTotal: LoadManagedIdsSchema.parse(lines(allIds)).length,
    managedRunning: LoadManagedIdsSchema.parse(lines(runningIds)).length,
    dockerStats: lines(stats).map((line) => LoadDockerStatsSchema.parse(JSON.parse(line))),
  };
}
