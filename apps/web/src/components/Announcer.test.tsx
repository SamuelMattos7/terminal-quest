import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { strings } from '../strings.js';
import { Announcer } from './Announcer.js';
import type { ObjectiveItem } from './ObjectiveList.js';

const pending: ObjectiveItem[] = [
  { id: 'o1', text: 'Print the path', optional: false, bonus: false, status: 'pending' },
];

describe('Announcer', () => {
  it('announces newly completed objectives but stays silent on mount', () => {
    const done: ObjectiveItem[] = [{ ...(pending[0] as ObjectiveItem), status: 'done' }];
    const { rerender } = render(<Announcer items={pending} />);
    expect(screen.getByTestId('announcer').textContent).toBe('');
    // Pre-done on first mount is baseline, not news.
    const { unmount } = render(<Announcer items={done} />);
    expect(screen.getAllByTestId('announcer')[0]?.textContent).toBe('');
    unmount();
    rerender(<Announcer items={done} />);
    expect(screen.getByTestId('announcer').textContent).toBe(
      `${strings.objectiveCompleteAnnouncement} Print the path`,
    );
  });
});
