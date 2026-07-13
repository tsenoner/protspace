import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTooltipAnnotations, writeTooltipAnnotations } from './tooltip-annotations-store';

const HASH = 'abc12345';
const KEY = `protspace:tooltip-annotations:${HASH}`;

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

describe('tooltip-annotations-store', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns an empty array when nothing is stored', () => {
    expect(readTooltipAnnotations(HASH)).toEqual([]);
  });

  it('writes and reads back a list of names', () => {
    writeTooltipAnnotations(HASH, ['ec', 'go']);
    expect(readTooltipAnnotations(HASH)).toEqual(['ec', 'go']);
  });

  it('overwrites previous values on write', () => {
    writeTooltipAnnotations(HASH, ['ec', 'go']);
    writeTooltipAnnotations(HASH, ['pfam']);
    expect(readTooltipAnnotations(HASH)).toEqual(['pfam']);
  });

  it('ignores non-string entries from corrupted storage', () => {
    localStorageMock.setItem(KEY, JSON.stringify(['ec', 42, null, 'go']));
    expect(readTooltipAnnotations(HASH)).toEqual(['ec', 'go']);
  });

  it('returns an empty array for non-array stored values', () => {
    localStorageMock.setItem(KEY, JSON.stringify({ bogus: true }));
    expect(readTooltipAnnotations(HASH)).toEqual([]);
  });
});
