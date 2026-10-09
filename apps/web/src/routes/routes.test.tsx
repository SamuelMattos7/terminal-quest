import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client.js';
import { useSession } from '../session/useSession.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';
import { AppRoutes } from './routes.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: {
      guest: vi.fn(),
      me: vi.fn(),
      worlds: vi.fn(),
      startLevel: vi.fn(),
      resetSession: vi.fn(),
      deleteSession: vi.fn(),
    },
  };
});

vi.mock('../session/socket.js', () => {
  class MockSocket {
    connect = vi.fn();
    send = vi.fn();
    close = vi.fn();
    constructor(_url: string, _handler: unknown) {}
  }
  return { SessionSocket: MockSocket, MAX_RECONNECT_ATTEMPTS: 3 };
});

vi.mock('@xterm/xterm', () => {
  class MockTerm {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    focus(): void {}
    dispose(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => {} };
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

function renderAt(path: string): void {
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useGame.setState({ me: null, worlds: null, starting: false, loading: false, error: null });
  useSession.getState().disconnect();
  vi.mocked(api.guest).mockReset();
  vi.mocked(api.me).mockReset();
  vi.mocked(api.worlds).mockReset();
  vi.mocked(api.startLevel).mockReset();
  vi.mocked(api.resetSession).mockReset();
  vi.mocked(api.deleteSession).mockReset();
});

describe('AppRoutes', () => {
  it('renders the landing page at /', () => {
    renderAt('/');
    expect(screen.getByRole('button', { name: strings.startPlaying })).not.toBeNull();
    expect(api.guest).not.toHaveBeenCalled();
  });

  it('renders the world map at /map once data loads', async () => {
    vi.mocked(api.me).mockResolvedValue({
      user: { id: 'u1', displayName: null, xp: 10, streakDays: 0 },
      playerLevel: 1,
      xpToNext: 90,
      badges: [],
    });
    vi.mocked(api.worlds).mockResolvedValue({ worlds: [] });
    renderAt('/map');
    expect(await screen.findByText(strings.mapTitle)).not.toBeNull();
  });

  it('renders the level page for /play/:levelId', async () => {
    vi.mocked(api.startLevel).mockResolvedValue({ sessionId: 's1', wsPath: '/ws/sessions/s1' });
    renderAt('/play/w1-01-first-words');
    expect(await screen.findByText(strings.levelStarting)).not.toBeNull();
    expect(api.startLevel).toHaveBeenCalledWith('w1-01-first-words');
  });

  it('renders T4.3 placeholders for the later pages', () => {
    for (const path of ['/spellbook', '/skills', '/profile', '/settings']) {
      const { unmount } = render(
        <MemoryRouter
          initialEntries={[path]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <AppRoutes />
        </MemoryRouter>,
      );
      expect(screen.getByText(`${strings.comingSoon} T4.3.`)).not.toBeNull();
      unmount();
    }
  });

  it('redirects unknown paths to /', () => {
    renderAt('/nope');
    expect(screen.getByRole('button', { name: strings.startPlaying })).not.toBeNull();
  });
});
