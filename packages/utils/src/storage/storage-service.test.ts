import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildStorageKey,
  getStorageItem,
  hasStorageItem,
  setStorageItem,
  removeStorageItem,
  removeAllStorageItemsByHash,
} from './storage-service';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

type ThrowableMethod = 'getItem' | 'setItem' | 'removeItem' | 'key';

/**
 * Make one storage method throw for the duration of `run`. The finally restores it even when an
 * assertion fails, so a broken mock never leaks into later tests (clearAllMocks does not undo it).
 */
function withThrowingStorage(method: ThrowableMethod, message: string, run: () => void): void {
  const mock = localStorageMock as unknown as Record<ThrowableMethod, unknown>;
  const original = mock[method];
  mock[method] = vi.fn(() => {
    throw new Error(message);
  });
  try {
    run();
  } finally {
    mock[method] = original;
  }
}

describe('buildStorageKey', () => {
  it('should build key with component and datasetHash', () => {
    const key = buildStorageKey('legend', 'abc12345');
    expect(key).toBe('protspace:legend:abc12345');
  });

  it('should build key with component, datasetHash, and context', () => {
    const key = buildStorageKey('legend', 'abc12345', 'Taxonomy');
    expect(key).toBe('protspace:legend:abc12345:Taxonomy');
  });

  it('should handle empty context', () => {
    const key = buildStorageKey('legend', 'abc12345', '');
    // Empty string is falsy, so context should not be added
    expect(key).toBe('protspace:legend:abc12345');
  });

  it('should handle undefined context', () => {
    const key = buildStorageKey('legend', 'abc12345', undefined);
    expect(key).toBe('protspace:legend:abc12345');
  });

  it('should handle special characters in context', () => {
    const key = buildStorageKey('legend', 'abc12345', 'Annotation:With:Colons');
    expect(key).toBe('protspace:legend:abc12345:Annotation:With:Colons');
  });

  it('should handle different component names', () => {
    expect(buildStorageKey('scatterplot', 'hash1')).toBe('protspace:scatterplot:hash1');
    expect(buildStorageKey('control-bar', 'hash2')).toBe('protspace:control-bar:hash2');
  });
});

describe('getStorageItem', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should return default value when key does not exist', () => {
    const defaultValue = { foo: 'bar' };
    const result = getStorageItem('nonexistent', defaultValue);
    expect(result).toEqual(defaultValue);
  });

  it('should return parsed value when key exists', () => {
    const storedValue = { name: 'test', count: 42 };
    localStorageMock.setItem('testKey', JSON.stringify(storedValue));

    const result = getStorageItem('testKey', { name: 'defaultValue', count: 0 });
    expect(result).toEqual(storedValue);
  });

  it('should return default value on JSON parse error', () => {
    localStorageMock.setItem('badJson', 'not valid json{');

    const defaultValue = { valid: true };
    const result = getStorageItem('badJson', defaultValue);
    expect(result).toEqual(defaultValue);
  });

  it('should return default value when localStorage throws', () => {
    withThrowingStorage('getItem', 'Storage error', () => {
      const defaultValue = { fallback: true };
      expect(getStorageItem('anyKey', defaultValue)).toEqual(defaultValue);
    });
  });
});

describe('setStorageItem', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should store value and return true', () => {
    const value = { name: 'test', count: 42 };
    const result = setStorageItem('myKey', value);

    expect(result).toBe(true);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('myKey', JSON.stringify(value));
  });

  it('should return false when localStorage throws', () => {
    withThrowingStorage('setItem', 'Quota exceeded', () => {
      expect(setStorageItem('anyKey', { data: 'value' })).toBe(false);
    });
  });
});

describe('hasStorageItem', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should report presence without deserialising the value', () => {
    localStorageMock.setItem('presentKey', 'not valid json{{{');

    // Deliberately unparseable: "is anything saved?" must not depend on the value being
    // readable, or a corrupted entry would read as absent and be silently overwritten.
    expect(hasStorageItem('presentKey')).toBe(true);
    expect(hasStorageItem('missingKey')).toBe(false);
  });

  it('should return false when localStorage is unavailable rather than throwing', () => {
    // Safari private browsing, a browser blocking site data, and a test runner with no storage
    // backend all throw on access rather than returning null. `hasPersistedSettings` runs on the
    // legend's rebuild path, so a throw here takes down legend rendering, not just persistence.
    withThrowingStorage('getItem', 'The operation is insecure.', () => {
      expect(() => hasStorageItem('anyKey')).not.toThrow();
      expect(hasStorageItem('anyKey')).toBe(false);
    });
  });
});

