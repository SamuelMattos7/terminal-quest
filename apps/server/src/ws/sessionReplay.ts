import type { ServerMessage } from '@terminal-quest/shared';

export const REPLAY_BYTES = 64 * 1024;
export const REPLAY_FRAMES = 256;
const CHUNK_SIZE = 8192;

type Outcome = Extract<ServerMessage, { t: 'hint' | 'level_complete' }>;

/** One bounded terminal tail, three revealed hints, and one committed result per attempt. */
export class SessionReplay {
  private seq = 0;
  private bytes = 0;
  private readonly output: { seq: number; payload: string; bytes: number }[] = [];
  private readonly outcomes = new Map<number | 'completion', string>();

  write(text: string, send: (payload: string) => void): void {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + CHUNK_SIZE, text.length);
      // Don't split a surrogate pair at a frame boundary.
      const next = text.charCodeAt(end);
      if (next >= 0xdc00 && next <= 0xdfff) end--;
      const seq = ++this.seq;
      const payload = JSON.stringify({ t: 'stdout', d: text.slice(start, end), seq });
      const bytes = Buffer.byteLength(payload);
      this.output.push({ seq, payload, bytes });
      this.bytes += bytes;
      while (this.bytes > REPLAY_BYTES || this.output.length > REPLAY_FRAMES) {
        this.bytes -= this.output.shift()!.bytes;
      }
      send(payload);
      start = end;
    }
  }

  remember(message: Outcome, payload: string): void {
    this.outcomes.set(message.t === 'hint' ? message.tier : 'completion', payload);
  }

  replay(after: number, send: (payload: string) => void): void {
    for (const payload of this.outcomes.values()) send(payload);
    for (const frame of this.output) {
      if (frame.seq > after) send(frame.payload);
    }
  }
}
