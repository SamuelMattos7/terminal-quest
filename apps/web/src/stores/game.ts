import type { MeResponse, WorldsResponse } from '@terminal-quest/shared';
import { create } from 'zustand';
import { ApiError, api } from '../api/client.js';

interface GameState {
  me: MeResponse | null;
  worlds: WorldsResponse | null;
  /** True while the Start button flow (guest → me → worlds) is running. */
  starting: boolean;
  /** True while refreshing data from the server. */
  loading: boolean;
  error: string | null;
  /** Landing flow: create (or reuse) a guest, then load profile + map data. */
  startPlaying: () => Promise<void>;
  /** Reload profile + map data (e.g. after returning from a level). */
  refresh: () => Promise<void>;
  clearError: () => void;
}

function toMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Something went wrong.';
}

async function loadProfileAndWorlds(): Promise<{ me: MeResponse; worlds: WorldsResponse }> {
  const [me, worlds] = await Promise.all([api.me(), api.worlds()]);
  return { me, worlds };
}

/** Global game data store (plan.md §9.4 `useGame`). The socket session store arrives in T4.2. */
export const useGame = create<GameState>()((set) => ({
  me: null,
  worlds: null,
  starting: false,
  loading: false,
  error: null,

  startPlaying: async () => {
    set({ starting: true, error: null });
    try {
      await api.guest();
      const { me, worlds } = await loadProfileAndWorlds();
      set({ me, worlds });
    } catch (err: unknown) {
      set({ error: toMessage(err) });
    } finally {
      set({ starting: false });
    }
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const { me, worlds } = await loadProfileAndWorlds();
      set({ me, worlds });
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
