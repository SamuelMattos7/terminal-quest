import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../stores/settings.js';
import { strings } from '../strings.js';
import { TerminalView } from './TerminalView.js';

const sessionStub = vi.hoisted(() => ({
  status: 'live' as string,
  closeReason: null as string | null,
  sendStdin: vi.fn(),
  sendResize: vi.fn(),
  setStdoutWriter: vi.fn(),
  setTerminalFocus: vi.fn(),
}));

vi.mock('../session/useSession.js', () => {
  const useSessionMock = Object.assign(
    (selector: (state: typeof sessionStub) => unknown) => selector(sessionStub),
    { getState: () => sessionStub },
  );
  return { useSession: useSessionMock };
});

const termMocks = vi.hoisted(() => ({ instances: [] as Array<MockTerminal>, fit: vi.fn() }));

interface MockTerminal {
  options: Record<string, unknown>;
  cols: number;
  rows: number;
  opened: unknown;
  written: string[];
  focused: boolean;
  disposed: boolean;
  emitData: (data: string) => void;
  keyHandler: ((event: KeyboardEvent) => boolean) | null;
}

vi.mock('@xterm/xterm', () => {
  class MockTerm implements MockTerminal {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    opened: unknown = null;
    written: string[] = [];
    focused = false;
    disposed = false;
    private dataHandlers: Array<(data: string) => void> = [];
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      termMocks.instances.push(this);
    }

    loadAddon(): void {}
    open(container: unknown): void {
      this.opened = container;
    }
    write(data: string): void {
      this.written.push(data);
    }
    focus(): void {
      this.focused = true;
    }
    dispose(): void {
      this.disposed = true;
    }
    onData(fn: (data: string) => void): { dispose: () => void } {
      this.dataHandlers.push(fn);
      return { dispose: () => {} };
    }
    attachCustomKeyEventHandler(fn: (event: KeyboardEvent) => boolean): void {
      this.keyHandler = fn;
    }
    emitData(data: string): void {
      for (const fn of this.dataHandlers) {
        fn(data);
      }
    }
  }
  return { Terminal: MockTerm };
});

vi.mock('@xterm/addon-fit', () => {
  class MockFit {
    fit = termMocks.fit;
  }
  return { FitAddon: MockFit };
});

const roCallbacks = vi.hoisted(() => ({ list: [] as Array<() => void> }));

function lastTerm(): MockTerminal {
  const term = termMocks.instances.at(-1);
  if (term === undefined) {
    throw new Error('no terminal created');
  }
  return term;
}

beforeEach(() => {
  termMocks.instances = [];
  termMocks.fit.mockReset();
  useSettings.setState({ fontSize: 'normal', highContrast: false, reducedMotion: false });
  roCallbacks.list = [];
  sessionStub.status = 'live';
  sessionStub.closeReason = null;
  sessionStub.sendStdin.mockClear();
  sessionStub.sendResize.mockClear();
  sessionStub.setStdoutWriter.mockClear();
  sessionStub.setTerminalFocus.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        roCallbacks.list.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TerminalView', () => {
  it('applies accessibility settings on open and updates the same terminal in place', () => {
    useSettings.setState({ fontSize: 'large', highContrast: true, reducedMotion: true });
    const { unmount } = render(<TerminalView onLeaveTerminal={() => {}} />);
    const term = lastTerm();
    expect(term.options).toMatchObject({
      fontSize: 17,
      cursorBlink: false,
      minimumContrastRatio: 7,
      theme: { background: '#000000', foreground: '#ffffff' },
    });

    termMocks.fit.mockImplementation(() => {
      expect(term.options.fontSize).toBe(19);
      term.cols = 72;
      term.rows = 21;
    });
    act(() => {
      useSettings.setState({ fontSize: 'xlarge', highContrast: false, reducedMotion: false });
    });

    expect(termMocks.instances).toEqual([term]);
    expect(term.options).toMatchObject({
      fontSize: 19,
      cursorBlink: true,
      minimumContrastRatio: 1,
      theme: { background: '#0b0f14', foreground: '#d7e0ea' },
    });
    expect(termMocks.fit).toHaveBeenCalledTimes(2);
    expect(sessionStub.sendResize).toHaveBeenLastCalledWith(72, 21);

    unmount();
    act(() => useSettings.setState({ fontSize: 'normal' }));
    expect(termMocks.fit).toHaveBeenCalledTimes(2);
  });

  it('opens a terminal and wires stdout, stdin, and resize', () => {
    const onLeave = vi.fn();
    render(<TerminalView onLeaveTerminal={onLeave} />);
    const term = lastTerm();
    expect(term.opened).not.toBeNull();
    expect(sessionStub.sendResize).toHaveBeenCalledWith(80, 24);

    const writer = sessionStub.setStdoutWriter.mock.calls[0]?.[0] as (data: string) => void;
    writer('hello');
    expect(term.written).toEqual(['hello']);

    term.emitData('pwd\n');
    expect(sessionStub.sendStdin).toHaveBeenCalledWith('pwd\n');

    roCallbacks.list[0]?.();
    expect(sessionStub.sendResize).toHaveBeenCalledTimes(1);
  });

  it('shows the connection status and close reason', () => {
    sessionStub.status = 'closed';
    sessionStub.closeReason = 'idle';
    render(<TerminalView onLeaveTerminal={() => {}} />);
    expect(screen.getByText(/Disconnected \(idle\)/)).not.toBeNull();
  });

  it('leave button and container click move focus', () => {
    const onLeave = vi.fn();
    render(<TerminalView onLeaveTerminal={onLeave} />);
    fireEvent.click(screen.getByRole('button', { name: strings.terminalLeave }));
    expect(onLeave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('terminal-container'));
    expect(lastTerm().focused).toBe(true);
  });

  it('disables input while disconnected and cleans up on unmount', () => {
    sessionStub.status = 'starting';
    const { unmount } = render(<TerminalView onLeaveTerminal={() => {}} />);
    const term = lastTerm();
    expect(term.options.disableStdin).toBe(true);
    unmount();
    expect(term.disposed).toBe(true);
    expect(sessionStub.setStdoutWriter).toHaveBeenLastCalledWith(null);
  });

  it('sends a control code for the next letter while Ctrl is armed', () => {
    const onCtrlConsumed = vi.fn();
    const ctrlKey = { current: { armed: true } };
    render(
      <TerminalView onLeaveTerminal={() => {}} ctrlKey={ctrlKey} onCtrlConsumed={onCtrlConsumed} />,
    );
    const term = lastTerm();
    const keyEvent = (key: string) =>
      ({ key, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent;
    expect(term.keyHandler?.(keyEvent('c'))).toBe(false);
    expect(sessionStub.sendStdin).toHaveBeenCalledWith('\x03');
    expect(ctrlKey.current.armed).toBe(false);
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1);
    // Disarmed: letters pass through to the terminal.
    expect(term.keyHandler?.(keyEvent('d'))).toBe(true);
    expect(sessionStub.sendStdin).toHaveBeenCalledTimes(1);
  });
});
