import { describe, expect, it } from 'vitest';
import {
  captureVariants,
  DEFAULT_GIF_BUDGET,
  outputFile,
  validateManifest,
  type CaptureEntry,
} from '../../../../scripts/docs-screenshots/capture-plan';

/**
 * Pins the docs media pipeline's pure rules (scripts/docs-screenshots/capture-plan.ts): how an
 * entry's files are named, which files it expands to, and which entries the runner refuses.
 * The runner and the pre-commit lint both rely on them, and neither runs in `pnpm test`.
 */

/** A valid desktop screenshot entry, with `overrides` applied. */
function entry(overrides: Partial<CaptureEntry> & { name: string }): CaptureEntry {
  return { kind: 'png', viewport: 'desktop', docs: ['explore/index.md'], ...overrides };
}

describe('outputFile', () => {
  it.each([
    ['interface-overview', 'png', 'light', 'interface-overview.png'],
    ['interface-overview', 'png', 'dark', 'interface-overview-dark.png'],
    ['examples/demo', 'png', 'light', 'examples/demo.png'],
    ['zoom', 'gif', 'light', 'zoom.gif'],
  ] as const)('names %s (%s, %s) %s', (name, kind, theme, file) => {
    expect(outputFile(name, kind, theme)).toBe(file);
  });
});

describe('captureVariants', () => {
  const entries = [
    entry({ name: 'paired', themes: ['dark', 'light'] }),
    entry({ name: 'zoom', kind: 'gif' }),
    entry({ name: 'plain' }),
  ];

  it('expands every entry in manifest order, light before dark, light by default', () => {
    expect(captureVariants(entries).map((variant) => [variant.file, variant.theme])).toEqual([
      ['paired.png', 'light'],
      ['paired-dark.png', 'dark'],
      ['zoom.gif', 'light'],
      ['plain.png', 'light'],
    ]);
  });

  it('keeps only the asked kind', () => {
    expect(captureVariants(entries, 'png').map((variant) => variant.file)).toEqual([
      'paired.png',
      'paired-dark.png',
      'plain.png',
    ]);
    expect(captureVariants(entries, 'gif').map((variant) => variant.file)).toEqual(['zoom.gif']);
  });

  it('hands each variant its entry', () => {
    expect(captureVariants(entries, 'gif')[0].entry).toBe(entries[1]);
  });
});

describe('validateManifest', () => {
  it('accepts a screenshot, a light and dark screenshot, a thumbnail and a GIF', () => {
    expect(
      validateManifest([
        entry({ name: 'interface-overview' }),
        entry({ name: 'legend-panel', themes: ['light', 'dark'], scale: 1 }),
        entry({ name: 'examples/demo', docs: ['explore/example-datasets.md'] }),
        entry({ name: 'zoom', kind: 'gif', budgetBytes: 2_000_000, gif: { fps: 20 } }),
        entry({ name: 'more-sheet', viewport: 'phone', themes: ['light', 'dark'] }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ['a name used twice', [entry({ name: 'twice' }), entry({ name: 'twice' })]],
    ['an uppercase name', [entry({ name: 'Interface-Overview' })]],
    ['a name with spaces', [entry({ name: 'interface overview' })]],
    ['a name in another folder', [entry({ name: 'gifs/zoom' })]],
    ['a name with an extension', [entry({ name: 'zoom.gif' })]],
    ['a name ending in -dark', [entry({ name: 'overview-dark' })]],
    ['a dark GIF', [entry({ name: 'zoom', kind: 'gif', themes: ['light', 'dark'] })]],
    ['a budget on a screenshot', [entry({ name: 'shot', budgetBytes: 1_000 })]],
    ['GIF settings on a screenshot', [entry({ name: 'shot', gif: { fps: 15 } })]],
    ['a scale on a GIF', [entry({ name: 'zoom', kind: 'gif', scale: 1 })]],
    ['a scale on a phone screenshot', [entry({ name: 'shot', viewport: 'phone', scale: 2 })]],
    ['no docs page', [entry({ name: 'shot', docs: [] })]],
    ['a docs page that is not markdown', [entry({ name: 'shot', docs: ['explore/index'] })]],
  ])('reports %s once', (_, entries) => {
    expect(validateManifest(entries)).toHaveLength(1);
  });
});

describe('the GIF budget', () => {
  it('defaults to 3 MiB', () => {
    expect(DEFAULT_GIF_BUDGET).toBe(3_145_728);
  });
});
