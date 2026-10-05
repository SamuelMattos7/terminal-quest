import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './api.js';

describe('HealthResponseSchema', () => {
  it('accepts a valid /healthz payload', () => {
    expect(HealthResponseSchema.parse({ ok: true, docker: false })).toEqual({
      ok: true,
      docker: false,
    });
  });

  it('rejects a payload missing docker', () => {
    expect(() => HealthResponseSchema.parse({ ok: true })).toThrow();
  });
});
