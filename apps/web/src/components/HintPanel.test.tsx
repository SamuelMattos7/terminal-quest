import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HintPanel } from './HintPanel.js';

describe('HintPanel', () => {
  it('requests a hint and lists revealed tiers', () => {
    const onRequestHint = vi.fn();
    render(
      <HintPanel
        hints={[{ tier: 1, text: 'try pwd', penaltyPct: 5 }]}
        hintsUsed={1}
        hintsTotal={3}
        canRequest
        onRequestHint={onRequestHint}
      />,
    );
    const button = screen.getByTestId('hint-button');
    expect(button.textContent).toMatch(/2 hints left/);
    fireEvent.click(button);
    expect(onRequestHint).toHaveBeenCalledTimes(1);
    expect(screen.getByText('try pwd')).not.toBeNull();
  });

  it('disables the button when no hints remain or the session is not live', () => {
    const { rerender } = render(
      <HintPanel hints={[]} hintsUsed={3} hintsTotal={3} canRequest onRequestHint={() => {}} />,
    );
    expect(screen.getByTestId('hint-button')).toHaveProperty('disabled', true);
    rerender(
      <HintPanel
        hints={[]}
        hintsUsed={0}
        hintsTotal={3}
        canRequest={false}
        onRequestHint={() => {}}
      />,
    );
    expect(screen.getByTestId('hint-button')).toHaveProperty('disabled', true);
  });
});
