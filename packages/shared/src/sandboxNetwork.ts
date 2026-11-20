import { z } from 'zod';

export const SandboxSidecarSchema = z.enum(['web', 'ssh', 'dns']);
export type SandboxSidecar = z.infer<typeof SandboxSidecarSchema>;

export const SandboxNetworkSchema = z.enum(['none', 'lan']);

export const SandboxSidecarsSchema = SandboxSidecarSchema.array().refine(
  (sidecars) => new Set(sidecars).size === sidecars.length,
  'sidecars must be unique',
);
