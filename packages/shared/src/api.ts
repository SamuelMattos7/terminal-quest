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
