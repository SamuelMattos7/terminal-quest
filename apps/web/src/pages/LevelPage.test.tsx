import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@terminal-quest/shared';
import { api } from '../api/client.js';
import type { SessionEventHandler } from '../session/socket.js';
import { useSession } from '../session/useSession.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';
import { LevelPage } from './LevelPage.js';

const socketMocks = vi.hoisted(() => ({ instances: [] as Array<MockSessionSocket> }));

interface MockSessionSocket {
  url: string;
  handler: SessionEventHandler;
  connect: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

vi.mock('../session/socket.js', () => {
  class MockSocket implements MockSessionSocket {
    url: string;
    handler: SessionEventHandler;
    connect = vi.fn();
    send = vi.fn();
    close = vi.fn();

    constructor(url: string, handler: SessionEventHandler) {
      this.url = url;
      this.handler = handler;
      socketMocks.instances.push(this);
    }
  }
  return { SessionSocket: MockSocket, MAX_RECONNECT_ATTEMPTS: 3 };
});

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: {
      startLevel: vi.fn(),
      resetSession: vi.fn(),
      deleteSession: vi.fn(),
      me: vi.fn(),
      worlds: vi.fn(),
      progress: vi.fn(),
      spellbook: vi.fn(),
    },
  };
});

const termMocks = vi.hoisted(() => ({ instances: [] as Array<MockTerminal> }));

interface MockTerminal {
  written: string[];
}

vi.mock('@xterm/xterm', () => {
  class MockTerm implements MockTerminal {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    written: string[] = [];

    constructor() {
      termMocks.instances.push(this);
    }

    loadAddon(): void {}
    open(): void {}
    write(data: string): void {
      this.written.push(data);
    }
    focus(): void {}
    dispose(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => {} };
    }
    attachCustomKeyEventHandler(): void {}
  }
  return { Terminal: MockTerm };
});

vi.mock('@xterm/addon-fit', () => {
  class MockFit {
    fit(): void {}
  }
  return { FitAddon: MockFit };
});

function sessionStateMessage(): ServerMessage {
  return {
    t: 'session_state',
    level: {
      id: 'w1-02-where-am-i',
      title: 'Where Am I?',
      story: 'Find yourself.',
      kind: 'lesson',
      objectives: [{ id: 'o1', text: 'Print the path', optional: false, bonus: false }],
      teaches: ['pwd'],
      parCommands: 3,
      xp: 50,
      hintCount: 3,
    },
    objectives: [{ id: 'o1', status: 'pending' }],
    hintsUsed: 0,
    hintsTotal: 3,
    completed: false,
  };
}

function completionMessage(): ServerMessage {
  return {
    t: 'level_complete',
    result: {
      xp: 55,
      rank: 'S',
      breakdown: [{ label: 'base', xp: 50 }],
      newBadges: [],
      unlocked: ['w1-03-moving-around'],
      explain: [],
      skillsGained: ['pwd'],
    },
  };
}

function lastSocket(): MockSessionSocket {
  const socket = socketMocks.instances.at(-1);
  if (socket === undefined) {
    throw new Error('no socket created');
  }
  return socket;
}

