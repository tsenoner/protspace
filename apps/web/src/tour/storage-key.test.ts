import { describe, expect, it } from 'vitest';
import { chooseTour, LEGACY_TOUR_STORAGE_KEY, TOUR_STORAGE_KEY } from './storage-key';

/**
 * Tests, helpers and captures keep the product tour from starting through
 * `tests/helpers/tour-storage-state.ts`, which imports the key from here. A literal copy anywhere
 * else goes stale when the key changes, and the tour then starts in the middle of a run (the perf
 * suite once measured its overlay as a click going from 7 to 28 ms). Read as raw text, as
 * example-datasets-docs.test.ts reads the docs, because `tsconfig.app.json` has no Node types.
 */
const SOURCES = {
  ...import.meta.glob('../../tests/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../../scripts/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  // The perf harness's config and spec sit at the repo root; top level only (perf/ holds a
  // Python env and large datasets).
  ...import.meta.glob('../../../../perf/*.{ts,mjs}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
} as Record<string, string>;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('the tour storage key', () => {
  it('reads the e2e and capture sources', () => {
    const files = Object.keys(SOURCES);
    expect(files).toContain('../../tests/helpers/tour-storage-state.ts');
    expect(files).toContain('../../../../perf/playwright.config.ts');
    expect(files.some((file) => file.startsWith('../../../../scripts/docs-screenshots/'))).toBe(
      true,
    );
  });

  it('is spelled by no test, helper or capture', () => {
    const keys = [TOUR_STORAGE_KEY, LEGACY_TOUR_STORAGE_KEY].map(escapeRegExp).join('|');
    const literal = new RegExp(`['"\`](?:${keys})['"\`]`);
    const spelled = Object.entries(SOURCES)
      .filter(([, text]) => literal.test(text))
      .map(([file]) => file);
    expect(spelled).toEqual([]);
  });
});

const reader =
  (stored: Record<string, string>) =>
  (key: string): string | null =>
    stored[key] ?? null;

describe('chooseTour', () => {
  it('gives a first visit the full tour', () => {
    expect(chooseTour(reader({}))).toBe('full');
  });

  it("gives a visitor who saw the old tour What's new", () => {
    expect(chooseTour(reader({ [LEGACY_TOUR_STORAGE_KEY]: 'true' }))).toBe('whats-new');
  });

  it.each(['full', 'whats-new', 'anything'])(
    'starts nothing once the tour key holds %s, with or without the old key',
    (value) => {
      expect(chooseTour(reader({ [TOUR_STORAGE_KEY]: value }))).toBeNull();
      expect(
        chooseTour(reader({ [TOUR_STORAGE_KEY]: value, [LEGACY_TOUR_STORAGE_KEY]: 'true' })),
      ).toBeNull();
    },
  );

  it('reads only the value true as a returning visitor', () => {
    expect(chooseTour(reader({ [LEGACY_TOUR_STORAGE_KEY]: 'false' }))).toBe('full');
  });

  it('keeps the old key apart from the new one', () => {
    expect(TOUR_STORAGE_KEY).toBe('protspace:tour:v2');
    expect(LEGACY_TOUR_STORAGE_KEY).not.toBe(TOUR_STORAGE_KEY);
  });
});
