import type {
  MeResponse,
  ProgressResponse,
  SkillsResponse,
  SpellbookResponse,
  WorldsResponse,
} from '@terminal-quest/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client.js';
import { useGame } from './game.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client.js')>();
  return {
    ...mod,
    api: {
      guest: vi.fn(),
      me: vi.fn(),
      worlds: vi.fn(),
      progress: vi.fn(),
      skills: vi.fn(),
      spellbook: vi.fn(),
      updateDisplayName: vi.fn(),
      saveSpellbookNote: vi.fn(),
      deleteProgress: vi.fn(),
    },
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
}

const progressFixture: ProgressResponse = {
  levels: {},
  totals: { xp: 55, completions: 1, levelsCompleted: 1, hintsUsed: 2 },
};

const skillsFixture: SkillsResponse = {
  skills: [
    { id: 'pwd', title: 'pwd', group: 'navigation', world: 1, prereqs: [], uses: 3, masteredAt: 9 },
  ],
};

const spellbookFixture: SpellbookResponse = {
  entries: [{ skillId: 'pwd', title: 'pwd', cheatsheet: [], examples: [], note: null }],
};

beforeEach(() => {
  resetStore();
  vi.mocked(api.guest).mockReset().mockResolvedValue({ user: meFixture.user });
  vi.mocked(api.me).mockReset().mockResolvedValue(meFixture);
  vi.mocked(api.worlds).mockReset().mockResolvedValue(worldsFixture);
  vi.mocked(api.progress).mockReset().mockResolvedValue(progressFixture);
  vi.mocked(api.skills).mockReset().mockResolvedValue(skillsFixture);
  vi.mocked(api.spellbook).mockReset().mockResolvedValue(spellbookFixture);
  vi.mocked(api.updateDisplayName).mockReset();
  vi.mocked(api.saveSpellbookNote).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(api.deleteProgress).mockReset().mockResolvedValue({ ok: true });
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

  it('refresh reloads profile, worlds, and progress', async () => {
    await useGame.getState().refresh();
    const state = useGame.getState();
    expect(state.me).toEqual(meFixture);
    expect(state.worlds).toEqual(worldsFixture);
    expect(state.progress).toEqual(progressFixture);
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

  it('loads skills and spellbook caches on demand', async () => {
    await useGame.getState().loadSkills();
    expect(useGame.getState().skillsData).toEqual(skillsFixture);
    await useGame.getState().loadSpellbook();
    expect(useGame.getState().spellbook).toEqual(spellbookFixture);
  });

  it('rename updates the display name in the profile', async () => {
    await useGame.getState().refresh();
    vi.mocked(api.updateDisplayName).mockResolvedValue({
      user: { ...meFixture.user, displayName: 'Tux' },
    });
    await useGame.getState().rename('Tux');
    expect(api.updateDisplayName).toHaveBeenCalledWith('Tux');
    expect(useGame.getState().me?.user.displayName).toBe('Tux');
  });

  it('saveNote persists and patches the spellbook cache', async () => {
    await useGame.getState().loadSpellbook();
    await useGame.getState().saveNote('pwd', 'remember -P');
    expect(api.saveSpellbookNote).toHaveBeenCalledWith('pwd', 'remember -P');
    expect(useGame.getState().spellbook?.entries.find((e) => e.skillId === 'pwd')?.note).toBe(
      'remember -P',
    );
  });

  it('resetProgress wipes and reloads', async () => {
    await useGame.getState().loadSkills();
    await useGame.getState().resetProgress();
    expect(api.deleteProgress).toHaveBeenCalledTimes(1);
    expect(useGame.getState().skillsData).toBeNull();
    expect(useGame.getState().progress).toEqual(progressFixture);
  });
});