describe('removeStorageItem', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should remove item and return true', () => {
    localStorageMock.setItem('toRemove', '"value"');

    const result = removeStorageItem('toRemove');

    expect(result).toBe(true);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('toRemove');
  });

  it('should return true even when key does not exist', () => {
    const result = removeStorageItem('nonexistent');

    expect(result).toBe(true);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('nonexistent');
  });

  it('should return false when localStorage throws', () => {
    withThrowingStorage('removeItem', 'Storage error', () => {
      expect(removeStorageItem('anyKey')).toBe(false);
    });
  });
});

describe('removeAllStorageItemsByHash', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should remove all items matching the hash', () => {
    // Set up items with different hashes
    localStorageMock.setItem('protspace:legend:hash123:Taxonomy', '{"data": 1}');
    localStorageMock.setItem('protspace:legend:hash123:Function', '{"data": 2}');
    localStorageMock.setItem('protspace:scatterplot:hash123', '{"data": 3}');
    localStorageMock.setItem('protspace:legend:differentHash:Taxonomy', '{"data": 4}');
    localStorageMock.setItem('unrelated:key', '{"data": 5}');

    const removedCount = removeAllStorageItemsByHash('hash123');

    expect(removedCount).toBe(3);
    // Items with hash123 should be removed
    expect(localStorageMock.getItem('protspace:legend:hash123:Taxonomy')).toBeNull();
    expect(localStorageMock.getItem('protspace:legend:hash123:Function')).toBeNull();
    expect(localStorageMock.getItem('protspace:scatterplot:hash123')).toBeNull();
    // Items with different hash or unrelated keys should remain
    expect(localStorageMock.getItem('protspace:legend:differentHash:Taxonomy')).toBe('{"data": 4}');
    expect(localStorageMock.getItem('unrelated:key')).toBe('{"data": 5}');
  });

  it('should return 0 when no items match the hash', () => {
    localStorageMock.setItem('protspace:legend:otherHash:Taxonomy', '{"data": 1}');
    localStorageMock.setItem('unrelated:key', '{"data": 2}');

    const removedCount = removeAllStorageItemsByHash('nonexistentHash');

    expect(removedCount).toBe(0);
    // All items should remain
    expect(localStorageMock.getItem('protspace:legend:otherHash:Taxonomy')).toBe('{"data": 1}');
    expect(localStorageMock.getItem('unrelated:key')).toBe('{"data": 2}');
  });

  it('should return 0 when localStorage is empty', () => {
    const removedCount = removeAllStorageItemsByHash('anyHash');
    expect(removedCount).toBe(0);
  });

  it('should handle edge case where hash appears elsewhere in key', () => {
    // Hash appears in context but not in hash position
    localStorageMock.setItem('protspace:legend:otherHash:hash123', '{"data": 1}');
    // Actual hash position
    localStorageMock.setItem('protspace:legend:hash123:Taxonomy', '{"data": 2}');

    const removedCount = removeAllStorageItemsByHash('hash123');

    expect(removedCount).toBe(1);
    // Only the one with hash123 in the hash position should be removed
    expect(localStorageMock.getItem('protspace:legend:otherHash:hash123')).toBe('{"data": 1}');
    expect(localStorageMock.getItem('protspace:legend:hash123:Taxonomy')).toBeNull();
  });

  it('should return 0 when localStorage throws', () => {
    localStorageMock.setItem('protspace:legend:anyHash', '{}');
    withThrowingStorage('key', 'Storage error', () => {
      expect(removeAllStorageItemsByHash('anyHash')).toBe(0);
    });
  });
});

describe('round trip: set → get → remove', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('returns what was stored for every JSON shape, and the default once removed', () => {
    const settings = {
      maxVisibleValues: 10,
      includeOthers: true,
      hiddenValues: ['null', 'Other'],
      zOrderMapping: { Bacteria: 0, Archaea: 1, Eukaryota: 2 },
      nested: { level1: { level2: 'deep' } },
    };
    const key = buildStorageKey('legend', 'dataset123', 'Taxonomy');

    expect(setStorageItem(key, { stale: true })).toBe(true);
    expect(setStorageItem(key, settings)).toBe(true); // overwrites
    expect(getStorageItem(key, {})).toEqual(settings);

    for (const [k, value] of [
      ['num', 42],
      ['str', 'hello'],
      ['bool', false],
      ['arr', [1, 2, 3, 'four']],
    ] as const) {
      setStorageItem(k, value);
      expect(getStorageItem(k, 'default')).toEqual(value);
    }

    // A stored null is a value, not a miss: it must not fall back to the default.
    setStorageItem('nullKey', null);
    expect(getStorageItem('nullKey', 'default')).toBeNull();

    expect(removeStorageItem(key)).toBe(true);
    expect(getStorageItem(key, { fallback: true })).toEqual({ fallback: true });
  });
});
