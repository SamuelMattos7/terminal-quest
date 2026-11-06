import { z } from 'zod';
import { regexSource } from './validation.js';

// Skill graph node for plan.md §10.3 (`skills.yaml` entries).
export const SkillSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    group: z.string().min(1),
    world: z.number().int().min(1).max(5),
    prereqs: z.array(z.string().min(1)).default([]),
    detect: regexSource().optional(),
  })
  .strict();

export type Skill = z.infer<typeof SkillSchema>;
