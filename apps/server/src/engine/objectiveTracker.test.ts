import { describe, expect, it } from 'vitest';
import { LevelSchema, type Level } from '@terminal-quest/shared';
import type { SandboxProvider } from '../sandbox/provider.js';
import {
  createTracker,
  evaluate,
  handleInboxLine,
  noteCommand,
  requiredObjectives,
  submitAnswer,
} from './objectiveTracker.js';

function makeLevel(overrides: Record<string, unknown> = {}): Level {
  return LevelSchema.parse({
    id: 'w1-02-where-am-i',
    world: 1,
    order: 2,
    title: 'Where Am I?',
    kind: 'lesson',
    difficulty: 1,
    estimated_minutes: 4,
    story: 'A short story.',
    teaches: ['pwd'],
    par_commands: 4,
    xp: 100,
    objectives: [
      { id: 'ran-pwd', text: 'Run pwd.', check: { type: 'command_used', regex: '^pwd$' } },
      {
        id: 'found-word',
        text: 'Submit the word.',
        hold: true,
        check: { type: 'answer_equals', value: 'banana' },
      },
      {
        id: 'style-bonus',
        text: 'Bonus.',
        bonus: true,
        check: { type: 'command_used', regex: '^ls' },
      },
    ],
    hints: ['one', 'two', 'three'],
    success_message: 'Done.',
    solutions: { reference: 'solution.sh' },
    ...overrides,
  });
}

/** No Docker: every check used here is pure (command_used, answer value). */
function stubProvider(): SandboxProvider {
  const boom = (): never => {
    throw new Error('tracker test must not touch docker');
  };
  return {
    create: boom,
    putFiles: boom,
    exec: boom,
    openShell: boom,
    watchFile: boom,
    destroy: boom,
    listManaged: boom,
  };
}

describe('requiredObjectives', () => {
  it('excludes bonus and optional objectives', () => {
    expect(requiredObjectives(makeLevel())).toEqual(['ran-pwd', 'found-word']);
  });
});

describe('inbox handling', () => {
  it('routes hint/status/explain/submit and tolerates junk', () => {
    const state = createTracker(makeLevel());
    expect(handleInboxLine(state, '{"cmd":"hint"}')).toBe('hint');
    expect(handleInboxLine(state, '{"cmd":"status"}')).toBe('status');
    expect(handleInboxLine(state, '{"cmd":"explain","text":"ls"}')).toEqual({
      kind: 'explain',
      text: 'ls',
    });
    expect(handleInboxLine(state, '{"cmd":"submit","text":"banana"}')).toEqual({
      kind: 'submit',
      text: 'banana',
    });
    expect(state.answers).toEqual(['banana']);
    for (const junk of ['not json', '{"cmd":"bogus"}', '{"cmd":"submit"}', '[]', '']) {
      expect(handleInboxLine(state, junk)).toBe('unknown');
    }
    expect(state.answers).toEqual(['banana']);
  });

  it('noteCommand and submitAnswer append', () => {
    const state = createTracker(makeLevel());
    noteCommand(state, { epoch: 1, exitCode: 0, cwd: '/home/player', command: 'pwd' });
    submitAnswer(state, 'banana');
    expect(state.commands).toEqual([{ command: 'pwd', exitCode: 0 }]);
    expect(state.answers).toEqual(['banana']);
  });
});

describe('evaluate', () => {
  it('completes when required objectives pass; bonus stays optional', async () => {
    const provider = stubProvider();
    const handle = { id: 'h', spec: {} } as never;
    const level = makeLevel();
    const state = createTracker(level);
    noteCommand(state, { epoch: 1, exitCode: 0, cwd: '/', command: 'pwd' });
    submitAnswer(state, 'banana');
    const first = await evaluate(provider, handle, level, state, { seed: 7 });
    expect(first.newlyDone).toEqual(['ran-pwd', 'found-word']);
    expect(first.completed).toBe(true);
    // Bonus untouched: still completable without it.
    const second = await evaluate(provider, handle, level, state, { seed: 7 });
    expect(second.newlyDone).toEqual([]);
    expect(second.completed).toBe(true);
  });

  it('sticky objectives skip re-checks but hold objectives flip back', async () => {
    const provider = stubProvider();
    const handle = { id: 'h', spec: {} } as never;
    const level = makeLevel();
    const state = createTracker(level);
    noteCommand(state, { epoch: 1, exitCode: 0, cwd: '/', command: 'pwd' });
    submitAnswer(state, 'banana');
    await evaluate(provider, handle, level, state, { seed: 7 });
    // New evidence that would fail a fresh check: sticky stays, hold flips.
    state.answers = ['wrong'];
    state.commands = [{ command: 'pwd', exitCode: 0 }];
    const result = await evaluate(provider, handle, level, state, { seed: 7 });
    expect(state.done.get('ran-pwd')).toBe(true);
    expect(state.done.get('found-word')).toBe(false);
    expect(result.newlyDone).toEqual([]);
    expect(result.completed).toBe(false);
  });
});
