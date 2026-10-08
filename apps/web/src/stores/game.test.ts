import type { MeResponse, WorldsResponse } from '@terminal-quest/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client.js';
import { useGame } from './game.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: { guest: vi.fn(), me: vi.fn(), worlds: vi.fn() },
  };
});

const meFixture: MeResponse = {
  user: { id: 'u1', displayName: null, xp: 55, streakDays: 2 },
  playerLevel: 1,
  xpToNext: 45,
  badges: [],
};

const worldsFixture: WorldsResponse = {
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
          state: 'available',
        },
      ],
    },
  ],
};

function resetStore(): void {
  useGame.setState({ me: null, worlds: null, starting: false, loading: false, error: null });
}

beforeEach(() => {
  resetStore();
  vi.mocked(api.guest).mockReset().mockResolvedValue({ user: meFixture.user });
  vi.mocked(api.me).mockReset().mockResolvedValue(meFixture);
  vi.mocked(api.worlds).mockReset().mockResolvedValue(worldsFixture);
});

describe('useGame', () => {
  it('startPlaying creates a guest then loads profile and worlds', async () => {
    await useGame.getState().startPlaying();
    expect(api.guest).toHaveBeenCalledTimes(1);
    const state = useGame.getState();
    expect(state.me).toEqual(meFixture);
    expect(state.worlds).toEqual(worldsFixture);
    expect(state.starting).toBe(false);
    expect(state.error).toBeNull();
  });

  it('startPlaying surfaces API failures and clears the busy flag', async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError(401, 'unauthorized'));
    await useGame.getState().startPlaying();
    const state = useGame.getState();
    expect(state.me).toBeNull();
    expect(state.error).toBe('unauthorized');
    expect(state.starting).toBe(false);
  });

  it('refresh reloads profile and worlds', async () => {
    await useGame.getState().refresh();
    const state = useGame.getState();
    expect(state.me).toEqual(meFixture);
    expect(state.worlds).toEqual(worldsFixture);
    expect(state.loading).toBe(false);
  });

  it('clearError resets the error', async () => {
    vi.mocked(api.worlds).mockRejectedValue(
      new ApiError(0, 'Network error: could not reach the server.'),
    );
    await useGame.getState().refresh();
    expect(useGame.getState().error).not.toBeNull();
    useGame.getState().clearError();
    expect(useGame.getState().error).toBeNull();
  });
});
