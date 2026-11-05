import type { FastifyInstance } from 'fastify';
import {
  ClientMessageSchema,
  MAX_CLIENT_FRAME_BYTES,
  SESSION_SOCKET_REPLACED,
} from '@terminal-quest/shared';
import { userFromToken, requestToken } from '../auth.js';
import type { LiveSession } from './liveSession.js';
import { boundedSocket, sessionBudgets } from './socketLimits.js';
import { scheduleEvaluation } from './sessionEvaluation.js';
import { send, attemptScope } from './sessionContext.js';
import { logger } from '../util/logger.js';
import { requiredObjectives } from '../engine/objectiveTracker.js';
import { tuxIntro } from '../progression/dialogue.js';
import { requestHint, sessionStateMessage, type FlowDeps } from './sessionFlow.js';

// WebSocket endpoint for plan.md §6.1: streams terminal I/O and drives
// evaluation, hints, and coaching. Origin is checked against PUBLIC_ORIGIN
// (§13); a session that is missing or owned by another user closes with
// 4401, a bad origin with 4403.

export interface SocketRouteDeps extends FlowDeps {
  config: { PUBLIC_ORIGIN: string };
}

function sendError(live: LiveSession, message: string): void {
  send(live, { t: 'error', message });
}

async function handleMessage(
  deps: SocketRouteDeps,
  live: LiveSession,
  raw: unknown,
): Promise<void> {
  if (live.closed || deps.manager.get(live.session.id) === undefined) return;
  const budgets = sessionBudgets(live);
  if (!budgets.messages.take()) {
    live.socket?.close(1008);
    return;
  }
  // maxPayload rejects oversized wire messages before parsing; this also
  // protects direct/injected handlers, and applies to every message type.
  if (Buffer.byteLength(String(raw)) > MAX_CLIENT_FRAME_BYTES) {
    live.socket?.close(1009);
    return;
  }
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
      if (!budgets.stdin.take(Buffer.byteLength(msg.data.d, 'utf8'))) {
        sendError(live, 'stdin rate exceeded');
        return;
      }
      deps.manager.touch(live.session.id);
      live.shell?.write(msg.data.d);
      return;
    }
    case 'resize': {
      const socket = live.socket;
      try {
        await live.shell?.resize(msg.data.cols, msg.data.rows);
      } catch (err) {
        logger.warn({ err, ...attemptScope(live) }, 'terminal resize failed');
        if (live.socket === socket) sendError(live, 'terminal resize failed');
      }
      return;
    }
    case 'ping':
      live.socket?.send(JSON.stringify({ t: 'pong' }));
      return;
    case 'check':
      scheduleEvaluation(deps, live);
      return;
    case 'hint':
      requestHint(deps, live);
      return;
  }
}

export async function registerSessionSocket(
  app: FastifyInstance,
  deps: SocketRouteDeps,
): Promise<void> {
  app.get('/ws/sessions/:sessionId', { websocket: true }, (socket, request) => {
    const { sessionId } = request.params as { sessionId: string };
    const logContext = () => {
      const live = deps.live.get(sessionId);
      return live === undefined ? { sessionId } : attemptScope(live);
    };
    socket.on('error', (err: Error) => {
      logger.warn({ err, ...logContext() }, 'session socket transport failed');
    });
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== deps.config.PUBLIC_ORIGIN) {
      socket.close(4403, 'bad origin');
      return;
    }
    void userFromToken(app.db, requestToken(request))
      .then((user) => {
        if (socket.readyState !== socket.OPEN) return;
        const live = deps.live.get(sessionId);
        if (user === undefined || live === undefined || live.userId !== user.id) {
          socket.close(4401, 'unauthorized');
          return;
        }
        const adapter = boundedSocket(socket);
        const previous = live.socket;
        // Revoke ownership before closing: frames and close events from the
        // old transport can still arrive during its close handshake.
        live.socket = adapter;
        previous?.close(SESSION_SOCKET_REPLACED);
        const s = sessionStateMessage(live);
        live.socket.send(JSON.stringify({ t: 'session_state', ...s, hintsTotal: 3 }));
        if (!live.dialogue.welcomed) {
          live.dialogue.welcomed = true;
          live.socket.send(
            JSON.stringify({
              t: 'tux',
              text: tuxIntro(live.level.title, requiredObjectives(live.level).length),
            }),
          );
        }
        socket.on('message', (raw: unknown) => {
          if (live.socket !== adapter || socket.readyState !== socket.OPEN) return;
          void handleMessage(deps, live, raw).catch((err: unknown) => {
            logger.warn({ err, ...attemptScope(live) }, 'socket message failed');
            if (live.socket === adapter) {
              sendError(live, 'message failed');
              adapter.close(1011);
            }
          });
        });
        socket.on('close', () => {
          // Only detach our own adapter: a stale close from a replaced socket
          // must not wipe the live registration (T6.2 reconnect-once intro).
          if (live.socket === adapter) {
            live.socket = undefined;
          }
        });
      })
      .catch((err: unknown) => {
        logger.error({ err, ...logContext() }, 'session socket attachment failed');
        socket.close(1011, 'session connection failed');
      });
  });
}
