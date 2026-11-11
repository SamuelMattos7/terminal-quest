import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('canonicalizes the public HTTP(S) origin for socket and CSP checks', () => {
    expect(loadConfig({ PUBLIC_ORIGIN: 'https://QUEST.example:443/' }).PUBLIC_ORIGIN).toBe(
      'https://quest.example',
    );
  });

  it.each([
    'ftp://quest.example',
    'https://user:pass@quest.example',
    'https://quest.example/game',
    'https://quest.example/?q=x',
    'https://quest.example/#x',
  ])('rejects a PUBLIC_ORIGIN that is not an HTTP(S) origin: %s', (value) => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: value })).toThrow('PUBLIC_ORIGIN');
  });
  it('defaults to worlds 1 and 2 and leaves sandbox overrides unset', () => {
    const config = loadConfig({});
    expect(config.ENABLE_WORLDS).toEqual([1, 2]);
    expect(config.SANDBOX_IMAGE).toBeUndefined();
    expect(config.SANDBOX_RUNTIME).toBeUndefined();
  });

  it('accepts an explicit empty world list and normalizes whitespace and duplicates', () => {
    expect(loadConfig({ ENABLE_WORLDS: '' }).ENABLE_WORLDS).toEqual([]);
    expect(loadConfig({ ENABLE_WORLDS: ' 5, 1, 5 ' }).ENABLE_WORLDS).toEqual([5, 1]);
  });

  it.each(['1,nope', '1,6', '0', '1,', '1,,2', '1.0', '0x1'])(
    'rejects the whole ENABLE_WORLDS value %j',
    (value) => {
      expect(() => loadConfig({ ENABLE_WORLDS: value })).toThrow('ENABLE_WORLDS');
    },
  );

  it.each([
    ['SANDBOX_IMAGE', ' '],
    ['SANDBOX_IMAGE', 'repo//image'],
    ['SANDBOX_IMAGE', 'repo/image:'],
    ['SANDBOX_RUNTIME', 'runsc --debug'],
    ['SANDBOX_RUNTIME', '/usr/bin/runsc'],
  ])('rejects invalid %s value %j', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(key);
  });
});
