import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';
import { WorldMap } from './WorldMap.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: { guest: vi.fn(), me: vi.fn(), worlds: vi.fn() },
  };
});

const meFixture = {
  user: { id: 'u1', displayName: null, xp: 55, streakDays: 3 },
  playerLevel: 2,
  xpToNext: 45,
  badges: [],
};

const worldsFixture = {
  worlds: [
    {
      id: 1,
      title: 'The Lobby',
      blurb: 'Welcome.',
      levels: [
        {
          id: 'w1-01-first-words',
          title: 'First words',
          kind: 'lesson',
          difficulty: 1,
          estimatedMinutes: 5,
          state: 'completed',
          bestRank: 'S',
        },
        {
          id: 'w1-02-where-am-i',
          title: 'Where am I',
          kind: 'lesson',
          difficulty: 1,
          estimatedMinutes: 5,
          state: 'available',
        },
        {
          id: 'w1-12-boss-organize-chaos',
          title: 'Organize chaos',
          kind: 'boss',
          difficulty: 3,
          estimatedMinutes: 20,
          state: 'locked',
        },
      ],
    },
    { id: 2, title: 'The Filing Room', blurb: 'Paper everywhere.', levels: [] },
  ],
} as const;

function renderMap(): void {
  render(
    <MemoryRouter
      initialEntries={['/map']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <WorldMap />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useGame.setState({ me: null, worlds: null, starting: false, loading: false, error: null });
  vi.mocked(api.me).mockReset().mockResolvedValue(meFixture);
  vi.mocked(api.worlds).mockReset().mockResolvedValue({ worlds: [] });
});

describe('WorldMap', () => {
  it('loads and renders worlds with locked/available/completed states', async () => {
    vi.mocked(api.worlds).mockResolvedValue(JSON.parse(JSON.stringify(worldsFixture)));
    renderMap();
    expect(await screen.findByText('The Lobby')).not.toBeNull();
    // Completed level links to the level page and shows its rank.
    const completed = await screen.findByRole('link', { name: /First words/ });
    expect(completed.getAttribute('href')).toBe('/play/w1-01-first-words');
    expect(screen.getByLabelText(`${strings.rankLabel} S`)).not.toBeNull();
    // Available level links to the level page.
    const available = screen.getByRole('link', { name: /Where am I/ });
    expect(available.getAttribute('href')).toBe('/play/w1-02-where-am-i');
    // Locked level is not a link.
    expect(screen.getByText(strings.levelLocked)).not.toBeNull();
    expect(screen.queryByRole('link', { name: /Organize chaos/ })).toBeNull();
    // Empty world shows the placeholder text.
    expect(screen.getByText(strings.mapEmptyWorld)).not.toBeNull();
  });

  it('shows XP progress and streak in the header', async () => {
    renderMap();
    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('55');
    expect(await screen.findByText(/3 day streak/)).not.toBeNull();
  });

  it('shows an error with retry when loading fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError(401, 'unauthorized'));
    renderMap();
    expect(await screen.findByRole('alert')).not.toBeNull();
    vi.mocked(api.me).mockResolvedValue(meFixture);
    fireEvent.click(screen.getByRole('button', { name: strings.mapRetry }));
    expect(await screen.findByText(strings.mapTitle)).not.toBeNull();
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it('shows a loading state while fetching', () => {
    vi.mocked(api.me).mockImplementation(() => new Promise(() => {}));
    renderMap();
    expect(screen.getByText(strings.mapLoading)).not.toBeNull();
  });
});
