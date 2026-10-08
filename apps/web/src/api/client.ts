import type {
  DailyResponse,
  GuestResponse,
  MeResponse,
  OkResponse,
  ProgressResponse,
  PublicLevel,
  ReviewResponse,
  SkillsResponse,
  SpellbookResponse,
  StartSessionResponse,
  WorldsResponse,
} from '@terminal-quest/shared';
import {
  DailyResponseSchema,
  GuestResponseSchema,
  MeResponseSchema,
  OkResponseSchema,
  ProgressResponseSchema,
  PublicLevelSchema,
  ReviewResponseSchema,
  SkillsResponseSchema,
  SpellbookResponseSchema,
  StartSessionResponseSchema,
  WorldsResponseSchema,
} from '@terminal-quest/shared';
import type { ZodType } from 'zod';

/** Typed HTTP error from the Terminal Quest API. `status` is 0 on network failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
    });
  } catch {
    throw new ApiError(0, 'Network error: could not reach the server.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, await readErrorMessage(res), readRetryAfter(res));
  }
  const parsed = schema.safeParse(await readJson(res));
  if (!parsed.success) {
    throw new ApiError(res.status, 'Bad response from server.');
  }
  return parsed.data;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Server errors use the `{ error: string }` shape (see apps/server routes). */
async function readErrorMessage(res: Response): Promise<string> {
  const body = await readJson(res);
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const message = (body as { error: unknown }).error;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return `Request failed (${res.status}).`;
}

function readRetryAfter(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (raw === null) {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}

function post(): RequestInit {
  return { method: 'POST' };
}

/** Typed client for the plan.md §6 JSON API. All payloads are zod-parsed. */
export const api = {
  guest(): Promise<GuestResponse> {
    return request('/api/guest', GuestResponseSchema, post());
  },
  me(): Promise<MeResponse> {
    return request('/api/me', MeResponseSchema);
  },
  worlds(): Promise<WorldsResponse> {
    return request('/api/worlds', WorldsResponseSchema);
  },
  level(id: string): Promise<PublicLevel> {
    return request(`/api/levels/${encodeURIComponent(id)}`, PublicLevelSchema);
  },
  startLevel(id: string): Promise<StartSessionResponse> {
    const path = `/api/levels/${encodeURIComponent(id)}/start`;
    return request(path, StartSessionResponseSchema, post());
  },
  deleteSession(id: string): Promise<OkResponse> {
    const path = `/api/sessions/${encodeURIComponent(id)}`;
    return request(path, OkResponseSchema, { method: 'DELETE' });
  },
  resetSession(id: string): Promise<StartSessionResponse> {
    const path = `/api/sessions/${encodeURIComponent(id)}/reset`;
    return request(path, StartSessionResponseSchema, post());
  },
  progress(): Promise<ProgressResponse> {
    return request('/api/progress', ProgressResponseSchema);
  },
  skills(): Promise<SkillsResponse> {
    return request('/api/skills', SkillsResponseSchema);
  },
  spellbook(): Promise<SpellbookResponse> {
    return request('/api/spellbook', SpellbookResponseSchema);
  },
  daily(): Promise<DailyResponse> {
    return request('/api/daily', DailyResponseSchema);
  },
  review(): Promise<ReviewResponse> {
    return request('/api/review', ReviewResponseSchema);
  },
};
