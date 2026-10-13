import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CSSResult, CSSResultGroup } from 'lit';
import { describe, expect, it } from 'vitest';
import { theme } from './theme';

/** Every style module except the token file itself, found as styles-integrity.test.ts finds them. */
const MODULES = import.meta.glob<Record<string, CSSResultGroup>>(
  [
    '../components/**/*.styles.ts',
    '../components/**/styles/*.ts',
    './*.ts',
    '!./*.test.ts',
    '!./theme.ts',
  ],
  { eager: true },
);

/**
 * Modules written before the tokens existed. A phase that migrates a module deletes its line. The
 * last test fails while a listed module is already clean, so this list only shrinks.
 */
const LEGACY = new Set<string>([
  '../components/control-bar/annotation-select.styles.ts',
  '../components/scatter-plot/projection-metadata/projection-metadata.styles.ts',
  '../components/scatter-plot/scatter-plot.styles.ts',
  '../components/scatter-plot/tooltips/protein-tooltip.styles.ts',
  '../components/structure-viewer/structure-viewer.styles.ts',
  './mixins.ts',
  './overlay-mixins.ts',
  './tokens.ts',
]);

const COLOUR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black)\b/i;
/** Set at run time by kit code (position.ts), not tokens. */
const RUNTIME_VARS = new Set(['--available-height']);
const DEFINED = new Set([...theme.cssText.matchAll(/(--ps-[\w-]+)\s*:/g)].map((m) => m[1]));
const CORE_SRC = fileURLToPath(new URL('..', import.meta.url));
// Joined, not `new URL(…, import.meta.url)`: knip reads that form as an import of the web app.
const WEB_SRC = join(CORE_SRC, '../../../apps/web/src');

function flatten(group: CSSResultGroup): CSSResult[] {
  return Array.isArray(group) ? group.flatMap(flatten) : [group as CSSResult];
}

function cssOf(path: string): string {
  return Object.values(MODULES[path] ?? {})
    .flatMap(flatten)
    .map((sheet) => sheet.cssText)
    .join('\n');
}

/**
 * Declarations that hard-code a colour or a font size, declare a token outside theme.ts, or read a
 * variable theme.ts does not define (a legacy one resolves to nothing once tokens.ts goes).
 */
function cssViolations(cssText: string): string[] {
  const found: string[] = [];
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, property, raw] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const value = raw.trim();
    const declaration = `${property}: ${value}`;
    const unknownVar = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(
      ([, name]) => !DEFINED.has(name) && !RUNTIME_VARS.has(name),
    );
    if (property.startsWith('--ps-') || COLOUR.test(value) || unknownVar) found.push(declaration);
    else if (property.startsWith('--')) continue;
    else if (
      property === 'font-size' &&
      value !== 'inherit' &&
      !/^var\(--ps-text-[a-z]+\)$/.test(value)
    )
      found.push(declaration);
    else if (property === 'font' && value !== 'inherit') found.push(declaration);
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const paths = Object.keys(MODULES).sort();

describe('style lint', () => {
  it('flags raw colours, literal font sizes, stray tokens and unknown variables', () => {
    expect(
      cssViolations(
        '.a { color: #fff; background: rgb(0 0 0 / 0.5); font-size: 12px; --ps-text: red; }',
      ),
    ).toEqual(['color: #fff', 'background: rgb(0 0 0 / 0.5)', 'font-size: 12px', '--ps-text: red']);
    expect(
      cssViolations(
        '.a:hover { color: var(--ps-text); font-size: var(--ps-text-sm); font: inherit; --x: 1px; outline-color: Highlight; }',
      ),
    ).toEqual([]);
    expect(
      cssViolations(
        ':host { --card-bg: #1e3a8a; } .a { color: oklch(0.7 0.1 200); background: color(srgb 1 0 0); border-color: lab(50% 0 0); gap: var(--spacing-sm); max-height: var(--available-height); } /* was: #fff */',
      ),
    ).toEqual([
      '--card-bg: #1e3a8a',
      'color: oklch(0.7 0.1 200)',
      'background: color(srgb 1 0 0)',
      'border-color: lab(50% 0 0)',
      'gap: var(--spacing-sm)',
    ]);
  });

  it.each(paths.filter((path) => !LEGACY.has(path)))(
    '%s reads colours and font sizes from tokens',
    (path) => {
      expect(cssViolations(cssOf(path))).toEqual([]);
    },
  );

  it('defines every --ps token a stylesheet reads', () => {
    const read = new Set(
      paths.flatMap((path) => [...cssOf(path).matchAll(/var\((--ps-[\w-]+)/g)].map((m) => m[1])),
    );
    expect([...read].filter((token) => !DEFINED.has(token))).toEqual([]);
  });

  it('uses every token theme.ts defines', () => {
    const sources = [...sourceFiles(CORE_SRC), ...sourceFiles(WEB_SRC)]
      .filter((file) => file !== join(CORE_SRC, 'styles', 'theme.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const unused = [...DEFINED].filter((token) => !new RegExp(`${token}(?![\\w-])`).test(sources));
    expect(unused).toEqual([]);
  });

  it.each([...LEGACY])('%s still needs its legacy exemption', (path) => {
    expect(MODULES[path], `${path} no longer exists; delete it from LEGACY`).toBeDefined();
    expect(
      cssViolations(cssOf(path)).length,
      `${path} is clean; delete it from LEGACY`,
    ).toBeGreaterThan(0);
  });
});
