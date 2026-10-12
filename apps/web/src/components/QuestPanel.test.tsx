import { fireEvent, render, screen } from '@testing-library/react';
import type { PublicLevel } from '@terminal-quest/shared';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../strings.js';
import { QuestPanel } from './QuestPanel.js';

const level: PublicLevel = {
  id: 'w1-02-where-am-i',
  title: 'Where Am I?',
  story: 'Find yourself.',
  kind: 'lesson',
  objectives: [{ id: 'o1', text: 'Print the path', optional: false, bonus: false }],
  teaches: ['pwd'],
  parCommands: 3,
  xp: 50,
  hintCount: 3,
};

const items = [
  { id: 'o1', text: 'Print the path', optional: false, bonus: false, status: 'pending' },
] as const;

function renderPanel(overrides?: Partial<Parameters<typeof QuestPanel>[0]>): {
  onRequestHint: ReturnType<typeof vi.fn>;
  onReset: ReturnType<typeof vi.fn>;
  onLeave: ReturnType<typeof vi.fn>;
  onFocusTerminal: ReturnType<typeof vi.fn>;
} {
  const onRequestHint = vi.fn();
  const onReset = vi.fn();
  const onLeave = vi.fn();
  const onDismissToast = vi.fn();
  const onFocusTerminal = vi.fn();
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QuestPanel
        level={level}
        items={[...items]}
        hints={[]}
        hintsUsed={0}
        hintsTotal={3}
        canRequestHint
        toasts={[]}
        notes={[]}
        onRequestHint={onRequestHint}
        onReset={onReset}
        onLeave={onLeave}
        onDismissToast={onDismissToast}
        onFocusTerminal={onFocusTerminal}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { onRequestHint, onReset, onLeave, onFocusTerminal };
}

describe('QuestPanel', () => {
  it('shows story, objectives, and hint button', () => {
    const { onRequestHint } = renderPanel();
    expect(screen.getByText('Where Am I?')).not.toBeNull();
    expect(screen.getByText('Find yourself.')).not.toBeNull();
    expect(screen.getByTestId('objective-o1')).not.toBeNull();
    fireEvent.click(screen.getByTestId('hint-button'));
    expect(onRequestHint).toHaveBeenCalledTimes(1);
  });

  it('confirms reset with a two-step button', () => {
    const { onReset } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: strings.resetLevel }));
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByText(strings.resetConfirm)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: strings.resetConfirmYes }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('cancels reset and leaves on demand', () => {
    const { onReset, onLeave } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: strings.resetLevel }));
    fireEvent.click(screen.getByRole('button', { name: strings.resetConfirmNo }));
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: strings.leaveLevel }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('focuses the terminal when the panel is clicked', () => {
    const { onFocusTerminal } = renderPanel();
    fireEvent.click(screen.getByLabelText(strings.missionTab));
    expect(onFocusTerminal).toHaveBeenCalled();
  });

  it('shows toasts', () => {
    renderPanel({ toasts: [{ id: 7, kind: 'coach', text: 'check your spelling' }] });
    expect(screen.getByText('check your spelling')).not.toBeNull();
  });

  it('switches mobile tabs and shows level notes', () => {
    renderPanel({
      notes: [{ skillId: 'pwd', title: 'pwd', note: 'stay oriented' }],
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: strings.notesTab }));
    expect(screen.getByText('stay oriented')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: strings.hintsTab }));
    expect(screen.getByTestId('hint-button')).not.toBeNull();
  });

  it('shows the notes empty state with a spellbook link', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: strings.notesTab }));
    expect(screen.getByText(strings.notesEmpty)).not.toBeNull();
    expect(screen.getByRole('link', { name: strings.openSpellbook })).not.toBeNull();
  });
});
