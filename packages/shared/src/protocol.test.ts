import { describe, expect, it } from 'vitest';
import { toPublicLevel } from './api.js';
import { ClientMessageSchema, ServerMessageSchema } from './protocol.js';
import { LevelSchema } from './level.js';
import { validLevelInput } from './test-fixtures.js';

describe('ClientMessageSchema', () => {
  it('parses stdin, resize, hint, check, ping', () => {
    expect(ClientMessageSchema.parse({ t: 'stdin', d: 'ls\n' })).toEqual({
      t: 'stdin',
      d: 'ls\n',
    });
    expect(ClientMessageSchema.parse({ t: 'resize', cols: 80, rows: 24 })).toEqual({
      t: 'resize',
      cols: 80,
      rows: 24,
    });
    for (const t of ['hint', 'check', 'ping'] as const) {
      expect(ClientMessageSchema.parse({ t })).toEqual({ t });
    }
  });

  it('rejects an oversized stdin frame (> 16 KB)', () => {
    expect(() => ClientMessageSchema.parse({ t: 'stdin', d: 'x'.repeat(16 * 1024 + 1) })).toThrow();
  });

  it('rejects out-of-range resize and unknown message types', () => {
    expect(() => ClientMessageSchema.parse({ t: 'resize', cols: 0, rows: 24 })).toThrow();
    expect(() => ClientMessageSchema.parse({ t: 'stdout', d: 'x' })).toThrow();
  });
});

describe('ServerMessageSchema', () => {
  it('parses session_state with a public level', () => {
    const level = toPublicLevel(LevelSchema.parse(validLevelInput));
    expect(
      ServerMessageSchema.parse({
        t: 'session_state',
        level,
        objectives: [{ id: 'ran-pwd', status: 'pending' }],
        hintsUsed: 0,
        hintsTotal: 3,
        completed: false,
      }),
    ).toMatchObject({ t: 'session_state', completed: false });
  });

  it('parses stdout, objective, tux, coach, error, pong, closing', () => {
    expect(ServerMessageSchema.parse({ t: 'stdout', d: 'hi' })).toEqual({
      t: 'stdout',
      d: 'hi',
    });
    expect(ServerMessageSchema.parse({ t: 'objective', id: 'a', status: 'done' })).toMatchObject({
      t: 'objective',
    });
    expect(ServerMessageSchema.parse({ t: 'tux', text: 'hello' })).toMatchObject({
      t: 'tux',
    });
    expect(ServerMessageSchema.parse({ t: 'coach', text: 'tip' })).toMatchObject({
      t: 'coach',
    });
    expect(ServerMessageSchema.parse({ t: 'error', message: 'boom' })).toMatchObject({
      t: 'error',
    });
    expect(ServerMessageSchema.parse({ t: 'pong' })).toEqual({ t: 'pong' });
    expect(ServerMessageSchema.parse({ t: 'closing', reason: 'idle' })).toMatchObject({
      t: 'closing',
    });
  });

  it('parses hint and level_complete, rejects bad tier and rank', () => {
    expect(
      ServerMessageSchema.parse({ t: 'hint', tier: 1, text: 'try ls', penaltyPct: 5 }),
    ).toMatchObject({ t: 'hint', tier: 1 });
    expect(() =>
      ServerMessageSchema.parse({ t: 'hint', tier: 4, text: 'x', penaltyPct: 5 }),
    ).toThrow();

    expect(
      ServerMessageSchema.parse({
        t: 'level_complete',
        result: {
          xp: 55,
          rank: 'A',
          breakdown: [{ label: 'base', xp: 50 }],
          newBadges: [],
          unlocked: ['w1-03-moving-around'],
          explain: [],
          skillsGained: ['pwd'],
        },
      }),
    ).toMatchObject({ t: 'level_complete' });
    expect(() =>
      ServerMessageSchema.parse({
        t: 'level_complete',
        result: {
          xp: 55,
          rank: 'Z',
          breakdown: [],
          newBadges: [],
          unlocked: [],
          explain: [],
          skillsGained: [],
        },
      }),
    ).toThrow();
  });
});
