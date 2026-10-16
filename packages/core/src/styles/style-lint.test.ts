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

const COLOUR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black)\b/i;
/**
 * Set at run time, not tokens: by kit code (position.ts), the query pickers (picker-placement.ts)
 * and the plot's tooltip placement (tooltips/tooltip-position.ts).
 */
const RUNTIME_VARS = new Set([
  '--available-height',
  '--available-width',
  '--picker-room',
  '--protspace-tooltip-max-height',
  '--protspace-tooltip-effective-width',
]);
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
 * variable that neither theme.ts, RUNTIME_VARS nor the checked CSS itself declares. A module may
 * read a property it declares (--card-gap, the plot's --protspace-* sizes); a sheet it composes
 * counts as its own, since cssOf returns both.
 */
function cssViolations(cssText: string): string[] {
  const found: string[] = [];
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)];
  const own = new Set(
    declarations
      .map(([, property]) => property)
      .filter((property) => property.startsWith('--') && !property.startsWith('--ps-')),
  );
  for (const [, property, raw] of declarations) {
    const value = raw.trim();
    const declaration = `${property}: ${value}`;
    const unknownVar = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(
      ([, name]) => !DEFINED.has(name) && !RUNTIME_VARS.has(name) && !own.has(name),
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

/** The web app's explore stylesheets (index.css belongs to the landing page): colours from tokens. */
const WEB_CSS = ['workbench/workbench.css', 'tour/product-tour.css'];

/**
 * index.css's shadcn colours (light-only HSL triples) and the Tailwind aliases that wrap them: an
 * explore sheet reading one stays light in Dark.
 */
const LANDING_COLOURS = new Set(
  [
    ...readFileSync(join(WEB_SRC, 'index.css'), 'utf8').matchAll(
      /(--[\w-]+)\s*:\s*(?:[\d.]+ [\d.]+% [\d.]+%|hsl\(var\(--[\w-]+\)\))\s*;/g,
    ),
  ].map(([, name]) => name),
);
/** Named colours beyond COLOUR's white/black; false positives are cheap in the two web sheets. */
const NAMED =
  /(?<![\w-])(?:gr[ae]y|silver|red|green|blue|yellow|orange|navy|maroon|teal|purple|whitesmoke|gainsboro|lightgr[ae]y|darkgr[ae]y)(?![\w-])/i;

/**
 * A web stylesheet's raw or named colours, its reads of --ps-* tokens theme.ts does not define,
 * and its reads of the landing page's light-only colours.
 */
function webCssViolations(cssText: string): string[] {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const [, property, raw] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const value = raw.trim();
    const unknownToken = [...value.matchAll(/var\(\s*(--ps-[\w-]+)/g)].some(
      ([, name]) => !DEFINED.has(name),
    );
    const landingColour = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(([, name]) =>
      LANDING_COLOURS.has(name),
    );
    if (COLOUR.test(value) || NAMED.test(value) || unknownToken || landingColour)
      found.push(`${property}: ${value}`);
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

  it('accepts a module reading a custom property it declares', () => {
    expect(cssViolations(':host { --gap: 2px; } .a { margin: var(--gap); }')).toEqual([]);
    // Declaring a token is still flagged, and does not make it a known own property.
    expect(cssViolations(':host { --ps-gap: 2px; } .a { margin: var(--ps-gap); }')).toEqual([
      '--ps-gap: 2px',
      'margin: var(--ps-gap)',
    ]);
    // A literal font size is still a literal behind an own property.
    expect(cssViolations(':host { --size: 12px; } .a { font-size: var(--size); }')).toEqual([
      'font-size: var(--size)',
    ]);
  });

  it.each(paths)('%s reads colours and font sizes from tokens', (path) => {
    expect(cssViolations(cssOf(path))).toEqual([]);
  });

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

  it('flags a raw colour and an undefined token in a web stylesheet', () => {
    expect(
      webCssViolations(
        '.a:hover { color: #334155; border: 1px solid var(--ps-nope); background: var(--ps-surface); font-size: 12px; } /* #fff */',
      ),
    ).toEqual(['color: #334155', 'border: 1px solid var(--ps-nope)']);
  });

  it('flags a named or landing-page colour in a web stylesheet', () => {
    expect(LANDING_COLOURS.size).toBeGreaterThan(10);
    expect(
      webCssViolations(
        '.a { border-color: var(--border); color: var(--color-muted-foreground); outline: 1px solid gray; padding: var(--ps-space-2); grid-area: content; }',
      ),
    ).toEqual([
      'border-color: var(--border)',
      'color: var(--color-muted-foreground)',
      'outline: 1px solid gray',
    ]);
  });

  it.each(WEB_CSS)('%s reads colours from tokens', (file) => {
    expect(webCssViolations(readFileSync(join(WEB_SRC, file), 'utf8'))).toEqual([]);
  });
});
