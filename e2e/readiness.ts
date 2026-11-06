import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { HealthResponseSchema } from '../packages/shared/src/api.js';

export async function isSandboxReady(
  response: Pick<APIResponse, 'ok' | 'json'> | undefined,
): Promise<boolean> {
  if (!response?.ok()) return false;
  const health = HealthResponseSchema.safeParse(await response.json().catch(() => undefined));
  return health.success && health.data.ok && health.data.docker;
}

export async function waitForSandbox(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get('/healthz', { timeout: 2_000 }).catch(() => undefined);
        return isSandboxReady(response);
      },
      { message: 'waiting for the API and Docker to become ready', timeout: 90_000 },
    )
    .toBe(true);
}
