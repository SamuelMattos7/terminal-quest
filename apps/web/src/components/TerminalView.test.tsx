import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const termMocks = vi.hoisted(() => ({ instances: [] as Array<MockTerminal> }));

interface MockTerminal {
  options: Record<string, unknown>;
  cols: number;
  rows: number;
  opened: unknown;
  written: string[];
  focused: boolean;
  disposed: boolean;
  emitData: (data: string) => void;
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

    constructor() {
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
    fit(): void {}
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
});
