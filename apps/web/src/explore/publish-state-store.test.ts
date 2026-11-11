import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLISH_STATE_KEY, loadPublishState, savePublishState } from './publish-state-store';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, String(value)),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publish state store', () => {
  it('round-trips a state under protspace_publishState', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    savePublishState({ preset: 'nature', widthPx: 1051, overlays: [] });

    expect(PUBLISH_STATE_KEY).toBe('protspace_publishState');
    expect(JSON.parse(storage.getItem('protspace_publishState')!)).toEqual({
      preset: 'nature',
      widthPx: 1051,
      overlays: [],
    });
    expect(loadPublishState()).toEqual({ preset: 'nature', widthPx: 1051, overlays: [] });
  });

  it('returns null when nothing is stored', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(loadPublishState()).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    const storage = memoryStorage();
    storage.setItem(PUBLISH_STATE_KEY, '{not-json');
    vi.stubGlobal('localStorage', storage);
    expect(loadPublishState()).toBeNull();
  });

  it('returns null for an array or a non-object', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(PUBLISH_STATE_KEY, '[1,2]');
    expect(loadPublishState()).toBeNull();
    storage.setItem(PUBLISH_STATE_KEY, '42');
    expect(loadPublishState()).toBeNull();
  });

  it('swallows a throwing storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(loadPublishState()).toBeNull();
    expect(() => savePublishState({ preset: 'nature' })).not.toThrow();
  });
});
