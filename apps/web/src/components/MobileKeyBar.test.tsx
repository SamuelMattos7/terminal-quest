import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileKeyBar } from './MobileKeyBar.js';

describe('MobileKeyBar', () => {
  it('sends raw sequences for special keys', () => {
    const onKey = vi.fn();
    render(<MobileKeyBar ctrlArmed={false} onToggleCtrl={() => {}} onKey={onKey} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tab' }));
    expect(onKey).toHaveBeenCalledWith('\t');
    fireEvent.click(screen.getByRole('button', { name: 'Up arrow' }));
    expect(onKey).toHaveBeenCalledWith('\x1b[A');
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }));
    expect(onKey).toHaveBeenCalledWith('\x03');
    fireEvent.click(screen.getByRole('button', { name: '|' }));
    expect(onKey).toHaveBeenCalledWith('|');
  });

  it('toggles the Ctrl modifier with pressed state', () => {
    const onToggleCtrl = vi.fn();
    const { rerender } = render(
      <MobileKeyBar ctrlArmed={false} onToggleCtrl={onToggleCtrl} onKey={() => {}} />,
    );
    const toggle = screen.getByRole('button', { name: 'Ctrl' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggleCtrl).toHaveBeenCalledTimes(1);
    rerender(<MobileKeyBar ctrlArmed onToggleCtrl={onToggleCtrl} onKey={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ctrl' }).getAttribute('aria-pressed')).toBe('true');
  });
});
