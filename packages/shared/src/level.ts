import { z } from 'zod';
import { CheckSchema } from './checks.js';

// Full `level.yaml` schema for plan.md §8.1. Structural rules from §12.3
// (exactly 3 hints, story ≤ 80 words, title ≤ 40 chars, teaches ≤ 3) live
// here so `levels:lint` (T2.1) and the server loader share one source.

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

const SandboxSchema = z
  .object({
    profile: z.enum(['basic', 'admin']).default('basic'),
    network: z.enum(['none', 'lan']).default('none'),
    sidecars: z.array(z.enum(['web', 'ssh', 'dns'])).default([]),
    image: z.string().min(1).default('tq-base'),
    start_cwd: z.string().min(1).regex(/^\//, 'must be an absolute path').default('/home/player'),
    resources: z
      .object({
        memory_mb: z.number().int().positive().default(256),
        cpus: z.number().positive().default(0.5),
        pids: z.number().int().positive().default(128),
      })
      .strict()
      .default({}),
    capabilities: z.array(z.string().min(1)).default([]),
    sudo_allow: z.array(z.string().min(1)).default([]),
    // §12.2: start cron when profile is admin and this is true. The daemon
    // start itself lands in T10.1 (no admin levels exist yet).
    needs_cron: z.boolean().default(true),
  })
  .strict();

const SetupDirSchema = z
  .object({
    path: z.string().min(1).regex(/^\//, 'must be an absolute path'),
    owner: z.string().min(1).default('player'),
    mode: z
      .string()
      .regex(/^[0-7]{3,4}$/, 'must be an octal mode like "755"')
      .default('755'),
  })
  .strict();

const SetupFileSchema = z
  .object({
    path: z.string().min(1).regex(/^\//, 'must be an absolute path'),
    owner: z.string().min(1).default('player'),
    mode: z
      .string()
      .regex(/^[0-7]{3,4}$/, 'must be an octal mode like "644"')
      .optional(),
    content: z.string().optional(),
    content_file: z.string().min(1).optional(),
  })
  .strict();

const SetupGeneratorSchema = z
  .object({
    script: z.string().min(1),
  })
  .strict();

const SetupSchema = z
  .object({
    dirs: z.array(SetupDirSchema).default([]),
    files: z.array(SetupFileSchema).default([]),
    generators: z.array(SetupGeneratorSchema).default([]),
    commands: z.array(z.string().min(1)).default([]),
    rc_extra: z.string().optional(),
  })
  .strict();

const ObjectiveSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'objective id must be a slug'),
    text: z.string().min(1),
    bonus: z.boolean().default(false),
    optional: z.boolean().default(false),
    hold: z.boolean().default(false),
    check: CheckSchema,
  })
  .strict();

const CoachRuleSchema = z
  .object({
    when: z
      .object({
        exit_code: z.number().int().min(0).max(255).optional(),
        command_regex: z.string().min(1).optional(),
      })
      .strict()
      .superRefine((v, ctx) => {
        if (v.exit_code === undefined && v.command_regex === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'coach when needs at least one of exit_code, command_regex',
          });
        }
      }),
    say: z.string().min(1),
  })
  .strict();

export const ExplainCardSchema = z
  .object({
    command: z.string().min(1),
    parts: z
      .array(
        z
          .object({
            token: z.string().min(1),
            meaning: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type ExplainCard = z.infer<typeof ExplainCardSchema>;

const CheatsheetEntrySchema = z
  .object({
    skill: z.string().min(1),
    syntax: z.string().min(1),
    note: z.string().min(1),
  })
  .strict();

const SolutionsSchema = z
  .object({
    reference: z.string().min(1),
    wrong: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const LevelSchema = z
  .object({
    id: z.string().regex(/^w[1-5]-\d{2}-[a-z0-9-]+$/, 'id must look like w1-02-where-am-i'),
    world: z.number().int().min(1).max(5),
    order: z.number().int().min(1),
    title: z.string().min(1).max(40),
    kind: z.enum(['lesson', 'boss', 'review', 'daily']),
    difficulty: z.number().int().min(1).max(5),
    estimated_minutes: z.number().int().positive(),
    story: z.string().min(1),
    teaches: z.array(z.string().min(1)).min(1).max(3),
    par_commands: z.number().int().positive(),
    xp: z.number().int().positive(),
    sandbox: SandboxSchema.default({}),
    setup: SetupSchema.optional(),
    objectives: z.array(ObjectiveSchema).min(1),
    hints: z.array(z.string().min(1)).length(3),
    coach: z.array(CoachRuleSchema).default([]),
    explain: z.array(ExplainCardSchema).default([]),
    cheatsheet: z.array(CheatsheetEntrySchema).default([]),
    success_message: z.string().min(1),
    forbidden_commands: z.array(z.string().min(1)).default([]),
    daily_eligible: z.boolean().optional(),
    solutions: SolutionsSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (countWords(v.story) > 80) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `story must be <= 80 words (got ${countWords(v.story)})`,
        path: ['story'],
      });
    }
    const ids = v.objectives.map((o) => o.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'objective ids must be unique',
        path: ['objectives'],
      });
    }
    if (!v.objectives.some((o) => !o.bonus && !o.optional)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one objective must be required (not bonus, not optional)',
        path: ['objectives'],
      });
    }
  });

export type Level = z.infer<typeof LevelSchema>;

/** Flatten a ZodError into `path: message` lines (used by the level loader). */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '(root)';
    return `${path}: ${i.message}`;
  });
}
