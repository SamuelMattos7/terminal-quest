import { describe, expect, it } from 'vitest';
import { ServerMessageSchema } from '@terminal-quest/shared';
import { REPLAY_BYTES, REPLAY_FRAMES, SessionReplay } from './sessionReplay.js';

describe('terminal replay limits', () => {
  it('caps serialized bytes, keeps the newest output, and splits without breaking Unicode', () => {
    const replay = new SessionReplay();
    const text = 'a'.repeat(8191) + '🐧' + '\u0000'.repeat(20000) + 'tail';
    const live: string[] = [];
    replay.write(text, (payload) => live.push(payload));
    const decode = (payload: string) => {
      const msg = ServerMessageSchema.parse(JSON.parse(payload));
      if (msg.t !== 'stdout') throw new Error('expected output');
      return msg.d;
    };
    expect(live.map(decode).join('')).toBe(text);
    expect(live.map(decode)[1]?.startsWith('🐧')).toBe(true);
    const retained: string[] = [];
    replay.replay(0, (payload) => retained.push(payload));
    expect(retained.length).toBeLessThan(live.length);
    expect(retained).toEqual(live.slice(-retained.length));
    expect(
      retained.reduce((bytes, payload) => bytes + Buffer.byteLength(payload), 0),
    ).toBeLessThanOrEqual(REPLAY_BYTES);
  });

  it('caps the number of tiny frames independently of their byte size', () => {
    const replay = new SessionReplay();
    const live: string[] = [];
    for (let i = 0; i < REPLAY_FRAMES + 10; i++) {
      replay.write('x', (payload) => live.push(payload));
    }
    const retained: string[] = [];
    replay.replay(0, (payload) => retained.push(payload));
    expect(retained).toEqual(live.slice(-REPLAY_FRAMES));
  });
});
