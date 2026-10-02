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

  it('should handle primitive types', () => {
    localStorageMock.setItem('numberKey', '42');
    localStorageMock.setItem('stringKey', '"hello"');
    localStorageMock.setItem('boolKey', 'true');
    localStorageMock.setItem('nullKey', 'null');

    expect(getStorageItem('numberKey', 0)).toBe(42);
    expect(getStorageItem('stringKey', '')).toBe('hello');
    expect(getStorageItem('boolKey', false)).toBe(true);
    expect(getStorageItem('nullKey', 'default')).toBe(null);
  });

  it('should handle arrays', () => {
    const storedArray = [1, 2, 3, 'four'];
    localStorageMock.setItem('arrayKey', JSON.stringify(storedArray));

    const result = getStorageItem('arrayKey', []);
    expect(result).toEqual(storedArray);
  });

  it('should handle nested objects', () => {
    const nestedObj = {
      level1: {
        level2: {
          value: 'deep',
        },
      },
    };
    localStorageMock.setItem('nestedKey', JSON.stringify(nestedObj));

    const result = getStorageItem('nestedKey', {});
    expect(result).toEqual(nestedObj);
  });

  it('should return default value when localStorage throws', () => {
    const originalGetItem = localStorageMock.getItem;
    localStorageMock.getItem = vi.fn(() => {
      throw new Error('Storage error');
    });

    const defaultValue = { fallback: true };
    const result = getStorageItem('anyKey', defaultValue);
    expect(result).toEqual(defaultValue);

    localStorageMock.getItem = originalGetItem;
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

  it('should store primitive types', () => {
    expect(setStorageItem('numKey', 123)).toBe(true);
    expect(setStorageItem('strKey', 'hello')).toBe(true);
    expect(setStorageItem('boolKey', true)).toBe(true);
    expect(setStorageItem('nullKey', null)).toBe(true);

    expect(localStorageMock.setItem).toHaveBeenCalledWith('numKey', '123');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('strKey', '"hello"');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('boolKey', 'true');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('nullKey', 'null');
  });

  it('should store arrays', () => {
    const arr = [1, 2, 3];
    const result = setStorageItem('arrKey', arr);

    expect(result).toBe(true);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('arrKey', '[1,2,3]');
  });

  it('should return false when localStorage throws', () => {
    const originalSetItem = localStorageMock.setItem;
    localStorageMock.setItem = vi.fn(() => {
      throw new Error('Quota exceeded');
    });

    const result = setStorageItem('anyKey', { data: 'value' });
    expect(result).toBe(false);

    localStorageMock.setItem = originalSetItem;
  });

  it('should overwrite existing values', () => {
    setStorageItem('overwriteKey', { original: true });
    setStorageItem('overwriteKey', { updated: true });

    const stored = localStorageMock.getItem('overwriteKey');
    expect(JSON.parse(stored!)).toEqual({ updated: true });
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
    const originalGetItem = localStorageMock.getItem;
    localStorageMock.getItem = vi.fn(() => {
      throw new Error('The operation is insecure.');
    });

    expect(() => hasStorageItem('anyKey')).not.toThrow();
    expect(hasStorageItem('anyKey')).toBe(false);

    localStorageMock.getItem = originalGetItem;
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
    const originalRemoveItem = localStorageMock.removeItem;
    localStorageMock.removeItem = vi.fn(() => {
      throw new Error('Storage error');
    });

    const result = removeStorageItem('anyKey');
    expect(result).toBe(false);

    localStorageMock.removeItem = originalRemoveItem;
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

  it('should not remove items from other components with same hash', () => {
    // All items have the same hash but different components
    localStorageMock.setItem('protspace:legend:hash123:Taxonomy', '{"data": 1}');
    localStorageMock.setItem('protspace:control-bar:hash123', '{"data": 2}');

    const removedCount = removeAllStorageItemsByHash('hash123');

    // Both should be removed since they both have the target hash
    expect(removedCount).toBe(2);
  });

  it('should handle keys without context (3 parts only)', () => {
    localStorageMock.setItem('protspace:scatterplot:hash123', '{"config": true}');

    const removedCount = removeAllStorageItemsByHash('hash123');

    expect(removedCount).toBe(1);
    expect(localStorageMock.getItem('protspace:scatterplot:hash123')).toBeNull();
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
    const originalKey = localStorageMock.key;
    localStorageMock.key = vi.fn(() => {
      throw new Error('Storage error');
    });

    const removedCount = removeAllStorageItemsByHash('anyHash');
    expect(removedCount).toBe(0);

    localStorageMock.key = originalKey;
  });
});

describe('integration: get/set/remove workflow', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should store and retrieve complex settings object', () => {
    const settings = {
      maxVisibleValues: 10,
      includeOthers: true,
      hiddenValues: ['null', 'Other'],
      zOrderMapping: { Bacteria: 0, Archaea: 1, Eukaryota: 2 },
    };

    const key = buildStorageKey('legend', 'dataset123', 'Taxonomy');

    const setResult = setStorageItem(key, settings);
    expect(setResult).toBe(true);

    const retrieved = getStorageItem(key, {
      maxVisibleValues: 5,
      includeOthers: false,
      hiddenValues: [],
      zOrderMapping: {},
    });
    expect(retrieved).toEqual(settings);

    const removeResult = removeStorageItem(key);
    expect(removeResult).toBe(true);

    const afterRemove = getStorageItem(key, {
      maxVisibleValues: 5,
      includeOthers: false,
      hiddenValues: [],
      zOrderMapping: {},
    });
    expect(afterRemove).toEqual({
      maxVisibleValues: 5,
      includeOthers: false,
      hiddenValues: [],
      zOrderMapping: {},
    });
  });
});
