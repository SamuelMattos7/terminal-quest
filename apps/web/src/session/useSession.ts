import type { PublicLevel, ServerMessage } from '@terminal-quest/shared';
import { create } from 'zustand';
import { ApiError, api } from '../api/client.js';
import { SessionSocket, type SessionEvent } from './socket.js';

export type SessionStatus = 'idle' | 'starting' | 'live' | 'reconnecting' | 'closed' | 'completed';

type CompletionResult = Extract<ServerMessage, { t: 'level_complete' }>['result'];
type SessionObjective = Extract<ServerMessage, { t: 'session_state' }>['objectives'][number];

export interface RevealedHint {
  tier: 1 | 2 | 3;
  text: string;
  penaltyPct: number;
}

export interface SessionToast {
  id: number;
  kind: 'tux' | 'coach';
  text: string;
}

interface ObjectiveState {
  id: string;
  status: 'pending' | 'done';
}

interface SessionState {
  status: SessionStatus;
  levelId: string | null;
  sessionId: string | null;
  level: PublicLevel | null;
  objectives: ObjectiveState[];
  hintsUsed: number;
  hints: RevealedHint[];
  toasts: SessionToast[];
  completion: CompletionResult | null;
  closeReason: string | null;
  reconnectAttempt: number;
  error: string | null;
  stdoutWriter: ((data: string) => void) | null;
  terminalFocus: (() => void) | null; /** Open (or replace) the live session for a level. */
  start: (levelId: string) => Promise<void>;
  requestHint: () => void;
  forceCheck: () => void;
  sendStdin: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  /** Destroy the sandbox and start over with a new seed (same level). */
  reset: () => Promise<void>;
  /** Abandon the session server-side and return to idle. */
  leave: () => Promise<void>;
  /** Close the socket only (page unmount); the server session idles out. */
  disconnect: () => void;
  dismissToast: (id: number) => void;
  setStdoutWriter: (writer: ((data: string) => void) | null) => void;
  setTerminalFocus: (focus: (() => void) | null) => void;
}

// Generation counter: async flows capture it and ignore stale socket events
// after a newer start/reset/leave/disconnect superseded them.
let generation = 0;
let liveSocket: SessionSocket | null = null;
let toastSeq = 0;

const MAX_TOASTS = 4;

