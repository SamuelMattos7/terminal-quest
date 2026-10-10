import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';
import { ProfilePage } from './ProfilePage.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: {
      me: vi.fn(),
      worlds: vi.fn(),
      progress: vi.fn(),
      badges: vi.fn(),
      updateDisplayName: vi.fn(),
    },
  };
});

const meFixture = {
  user: { id: 'u1', displayName: 'Tux', xp: 55, streakDays: 3 },
  playerLevel: 1,
  xpToNext: 45,
  badges: ['first-command'],
};

const progressFixture = {
  levels: {},
  totals: { xp: 55, completions: 2, levelsCompleted: 1, hintsUsed: 4 },
};

const badgesFixture = {
  badges: [
    { id: 'first-command', title: 'First Command', description: 'Do it.', earnedAt: 9 },
    { id: 'other', title: 'Other', description: 'Later.', earnedAt: null },
  ],
};

function renderPage(): void {
  render(
    <MemoryRouter
      initialEntries={['/profile']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ProfilePage />
    </MemoryRouter>,
  );
}

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
  vi.mocked(api.me).mockReset().mockResolvedValue(meFixture);
  vi.mocked(api.worlds).mockReset().mockResolvedValue({ worlds: [] });
  vi.mocked(api.progress).mockReset().mockResolvedValue(progressFixture);
  vi.mocked(api.badges).mockReset().mockResolvedValue(badgesFixture);
  vi.mocked(api.updateDisplayName).mockReset();
});

describe('ProfilePage', () => {
  it('shows the name, stats, and badge grid', async () => {
    renderPage();
    expect(await screen.findByTestId('display-name')).not.toBeNull();
    expect(screen.getByText('Tux')).not.toBeNull();
    expect(screen.getByTestId(`stat-${strings.statHintsUsed}`).textContent).toBe('4');
    expect(screen.getByTestId(`stat-${strings.statStreak}`).textContent).toBe('3');
    expect(await screen.findByTestId('badge-first-command')).not.toBeNull();
    expect(screen.getByTestId('badge-other').textContent).toContain(strings.badgeLocked);
  });

  it('renames via the editor', async () => {
    renderPage();
    await screen.findByTestId('display-name');
    vi.mocked(api.updateDisplayName).mockResolvedValue({
      user: { ...meFixture.user, displayName: 'Root' },
    });
    fireEvent.click(screen.getByRole('button', { name: strings.editName }));
    fireEvent.change(screen.getByLabelText(strings.displayNameLabel), {
      target: { value: 'Root' },
    });
    fireEvent.click(screen.getByRole('button', { name: strings.saveName }));
    expect(await screen.findByText('Root')).not.toBeNull();
    expect(api.updateDisplayName).toHaveBeenCalledWith('Root');
  });

  it('shows an error when renaming fails', async () => {
    renderPage();
    await screen.findByTestId('display-name');
    vi.mocked(api.updateDisplayName).mockRejectedValue(new ApiError(400, 'bad name'));
    fireEvent.click(screen.getByRole('button', { name: strings.editName }));
    fireEvent.change(screen.getByLabelText(strings.displayNameLabel), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: strings.saveName }));
    expect(await screen.findByText(strings.saveFailed)).not.toBeNull();
  });
});
