import { describe, expect, it } from 'vitest';
import { LoadTestOptionsSchema } from '@terminal-quest/shared';
import { MarkerMatcher, latencySummary, percentile } from './metrics.js';
import { cpuPercent, cpuTicks, csvRow, memoryKiB } from './host.js';
import { assertCapacity } from './scenario.js';

describe('load test evidence', () => {
  it('matches split markers while bounding unrelated terminal output', () => {
    const matcher = new MarkerMatcher('tq_marker');
    expect(matcher.push('x'.repeat(100_000) + 'tq_')).toBe(false);
    expect(matcher.push('mar')).toBe(false);
    expect(matcher.push('ker\r\n')).toBe(true);
    expect(matcher.push('unrelated')).toBe(false);
  });

  it('uses nearest-rank percentiles and does not invent empty measurements', () => {
    expect(latencySummary([])).toEqual({ count: 0, p50Ms: null, p95Ms: null });
    expect(
      percentile(
        Array.from({ length: 20 }, (_, i) => 20 - i),
        0.95,
      ),
    ).toBe(19);
    expect(latencySummary([50, 10, 30])).toEqual({ count: 3, p50Ms: 30, p95Ms: 50 });
  });

  it('distinguishes capacity 429 from rate limiting and missing Retry-After', async () => {
    const response = (error: string, retryAfter?: string) =>
      new Response(JSON.stringify({ error }), {
        status: 429,
        headers: retryAfter ? { 'Retry-After': retryAfter } : {},
      });
    await expect(assertCapacity(response('sandbox capacity reached', '30'))).resolves.toEqual({
      status: 429,
      retryAfter: '30',
      error: 'sandbox capacity reached',
    });
    await expect(assertCapacity(response('Too Many Requests', '30'))).rejects.toThrow();
    await expect(assertCapacity(response('sandbox capacity reached'))).rejects.toThrow();
    await expect(assertCapacity(new Response('{}', { status: 200 }))).rejects.toThrow('HTTP 200');
  });

  it('rejects credentials and paths in target origins', () => {
    for (const baseUrl of [
      'https://user:password@test.local',
      'file:///tmp',
      'https://test.local/api',
    ]) {
      expect(
        LoadTestOptionsSchema.safeParse({ baseUrl, origin: 'https://test.local', out: 'run.json' })
          .success,
      ).toBe(false);
    }
  });

  it('measures Linux available memory and CPU without double-counting guest ticks', () => {
    expect(memoryKiB('MemAvailable:  1024 kB\n', 'MemAvailable')).toBe(1024);
    expect(() => memoryKiB('missing', 'MemAvailable')).toThrow();
    const before = cpuTicks('cpu  10 0 10 80 0 0 0 0 10 0\n');
    const after = cpuTicks('cpu  30 0 10 160 0 0 0 0 30 0\n');
    expect(cpuPercent(before, after)).toBe(20);
    expect(() => cpuTicks('invalid')).toThrow();
    expect(csvRow(['a,"b', 20])).toBe('"a,""b","20"\n');
  });
});
