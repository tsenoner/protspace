import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, THEME_STORAGE_KEY } from './theme-defaults';

/**
 * Pins index.html's first-paint pair to the app and to the tokens (AGENTS.md: a fact that lives
 * in two places gets a test). The boot script repeats the storage key, the choices and the
 * default, and the boot style repeats dark --ps-surface, because neither can import anything.
 * Both files are read via `?raw`: tsconfig.app.json carries no Node types.
 */
const raw = (modules: Record<string, unknown>) => (Object.values(modules)[0] ?? '') as string;
const INDEX_HTML = raw(
  import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }),
);
const THEME_TS = raw(
  import.meta.glob('../../../../packages/core/src/styles/theme.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

const BOOT_SCRIPT = INDEX_HTML.match(/<script data-theme-boot>([\s\S]*?)<\/script>/)?.[1] ?? '';
const BOOT_STYLE = INDEX_HTML.match(/<style data-theme-boot>([\s\S]*?)<\/style>/)?.[1] ?? '';

/**
 * Runs the boot script at `pathname` with `getItem` as localStorage's, and returns the
 * data-theme it set (null: none). The script uses the bare globals, which the parameters shadow.
 */
function runBoot(pathname: string, getItem: (key: string) => string | null): string | null {
  let theme: string | null = null;
  const location = { pathname };
  const localStorage = { getItem };
  const document = {
    documentElement: {
      setAttribute(name: string, value: string) {
        if (name === 'data-theme') theme = value;
      },
    },
  };
  new Function('location', 'localStorage', 'document', BOOT_SCRIPT)(
    location,
    localStorage,
    document,
  );
  return theme;
}

/** A storage holding `value` (already JSON) under the theme key. */
const holding = (value: string | null) => (key: string) =>
  key === THEME_STORAGE_KEY ? value : null;

describe('the first-paint boot in index.html', () => {
  it('is found', () => {
    expect(BOOT_SCRIPT.trim()).not.toBe('');
    expect(BOOT_STYLE.trim()).not.toBe('');
    expect(THEME_TS).toContain('const darkRoles');
  });

  it('the boot script comes after the GitHub Pages redirect script', () => {
    const redirectEnd = INDEX_HTML.indexOf('<!-- End Single Page Apps for GitHub Pages -->');
    expect(redirectEnd).toBeGreaterThan(0);
    // The redirect turns /?/explore into /explore; a path check before it would see "/".
    expect(INDEX_HTML.indexOf('<script data-theme-boot>')).toBeGreaterThan(redirectEnd);
    expect(INDEX_HTML.indexOf('<style data-theme-boot>')).toBeGreaterThan(redirectEnd);
    expect(INDEX_HTML.indexOf('<style data-theme-boot>')).toBeLessThan(
      INDEX_HTML.indexOf('</head>'),
    );
  });

  it('/explore with "dark" stored sets dark', () => {
    expect(runBoot('/explore', holding('"dark"'))).toBe('dark');
    expect(runBoot('/explore', holding('"system"'))).toBe('system');
    expect(runBoot('/explore', holding('"light"'))).toBe('light');
  });

  it('/explore/ is themed too', () => {
    expect(runBoot('/explore/', holding('"dark"'))).toBe('dark');
  });

  it.each([
    ['nothing stored', holding(null)],
    ['garbage', holding('{not json')],
    ['"blue"', holding('"blue"')],
    ['a number', holding('1')],
    ['a bare dark (not JSON)', holding('dark')],
    [
      'a throwing localStorage',
      () => {
        throw new Error('SecurityError: storage is disabled');
      },
    ],
  ])('%s sets DEFAULT_THEME', (_case, getItem) => {
    expect(runBoot('/explore', getItem)).toBe(DEFAULT_THEME);
  });

  it.each(['/', '/privacy', '/explore-foo', '/explore/x', '/dev/kit', '/docs/'])(
    '%s sets nothing',
    (pathname) => {
      expect(runBoot(pathname, holding('"dark"'))).toBeNull();
    },
  );

  it("the script's key equals THEME_STORAGE_KEY", () => {
    const getItem = vi.fn(holding('"dark"'));
    runBoot('/explore', getItem);
    expect(getItem).toHaveBeenCalledExactlyOnceWith(THEME_STORAGE_KEY);
    expect(BOOT_SCRIPT).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it("the first-paint style's colour equals dark --ps-surface in theme.ts", () => {
    const darkRoles = THEME_TS.match(/const darkRoles = css`([\s\S]*?)`/)?.[1] ?? '';
    const darkSurface = darkRoles.match(/--ps-surface:\s*(#[0-9a-f]{6})\b/i)?.[1];
    expect(darkSurface).toBeDefined();
    const colours = [...BOOT_STYLE.matchAll(/background:\s*(#[0-9a-f]{3,8})\b/gi)].map((match) =>
      match[1].toLowerCase(),
    );
    expect(colours).toEqual([darkSurface!.toLowerCase(), darkSurface!.toLowerCase()]);
  });

  it('the first-paint style covers data-theme dark and, under prefers-color-scheme dark, system', () => {
    const style = BOOT_STYLE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const [outside, media = ''] = style.split('@media (prefers-color-scheme: dark)');
    expect(outside).toMatch(
      /:root\[data-theme='dark'\], :root\[data-theme='dark'\] body \{ color-scheme: dark; background: #[0-9a-f]{6}; \}/i,
    );
    expect(media).toMatch(
      /:root\[data-theme='system'\], :root\[data-theme='system'\] body \{ color-scheme: dark; background: #[0-9a-f]{6}; \}/i,
    );
    // Nothing themes a page outside these two cases: no light rule, no bare :root.
    expect(outside).not.toContain("data-theme='system'");
    expect(style).not.toContain("data-theme='light'");
  });
});
