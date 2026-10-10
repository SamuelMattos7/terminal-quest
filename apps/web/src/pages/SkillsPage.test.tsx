import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';
import { SkillsPage } from './SkillsPage.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: { skills: vi.fn() },
  };
});

function renderPage(): void {
  render(
    <MemoryRouter
      initialEntries={['/skills']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <SkillsPage />
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
  vi.mocked(api.skills)
    .mockReset()
    .mockResolvedValue({
      skills: [
        {
          id: 'pwd',
          title: 'pwd',
          group: 'navigation',
          world: 1,
          prereqs: [],
          uses: 2,
          masteredAt: null,
        },
      ],
    });
});

describe('SkillsPage', () => {
  it('loads and graphs skills', async () => {
    renderPage();
    expect(await screen.findByTestId('skill-graph')).not.toBeNull();
    expect(screen.getByTestId('skill-node-pwd')).not.toBeNull();
  });

  it('shows an empty state without skills', async () => {
    vi.mocked(api.skills).mockResolvedValue({ skills: [] });
    renderPage();
    expect(await screen.findByText(strings.skillsEmpty)).not.toBeNull();
  });

  it('surfaces load failures', async () => {
    vi.mocked(api.skills).mockRejectedValue(new ApiError(401, 'unauthorized'));
    renderPage();
    expect(await screen.findByRole('alert')).not.toBeNull();
  });
});