function renderPage(): { unmount: () => void } {
  return render(
    <MemoryRouter
      initialEntries={['/play/w1-02-where-am-i']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/play/:levelId" element={<LevelPage />} />
        <Route path="/map" element={<div>map-probe</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openLiveSession(): Promise<MockSessionSocket> {
  await vi.waitFor(() => {
    if (socketMocks.instances.length === 0) {
      throw new Error('waiting for socket');
    }
  });
  const socket = lastSocket();
  socket.handler({ kind: 'open' });
  socket.handler({ kind: 'message', message: sessionStateMessage() });
  return socket;
}

beforeEach(() => {
  socketMocks.instances = [];
  termMocks.instances = [];
  useSession.getState().disconnect();
  useGame.setState({
    me: null,
    worlds: null,
    progress: null,
    skillsData: null,
    spellbook: null,
    starting: false,
    loading: false,
    error: null,
  });
  vi.mocked(api.startLevel)
    .mockReset()
    .mockResolvedValue({ sessionId: 's1', wsPath: '/ws/sessions/s1' });
  vi.mocked(api.resetSession).mockReset();
  vi.mocked(api.deleteSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(api.me)
    .mockReset()
    .mockResolvedValue({
      user: { id: 'u1', displayName: null, xp: 0, streakDays: 0 },
      playerLevel: 1,
      xpToNext: 100,
      badges: [],
    });
  vi.mocked(api.worlds).mockReset().mockResolvedValue({ worlds: [] });
  vi.mocked(api.progress)
    .mockReset()
    .mockResolvedValue({
      levels: {},
      totals: { xp: 0, completions: 0, levelsCompleted: 0, hintsUsed: 0 },
    });
  vi.mocked(api.spellbook).mockReset().mockResolvedValue({ entries: [] });
});

describe('LevelPage', () => {
  it('starts the session on mount and shows terminal plus panel', async () => {
    renderPage();
    expect(screen.getByText(strings.levelStarting)).not.toBeNull();
    expect(api.startLevel).toHaveBeenCalledWith('w1-02-where-am-i');
    await openLiveSession();
    expect(await screen.findByTestId('terminal-container')).not.toBeNull();
    expect(screen.getByText('Find yourself.')).not.toBeNull();
    expect(screen.getByTestId('objective-o1')).not.toBeNull();
    expect(screen.getByTestId('hint-button')).not.toBeNull();
  });

  it('shows an error with retry when starting fails', async () => {
    vi.mocked(api.startLevel).mockRejectedValueOnce(new Error('down'));
    renderPage();
    expect(await screen.findByTestId('level-error')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: strings.levelRetry }));
    await openLiveSession();
    expect(await screen.findByTestId('terminal-container')).not.toBeNull();
  });

  it('shows the completion modal and advances to the next level', async () => {
    renderPage();
    const socket = await openLiveSession();
    await screen.findByTestId('terminal-container');
    socket.handler({ kind: 'message', message: completionMessage() });
    expect(await screen.findByTestId('complete-modal')).not.toBeNull();
    fireEvent.click(screen.getByTestId('complete-next'));
    expect(api.startLevel).toHaveBeenCalledWith('w1-03-moving-around');
  });

  it('replays via reset and leaves via abandon', async () => {
    renderPage();
    await openLiveSession();
    await screen.findByTestId('terminal-container');
    fireEvent.click(screen.getByRole('button', { name: strings.resetLevel }));
    vi.mocked(api.resetSession).mockResolvedValue({ sessionId: 's2', wsPath: '/ws/sessions/s2' });
    fireEvent.click(screen.getByRole('button', { name: strings.resetConfirmYes }));
    expect(api.resetSession).toHaveBeenCalledWith('s1');
    // The fresh sandbox replays session_state; drive the new socket.
    await vi.waitFor(() => {
      if (socketMocks.instances.length < 2) {
        throw new Error('waiting for fresh socket');
      }
    });
    const fresh = lastSocket();
    fresh.handler({ kind: 'open' });
    fresh.handler({ kind: 'message', message: sessionStateMessage() });
    expect(await screen.findByTestId('terminal-container')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: strings.leaveLevel }));
    expect(await screen.findByText('map-probe')).not.toBeNull();
    expect(api.deleteSession).toHaveBeenCalledWith('s2');
  });

  it('sends keybar keys through stdin', async () => {
    renderPage();
    const socket = await openLiveSession();
    await screen.findByTestId('terminal-container');
    expect(screen.getByTestId('mobile-keybar')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tab' }));
    expect(socket.send).toHaveBeenCalledWith({ t: 'stdin', d: '\t' });
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }));
    expect(socket.send).toHaveBeenCalledWith({ t: 'stdin', d: '\x03' });
  });

  it('shows spellbook notes for the level skills in the notes tab', async () => {
    vi.mocked(api.spellbook).mockResolvedValue({
      entries: [
        { skillId: 'pwd', title: 'pwd', cheatsheet: [], examples: [], note: 'stay oriented' },
        { skillId: 'grep', title: 'grep', cheatsheet: [], examples: [], note: 'unrelated' },
      ],
    });
    renderPage();
    await openLiveSession();
    await screen.findByTestId('terminal-container');
    fireEvent.click(screen.getByRole('tab', { name: strings.notesTab }));
    expect(screen.getByText('stay oriented')).not.toBeNull();
    expect(screen.queryByText('unrelated')).toBeNull();
  });

  it('disconnects the socket on unmount without abandoning', async () => {
    const { unmount } = renderPage();
    const socket = await openLiveSession();
    await screen.findByTestId('terminal-container');
    socket.close.mockClear();
    vi.mocked(api.deleteSession).mockClear();
    unmount();
    expect(socket.close).toHaveBeenCalled();
    expect(api.deleteSession).not.toHaveBeenCalled();
  });
});
