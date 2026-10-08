import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';
import { AppRoutes } from './routes.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: { guest: vi.fn(), me: vi.fn(), worlds: vi.fn() },
  };
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
  vi.mocked(api.guest).mockReset();
  vi.mocked(api.me).mockReset();
  vi.mocked(api.worlds).mockReset();
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

  it('renders the T4.2 placeholder for level pages', () => {
    renderAt('/play/w1-01-first-words');
    expect(screen.getByText(strings.levelPageTitle)).not.toBeNull();
    expect(screen.getByText(`${strings.comingSoon} T4.2.`)).not.toBeNull();
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
