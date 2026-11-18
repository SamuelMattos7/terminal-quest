import { setTimeout as sleep } from 'node:timers/promises';
import {
  CapacityResponseSchema,
  GuestResponseSchema,
  HealthResponseSchema,
  OkResponseSchema,
  RetryAfterSecondsSchema,
  StartSessionResponseSchema,
  type LoadTestOptions,
} from '@terminal-quest/shared';
import { LoadPeer } from './peer.js';
import { latencySummary } from './metrics.js';

const levelPath = '/api/levels/w1-01-first-words/start';
type Session = { cookie: string; id: string; peer?: LoadPeer };

export async function request(base: string, path: string, method: string, cookie?: string) {
  return fetch(new URL(path, base), {
    method,
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
}

async function guest(base: string): Promise<string> {
  const response = await request(base, '/api/guest', 'POST');
  if (response.status !== 200) throw new Error(`guest returned HTTP ${response.status}`);
  GuestResponseSchema.parse(await response.json());
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith('tq_session='));
  if (!cookie) throw new Error('guest did not set tq_session');
  return cookie.split(';')[0];
}

export async function assertCapacity(response: Response) {
  if (response.status !== 429) throw new Error(`capacity probe returned HTTP ${response.status}`);
  const retryAfter = RetryAfterSecondsSchema.parse(response.headers.get('retry-after'));
  const body = CapacityResponseSchema.parse(await response.json());
  return { status: response.status, retryAfter, ...body };
}

export interface WorkloadTiming {
  rampMs: number;
  holdMs: number;
  quietMs: number;
  cooldownMs: number;
  probeDelay: () => number;
}

const qualifyingTiming: WorkloadTiming = {
  rampMs: 60_000,
  holdMs: 300_000,
  quietMs: 61_000,
  cooldownMs: 60_000,
  probeDelay: () => 2000 + Math.random() * 3000,
};

/** Timings are injectable for driver tests; the CLI always uses qualifyingTiming. */
export async function runScenario(
  options: LoadTestOptions,
  report: Record<string, unknown>,
  signal: AbortSignal,
  log: (event: string) => void,
  timing = qualifyingTiming,
): Promise<void> {
  const sessions: Session[] = [];
  const starts: number[] = [];
  const echoes: number[] = [];
  const rampEchoes: number[] = [];
  const completions: number[] = [];
  const loops: Promise<void>[] = [];
  const stop = new AbortController();
  let loopError: unknown;
  let holding = false;
  const stopOnSignal = () => stop.abort();
  signal.addEventListener('abort', stopOnSignal, { once: true });
  const pause = (ms: number) => sleep(ms, undefined, { signal });
  const check = () => {
    signal.throwIfAborted();
    if (loopError) throw loopError;
    for (const session of sessions) session.peer?.assertActive();
  };
  const start = async (cookie: string) => {
    const began = performance.now();
    const response = await request(options.baseUrl, levelPath, 'POST', cookie);
    if (response.status !== 200) throw new Error(`start returned HTTP ${response.status}`);
    const data = StartSessionResponseSchema.parse(await response.json());
    starts.push(performance.now() - began);
    const session: Session = { cookie, id: data.sessionId };
    sessions.push(session); // keep ownership even if socket acquisition fails
    const url = new URL(data.wsPath, options.baseUrl);
    if (url.origin !== options.baseUrl || !url.pathname.startsWith('/ws/sessions/')) {
      throw new Error('start returned an unexpected WebSocket URL');
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    session.peer = new LoadPeer(url, cookie, options.origin);
    await session.peer.ready();
    return session.peer;
  };
  const execute = async () => {
    signal.throwIfAborted();
    const health = await request(options.baseUrl, '/healthz', 'GET');
    if (health.status !== 200 || !HealthResponseSchema.parse(await health.json()).docker) {
      throw new Error('target is not healthy with Docker ready');
    }
    report.startedAt = new Date().toISOString();
    if (options.mode === 'idle') {
      const peer = await start(await guest(options.baseUrl));
      const began = performance.now();
      log('idle session ready; waiting without stdin');
      await peer.wait(
        (message) => message.t === 'closing' && message.reason === 'idle',
        options.idleTtlSeconds * 1000 + 45_000,
      );
      report.idleExpired = true;
      report.idleWaitMs = performance.now() - began;
      return;
    }
    const cookies: string[] = [];
    for (let i = 0; i < 21; i++) cookies.push(await guest(options.baseUrl));
    // Guest requests and WS upgrades also count against the common 60/min/IP cap.
    log('21 guests created; waiting 61 s for a fresh HTTP rate-limit window');
    await pause(timing.quietMs);
    const rampBegan = performance.now();
    report.rampStartedAt = new Date().toISOString();
    for (let i = 0; i < 20; i++) {
      check();
      await pause(Math.max(0, (i * timing.rampMs) / 19 - (performance.now() - rampBegan)));
      const peer = await start(cookies[i]);
      loops.push(
        (async () => {
          while (!stop.signal.aborted) {
            const duringHold = holding;
            const latency = await peer.echo();
            (duringHold ? echoes : rampEchoes).push(latency);
            await sleep(timing.probeDelay(), undefined, { signal: stop.signal });
          }
        })().catch((error: unknown) => {
          if (!stop.signal.aborted) {
            loopError = error;
            stop.abort();
          }
        }),
      );
      log(`active sessions: ${i + 1}/20`);
    }
    check();
    report.holdStartedAt = new Date().toISOString();
    log('20 sessions active; testing guest 21 at capacity');
    // Track an unexpected successful probe so even that sandbox is cleaned up.
    const capacity = await request(options.baseUrl, levelPath, 'POST', cookies[20]);
    if (capacity.status === 200) {
      const data = StartSessionResponseSchema.parse(await capacity.json());
      sessions.push({ cookie: cookies[20], id: data.sessionId });
      throw new Error('guest 21 unexpectedly acquired a sandbox');
    }
    report.capacity = await assertCapacity(capacity);
    holding = true;
    const heldFrom = performance.now();
    for (let elapsed = 0; elapsed < timing.holdMs; elapsed += 1000) {
      await pause(Math.min(1000, timing.holdMs - elapsed));
      check();
    }
    report.holdDurationMs = performance.now() - heldFrom;
    holding = false;
    report.holdEndedAt = new Date().toISOString();
    stop.abort();
    await Promise.all(loops);
    check();
    log('hold finished; completing all 20 levels');
    for (const session of sessions) completions.push(await session.peer!.complete());
    const startP95 = latencySummary(starts).p95Ms;
    const echoP50 = latencySummary(echoes).p50Ms;
    report.latencyTargetsPassed =
      startP95 !== null && startP95 < 5000 && echoP50 !== null && echoP50 < 100;
    if (!report.latencyTargetsPassed)
      throw new Error('start p95 or full-load echo p50 missed target');
    report.workloadPassed = true;
  };
  let runError: unknown;
  try {
    await execute();
  } catch (error) {
    runError = error;
  }
  {
    stop.abort();
    await Promise.all(loops);
    signal.removeEventListener('abort', stopOnSignal);
    report.latencies = {
      start: latencySummary(starts),
      echo: latencySummary(echoes),
      completion: latencySummary(completions),
    };
    // Persist raw timing evidence, never cookies or terminal frames.
    report.rawMs = { starts, echoes, rampEchoes, completions };
    report.sessionIds = sessions.map((session) => session.id);
    for (const session of sessions) session.peer?.close();
    const cleanup = await Promise.allSettled(
      sessions.map(async (session) => {
        const response = await request(
          options.baseUrl,
          `/api/sessions/${encodeURIComponent(session.id)}`,
          'DELETE',
          session.cookie,
        );
        if (response.status === 404) return; // idle expiry already retired ownership
        if (response.status !== 200) throw new Error(`DELETE returned HTTP ${response.status}`);
        OkResponseSchema.parse(await response.json());
      }),
    );
    report.cleanupErrors = cleanup.flatMap((result) =>
      result.status === 'rejected' ? [String(result.reason)] : [],
    );
    report.cleanupRequestedAt = new Date().toISOString();
    if (!signal.aborted) {
      log('sessions closed; waiting 60 s for host cleanup/resource sampling');
      try {
        await pause(timing.cooldownMs);
      } catch (error) {
        runError ??= error;
      }
    }
    if (runError !== undefined) throw runError;
    if (cleanup.some((result) => result.status === 'rejected')) {
      throw new Error('one or more session cleanup requests failed; inspect report');
    }
  }
}
