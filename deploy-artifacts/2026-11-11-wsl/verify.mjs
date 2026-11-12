/* global Buffer, URL, console, process */
// Run as tq inside the rehearsal distro. Output excludes cookies and terminal data.
import assert from 'node:assert/strict';
import https from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const checkout = process.env.TQ_CHECKOUT ?? '/home/tq/terminal-quest';
const require = createRequire(`${checkout}/apps/server/package.json`);
const WebSocket = require('ws');
const { z } = require('zod');
const shared = await import(pathToFileURL(`${checkout}/packages/shared/dist/index.js`));
const exec = promisify(execFile);
const ca = readFileSync('/home/tq/caddy-root.crt');
const privateState = '/home/tq/.t93-rehearsal.json';
const State = z.object({ cookie: z.string(), userId: z.string(), xp: z.number() }).strict();
const level = 'w1-01-first-words';
const output = (event, details = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));
const command = async (file, args) => (await exec(file, args, { timeout: 60_000 })).stdout.trim();
const control = (...args) => command('systemctl', ['--user', ...args]);
const managed = async () =>
  (await command('docker', ['ps', '-aq', '--filter', 'label=tq.managed=true']))
    .split('\n')
    .filter(Boolean);

function request(path, method = 'GET', cookie) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      new URL(path, 'https://localhost'),
      {
        ca,
        method,
        headers: cookie ? { Cookie: cookie } : {},
        timeout: 15_000,
      },
      (res) => {
        const chunks = [];
        const authorized = res.socket.authorized;
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            authorized,
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('HTTPS timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function json(path, schema, method = 'GET', cookie) {
  const res = await request(path, method, cookie);
  assert.equal(res.status, 200);
  return schema.parse(JSON.parse(res.body.toString()));
}

async function guest() {
  const res = await request('/api/guest', 'POST');
  assert.equal(res.status, 200);
  const { user } = shared.GuestResponseSchema.parse(JSON.parse(res.body.toString()));
  const header = res.headers['set-cookie'].find((value) => value.startsWith('tq_session='));
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'])
    assert.ok(header.includes(flag));
  output('guest-cookie', { secure: true, httpOnly: true, sameSite: 'Lax' });
  return { cookie: header.split(';')[0], userId: user.id, xp: 0 };
}

async function start(state) {
  const session = await json(
    `/api/levels/${level}/start`,
    shared.StartSessionResponseSchema,
    'POST',
    state.cookie,
  );
  const ws = new WebSocket(
    new URL(session.wsPath, 'https://localhost').href.replace('https:', 'wss:'),
    {
      ca,
      headers: { Cookie: state.cookie, Origin: 'https://localhost' },
      handshakeTimeout: 15_000,
    },
  );
  const messages = [];
  let failure;
  ws.on('message', (raw) => {
    try {
      messages.push(shared.ServerMessageSchema.parse(JSON.parse(String(raw))));
    } catch (error) {
      failure = error;
    }
  });
  ws.on('error', (error) => {
    failure = error;
  });
  const wait = async (matches) => {
    let index = 0;
    for (let n = 0; n < 300; n++) {
      if (failure) throw failure;
      while (index < messages.length) {
        const message = messages[index++];
        if (matches(message)) return message;
      }
      await sleep(100);
    }
    throw new Error('WebSocket message timeout');
  };
  await wait((m) => m.t === 'session_state');
  const send = (d) => ws.send(JSON.stringify(shared.ClientMessageSchema.parse({ t: 'stdin', d })));
  // Distinct command/output strings ensure this observes execution, not PTY input echo.
  send("printf 'deploy_%s\\n' 'ready'\r");
  let stdout = '';
  await wait((m) => {
    if (m.t === 'stdout') stdout += m.d;
    return stdout.includes('deploy_ready\r\n');
  });
  return { ...session, ws, wait, send };
}

async function health() {
  for (let n = 0; n < 40; n++) {
    try {
      const value = await json('/healthz', shared.HealthResponseSchema);
      if (value.docker) return;
    } catch {
      /* A restart intentionally makes the endpoint temporarily unavailable. */
    }
    await sleep(500);
  }
  throw new Error('service did not recover');
}

async function progress(state) {
  const me = await json('/api/me', shared.MeResponseSchema, 'GET', state.cookie);
  const value = await json('/api/progress', shared.ProgressResponseSchema, 'GET', state.cookie);
  assert.equal(me.user.id, state.userId);
  assert.equal(me.user.xp, state.xp);
  assert.equal(value.levels[level].completions, 1);
  assert.equal(value.levels[level].state, 'completed');
  output('saved-progress', { xp: me.user.xp, completions: value.levels[level].completions });
}

const mode = process.argv[2];
await health();
if (mode === 'smoke') {
  for (const path of ['/', '/map', '/profile']) {
    const res = await request(path);
    assert.equal(res.status, 200);
    assert.ok(res.authorized);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.ok(res.headers['content-security-policy'].includes('wss://localhost'));
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.match(res.headers['strict-transport-security'], /max-age=31536000/);
  }
  const html = (await request('/')).body.toString();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(assets.some((a) => a.endsWith('.js')));
  assert.ok(assets.some((a) => a.endsWith('.css')));
  for (const asset of assets) {
    const res = await request(asset);
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 100);
    if (asset.endsWith('.css')) {
      const font = res.body.toString().match(/url\((?:["'])?(\/assets\/[^)"']+\.woff2)/)?.[1];
      assert.ok(font);
      assert.equal((await request(font)).status, 200);
    }
  }
  assert.equal((await request('/assets/missing.js')).status, 404);
  assert.equal((await request('/api/missing')).status, 401);
  output('https-spa-assets', {
    certificateVerified: true,
    csp: true,
    selfHostedFonts: true,
    missingAssets: 404,
  });
  const state = await guest();
  const session = await start(state);
  const ids = await managed();
  assert.equal(ids.length, 1);
  const [container] = JSON.parse(await command('docker', ['inspect', ids[0]]));
  assert.equal(container.HostConfig.NetworkMode, 'none');
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
  assert.ok(container.HostConfig.SecurityOpt.some((s) => s.startsWith('no-new-privileges')));
  assert.equal(container.HostConfig.Memory, 268435456);
  assert.equal(container.HostConfig.PidsLimit, 128);
  assert.equal(container.HostConfig.NanoCpus, 500000000);
  assert.equal(container.Mounts.length, 0);
  const limits = await command('docker', [
    'exec',
    ids[0],
    'cat',
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/cpu.max',
    '/sys/fs/cgroup/pids.max',
  ]);
  assert.equal(limits, '268435456\n50000 100000\n128');
  output('sandbox-isolation', {
    network: 'none',
    capDrop: ['ALL'],
    noNewPrivileges: true,
    mounts: 0,
    cgroupLimits: limits.split('\n'),
  });
  session.send('echo hello\rwhoami\r');
  const complete = await session.wait((m) => m.t === 'level_complete');
  state.xp = complete.result.xp;
  writeFileSync(privateState, JSON.stringify(State.parse(state)), { mode: 0o600 });
  output('websocket-level-clear', { rank: complete.result.rank, xp: complete.result.xp });
  await json(`/api/sessions/${session.sessionId}`, shared.OkResponseSchema, 'DELETE', state.cookie);
  session.ws.terminate();
  assert.equal((await managed()).length, 0);
  await progress(state);
} else if (mode === 'shutdown') {
  const state = await guest();
  const session = await start(state);
  await control('stop', 'terminal-quest');
  const closing = await session.wait((m) => m.t === 'closing');
  assert.equal(closing.reason, 'server_shutdown');
  assert.equal((await managed()).length, 0);
  const rows = JSON.parse(
    await command('sqlite3', [
      '-json',
      '/home/tq/data/tq.sqlite',
      `SELECT status, ended_at FROM attempts WHERE user_id='${state.userId}'`,
    ]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'abandoned');
  assert.ok(rows[0].ended_at);
  session.ws.terminate();
  output('graceful-stop', {
    closing: closing.reason,
    status: rows[0].status,
    managedContainers: 0,
  });
  await control('start', 'terminal-quest');
  await health();
} else if (mode === 'orphan') {
  const session = await start(await guest());
  const [orphan] = await managed();
  assert.ok(orphan);
  const oldPid = await control('show', 'terminal-quest', '-p', 'MainPID', '--value');
  await control('kill', '--kill-whom=main', '--signal=SIGKILL', 'terminal-quest');
  const leftAfterKill = (await managed()).includes(orphan);
  assert.ok(leftAfterKill);
  await sleep(3500);
  await health();
  assert.equal((await managed()).length, 0);
  const newPid = await control('show', 'terminal-quest', '-p', 'MainPID', '--value');
  assert.notEqual(newPid, oldPid);
  session.ws.terminate();
  output('abrupt-restart', {
    oldPid,
    newPid,
    orphanPresentAfterKill: leftAfterKill,
    managedContainersAfterBoot: 0,
  });
} else if (mode === 'progress') {
  await progress(State.parse(JSON.parse(readFileSync(privateState, 'utf8'))));
  assert.equal((await managed()).length, 0);
} else {
  throw new Error('expected smoke, shutdown, orphan or progress');
}
