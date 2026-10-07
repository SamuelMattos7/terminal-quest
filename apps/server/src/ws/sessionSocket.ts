import type { FastifyInstance } from 'fastify';
import { ClientMessageSchema } from '@terminal-quest/shared';
import { userFromToken, requestToken } from '../auth.js';
import { createStdinLimiter, type LiveSession } from './liveSession.js';
import {
  evaluateAndReport,
  requestHint,
  sessionStateMessage,
  type FlowDeps,
} from './sessionFlow.js';

// WebSocket endpoint for plan.md §6.1: streams terminal I/O and drives
// evaluation, hints, and coaching. Origin is checked against PUBLIC_ORIGIN
// (§13); a session that is missing or owned by another user closes with
// 4401, a bad origin with 4403.

export interface SocketRouteDeps extends FlowDeps {
  config: { PUBLIC_ORIGIN: string };
}

function sendError(live: LiveSession, message: string): void {
  live.socket?.send(JSON.stringify({ t: 'error', message }));
}

async function handleMessage(
  deps: SocketRouteDeps,
  live: LiveSession,
  limiter: ReturnType<typeof createStdinLimiter>,
  raw: unknown,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    sendError(live, 'bad frame');
    return;
  }
  const msg = ClientMessageSchema.safeParse(parsed);
  if (!msg.success) {
    sendError(live, 'bad frame');
    return;
  }
  switch (msg.data.t) {
    case 'stdin': {
      if (!limiter.take(Buffer.byteLength(msg.data.d, 'utf8'))) {
        sendError(live, 'stdin rate exceeded');
        return;
      }
      deps.manager.touch(live.session.id);
      live.shell?.write(msg.data.d);
      return;
    }
    case 'resize':
      live.shell?.resize(msg.data.cols, msg.data.rows);
      return;
    case 'ping':
      live.socket?.send(JSON.stringify({ t: 'pong' }));
      return;
    case 'check':
      await evaluateAndReport(deps, live);
      return;
    case 'hint':
      requestHint(live);
      return;
  }
}

export async function registerSessionSocket(
  app: FastifyInstance,
  deps: SocketRouteDeps,
): Promise<void> {
  app.get('/ws/sessions/:sessionId', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== deps.config.PUBLIC_ORIGIN) {
      socket.close(4403, 'bad origin');
      return;
    }
    const { sessionId } = request.params as { sessionId: string };
    void userFromToken(app.db, requestToken(request)).then((user) => {
      const live = deps.live.get(sessionId);
      if (user === undefined || live === undefined || live.userId !== user.id) {
        socket.close(4401, 'unauthorized');
        return;
      }
      live.socket = {
        send: (payload: string) => {
          socket.send(payload);
        },
        close: (code?: number) => {
          socket.close(code);
        },
      };
      const s = sessionStateMessage(live);
      live.socket.send(JSON.stringify({ t: 'session_state', ...s, hintsTotal: 3 }));
      const limiter = createStdinLimiter();
      socket.on('message', (raw: unknown) => {
        void handleMessage(deps, live, limiter, raw).catch(() => undefined);
      });
      socket.on('close', () => {
        if (live.socket !== undefined) {
          live.socket = undefined;
        }
      });
    });
  });
}