function wsUrl(wsPath: string): string {
  const secure = window.location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${window.location.host}${wsPath}`;
}

function toMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Something went wrong.';
}

function initialProgress(): Pick<
  SessionState,
  | 'level'
  | 'objectives'
  | 'hintsUsed'
  | 'hints'
  | 'toasts'
  | 'completion'
  | 'closeReason'
  | 'reconnectAttempt'
  | 'error'
> {
  return {
    level: null,
    objectives: [],
    hintsUsed: 0,
    hints: [],
    toasts: [],
    completion: null,
    closeReason: null,
    reconnectAttempt: 0,
    error: null,
  };
}

function pushToast(
  toasts: SessionToast[],
  kind: SessionToast['kind'],
  text: string,
): SessionToast[] {
  toastSeq += 1;
  return [...toasts, { id: toastSeq, kind, text }].slice(-MAX_TOASTS);
}

function attachSocket(sessionId: string, wsPath: string, gen: number): void {
  const socket = new SessionSocket(wsUrl(wsPath), (event) => handleEvent(gen, event));
  liveSocket = socket;
  useSession.setState({ sessionId });
  socket.connect();
}

function handleEvent(gen: number, event: SessionEvent): void {
  if (gen !== generation) {
    return;
  }
  const state = useSession.getState();
  switch (event.kind) {
    case 'open':
      if (state.status === 'starting' || state.status === 'reconnecting') {
        useSession.setState({ status: 'live', reconnectAttempt: 0 });
      }
      return;
    case 'reconnecting':
      useSession.setState({ status: 'reconnecting', reconnectAttempt: event.attempt });
      return;
    case 'closed':
      if (event.gaveUp) {
        useSession.setState({ status: 'closed', closeReason: 'connection lost' });
      } else if (event.code === 4401 || event.code === 4403) {
        useSession.setState({ status: 'closed', error: 'Session not authorized.' });
      } else if (state.status !== 'closed' && state.status !== 'completed') {
        useSession.setState({ status: 'closed' });
      }
      return;
    case 'message':
      handleServerMessage(event.message);
      return;
  }
}

function handleServerMessage(message: ServerMessage): void {
  const state = useSession.getState();
  switch (message.t) {
    case 'session_state':
      useSession.setState({
        level: message.level,
        objectives: message.objectives.map((o: SessionObjective) => ({ ...o })),
        hintsUsed: message.hintsUsed,
        status: message.completed
          ? 'completed'
          : state.status === 'starting'
            ? state.status
            : 'live',
      });
      return;
    case 'stdout':
      state.stdoutWriter?.(message.d);
      return;
    case 'objective':
      useSession.setState({
        objectives: state.objectives.map((o) =>
          o.id === message.id ? { ...o, status: message.status } : o,
        ),
      });
      return;
    case 'hint':
      useSession.setState({
        hints: [
          ...state.hints,
          { tier: message.tier, text: message.text, penaltyPct: message.penaltyPct },
        ],
        hintsUsed: state.hintsUsed + 1,
      });
      return;
    case 'tux':
      useSession.setState({ toasts: pushToast(state.toasts, 'tux', message.text) });
      return;
    case 'coach':
      useSession.setState({ toasts: pushToast(state.toasts, 'coach', message.text) });
      return;
    case 'level_complete':
      useSession.setState({ completion: message.result, status: 'completed' });
      return;
    case 'closing':
      // Server is tearing the session down: stop reconnecting.
      liveSocket?.close();
      useSession.setState({ status: 'closed', closeReason: message.reason });
      return;
    case 'error':
      useSession.setState({ error: message.message });
      return;
    case 'pong':
      return;
  }
}

/** Live level-session store (plan.md §9.4 `useSession`). */
export const useSession = create<SessionState>()((set, get) => ({
  status: 'idle',
  levelId: null,
  sessionId: null,
  ...initialProgress(),
  stdoutWriter: null,
  terminalFocus: null,

  start: async (levelId: string) => {
    generation += 1;
    const gen = generation;
    liveSocket?.close();
    liveSocket = null;
    set({ status: 'starting', levelId, sessionId: null, ...initialProgress() });
    try {
      const { sessionId, wsPath } = await api.startLevel(levelId);
      if (gen !== generation) {
        return;
      }
      attachSocket(sessionId, wsPath, gen);
    } catch (err: unknown) {
      if (gen !== generation) {
        return;
      }
      set({ status: 'closed', error: toMessage(err) });
    }
  },

  requestHint: () => {
    liveSocket?.send({ t: 'hint' });
  },

  forceCheck: () => {
    liveSocket?.send({ t: 'check' });
  },

  sendStdin: (data: string) => {
    if (data !== '') {
      liveSocket?.send({ t: 'stdin', d: data });
    }
  },

  sendResize: (cols: number, rows: number) => {
    liveSocket?.send({ t: 'resize', cols, rows });
  },

  reset: async () => {
    const { levelId, sessionId } = get();
    if (levelId === null || sessionId === null) {
      return;
    }
    generation += 1;
    const gen = generation;
    liveSocket?.close();
    liveSocket = null;
    // Keep the level panel visible; progress is replaced by the new session_state.
    set({ status: 'starting', sessionId: null, ...initialProgress() });
    try {
      const fresh = await api.resetSession(sessionId);
      if (gen !== generation) {
        return;
      }
      attachSocket(fresh.sessionId, fresh.wsPath, gen);
    } catch (err: unknown) {
      if (gen !== generation) {
        return;
      }
      set({ status: 'closed', error: toMessage(err) });
    }
  },

  leave: async () => {
    const { sessionId } = get();
    generation += 1;
    liveSocket?.close();
    liveSocket = null;
    if (sessionId !== null) {
      try {
        await api.deleteSession(sessionId);
      } catch (err: unknown) {
        console.warn('[tq] abandon session failed:', err);
      }
    }
    set({ status: 'idle', levelId: null, sessionId: null, ...initialProgress() });
  },

  disconnect: () => {
    generation += 1;
    liveSocket?.close();
    liveSocket = null;
    set({ status: 'idle', levelId: null, sessionId: null, ...initialProgress() });
  },

  dismissToast: (id: number) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  setStdoutWriter: (writer: ((data: string) => void) | null) => {
    set({ stdoutWriter: writer });
  },

  setTerminalFocus: (focus: (() => void) | null) => {
    set({ terminalFocus: focus });
  },
}));
