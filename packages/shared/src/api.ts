import { z } from 'zod';

// Minimal T0.1 contract for GET /healthz.
// Full protocol / level / checks schemas land in T0.2 (plan.md §8).
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  docker: z.boolean(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
