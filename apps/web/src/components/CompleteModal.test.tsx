import { fireEvent, render, screen } from '@testing-library/react';
import type { ServerMessage } from '@terminal-quest/shared';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../strings.js';
import { CompleteModal } from './CompleteModal.js';

type CompletionResult = Extract<ServerMessage, { t: 'level_complete' }>['result'];

const result: CompletionResult = {
  xp: 55,
  rank: 'S',
  breakdown: [
    { label: 'base', xp: 50 },
    { label: 'first clear', xp: 5 },
  ],
  newBadges: ['early-bird'],
  unlocked: ['w1-03-moving-around'],
  explain: [
    {
      command: 'pwd',
      parts: [{ token: 'pwd', meaning: 'print working directory' }],
    },
  ],
  skillsGained: ['pwd'],
};

describe('CompleteModal', () => {
  it('renders rank, breakdown, skills, explain cards, badges, and all actions', () => {
    const onNext = vi.fn();
    const onReplay = vi.fn();
    const onBackToMap = vi.fn();
    render(
      <CompleteModal
        result={result}
        onNext={onNext}
        onReplay={onReplay}
        onBackToMap={onBackToMap}
      />,
    );
    expect(screen.getByTestId('complete-rank').textContent).toBe('S');
    expect(screen.getByText('base')).not.toBeNull();
    expect(screen.getByText(strings.completeExplain)).not.toBeNull();
    expect(screen.getByText('early-bird')).not.toBeNull();
    fireEvent.click(screen.getByTestId('complete-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('complete-replay'));
    expect(onReplay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('complete-back'));
    expect(onBackToMap).toHaveBeenCalledTimes(1);
  });

  it('hides the next button when there is no next level', () => {
    render(
      <CompleteModal
        result={{ ...result, unlocked: [] }}
        onNext={null}
        onReplay={() => {}}
        onBackToMap={() => {}}
      />,
    );
    expect(screen.queryByTestId('complete-next')).toBeNull();
    expect(screen.getByRole('dialog', { name: strings.completeTitle })).not.toBeNull();
  });
});
