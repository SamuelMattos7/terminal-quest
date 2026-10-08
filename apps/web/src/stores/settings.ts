import { create } from 'zustand';

export type FontSizeSetting = 'normal' | 'large' | 'xlarge';

export interface SettingsValues {
  highContrast: boolean;
  fontSize: FontSizeSetting;
  reducedMotion: boolean;
}

interface SettingsState extends SettingsValues {
  setHighContrast: (on: boolean) => void;
  setFontSize: (size: FontSizeSetting) => void;
  setReducedMotion: (on: boolean) => void;
}

const STORAGE_KEY = 'tq-settings';

function isFontSizeSetting(value: unknown): value is FontSizeSetting {
  return value === 'normal' || value === 'large' || value === 'xlarge';
}

function systemPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readStored(): Partial<SettingsValues> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record['highContrast'] === 'boolean'
        ? { highContrast: record['highContrast'] }
        : {}),
      ...(isFontSizeSetting(record['fontSize']) ? { fontSize: record['fontSize'] } : {}),
      ...(typeof record['reducedMotion'] === 'boolean'
        ? { reducedMotion: record['reducedMotion'] }
        : {}),
    };
  } catch {
    return {};
  }
}

function persist(values: SettingsValues): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Private-mode storage failures must not break the UI.
  }
}

interface AttributeRoot {
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
}

function documentRoot(): AttributeRoot | null {
  if (typeof document === 'undefined' || document.documentElement == null) {
    return null;
  }
  return document.documentElement;
}

/**
 * Apply settings as `data-*` attributes (see theme.css). Accepts an explicit
 * root so tests can assert without touching the real document.
 */
export function applySettings(values: SettingsValues, root?: AttributeRoot | null): void {
  const el = root ?? documentRoot();
  if (el === null || el === undefined) {
    return;
  }
  if (values.highContrast) {
    el.setAttribute('data-contrast', 'high');
  } else {
    el.removeAttribute('data-contrast');
  }
  if (values.fontSize === 'normal') {
    el.removeAttribute('data-font-size');
  } else {
    el.setAttribute('data-font-size', values.fontSize);
  }
  if (values.reducedMotion) {
    el.setAttribute('data-reduced-motion', 'on');
  } else {
    el.removeAttribute('data-reduced-motion');
  }
}

/**
 * Accessibility settings store (plan.md §9.1). The Settings page UI that
 * flips these values arrives in T4.3; the mechanism lives here so the theme
 * is complete from the start.
 */
export const useSettings = create<SettingsState>()((set) => {
  const stored = typeof window === 'undefined' ? {} : readStored();
  const initial: SettingsValues = {
    highContrast: stored.highContrast ?? false,
    fontSize: stored.fontSize ?? 'normal',
    reducedMotion: stored.reducedMotion ?? systemPrefersReducedMotion(),
  };
  applySettings(initial);

  const update = (patch: Partial<SettingsValues>): void => {
    set((state) => {
      const next: SettingsValues = {
        highContrast: patch.highContrast ?? state.highContrast,
        fontSize: patch.fontSize ?? state.fontSize,
        reducedMotion: patch.reducedMotion ?? state.reducedMotion,
      };
      persist(next);
      applySettings(next);
      return next;
    });
  };

  return {
    ...initial,
    setHighContrast: (on: boolean) => {
      update({ highContrast: on });
    },
    setFontSize: (size: FontSizeSetting) => {
      update({ fontSize: size });
    },
    setReducedMotion: (on: boolean) => {
      update({ reducedMotion: on });
    },
  };
});
