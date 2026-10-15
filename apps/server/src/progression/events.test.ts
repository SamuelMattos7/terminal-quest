import { describe, expect, it } from 'vitest';
import { events } from '../db/schema.js';
import { makeTempDb } from '../testUtils.js';
import { recordEvent } from './events.js';

describe('recordEvent', () => {
  it('writes rows with ids, payload, and second timestamps', () => {
    const { db, cleanup } = makeTempDb();
    try {
      recordEvent(
        db,
        {
          userId: 'u1',
          levelId: 'w1-01-a',
          attemptId: 'att-1',
          type: 'objective_complete',
          payload: { objectiveId: 'did-it' },
        },
        1_700_000_000_123,
      );
      recordEvent(db, { type: 'level_start' }, 1_700_000_001_000);
      const rows = db.select().from(events).all();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        userId: 'u1',
        levelId: 'w1-01-a',
        attemptId: 'att-1',
        type: 'objective_complete',
        payloadJson: JSON.stringify({ objectiveId: 'did-it' }),
        createdAt: 1_700_000_000,
      });
      expect(rows[1]).toMatchObject({
        userId: null,
        levelId: null,
        attemptId: null,
        type: 'level_start',
        payloadJson: '{}',
      });
      expect((rows[1]?.id ?? 0) > (rows[0]?.id ?? 0)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('rejects unknown types and non-object payloads', () => {
    const { db, cleanup } = makeTempDb();
    try {
      expect(() => recordEvent(db, { type: 'player_clicked' as 'level_start' })).toThrow();
      expect(() =>
        recordEvent(db, {
          type: 'level_start',
          payload: ['x'] as unknown as Record<string, unknown>,
        }),
      ).toThrow();
      expect(db.select().from(events).all()).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
