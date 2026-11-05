import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { testConfig } from './config.js';
import { attempts } from './db/schema.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { makeTempDb, type TempDb } from './testUtils.js';

const publicOrigin = 'https://quest.example.test';
const webRoot = new URL('../../web/dist/', import.meta.url);

async function bootProduction(database: TempDb, fakeDocker = false) {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (address === null || typeof address === 'string') throw new Error('missing TCP port');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    listener.close((err) => (err ? reject(err) : resolve())),
  );
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      ...(fakeDocker ? ['--import', new URL('./fixtures/shutdown.mjs', import.meta.url).href] : []),
      fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    ],
    {
      // Production paths must resolve from the installed module, not cwd.
      cwd: tmpdir(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DB_PATH: database.db.$client.name,
        DOCKER_SOCKET: '/nonexistent/docker.sock',
        PUBLIC_ORIGIN: publicOrigin,
      },
      stdio: fakeDocker ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`production boot timed out: ${output}`)),
      15_000,
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`production exited ${code}: ${output}`));
    });
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('server listening')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout!.on('data', collect);
    child.stderr!.on('data', collect);
  }).catch(async (err: unknown) => {
    await stopChild(child);
    throw err;
  });
  return { child, origin, output: () => output };
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
}

// Exercise the documented node command, compiled modules, and real Vite assets.
// `pnpm verify` builds both packages before this Docker-free regression suite.
describe('production server delivery and security (A07/A08)', () => {
  let child: ChildProcess | undefined;
  let database: TempDb | undefined;
  let origin: string;
  let cookie: string;
  const html = readFileSync(new URL('index.html', webRoot), 'utf8');

  beforeAll(async () => {
    database = makeTempDb();
    ({ child, origin } = await bootProduction(database));
    const guest = await fetch(`${origin}/api/guest`, { method: 'POST' });
    expect(guest.status).toBe(200);
    cookie = guest.headers.get('set-cookie')!.split(';')[0];
  }, 20_000);

  afterAll(async () => {
    await stopChild(child);
    database?.cleanup();
  });

  it('serves the built index and refreshes every client route', async () => {
    for (const path of [
      '/',
      '/map',
      '/play/w1-01-first-words',
      '/spellbook',
      '/skills',
      '/profile',
      '/settings',
      '/unknown-client-route?from=bookmark',
    ]) {
      const response = await fetch(origin + path, { headers: { accept: 'text/html' } });
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toContain('max-age=0');
      expect(await response.text()).toBe(html);
    }
    const head = await fetch(`${origin}/map`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('delivers the emitted JavaScript, CSS, and self-hosted fonts with correct bytes and MIME', async () => {
    const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
    expect(paths.some((path) => path.endsWith('.js'))).toBe(true);
    const cssPath = paths.find((path) => path.endsWith('.css'))!;
    const css = readFileSync(new URL(`.${cssPath}`, webRoot), 'utf8');
    const font = css.match(/url\((?:["'])?(\/assets\/[^)"']+\.woff2)/)?.[1];
    expect(font).toBeDefined();
    for (const path of [...paths, font!]) {
      const response = await fetch(origin + path);
      expect(response.status, path).toBe(200);
      const mime = path.endsWith('.js')
        ? /javascript/
        : path.endsWith('.css')
          ? /text\/css/
          : /font\/woff2/;
      expect(response.headers.get('content-type')).toMatch(mime);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        readFileSync(new URL(`.${path}`, webRoot)),
      );
    }
  });

  it('keeps API, health, and WebSocket errors out of the SPA fallback', async () => {
    expect(await (await fetch(`${origin}/healthz`)).json()).toEqual({ ok: true, docker: false });
    expect((await fetch(`${origin}/api/me`)).status).toBe(401);
    expect((await fetch(`${origin}/api/me`, { headers: { cookie } })).status).toBe(200);
    for (const path of ['/api', '/api/missing', '/ws', '/ws/missing', '/healthz/missing']) {
      const response = await fetch(origin + path, { headers: { cookie, accept: 'text/html' } });
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
    }
  });

  it('never substitutes HTML for missing assets, source files, traversal, or POSTs', async () => {
    for (const path of [
      '/assets/missing.js',
      '/assets/missing.css',
      '/missing.js',
      '/.env.production',
      '/packages/levels/content/w1/01-first-words/solution.sh',
    ]) {
      const response = await fetch(origin + path, { headers: { accept: 'text/html' } });
      expect(response.status, path).toBe(404);
      expect(await response.text()).not.toBe(html);
    }
    const response = await fetch(`${origin}/map`, {
      method: 'POST',
      headers: { accept: 'text/html' },
    });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toBe(html);
    const traversal = await fetch(`${origin}/assets/%2e%2e%2f%2e%2e%2fpackage.json`);
    // fastify-static explicitly forbids escape from its root.
    expect(traversal.status).toBe(403);
    expect(await traversal.text()).not.toContain('terminal-quest');
  });

  it('preserves the WebSocket upgrade and session authorization on the production port', async () => {
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws/sessions/missing`, {
      origin: publicOrigin,
      headers: { cookie },
    });
    try {
      const [code] = await once(socket, 'close');
      expect(code).toBe(4401);
    } finally {
      socket.terminate();
    }
  });

  it('sets Secure, HttpOnly, SameSite=Lax and a host-only cookie through the TLS proxy', async () => {
    const response = await fetch(`${origin}/api/guest`, {
      method: 'POST',
      headers: {
        'x-forwarded-for': '203.0.113.7',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'quest.example.test',
      },
    });
    expect(response.status).toBe(200);
    const [token, ...attributes] = response.headers.get('set-cookie')!.split('; ');
    expect(token).toMatch(/^tq_session=[a-f0-9]{64}$/);
    expect(attributes.sort()).toEqual(['HttpOnly', 'Path=/', 'SameSite=Lax', 'Secure']);
  });

  it('restricts CSP on the entry page and SPA refreshes to local assets and the public WebSocket', async () => {
    for (const path of ['/', '/play/w1-01-first-words']) {
      const response = await fetch(origin + path, {
        headers: { 'x-forwarded-host': 'spoof.example.test' },
      });
      const directives = response.headers.get('content-security-policy')?.split('; ');
      expect(directives).toEqual([
        "default-src 'self'",
        "connect-src 'self' wss://quest.example.test",
        "style-src 'self' 'unsafe-inline'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ]);
    }
  });

  it('rate limits by the immediate client of the loopback proxy and ignores older hops', async () => {
    const request = (forwardedFor: string) =>
      fetch(`${origin}/api/me`, { headers: { cookie, 'x-forwarded-for': forwardedFor } });
    for (let n = 1; n <= 60; n++) {
      const response = await request(`192.0.2.${n}, 203.0.113.8`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-ratelimit-remaining')).toBe(String(60 - n));
      await response.arrayBuffer();
    }
    expect((await request('192.0.2.61, 203.0.113.8')).status).toBe(429);
    expect((await request('203.0.113.9')).status).toBe(200);
  });

  it('ignores forwarding headers from a non-loopback peer', async () => {
    const app = await buildApp({
      db: database!.db,
      config: testConfig(),
      startReaper: false,
      webRoot: fileURLToPath(webRoot),
    });
    try {
      for (const [index, forwardedFor] of ['203.0.113.10', '203.0.113.11'].entries()) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/guest',
          remoteAddress: '192.0.2.100',
          headers: { 'x-forwarded-for': forwardedFor },
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers['x-ratelimit-remaining']).toBe(String(59 - index));
      }
    } finally {
      await app.close();
    }
  });
});

it.each(['SIGTERM', 'SIGINT'] as const)(
  'drains an active production WebSocket and sandbox on %s',
  async (signal) => {
    const database = makeTempDb();
    let child: ChildProcess | undefined;
    let socket: WebSocket | undefined;
    try {
      const server = await bootProduction(database, true);
      child = server.child;
      const guest = await fetch(`${server.origin}/api/guest`, { method: 'POST' });
      const cookie = guest.headers.get('set-cookie')!.split(';')[0];
      const start = await fetch(`${server.origin}/api/levels/w1-01-first-words/start`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(start.status).toBe(200);
      const { wsPath } = (await start.json()) as { wsPath: string };
      socket = new WebSocket(server.origin.replace('http:', 'ws:') + wsPath, {
        origin: publicOrigin,
        headers: { cookie },
      });
      const frames: unknown[] = [];
      socket.on('message', (frame) => frames.push(JSON.parse(String(frame)) as unknown));
      await once(socket, 'message', { signal: AbortSignal.timeout(5_000) });
      const deadline = AbortSignal.timeout(5_000);
      const drained = Promise.all([
        once(socket, 'close', { signal: deadline }),
        once(child, 'close', { signal: deadline }),
      ]);
      // Windows terminates the child outright for kill(SIGTERM/SIGINT).
      if (process.platform === 'win32') child.send(signal);
      else child.kill(signal);
      const [[closeCode], exit] = await drained;
      expect(closeCode).toBe(1005);
      expect(frames).toContainEqual({ t: 'closing', reason: 'server_shutdown' });
      expect(exit).toEqual([0, null]);
      expect(server.output().match(/fixture sandbox destroyed/g)).toHaveLength(1);
      expect(database.db.select().from(attempts).all()).toEqual([
        expect.objectContaining({ status: 'abandoned' }),
      ]);
    } finally {
      socket?.terminate();
      await stopChild(child);
      database.cleanup();
    }
  },
  20_000,
);
