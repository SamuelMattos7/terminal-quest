import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client.js';
import { strings } from '../strings.js';
import { DailyCard } from './DailyCard.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return { ...mod, api: { daily: vi.fn() } };
});

function renderCard(): void {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DailyCard levelTitles={new Map([['w1-02-where-am-i', 'Where Am I?']])} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.daily).mockReset();
});

describe('DailyCard', () => {
  it('shows the daily level with a play link', async () => {
    vi.mocked(api.daily).mockResolvedValue({
      levelId: 'w1-02-where-am-i',
      date: '2026-10-13',
      completed: false,
    });
    renderCard();
    expect(await screen.findByTestId('daily-card')).not.toBeNull();
    expect(screen.getByText('Where Am I?')).not.toBeNull();
    expect(screen.getByRole('link', { name: strings.dailyPlay }).getAttribute('href')).toBe(
      '/play/w1-02-where-am-i',
    );
  });

  it('shows the completed state instead of a link', async () => {
    vi.mocked(api.daily).mockResolvedValue({
      levelId: 'w1-02-where-am-i',
      date: '2026-10-13',
      completed: true,
    });
    renderCard();
    expect(await screen.findByText(strings.dailyCompleted)).not.toBeNull();
    expect(screen.queryByRole('link', { name: strings.dailyPlay })).toBeNull();
  });

  it('hides on failure', async () => {
    vi.mocked(api.daily).mockRejectedValue(new Error('down'));
    renderCard();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('daily-card')).toBeNull();
  });
});
