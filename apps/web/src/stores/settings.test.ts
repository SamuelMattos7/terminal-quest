import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applySettings, useSettings } from './settings.js';

function fakeRoot(): {
  attrs: Map<string, string>;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
} {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute(name: string, value: string): void {
      attrs.set(name, value);
    },
    removeAttribute(name: string): void {
      attrs.delete(name);
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  useSettings.setState({ highContrast: false, fontSize: 'normal', reducedMotion: false });
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.removeAttribute('data-font-size');
  document.documentElement.removeAttribute('data-reduced-motion');
});

describe('applySettings', () => {
  it('sets data attributes for non-default values', () => {
    const root = fakeRoot();
    applySettings({ highContrast: true, fontSize: 'large', reducedMotion: true }, root);
    expect(root.attrs.get('data-contrast')).toBe('high');
    expect(root.attrs.get('data-font-size')).toBe('large');
    expect(root.attrs.get('data-reduced-motion')).toBe('on');
  });

  it('removes data attributes for default values', () => {
    const root = fakeRoot();
    applySettings({ highContrast: true, fontSize: 'xlarge', reducedMotion: true }, root);
    applySettings({ highContrast: false, fontSize: 'normal', reducedMotion: false }, root);
    expect(root.attrs.size).toBe(0);
  });
});

describe('useSettings', () => {
  it('persists changes to localStorage and applies them to the document', () => {
    useSettings.getState().setHighContrast(true);
    useSettings.getState().setFontSize('xlarge');
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
    expect(document.documentElement.getAttribute('data-font-size')).toBe('xlarge');
    const stored = window.localStorage.getItem('tq-settings');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toMatchObject({
      highContrast: true,
      fontSize: 'xlarge',
    });
  });

  it('falls back to defaults when stored settings are corrupt', async () => {
    window.localStorage.setItem('tq-settings', 'not-json{');
    vi.resetModules();
    const fresh = await import('./settings.js');
    expect(fresh.useSettings.getState().highContrast).toBe(false);
    expect(fresh.useSettings.getState().fontSize).toBe('normal');
  });
});
