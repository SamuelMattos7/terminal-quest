import { describe, expect, it } from 'vitest';
import { createStdinLimiter, STDIN_BUDGET_BYTES_PER_SECOND } from './liveSession.js';

describe('createStdinLimiter', () => {
  it('caps throughput at 64 KB per second window', () => {
    let now = 1_000_000;
    const limiter = createStdinLimiter(() => now);
    expect(limiter.take(STDIN_BUDGET_BYTES_PER_SECOND)).toBe(true);
    expect(limiter.take(1)).toBe(false);
    now += 1000;
    expect(limiter.take(STDIN_BUDGET_BYTES_PER_SECOND)).toBe(true);
  });

  it('accumulates within a window', () => {
    let now = 0;
    const limiter = createStdinLimiter(() => now);
    expect(limiter.take(1024)).toBe(true);
    now += 999;
    expect(limiter.take(STDIN_BUDGET_BYTES_PER_SECOND)).toBe(false);
    now += 1;
    expect(limiter.take(1)).toBe(true);
  });
});
