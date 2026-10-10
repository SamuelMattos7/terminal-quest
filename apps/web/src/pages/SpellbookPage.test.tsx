import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';
import { SpellbookPage } from './SpellbookPage.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: {
      spellbook: vi.fn(),
      saveSpellbookNote: vi.fn(),
      spellbookExport: vi.fn(),
    },
  };
});

const bookFixture = {
  entries: [
    {
      skillId: 'pwd',
      title: 'pwd',
      cheatsheet: [{ syntax: 'pwd', note: 'print directory' }],
      examples: ['pwd'],
      note: null,
    },
    {
      skillId: 'ls',
      title: 'ls',
      cheatsheet: [{ syntax: 'ls -la', note: 'list all' }],
      examples: [],
      note: 'my memory hook',
    },
  ],
};

function renderPage(): void {
  render(
    <MemoryRouter
      initialEntries={['/spellbook']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <SpellbookPage />
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
  vi.mocked(api.spellbook).mockReset().mockResolvedValue(bookFixture);
  vi.mocked(api.saveSpellbookNote).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(api.spellbookExport).mockReset().mockResolvedValue('# Spellbook');
});

describe('SpellbookPage', () => {
  it('loads and renders entries with cheats and notes', async () => {
    renderPage();
    expect(await screen.findByTestId('spellbook-entry-pwd')).not.toBeNull();
    const entry = within(screen.getByTestId('spellbook-entry-pwd'));
    expect(entry.getByText('— print directory')).not.toBeNull();
    expect(screen.getByDisplayValue('my memory hook')).not.toBeNull();
  });

  it('filters entries by search query', async () => {
    renderPage();
    await screen.findByTestId('spellbook-entry-pwd');
    fireEvent.change(screen.getByPlaceholderText(strings.spellbookSearch), {
      target: { value: 'memory hook' },
    });
    expect(screen.queryByTestId('spellbook-entry-pwd')).toBeNull();
    expect(screen.getByTestId('spellbook-entry-ls')).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText(strings.spellbookSearch), {
      target: { value: 'zzz-no-match' },
    });
    expect(screen.getByText(strings.spellbookNoMatch)).not.toBeNull();
  });

  it('saves an edited note and shows confirmation', async () => {
    renderPage();
    await screen.findByTestId('spellbook-entry-pwd');
    const areas = screen.getAllByLabelText(strings.noteLabel);
    fireEvent.change(areas[0] as HTMLElement, { target: { value: 'stay oriented' } });
    fireEvent.click(screen.getAllByRole('button', { name: strings.noteSave })[0] as HTMLElement);
    expect(await screen.findByText(strings.noteSaved)).not.toBeNull();
    expect(api.saveSpellbookNote).toHaveBeenCalledWith('pwd', 'stay oriented');
  });

  it('shows an empty state when nothing is unlocked', async () => {
    vi.mocked(api.spellbook).mockResolvedValue({ entries: [] });
    renderPage();
    expect(await screen.findByText(strings.spellbookEmpty)).not.toBeNull();
  });

  it('surfaces load and export failures', async () => {
    vi.mocked(api.spellbook).mockRejectedValue(new ApiError(401, 'unauthorized'));
    renderPage();
    expect(await screen.findByRole('alert')).not.toBeNull();
  });
});
