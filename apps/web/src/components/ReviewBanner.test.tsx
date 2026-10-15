import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client.js';
import { ReviewBanner } from './ReviewBanner.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return { ...mod, api: { review: vi.fn(), skills: vi.fn() } };
});

function renderBanner(): void {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ReviewBanner levelTitles={new Map([['w1-01-first-words', 'First Words']])} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.review).mockReset();
  vi.mocked(api.skills).mockReset();
});

describe('ReviewBanner', () => {
  it('lists due items with replay links', async () => {
    vi.mocked(api.review).mockResolvedValue({
      due: [{ skillId: 'pwd', levelId: 'w1-01-first-words' }],
    });
    vi.mocked(api.skills).mockResolvedValue({
      skills: [
        {
          id: 'pwd',
          title: 'pwd',
          group: 'navigation',
          world: 1,
          prereqs: [],
          uses: 3,
          masteredAt: 9,
        },
      ],
    });
    renderBanner();
    expect(await screen.findByTestId('review-banner')).not.toBeNull();
    const link = screen.getByRole('link', { name: 'Review' });
    expect(link.getAttribute('href')).toBe('/play/w1-01-first-words');
    expect(screen.getByText(/First Words/)).not.toBeNull();
  });

  it('hides when nothing is due and on failure', async () => {
    vi.mocked(api.review).mockResolvedValue({ due: [] });
    vi.mocked(api.skills).mockResolvedValue({ skills: [] });
    renderBanner();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('review-banner')).toBeNull();

    vi.mocked(api.review).mockRejectedValue(new Error('down'));
    renderBanner();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('review-banner')).toBeNull();
  });
});
