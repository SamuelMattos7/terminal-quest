import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ServerMessage,
} from '@terminal-quest/shared';
import { MarkerMatcher } from './metrics.js';

type Waiter = {
  matches: (message: ServerMessage) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class LoadPeer {
  readonly socket: WebSocket;
  failure: Error | undefined;
  completed = false;
  private disposing = false;
  private readonly waiters = new Set<Waiter>();

  constructor(url: URL, cookie: string, origin: string) {
    this.socket = new WebSocket(url, {
      headers: { Cookie: cookie, Origin: origin },
      handshakeTimeout: 15_000,
      maxPayload: 256 * 1024,
      perMessageDeflate: false,
      followRedirects: false,
    });
    this.socket.on('error', (error) => this.fail(error));
    this.socket.on('close', (code) => {
      if (!this.disposing) this.fail(new Error(`unexpected socket close: ${code}`));
    });
    this.socket.on('message', (raw) => {
      try {
        const message = ServerMessageSchema.parse(JSON.parse(String(raw)));
        if (message.t === 'level_complete') this.completed = true;
        if (message.t === 'error') throw new Error(`server error: ${message.message}`);
        for (const waiter of [...this.waiters]) {
          if (waiter.matches(message)) waiter.resolve();
        }
        if (message.t === 'closing') {
          this.fail(new Error(`session closing: ${message.reason}`));
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  assertActive(): void {
    if (this.failure) throw this.failure;
    if (this.completed) throw new Error('level completed before the end of the hold');
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('socket is not open');
  }

  wait(matches: Waiter['matches'], timeoutMs = 15_000): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        if (error) reject(error);
        else resolve();
      };
      const waiter: Waiter = { matches, resolve: () => finish(), reject: finish };
      const timer = setTimeout(() => finish(new Error('socket response timed out')), timeoutMs);
      this.waiters.add(waiter);
    });
  }

  send(input: string): void {
    if (this.failure) throw this.failure;
    this.socket.send(JSON.stringify(ClientMessageSchema.parse({ t: 'stdin', d: input })));
  }

  async ready(): Promise<void> {
    await this.wait((message) => message.t === 'session_state' && !message.completed);
    // The marker is split in the command, so local input echo cannot satisfy readiness.
    const nonce = randomUUID().replaceAll('-', '');
    const matcher = new MarkerMatcher(`ready_${nonce}\r\n`);
    const echoed = this.wait((message) => message.t === 'stdout' && matcher.push(message.d));
    this.send(`printf 'ready_%s\\n' '${nonce}'\r`);
    await echoed;
  }

  async echo(): Promise<number> {
    this.assertActive();
    const marker = `tq_${randomUUID().slice(0, 8)}`;
    const matcher = new MarkerMatcher(marker);
    const echoed = this.wait((message) => message.t === 'stdout' && matcher.push(message.d));
    const began = performance.now();
    // No Enter: this measures the PTY's input echo, without completing either objective.
    this.send(marker);
    await echoed;
    const elapsed = performance.now() - began;
    this.send('\x15'); // clear the input line before the next probe
    return elapsed;
  }

  async complete(): Promise<number> {
    this.assertActive();
    const finished = this.wait((message) => message.t === 'level_complete', 30_000);
    const began = performance.now();
    this.send('echo hello\rwhoami\r');
    await finished;
    return performance.now() - began;
  }

  close(): void {
    this.disposing = true;
    this.fail(new Error('load driver disposed socket'));
    this.socket.terminate();
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const waiter of [...this.waiters]) waiter.reject(this.failure);
  }
}
