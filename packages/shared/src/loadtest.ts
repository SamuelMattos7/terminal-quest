import { z } from 'zod';

const HttpOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  }, 'expected an HTTP(S) origin without credentials, path, query or fragment')
  .transform((value) => new URL(value).origin);

export const LoadTestOptionsSchema = z.object({
  baseUrl: HttpOriginSchema,
  origin: HttpOriginSchema,
  out: z.string().min(1),
  mode: z.enum(['capacity', 'idle']).default('capacity'),
  idleTtlSeconds: z.coerce.number().int().positive().max(900).default(30),
});

export const LoadSampleOptionsSchema = z.object({
  serverPid: z.coerce.number().int().positive(),
  out: z.string().min(1),
});

export const CapacityResponseSchema = z
  .object({ error: z.literal('sandbox capacity reached') })
  .strict();

export const RetryAfterSecondsSchema = z.string().regex(/^[1-9]\d*$/);

export const LoadDockerStatsSchema = z.object({
  Name: z.string().min(1),
  CPUPerc: z.string().min(1),
  MemUsage: z.string().min(1),
  PIDs: z.string().min(1),
});

export const LoadManagedIdsSchema = z.array(z.string().regex(/^[a-f0-9]{12,64}$/));

export type LoadTestOptions = z.infer<typeof LoadTestOptionsSchema>;
