import { describe, expect, it } from 'vitest';
import { MACHINE_PATH } from '../../../../docs/scripts/machine-path';
import { EXAMPLE_DATASETS, EXAMPLES_DOCS_URL } from './example-datasets';

/**
 * Pins the catalog against the generated Example datasets page
 * (docs/explore/example-datasets.md), per AGENTS.md's "pin a fact that has to
 * live in two places with a test". Each example's info popover links to
 * `#<id>` on that page and VitePress never checks anchors, so a renamed or
 * missing section would otherwise break the link silently. Read via `?raw`
 * rather than `node:fs`, because `tsconfig.app.json` deliberately carries no
 * Node types.
 */
const docsModules = import.meta.glob('../../../../docs/explore/example-datasets.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const PAGE = Object.values(docsModules)[0] as string;

/** The ids of the page's cards: the explicit `{#id}` anchors on its level-2 headings. */
const SECTION_IDS = [...(PAGE ?? '').matchAll(/^## .* \{#([^}]+)\}$/gm)].map((match) => match[1]);

describe('example-datasets.md', () => {
  it('is found', () => {
    expect(PAGE).toBeTruthy();
  });

  it('has one section per catalog entry, in menu order', () => {
    expect(SECTION_IDS).toEqual(EXAMPLE_DATASETS.map((entry) => entry.id));
  });

  it.each(EXAMPLE_DATASETS)("links $id's info to its section", (entry) => {
    expect(entry.docsUrl).toBe(`${EXAMPLES_DOCS_URL}#${entry.id}`);
  });
});

/**
 * The docs check refuses a manifest build command that names a path of the build machine,
 * because the page prints the command. Each form a real build command could carry one in.
 */
describe('MACHINE_PATH', () => {
  it.each([
    ['a scratch checkout', 'build_showcase.py build --cli-root /private/tmp/x/cli'],
    ['/tmp', 'build --out-root=/tmp/out'],
    ['a home directory', 'build --path nm_data=/Users/jane/nm'],
    ['a Linux home directory', 'build --cli-root /home/jane/cli'],
    ['a quoted path with a space', "build --cli-root '/Users/Jane Doe/cli'"],
    ['a double-quoted path', 'build --cli-root "/Volumes/Data/cli"'],
    ["macOS's $TMPDIR", 'build --out-root /var/folders/ab/T/tmp.x'],
    ['an external disk', 'build --out-root /Volumes/Data/out'],
    ['a path under ~', 'build --release ~/r'],
    ['the start of the command', '/Users/jane/build_showcase.py build'],
  ])('finds %s', (_, command) => {
    expect(command).toMatch(MACHINE_PATH);
  });

  it.each([
    'build_showcase.py build --only three-finger-toxins --cli-root $CLI --out-root $OUT',
    'build --path nm_data=$NM_DATA --only $TMP',
    'build --only a/Users/b',
  ])('passes the redacted command %s', (command) => {
    expect(command).not.toMatch(MACHINE_PATH);
  });
});
