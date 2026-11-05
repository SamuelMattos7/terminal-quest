import {
  ServerMessageSchema,
  SESSION_SOCKET_REPLACED,
  type ClientMessage,
  type ServerMessage,
} from '@terminal-quest/shared';

/** Framework-free WebSocket wrapper for `/ws/sessions/:sessionId` (plan.md §6.1). */
export const MAX_RECONNECT_ATTEMPTS = 3;
export const STABLE_CONNECTION_MS = 10_000;

const BACKOFF_MS = [1000, 2000, 4000];

/** Reconnecting cannot fix authorization or a deliberate socket takeover. */
const FATAL_CLOSE_CODES = new Set([4401, 4403, SESSION_SOCKET_REPLACED]);

export type SessionEvent =
  | { kind: 'open' }
  | { kind: 'message'; message: ServerMessage }
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'closed'; code: number; gaveUp: boolean };

export type SessionEventHandler = (event: SessionEvent) => void;

export interface SocketFactory {
  (url: string): WebSocket;
}

interface SocketDeps {
  createSocket?: SocketFactory;
}

/**
 * Owns one live-session socket: typed send, zod-parsed dispatch, and up to
 * MAX_RECONNECT_ATTEMPTS reconnects with backoff. Malformed frames are
 * ignored (never crash the terminal). One instance per session — reset
 * creates a new instance for the new `wsPath`.
 */
export class SessionSocket {
  private ws: WebSocket | null = null;
  private closedByClient = false;
  private reconnects = 0;
  private lastOutputSeq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly createSocket: SocketFactory;

  constructor(
    private readonly url: string,
    private readonly onEvent: SessionEventHandler,
    deps: SocketDeps = {},
  ) {
    this.createSocket = deps.createSocket ?? ((target) => new WebSocket(target));
  }

  connect(): void {
    this.closedByClient = false;
    this.reconnects = 0;
    this.openSocket();
  }

  send(message: ClientMessage): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /** Client-initiated shutdown: closes the socket and cancels any reconnect. */
  close(): void {
    this.closedByClient = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(): void {
    const separator = this.url.includes('?') ? '&' : '?';
    const target =
      this.lastOutputSeq === 0 ? this.url : `${this.url}${separator}after=${this.lastOutputSeq}`;
    const ws = this.createSocket(target);
    this.ws = ws;
    let openedAt: number | undefined;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      openedAt = Date.now();
      this.onEvent({ kind: 'open' });
    });
    ws.addEventListener('message', (event: Event) => {
      if (this.ws !== ws || this.closedByClient) return;
      this.handleFrame((event as MessageEvent).data);
    });
    ws.addEventListener('close', (event: Event) => {
      if (this.ws !== ws) return;
      if (openedAt !== undefined && Date.now() - openedAt >= STABLE_CONNECTION_MS) {
        this.reconnects = 0;
      }
      this.handleClose((event as CloseEvent).code);
    });
  }

  private handleFrame(data: unknown): void {
    if (typeof data !== 'string') {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      console.warn('[tq] ignoring non-JSON socket frame');
      return;
    }
    const msg = ServerMessageSchema.safeParse(parsed);
    if (!msg.success) {
      console.warn('[tq] ignoring malformed socket frame');
      return;
    }
    if (msg.data.t === 'stdout') {
      if (msg.data.seq <= this.lastOutputSeq) return;
      this.lastOutputSeq = msg.data.seq;
    }
    this.onEvent({ kind: 'message', message: msg.data });
  }

  private handleClose(code: number): void {
    this.ws = null;
    if (this.closedByClient || FATAL_CLOSE_CODES.has(code)) {
      this.onEvent({ kind: 'closed', code, gaveUp: false });
      return;
    }
    if (this.reconnects >= MAX_RECONNECT_ATTEMPTS) {
      this.onEvent({ kind: 'closed', code, gaveUp: true });
      return;
    }
    this.reconnects += 1;
    this.onEvent({ kind: 'reconnecting', attempt: this.reconnects });
    const delay = BACKOFF_MS[Math.min(this.reconnects - 1, BACKOFF_MS.length - 1)] ?? 4000;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.closedByClient) {
        this.openSocket();
      }
    }, delay);
  }
}
