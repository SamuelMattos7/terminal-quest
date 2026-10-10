import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { useSession, type SessionStatus } from '../session/useSession.js';
import { strings } from '../strings.js';

const RESIZE_DEBOUNCE_MS = 150;

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: strings.connectionClosed,
  starting: strings.connectionStarting,
  live: strings.connectionLive,
  reconnecting: strings.connectionReconnecting,
  closed: strings.connectionClosed,
  completed: strings.connectionCompleted,
};

const STATUS_DOT: Record<SessionStatus, string> = {
  idle: 'bg-muted',
  starting: 'bg-amber',
  live: 'bg-green',
  reconnecting: 'bg-amber',
  closed: 'bg-red',
  completed: 'bg-purple',
};

interface TerminalViewProps {
  /** Move keyboard focus out of the terminal (plan.md §9.5: focus is never trapped). */
  onLeaveTerminal: () => void;
  /**
   * Shared Ctrl-arm flag for the mobile key bar (§9.6): while armed, the next
   * letter typed on the OS keyboard is sent as a control code instead.
   */
  ctrlKey?: { current: { armed: boolean } };
  /** Fired when an armed Ctrl is consumed by a keystroke. */
  onCtrlConsumed?: () => void;
}

/** xterm.js terminal bound to the live session socket (plan.md §9.3). */
export function TerminalView({ onLeaveTerminal, ctrlKey, onCtrlConsumed }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const status = useSession((s) => s.status);
  const closeReason = useSession((s) => s.closeReason);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: '#0b0f14',
        foreground: '#d7e0ea',
        cursor: '#3ddc84',
        selectionBackground: '#243040',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      // jsdom and zero-size containers have nothing to fit; harmless.
    }
    termRef.current = term;
    useSession.getState().sendResize(term.cols, term.rows);
    useSession.getState().setStdoutWriter((data: string) => {
      term.write(data);
    });
    useSession.getState().setTerminalFocus(() => {
      term.focus();
    });
    const dropInput = term.onData((data: string) => {
      useSession.getState().sendStdin(data);
    });
    // Returns void in xterm v5: the handler dies with the terminal on dispose.
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const armed = ctrlKey?.current.armed ?? false;
      if (
        armed &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        /^[a-zA-Z]$/.test(event.key)
      ) {
        const code = String.fromCharCode(event.key.toLowerCase().charCodeAt(0) - 96);
        useSession.getState().sendStdin(code);
        if (ctrlKey !== undefined) {
          ctrlKey.current.armed = false;
        }
        onCtrlConsumed?.();
        return false;
      }
      return true;
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (timer !== null) {
              clearTimeout(timer);
            }
            timer = setTimeout(() => {
              timer = null;
              try {
                fit.fit();
              } catch {
                return;
              }
              useSession.getState().sendResize(term.cols, term.rows);
            }, RESIZE_DEBOUNCE_MS);
          })
        : null;
    observer?.observe(container);

    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      observer?.disconnect();
      dropInput.dispose();
      useSession.getState().setStdoutWriter(null);
      useSession.getState().setTerminalFocus(null);
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Never accept keystrokes the socket cannot deliver (avoids silent loss).
  useEffect(() => {
    const term = termRef.current;
    if (term !== null) {
      term.options.disableStdin = status !== 'live' && status !== 'completed';
    }
  }, [status]);

  return (
    <div data-testid="terminal-view" className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="flex items-center gap-2 font-mono text-xs text-muted">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`}
          />
          {STATUS_LABEL[status]}
          {status === 'closed' && closeReason !== null ? ` (${closeReason})` : ''}
        </span>
        <button
          type="button"
          onClick={onLeaveTerminal}
          className="rounded border border-border px-2 py-1 font-mono text-xs text-muted hover:text-text"
        >
          {strings.terminalLeave}
        </button>
      </div>
      <div
        ref={containerRef}
        role="application"
        aria-label={strings.terminalLabel}
        data-testid="terminal-container"
        className="min-h-[45vh] flex-1 overflow-hidden rounded-lg border border-border bg-bg p-2 lg:min-h-0"
        onClick={() => {
          termRef.current?.focus();
        }}
      />
    </div>
  );
}
