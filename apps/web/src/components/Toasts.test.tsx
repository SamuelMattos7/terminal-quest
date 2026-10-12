import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toasts } from './Toasts.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toasts', () => {
  it('renders nothing without toasts', () => {
    render(<Toasts toasts={[]} onDismiss={() => {}} />);
    expect(screen.queryByTestId('toasts')).toBeNull();
  });

  it('dismisses manually and automatically', () => {
    const onDismiss = vi.fn();
    render(
      <Toasts
        toasts={[
          { id: 1, kind: 'tux', text: 'hello' },
          { id: 2, kind: 'coach', text: 'tip' },
        ]}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('hello')).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0] as HTMLElement);
    expect(onDismiss).toHaveBeenCalledWith(1);
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(onDismiss).toHaveBeenCalledWith(2);
  });
});
