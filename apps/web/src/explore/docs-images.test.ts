import { describe, expect, it } from 'vitest';
import {
  captureVariants,
  DEFAULT_GIF_BUDGET,
  gifLadder,
  outputFile,
  validateManifest,
  type CaptureEntry,
} from '../../../../scripts/docs-screenshots/capture-plan';
import {
  headingSlug,
  imageRefs,
  LEGACY_IMAGES,
  lintDocs,
  lintManifest,
  pageAnchors,
  STALE_PAGES,
  type DocsPage,
  type ImageFile,
  type ImageRef,
  type MediaOutput,
} from '../../../../scripts/docs-screenshots/docs-lint';

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

// ─── docs-lint.ts: the rules on small pages ──────────────────────────────────

const lintPage = (path: string, ...lines: string[]): DocsPage => ({ path, text: lines.join('\n') });
const onDisk = (...names: string[]): ImageFile[] => names.map((file) => ({ file }));
const PAIR = ['![A](./images/a.png){.light-only}', '![A](./images/a-dark.png){.dark-only}'];

describe('docs lint: headingSlug', () => {
  it.each([
    ['Numeric range conditions', 'numeric-range-conditions'],
    ['7. Filter Button', '_7-filter-button'],
    ['Light and dark', 'light-and-dark'],
    ["What's new?", 'what-s-new'],
    ['Selecting items (canvas + sidebar)', 'selecting-items-canvas-sidebar'],
    ['`predicted_membrane`', 'predicted-membrane'],
    ['Café **au lait**', 'cafe-au-lait'],
  ])('slugs %s as VitePress does', (text, slug) => {
    expect(headingSlug(text)).toBe(slug);
  });
});

describe('docs lint: pageAnchors', () => {
  it('reads slugs, explicit ids and repeats, and skips front matter and code', () => {
    const anchors = pageAnchors(
      lintPage(
        'explore/a.md',
        '---',
        '# a YAML comment, not a heading',
        '---',
        '# Page',
        '## Setup {#custom-id}',
        '## Usage',
        '## Usage',
        '```bash',
        '# a shell comment, not a heading',
        '```',
      ),
    );
    expect([...anchors].sort()).toEqual(['custom-id', 'page', 'usage', 'usage-1']);
  });
});

describe('docs lint: imageRefs', () => {
  it('reads markdown and raw images in all three path forms, in page order', () => {
    const explore = lintPage(
      'explore/a.md',
      '![A](./images/a.png){.light-only}',
      '![A](./images/a-dark.png){.dark-only}',
      '<img src="./images/b.png" class="light-only" alt="B" width="1280" height="720" />',
      '<img src="./images/b-dark.png" class="dark-only" loading="lazy" alt="B" />',
      '![C](/explore/images/examples/c.png)',
    );
    const guide = lintPage(
      'guide/x.md',
      '![D](../explore/images/d.gif)',
      '![Not ours](./images/chart.png)',
      '`![in code](../explore/images/e.png)`',
    );
    const ref = (
      page: string,
      file: string,
      line: number,
      classes: string[],
      lazy = true,
    ): ImageRef => ({
      page,
      file,
      classes,
      lazy,
      line,
    });
    expect(imageRefs(explore)).toEqual([
      ref('explore/a.md', 'a.png', 1, ['light-only']),
      ref('explore/a.md', 'a-dark.png', 2, ['dark-only']),
      ref('explore/a.md', 'b.png', 3, ['light-only'], false),
      ref('explore/a.md', 'b-dark.png', 4, ['dark-only']),
      ref('explore/a.md', 'examples/c.png', 5, []),
    ]);
    expect(imageRefs(guide)).toEqual([ref('guide/x.md', 'd.gif', 1, [])]);
  });
});

