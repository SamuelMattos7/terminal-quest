import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSettings } from '../stores/settings.js';
import { strings } from '../strings.js';
import { FakeTerminal } from './FakeTerminal.js';

describe('FakeTerminal', () => {
  it('types the command out and then shows the output', async () => {
    useSettings.setState({ reducedMotion: false });
    render(<FakeTerminal />);
    expect(screen.queryByText(strings.fakeTerminalOutput)).toBeNull();
    expect(await screen.findByText(strings.fakeTerminalOutput)).not.toBeNull();
    useSettings.setState({ reducedMotion: false });
  });

  it('renders the full frame instantly with reduced motion', () => {
    useSettings.setState({ reducedMotion: true });
    render(<FakeTerminal />);
    expect(screen.getByText(strings.fakeTerminalOutput)).not.toBeNull();
  });
});
