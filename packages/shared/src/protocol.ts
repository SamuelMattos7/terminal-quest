import { z } from 'zod';
import { PublicLevelSchema } from './api.js';
import { ExplainCardSchema } from './level.js';

// WebSocket protocol for `/ws/sessions/:sessionId` (plan.md §6.1).
// Text frames containing JSON. Behavioural rules (rate limits, frame size,
// 4401 ownership close) are enforced by the server socket layer (T3.2);
// the schema pins shapes and the 16 KB stdin frame cap.

const StdinMessageSchema = z
  .object({
    t: z.literal('stdin'),
    d: z.string().max(16 * 1024, 'stdin frame must fit in 16 KB'),
  })
  .strict();

const ResizeMessageSchema = z
  .object({
    t: z.literal('resize'),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(500),
  })
  .strict();

export const ClientMessageSchema = z.discriminatedUnion('t', [
  StdinMessageSchema,
  ResizeMessageSchema,
  z.object({ t: z.literal('hint') }).strict(),
  z.object({ t: z.literal('check') }).strict(),
  z.object({ t: z.literal('ping') }).strict(),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

const ObjectiveStatusSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(['pending', 'done']),
  })
  .strict();

const LevelCompleteResultSchema = z
  .object({
    xp: z.number().int().min(0),
    rank: z.enum(['S', 'A', 'B', 'C']),
    breakdown: z.array(
      z
        .object({
          label: z.string().min(1),
          xp: z.number().int(),
        })
        .strict(),
    ),
    newBadges: z.array(z.string().min(1)),
    unlocked: z.array(z.string().min(1)),
    explain: z.array(ExplainCardSchema),
    skillsGained: z.array(z.string().min(1)),
  })
  .strict();

export const ServerMessageSchema = z.discriminatedUnion('t', [
  z
    .object({
      t: z.literal('session_state'),
      level: PublicLevelSchema,
      objectives: z.array(ObjectiveStatusSchema),
      hintsUsed: z.number().int().min(0),
      hintsTotal: z.literal(3),
      completed: z.boolean(),
    })
    .strict(),
  z.object({ t: z.literal('stdout'), d: z.string() }).strict(),
  z
    .object({
      t: z.literal('objective'),
      id: z.string().min(1),
      status: z.enum(['done', 'pending']),
    })
    .strict(),
  z
    .object({
      t: z.literal('hint'),
      tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      text: z.string().min(1),
      penaltyPct: z.number().min(0).max(100),
    })
    .strict(),
  z.object({ t: z.literal('tux'), text: z.string() }).strict(),
  z.object({ t: z.literal('coach'), text: z.string() }).strict(),
  z.object({ t: z.literal('level_complete'), result: LevelCompleteResultSchema }).strict(),
  z
    .object({
      t: z.literal('closing'),
      reason: z.enum(['idle', 'max_age', 'server_shutdown', 'replaced', 'abandoned']),
    })
    .strict(),
  z.object({ t: z.literal('error'), message: z.string().min(1) }).strict(),
  z.object({ t: z.literal('pong') }).strict(),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