describe('docs lint: light and dark pairs', () => {
  const files = onDisk('a.png', 'a-dark.png');

  it('passes a light image followed by its dark twin', () => {
    expect(lintDocs([lintPage('explore/a.md', ...PAIR)], files)).toEqual([]);
  });

  it('passes a raw pair whose dark twin loads lazily', () => {
    const raw = lintPage(
      'explore/a.md',
      '<img src="./images/a.png" class="light-only" alt="A" loading="eager" />',
      '<img src="./images/a-dark.png" class="dark-only" alt="A" loading="lazy" />',
    );
    expect(lintDocs([raw], files)).toEqual([]);
  });

  it.each([
    ['the dark twin first', [PAIR[1], PAIR[0]], /a-dark\.png is shown outside a light\/dark pair/],
    ['no .dark-only', [PAIR[0], '![A](./images/a-dark.png)'], /a-dark\.png needs \{\.dark-only\}/],
    ['no .light-only', ['![A](./images/a.png)', PAIR[1]], /a\.png needs \{\.light-only\}/],
    [
      'an eager raw dark twin',
      [
        '<img src="./images/a.png" class="light-only" alt="A" />',
        '<img src="./images/a-dark.png" class="dark-only" alt="A" />',
      ],
      /a-dark\.png must load lazily/,
    ],
  ])('fails %s with one message', (_, lines, message) => {
    const messages = lintDocs([lintPage('explore/a.md', ...lines)], files);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(message);
  });

  it('fails a raw pair with an inline display, which shows both twins', () => {
    const page = lintPage(
      'explore/a.md',
      '<img src="./images/a.png" class="light-only" style="max-width: 50%; display: block">',
      '<img src="./images/a-dark.png" class="dark-only" loading="lazy">',
    );
    expect(lintDocs([page], files)).toEqual([
      'explore/a.md:1: a.png sets display in its inline style, which shows both twins in either theme; style it with a class',
    ]);
  });

  it('leaves an inline display alone on an image with no dark twin', () => {
    const page = lintPage('explore/a.md', '<img src="./images/b.png" style="display: block">');
    expect(lintDocs([page], onDisk('b.png'))).toEqual([]);
  });

  it('fails a -dark image shown without its light twin before it', () => {
    const pages = [lintPage('explore/a.md', ...PAIR), lintPage('explore/b.md', PAIR[1])];
    expect(lintDocs(pages, files)).toEqual([
      expect.stringMatching(/^explore\/b\.md:1: a-dark\.png is shown outside a light\/dark pair/),
    ]);
  });

  it('fails a -dark file without its light twin', () => {
    expect(lintDocs([], onDisk('b-dark.png'))).toEqual([
      'b-dark.png: a -dark image needs its light twin b.png',
    ]);
  });
});

describe('docs lint: files', () => {
  it('fails a file no page shows', () => {
    expect(lintDocs([], onDisk('a.png'))).toEqual([
      'a.png: no docs page shows it; delete it or show it on a page',
    ]);
  });

  it('fails a page showing a file that does not exist', () => {
    expect(lintDocs([lintPage('explore/a.md', '![x](./images/gone.png)')], [])).toEqual([
      'explore/a.md:1: gone.png does not exist',
    ]);
  });
});

describe('docs lint: anchors', () => {
  const target = lintPage('explore/a.md', '# A', '## Real heading {#custom}', '## Other part');

  it('resolves links in every form', () => {
    const pages = [
      target,
      lintPage('explore/index.md', '# Overview', '## Light and dark'),
      lintPage(
        'explore/b.md',
        '# B',
        '## Local',
        '[1](/explore/a#custom) [2](./a.md#other-part) [3](a#other-part) [4](#local)',
        '[5](/explore/#light-and-dark) [6](../explore/a.md#a) [7](/explore/a.html#other-part)',
        '[external](https://example.com/page#frag) [unknown page](/explore/nowhere#x)',
        '```md',
        '[in a fence](#nowhere)',
        '```',
        'Inline code is no link: `[x](#nowhere)`',
      ),
    ];
    expect(lintDocs(pages, [])).toEqual([]);
  });

  it('fails an anchor no heading has', () => {
    const pages = [target, lintPage('guide/data-format.md', 'See [it](/explore/a#nope).')];
    expect(lintDocs(pages, [])).toEqual([
      'guide/data-format.md:1: /explore/a#nope points at no heading on explore/a.md',
    ]);
  });
});

describe('docs lint: stale terms', () => {
  it('fails removed UI named in the user guide', () => {
    expect(
      lintDocs([lintPage('explore/new-page.md', '# New', 'Open the Control Bar.')], []),
    ).toEqual(['explore/new-page.md:2: "Control Bar" names removed UI']);
  });

  it('reports every line that names removed UI, and skips code and front matter', () => {
    const page = lintPage(
      'explore/new-page.md',
      'Use the control bar.',
      '---',
      'The control bar again.',
      '```',
      'control bar settings dialog',
      '```',
    );
    expect(lintDocs([page], [])).toEqual([
      'explore/new-page.md:1: "control bar" names removed UI',
      'explore/new-page.md:3: "control bar" names removed UI',
    ]);
    const frontMatter = lintPage('explore/x.md', '---', 'title: The settings dialog', '---', '# X');
    expect(lintDocs([frontMatter], [])).toEqual([]);
  });

  it('leaves the developer docs alone', () => {
    const api = lintPage('developers/api/index.md', 'The control bar is removed.');
    expect(lintDocs([api], [])).toEqual([]);
  });

  it('leaves a page in STALE_PAGES alone until its rewrite', () => {
    // Empty once every page task has run (7.15); Task 7.16 deletes this case with the set. Until
    // then an empty set must still flag a stale term, so the case never passes with no assertion.
    if (STALE_PAGES.size === 0) {
      expect(lintDocs([lintPage('explore/x.md', 'Use the control bar.')], [])).toHaveLength(1);
      return;
    }
    for (const path of STALE_PAGES) {
      expect(lintDocs([lintPage(path, 'Use the control bar.')], [])).toEqual([]);
    }
  });
});

