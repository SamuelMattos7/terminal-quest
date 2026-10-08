import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';
import { Landing } from './Landing.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: { guest: vi.fn(), me: vi.fn(), worlds: vi.fn() },
  };
});

const meFixture = {
  user: { id: 'u1', displayName: null, xp: 0, streakDays: 0 },
  playerLevel: 1,
  xpToNext: 100,
  badges: [],
};

function renderLanding(): void {
  render(
    <MemoryRouter
      initialEntries={['/']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/map" element={<div>map-probe</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useGame.setState({ me: null, worlds: null, starting: false, loading: false, error: null });
  vi.mocked(api.guest).mockReset().mockResolvedValue({ user: meFixture.user });
  vi.mocked(api.me).mockReset().mockResolvedValue(meFixture);
  vi.mocked(api.worlds).mockReset().mockResolvedValue({ worlds: [] });
});

describe('Landing', () => {
  it('shows the pitch and start button', () => {
    renderLanding();
    expect(screen.getByText(strings.landingTagline)).not.toBeNull();
    expect(screen.getByRole('button', { name: strings.startPlaying })).not.toBeNull();
  });

  it('creates a guest and navigates to the map on start', async () => {
    renderLanding();
    fireEvent.click(screen.getByRole('button', { name: strings.startPlaying }));
    expect(await screen.findByText('map-probe')).not.toBeNull();
    expect(api.guest).toHaveBeenCalledTimes(1);
  });

  it('stays put and shows an error when guest creation fails', async () => {
    vi.mocked(api.guest).mockRejectedValue(new ApiError(0, 'down'));
    renderLanding();
    fireEvent.click(screen.getByRole('button', { name: strings.startPlaying }));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.queryByText('map-probe')).toBeNull();
  });
});
