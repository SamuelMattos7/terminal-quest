import { z } from 'zod';

export const DockerImageSchema = z
  .string()
  .regex(
    /^(?:(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d+)?\/)?[a-z0-9]+(?:[._-]+[a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-]+[a-z0-9]+)*)*(?::[\w][\w.-]{0,127})?(?:@[a-zA-Z][a-zA-Z0-9_+.-]*:[a-fA-F0-9]{32,})?$/,
    'invalid Docker image reference',
  );

export const SandboxEnvSchema = z.object({
  SANDBOX_IMAGE: DockerImageSchema.optional(),
  SANDBOX_RUNTIME: z
    .union([z.literal(''), z.string().regex(/^[\w][\w.-]*$/, 'invalid Docker runtime name')])
    .default('')
    .transform((name) => name || undefined),
});

export function regexSource(allowSecrets = false) {
  return z
    .string()
    .min(1)
    .refine((source) => {
      const pattern = allowSecrets ? source.replace(/\{\{secret:[\w-]+\}\}/g, 'secret') : source;
      try {
        new RegExp(pattern);
        return true;
      } catch {
        return false;
      }
    }, 'invalid regular expression');
}