describe('docs lint: manifest', () => {
  const output = (file: string, extra: Partial<MediaOutput> = {}): MediaOutput => ({
    file,
    kind: 'png',
    budgetBytes: 3 * 1024 * 1024,
    docs: ['explore/a.md'],
    ...extra,
  });
  const shows = (...files: string[]) =>
    lintPage('explore/a.md', ...files.map((file) => `![x](./images/${file})`));

  it('passes outputs on disk, shown by their page, within budget', () => {
    const gif = output('z.gif', { kind: 'gif', budgetBytes: 100 });
    const files = [
      { file: 'a.png', bytes: 5 },
      { file: 'z.gif', bytes: 100 },
    ];
    expect(lintManifest([output('a.png'), gif], files, [shows('a.png', 'z.gif')])).toEqual([]);
  });

  it('fails an output missing on disk', () => {
    expect(lintManifest([output('a.png')], [], [shows('a.png')])).toEqual([
      expect.stringMatching(/^a\.png: in the manifest but not on disk/),
    ]);
  });

  it('fails a file no entry makes', () => {
    expect(lintManifest([], [{ file: 'stray.png' }], [])).toEqual([
      expect.stringMatching(/^stray\.png: no manifest entry makes it/),
    ]);
  });

  it('fails a GIF one byte over its budget', () => {
    const gif = output('z.gif', { kind: 'gif', budgetBytes: 100 });
    expect(lintManifest([gif], [{ file: 'z.gif', bytes: 101 }], [shows('z.gif')])).toEqual([
      'z.gif: 101 bytes, over its 100-byte budget',
    ]);
  });

  it('fails an output its page does not show', () => {
    expect(lintManifest([output('a.png')], [{ file: 'a.png' }], [shows()])).toEqual([
      'a.png: explore/a.md does not show it',
    ]);
  });

  it('fails an output whose page does not exist', () => {
    const lost = output('a.png', { docs: ['explore/none.md'] });
    expect(lintManifest([lost], [{ file: 'a.png' }], [])).toEqual([
      'a.png: its docs page explore/none.md does not exist',
    ]);
  });

  it('lets a legacy image stand without an entry, but not once an entry makes it', () => {
    // Empty after Task 7.14: an uncovered file must then fail, so the case still asserts.
    if (LEGACY_IMAGES.size === 0) {
      expect(lintManifest([], [{ file: 'x.png' }], [])).toEqual([
        expect.stringMatching(/^x\.png: no manifest entry makes it/),
      ]);
      return;
    }
    for (const file of [...LEGACY_IMAGES].slice(0, 1)) {
      expect(lintManifest([], [{ file }], [])).toEqual([]);
      const made = output(file);
      expect(lintManifest([made], [{ file }], [shows(file)])).toEqual([
        `${file}: an entry makes it, so remove it from LEGACY_IMAGES`,
      ]);
    }
  });
});

// ─── docs-lint.ts: the real docs ─────────────────────────────────────────────

const DOCS_ROOT = '../../../../docs/';
const IMAGES_ROOT = '../../../../docs/explore/images/';
const realPageTexts = import.meta.glob('../../../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const REAL_PAGES: DocsPage[] = Object.entries(realPageTexts)
  // Mirrors `srcExclude` in docs/.vitepress/config.mts: these are not built pages.
  .filter(([key]) => !key.endsWith('/README.md'))
  .filter(([key]) => !key.startsWith(`${DOCS_ROOT}superpowers/`))
  .map(([key, text]) => ({ path: key.slice(DOCS_ROOT.length), text }));
const REAL_FILES: ImageFile[] = Object.keys(
  import.meta.glob('../../../../docs/explore/images/**/*.{png,gif}'),
).map((key) => ({ file: key.slice(IMAGES_ROOT.length) }));

describe('docs lint: the real docs', () => {
  it('finds the pages and the images', () => {
    expect(REAL_PAGES.map((page) => page.path)).toContain('explore/index.md');
    expect(REAL_FILES.map((file) => file.file)).toContain('examples/demo.png');
  });

  it('passes every page and image', () => {
    expect(lintDocs(REAL_PAGES, REAL_FILES)).toEqual([]);
  });

  it('LEGACY_IMAGES lists only files that exist', () => {
    const names = new Set(REAL_FILES.map((file) => file.file));
    expect([...LEGACY_IMAGES].filter((file) => !names.has(file))).toEqual([]);
  });

  it('STALE_PAGES lists only pages that still use a stale term', () => {
    const stillStale = (path: string) => {
      // Read as a page outside STALE_PAGES, so the check itself decides (prose only).
      const text = REAL_PAGES.find((page) => page.path === path)?.text ?? '';
      const probe = { path: 'explore/stale-probe.md', text };
      return lintDocs([probe], []).some((problem) => problem.endsWith('names removed UI'));
    };
    expect([...STALE_PAGES].filter((path) => !stillStale(path))).toEqual([]);
  });
});
