import { z } from 'zod';
import type { Level } from './level.js';

// Whitelisted public DTO for `GET /api/levels/:id` (plan.md §6). Checks,
// setup, secrets, solutions, and hint text must never reach the client —
// hints are served only via the socket when requested (hard rule 1).
const PublicObjectiveSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    optional: z.boolean(),
    bonus: z.boolean(),
  })
  .strict();

export const PublicLevelSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    story: z.string().min(1),
    kind: z.enum(['lesson', 'boss', 'review', 'daily']),
    objectives: z.array(PublicObjectiveSchema),
    teaches: z.array(z.string().min(1)),
    parCommands: z.number().int().positive(),
    xp: z.number().int().positive(),
    hintCount: z.number().int().positive(),
  })
  .strict();

export type PublicLevel = z.infer<typeof PublicLevelSchema>;

/** Strip a full level down to its public DTO. Never add check/setup/solutions/hints here. */
export function toPublicLevel(level: Level): PublicLevel {
  return PublicLevelSchema.parse({
    id: level.id,
    title: level.title,
    story: level.story,
    kind: level.kind,
    objectives: level.objectives.map((o) => ({
      id: o.id,
      text: o.text,
      optional: o.optional,
      bonus: o.bonus,
    })),
    teaches: level.teaches,
    parCommands: level.par_commands,
    xp: level.xp,
    hintCount: level.hints.length,
  });
}

// Minimal T0.1 contract for GET /healthz.
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  docker: z.boolean(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// Auth + progression shapes for plan.md §6 (T3.1).

export const UserShapeSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().nullable(),
    xp: z.number().int().min(0),
    streakDays: z.number().int().min(0),
  })
  .strict();

export type UserShape = z.infer<typeof UserShapeSchema>;

export const GuestResponseSchema = z
  .object({
    user: UserShapeSchema,
  })
  .strict();

export type GuestResponse = z.infer<typeof GuestResponseSchema>;

export const MeResponseSchema = z
  .object({
    user: UserShapeSchema,
    playerLevel: z.number().int().min(1),
    xpToNext: z.number().int().min(0),
    badges: z.array(z.string().min(1)),
  })
  .strict();

export type MeResponse = z.infer<typeof MeResponseSchema>;

export const LevelStateSchema = z.enum(['locked', 'available', 'completed']);

export type LevelState = z.infer<typeof LevelStateSchema>;

const WorldsLevelSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    kind: z.enum(['lesson', 'boss', 'review', 'daily']),
    difficulty: z.number().int().min(1).max(5),
    estimatedMinutes: z.number().int().positive(),
    state: LevelStateSchema,
    bestRank: z.enum(['S', 'A', 'B', 'C']).optional(),
  })
  .strict();

export const WorldsResponseSchema = z
  .object({
    worlds: z.array(
      z
        .object({
          id: z.number().int().min(1),
          title: z.string().min(1),
          blurb: z.string().min(1),
          levels: z.array(WorldsLevelSchema),
        })
        .strict(),
    ),
  })
  .strict();

export type WorldsResponse = z.infer<typeof WorldsResponseSchema>;

// Session lifecycle shapes for plan.md §6 (T3.2).

export const StartSessionResponseSchema = z
  .object({
    sessionId: z.string().min(1),
    wsPath: z.string().min(1),
  })
  .strict();

export type StartSessionResponse = z.infer<typeof StartSessionResponseSchema>;

export const OkResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export type OkResponse = z.infer<typeof OkResponseSchema>;
