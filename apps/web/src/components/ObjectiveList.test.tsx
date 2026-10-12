import { render, screen } from '@testing-library/react';
import type { PublicLevel } from '@terminal-quest/shared';
import { describe, expect, it } from 'vitest';
import { strings } from '../strings.js';
import { buildObjectiveItems, ObjectiveList } from './ObjectiveList.js';

const level: PublicLevel = {
  id: 'w1-02-where-am-i',
  title: 'Where Am I?',
  story: 'Find yourself.',
  kind: 'lesson',
  objectives: [
    { id: 'o1', text: 'Print the path', optional: false, bonus: false },
    { id: 'o2', text: 'Extra style points', optional: true, bonus: true },
  ],
  teaches: ['pwd'],
  parCommands: 3,
  xp: 50,
  hintCount: 3,
};

describe('ObjectiveList', () => {
  it('joins text with live statuses and marks bonus objectives', () => {
    const items = buildObjectiveItems(level, [{ id: 'o1', status: 'done' }]);
    expect(items).toEqual([
      { id: 'o1', text: 'Print the path', optional: false, bonus: false, status: 'done' },
      { id: 'o2', text: 'Extra style points', optional: true, bonus: true, status: 'pending' },
    ]);
    render(<ObjectiveList items={items} />);
    expect(screen.getByTestId('objective-o1')).not.toBeNull();
    expect(screen.getByText(strings.bonusLabel)).not.toBeNull();
    expect(screen.getByText(strings.objectiveDone)).not.toBeNull();
    expect(screen.getByText(strings.objectivePending)).not.toBeNull();
  });
});
