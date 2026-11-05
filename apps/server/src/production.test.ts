import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { makeTempDb, type TempDb } from './testUtils.js';

// Exercise the documented node command, compiled modules, and real Vite assets.
// `pnpm verify` builds both packages before this Docker-free regression suite.
describe('production server delivery (A07)', () => {
  let child: ChildProcess | undefined;
  let database: TempDb | undefined;
  let origin: string;
  let cookie: string;
  const webRoot = new URL('../../web/dist/', import.meta.url);
  const html = readFileSync(new URL('index.html', webRoot), 'utf8');

  beforeAll(async () => {
    const listener = createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const address = listener.address();
    if (address === null || typeof address === 'string') throw new Error('missing TCP port');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      listener.close((err) => (err ? reject(err) : resolve())),
    );
    database = makeTempDb();
    origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url))], {
      // Production paths must resolve from the installed module, not cwd.
      cwd: tmpdir(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DB_PATH: database.db.$client.name,
        DOCKER_SOCKET: '/nonexistent/docker.sock',
        PUBLIC_ORIGIN: origin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error(`production boot timed out: ${output}`)),
        15_000,
      );
      child!.once('error', reject);
      child!.once('exit', (code) => {
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
      child!.stdout!.on('data', collect);
      child!.stderr!.on('data', collect);
    });
    const guest = await fetch(`${origin}/api/guest`, { method: 'POST' });
    expect(guest.status).toBe(200);
    cookie = guest.headers.get('set-cookie')!.split(';')[0];
  }, 20_000);

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
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
      origin,
      headers: { cookie },
    });
    try {
      const [code] = await once(socket, 'close');
      expect(code).toBe(4401);
    } finally {
      socket.terminate();
    }
  });
});
