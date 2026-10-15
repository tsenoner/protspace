import { describe, expect, it } from 'vitest';
import {
  captureVariants,
  DEFAULT_GIF_BUDGET,
  gifLadder,
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
    ['a name used twice', [entry({ name: 'twice' }), entry({ name: 'twice' })], 'used twice'],
    ['an uppercase name', [entry({ name: 'Interface-Overview' })], 'kebab-case'],
    ['a name with spaces', [entry({ name: 'interface overview' })], 'kebab-case'],
    ['a name in another folder', [entry({ name: 'gifs/zoom' })], 'kebab-case'],
    ['a name with an extension', [entry({ name: 'zoom.gif' })], 'has an extension'],
    ['a name ending in -dark', [entry({ name: 'overview-dark' })], 'ending in -dark'],
    [
      'a dark GIF',
      [entry({ name: 'zoom', kind: 'gif', themes: ['light', 'dark'] })],
      'GIF is light only',
    ],
    ['a budget on a screenshot', [entry({ name: 'shot', budgetBytes: 1_000 })], 'GIFs only'],
    ['GIF settings on a screenshot', [entry({ name: 'shot', gif: { fps: 15 } })], 'GIFs only'],
    ['a scale on a GIF', [entry({ name: 'zoom', kind: 'gif', scale: 1 })], 'scale applies'],
    [
      'a scale on a phone screenshot',
      [entry({ name: 'shot', viewport: 'phone', scale: 2 })],
      'scale applies',
    ],
    [
      'a scale on a custom-size screenshot',
      [entry({ name: 'shot', viewport: { width: 600, height: 400 }, scale: 1 })],
      'scale applies',
    ],
    ['no docs page', [entry({ name: 'shot', docs: [] })], 'names no page'],
    [
      'a docs page that is not markdown',
      [entry({ name: 'shot', docs: ['explore/index'] })],
      'not a .md file',
    ],
  ] as const)('reports %s once, and why', (_, entries, why) => {
    expect(validateManifest(entries)).toEqual([expect.stringContaining(why)]);
  });
});

describe('the GIF budget', () => {
  it('defaults to 3 MiB', () => {
    expect(DEFAULT_GIF_BUDGET).toBe(3_145_728);
  });
});

describe('gifLadder', () => {
  const rungs = (ladder: ReturnType<typeof gifLadder>) =>
    ladder.map(({ fps, width }) => `${fps}/${width}`);

  it('steps the frame rate down, then the width', () => {
    expect(rungs(gifLadder())).toEqual(['25/1000', '20/1000', '15/1000', '15/800', '15/640']);
  });

  it("starts at an entry's own settings", () => {
    expect(rungs(gifLadder({ fps: 20, width: 800 }))).toEqual(['20/800', '15/800', '15/640']);
  });

  it('steps only the frame rate from the narrowest width', () => {
    expect(rungs(gifLadder({ width: 640 }))).toEqual(['25/640', '20/640', '15/640']);
  });
});

/**
 * The capture code as text: decision 19 replaced the old captures' hand-written shadow-root
 * lookups and fixed sleeps with role locators, typed plot reads and signals. Pacing a GIF is the
 * one place a fixed wait belongs, and it is `cap.hold`, so it is countable in review.
 */
const CAPTURE_SOURCES = import.meta.glob('../../../../scripts/docs-screenshots/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SCRIPTS = '../../../../scripts/docs-screenshots/';

/**
 * The test helpers capture code may import (`scripts/tsconfig.json`'s include list). A capture
 * reaches their timers too, so each one is counted: a new timer in a shared helper fails here
 * until it is either passed in by the caller (as `doubleClickLegendRow`'s `pause` is, which a
 * capture sets to `cap.hold`) or added to this list on purpose.
 */
const HELPER_SOURCES = import.meta.glob('../../tests/helpers/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SCRIPTS_TSCONFIG = import.meta.glob('../../../../scripts/tsconfig.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const HELPER_TIMERS: Record<string, number> = {
  // doubleClickLegendRow's default pause; a capture passes its own.
  '../../tests/helpers/legend.ts': 1,
  // A persisted-dataset poll that captures do not reach.
  '../../tests/helpers/explore.ts': 1,
  // A touch gesture's rest and its per-step frame, for the phone specs.
  '../../tests/helpers/mobile.ts': 2,
  // The perf probes' idle wait, for the perf runs.
  '../../tests/helpers/perf/probes.ts': 1,
};

describe('the capture code', () => {
  it('is read', () => {
    expect(Object.keys(CAPTURE_SOURCES)).toContain(`${SCRIPTS}runner.ts`);
    expect(Object.keys(CAPTURE_SOURCES)).toContain(`${SCRIPTS}scenes/scatterplot.ts`);
  });

  it('never reaches into a shadow root', () => {
    const offenders = Object.entries(CAPTURE_SOURCES)
      .filter(([, text]) => text.includes('shadowRoot'))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('keeps timers and page evaluation out of the scenes', () => {
    const offenders = Object.entries(CAPTURE_SOURCES)
      .filter(([file]) => file.startsWith(`${SCRIPTS}scenes/`))
      .filter(([, text]) => text.includes('waitForTimeout') || text.includes('.evaluate('))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('removes an older recording before a GIF starts recording', () => {
    const runner = CAPTURE_SOURCES[`${SCRIPTS}runner.ts`];
    const removed = runner.indexOf("fs.rmSync(recording(entry.name, 'webm')");
    expect(removed).toBeGreaterThan(-1);
    expect(removed).toBeLessThan(runner.indexOf('browser.newContext('));
  });

  it("waits on a timer only in the runner's hold", () => {
    const timed = Object.entries(CAPTURE_SOURCES)
      .filter(([, text]) => text.includes('waitForTimeout'))
      .map(([file]) => file);
    expect(timed).toEqual([`${SCRIPTS}runner.ts`]);
    const runner = CAPTURE_SOURCES[`${SCRIPTS}runner.ts`];
    expect(runner.match(/waitForTimeout/g)).toHaveLength(1);
    expect(runner).toMatch(/hold: async \(ms\) => \{\s*await page\.waitForTimeout\(ms\);/);
  });

  it('counts every timer in the helpers it imports', () => {
    const { include } = JSON.parse(Object.values(SCRIPTS_TSCONFIG)[0]) as { include: string[] };
    const helpers = include
      .filter((path) => path.startsWith('../apps/web/tests/helpers/'))
      .map((path) => path.replace('../apps/web/tests/', '../../tests/'));
    expect(helpers.length).toBeGreaterThan(0);
    const timers = Object.fromEntries(
      helpers
        .map((file) => {
          expect(Object.keys(HELPER_SOURCES)).toContain(file);
          return [file, HELPER_SOURCES[file].match(/waitForTimeout/g)?.length ?? 0] as const;
        })
        .filter(([, count]) => count > 0),
    );
    expect(timers).toEqual(HELPER_TIMERS);
  });
});
