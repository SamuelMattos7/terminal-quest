import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { useSettings } from '../stores/settings.js';
import { strings } from '../strings.js';
import { SettingsPage } from './SettingsPage.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: {
      me: vi.fn(),
      worlds: vi.fn(),
      progress: vi.fn(),
      deleteProgress: vi.fn(),
    },
  };
});

function renderPage(): void {
  render(
    <MemoryRouter
      initialEntries={['/settings']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/map" element={<div>map-probe</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const emptyProgress = {
  levels: {},
  totals: { xp: 0, completions: 0, levelsCompleted: 0, hintsUsed: 0 },
};

beforeEach(() => {
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
  useSettings.setState({ highContrast: false, fontSize: 'normal', reducedMotion: false });
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.removeAttribute('data-font-size');
  document.documentElement.removeAttribute('data-reduced-motion');
  vi.mocked(api.me)
    .mockReset()
    .mockResolvedValue({
      user: { id: 'u1', displayName: null, xp: 0, streakDays: 0 },
      playerLevel: 1,
      xpToNext: 100,
      badges: [],
    });
  vi.mocked(api.worlds).mockReset().mockResolvedValue({ worlds: [] });
  vi.mocked(api.progress).mockReset().mockResolvedValue(emptyProgress);
  vi.mocked(api.deleteProgress).mockReset().mockResolvedValue({ ok: true });
});

describe('SettingsPage', () => {
  it('changes font size and toggles contrast', () => {
    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: strings.fontSizeLarge }));
    expect(document.documentElement.getAttribute('data-font-size')).toBe('large');
    fireEvent.click(screen.getByRole('checkbox', { name: strings.highContrastLabel }));
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
    fireEvent.click(screen.getByRole('checkbox', { name: strings.reducedMotionLabel }));
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('on');
  });

  it('resets progress after confirmation and returns to the map', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: strings.resetProgress }));
    expect(api.deleteProgress).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: strings.resetConfirmYes }));
    expect(await screen.findByText('map-probe')).not.toBeNull();
    expect(api.deleteProgress).toHaveBeenCalledTimes(1);
  });

  it('shows an error when reset fails', async () => {
    vi.mocked(api.deleteProgress).mockRejectedValue(new ApiError(500, 'boom'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: strings.resetProgress }));
    fireEvent.click(screen.getByRole('button', { name: strings.resetConfirmYes }));
    expect(await screen.findByText(strings.saveFailed)).not.toBeNull();
    expect(screen.queryByText('map-probe')).toBeNull();
  });
});
