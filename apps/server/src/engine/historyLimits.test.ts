import { describe, expect, it } from 'vitest';
import { LevelSchema } from '@terminal-quest/shared';
import { createTracker, handleInboxLine, noteCommand, submitAnswer } from './objectiveTracker.js';
import { parseCmdlogLine } from './cmdlog.js';
import { makeLevel } from '../testUtils.js';

const tracker = () => createTracker(LevelSchema.parse(makeLevel('a', 1, 1).level));

describe('player history limits (A03)', () => {
  it('rejects answers at the count cap without losing earlier answers', () => {
    const state = tracker();
    for (let i = 0; i < 256; i++) submitAnswer(state, String(i));
    expect(() => submitAnswer(state, 'overflow')).toThrow(/limit/);
    expect(state.answers).toHaveLength(256);
    expect(state.answers[0]).toBe('0');
  });

  it('caps answer bytes independently of count using UTF-8 bytes', () => {
    const state = tracker();
    const answer = 'é'.repeat(4096);
    for (let i = 0; i < 32; i++) submitAnswer(state, answer);
    expect(() => submitAnswer(state, 'x')).toThrow(/limit/);
    expect(state.answers).toHaveLength(32);
  });

  it.each(['count', 'bytes'])('caps command history by %s', (cap) => {
    const state = tracker();
    const entry = {
      epoch: 1,
      cwd: '/',
      exitCode: 0,
      command: cap === 'count' ? 'ls' : 'é'.repeat(4096),
    };
    const count = cap === 'count' ? 4096 : 128;
    for (let i = 0; i < count; i++) noteCommand(state, entry);
    expect(() => noteCommand(state, entry)).toThrow(/limit/);
    expect(state.commands).toHaveLength(count);
  });

  it('rejects oversized and invalid inbox messages before retaining them', () => {
    const state = tracker();
    for (const input of [
      { cmd: 'submit', text: 'é'.repeat(4097) },
      { cmd: 'explain', text: 'x'.repeat(8193) },
      { cmd: 'hint', extra: true },
      { cmd: 'submit', text: 1 },
    ])
      expect(handleInboxLine(state, JSON.stringify(input))).toBe('unknown');
    expect(state.answers).toEqual([]);
  });

  it('validates command log fields and UTF-8 lengths with shared schemas', () => {
    for (const line of [
      '1\t999\t/\tls',
      '1\t-1\t/\tls',
      '-1\t0\t/\tls',
      '1\t0\trelative\tls',
      '1\t0\t/\t' + 'é'.repeat(4097),
      '\t0\t/\tls',
    ])
      expect(parseCmdlogLine(line)).toBeUndefined();
  });
});
