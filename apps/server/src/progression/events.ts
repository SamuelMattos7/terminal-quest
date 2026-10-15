import { z } from 'zod';
import { events } from '../db/schema.js';
import type { Db } from '../db/client.js';

// Telemetry writer for plan.md §5 `events` (T6.3). Rows carry ids only —
// no commands, no output, no PII beyond the ids the tables already hold.

export const EventTypeSchema = z.enum([
  'level_start',
  'objective_complete',
  'hint_used',
  'level_complete',
  'level_abandon',
  'check_timeout',
  'sandbox_error',
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export interface RecordEventInput {
  userId?: string;
  levelId?: string;
  attemptId?: string;
  type: EventType;
  payload?: Record<string, unknown>;
  now?: number;
}

export function recordEvent(db: Db, input: RecordEventInput, now = input.now ?? Date.now()): void {
  const type = EventTypeSchema.parse(input.type);
  const payload = input.payload ?? {};
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('recordEvent: payload must be a JSON object');
  }
  db.insert(events)
    .values({
      userId: input.userId ?? null,
      levelId: input.levelId ?? null,
      attemptId: input.attemptId ?? null,
      type,
      payloadJson: JSON.stringify(payload),
      createdAt: Math.floor(now / 1000),
    })
    .run();
}
