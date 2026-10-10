import type {
  MeResponse,
  ProgressResponse,
  SkillsResponse,
  SpellbookResponse,
  WorldsResponse,
} from '@terminal-quest/shared';
import { create } from 'zustand';
import { ApiError, api } from '../api/client.js';

interface GameState {
  me: MeResponse | null;
  worlds: WorldsResponse | null;
  progress: ProgressResponse | null;
  skillsData: SkillsResponse | null;
  spellbook: SpellbookResponse | null;
  /** True while the Start button flow (guest → me → worlds) is running. */
  starting: boolean;
  /** True while refreshing data from the server. */
  loading: boolean;
  error: string | null;
  /** Landing flow: create (or reuse) a guest, then load profile + map data. */
  startPlaying: () => Promise<void>;
  /** Reload profile + map + progress data (e.g. after returning from a level). */
  refresh: () => Promise<void>;
  /** Update the display name, then reload the profile. */
  rename: (displayName: string) => Promise<void>;
  /** Lazily load the skill graph (Skills page). */
  loadSkills: () => Promise<void>;
  /** Lazily load the spellbook cache (Spellbook page). */
  loadSpellbook: () => Promise<void>;
  /** Save a spellbook note and update the cache. */
  saveNote: (skillId: string, note: string) => Promise<void>;
  /** Wipe progress server-side, then reload. */
  resetProgress: () => Promise<void>;
  clearError: () => void;
}

function toMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Something went wrong.';
}

async function loadProfileAndWorlds(): Promise<{
  me: MeResponse;
  worlds: WorldsResponse;
  progress: ProgressResponse;
}> {
  const [me, worlds, progress] = await Promise.all([api.me(), api.worlds(), api.progress()]);
  return { me, worlds, progress };
}

/** Global game data store (plan.md §9.4 `useGame`). */
export const useGame = create<GameState>()((set, get) => ({
  me: null,
  worlds: null,
  progress: null,
  skillsData: null,
  spellbook: null,
  starting: false,
  loading: false,
  error: null,

  startPlaying: async () => {
    set({ starting: true, error: null });
    try {
      await api.guest();
      const { me, worlds, progress } = await loadProfileAndWorlds();
      set({ me, worlds, progress });
    } catch (err: unknown) {
      set({ error: toMessage(err) });
    } finally {
      set({ starting: false });
    }
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const { me, worlds, progress } = await loadProfileAndWorlds();
      set({ me, worlds, progress });
    } catch (err: unknown) {
      set({ error: toMessage(err) });
    } finally {
      set({ loading: false });
    }
  },

  rename: async (displayName: string) => {
    set({ loading: true, error: null });
    try {
      const { user } = await api.updateDisplayName(displayName);
      const me = get().me;
      if (me !== null) {
        set({ me: { ...me, user } });
      }
    } catch (err: unknown) {
      set({ error: toMessage(err) });
    } finally {
      set({ loading: false });
    }
  },

  loadSkills: async () => {
    set({ loading: true, error: null });
    try {
      set({ skillsData: await api.skills() });
    } catch (err: unknown) {
      set({ error: toMessage(err) });
    } finally {
      set({ loading: false });
    }
  },

  loadSpellbook: async () => {
    set({ loading: true, error: null });
    try {
      set({ spellbook: await api.spellbook() });
    } catch (err: unknown) {
      set({ error: toMessage(err) });
    } finally {
      set({ loading: false });
    }
  },

  saveNote: async (skillId: string, note: string) => {
    set({ error: null });
    try {
      await api.saveSpellbookNote(skillId, note);
      const spellbook = get().spellbook;
      if (spellbook !== null) {
        set({
          spellbook: {
            entries: spellbook.entries.map((e) => (e.skillId === skillId ? { ...e, note } : e)),
          },
        });
      }
    } catch (err: unknown) {
      set({ error: toMessage(err) });
    }
  },

  resetProgress: async () => {
    set({ loading: true, error: null });
    try {
      await api.deleteProgress();
      const { me, worlds, progress } = await loadProfileAndWorlds();
      set({ me, worlds, progress, skillsData: null, spellbook: null });
    } catch (err: unknown) {
      set({ error: toMessage(err) });
    } finally {
      set({ loading: false });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
