import { describe, expect, it } from 'vitest';
import { THEME_BOOT_SCRIPT } from '../../../../config/theme';
import { DEFAULT_THEME, LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from './theme-defaults';

/**
 * The first-paint boot: config/theme.ts's script, which the app's vite.config.ts injects into
 * index.html and the docs put in their head, and index.html's style, which repeats dark
 * --ps-surface because it cannot import anything (AGENTS.md: a fact that lives in two places gets
 * a test). The files are read via `?raw`: tsconfig.app.json carries no Node types.
 * workbench-theme.spec.ts runs the script in the built app.
 */
const raw = (modules: Record<string, unknown>) => (Object.values(modules)[0] ?? '') as string;
const INDEX_HTML = raw(
  import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }),
);
const VITE_CONFIG = raw(
  import.meta.glob('../../vite.config.ts', { query: '?raw', import: 'default', eager: true }),
);
const TOKENS_CSS = raw(
  import.meta.glob('../../../../packages/core/src/styles/tokens.css', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

const DOCS_CONFIG = raw(
  import.meta.glob('../../../../docs/.vitepress/config.mts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

const BOOT_STYLE = INDEX_HTML.match(/<style data-theme-boot>([\s\S]*?)<\/style>/)?.[1] ?? '';

/** A storage over `entries`; `throws` makes every call throw, as blocked site data does. */
function fakeStorage(entries: Record<string, string>, throws = false) {
  const store = new Map(Object.entries(entries));
  const guard = () => {
    if (throws) throw new Error('SecurityError: storage is disabled');
  };
  return {
    store,
    getItem(key: string): string | null {
      guard();
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      guard();
      store.set(key, value);
    },
    removeItem(key: string): void {
      guard();
      store.delete(key);
    },
  };
}

/**
 * Runs `script` with `storage` as localStorage's, and returns the data-theme it set (null: none).
 * The script uses the bare globals, which the parameters shadow.
 */
function runBoot(script: string, storage: ReturnType<typeof fakeStorage>): string | null {
  let theme: string | null = null;
  const document = {
    documentElement: {
      setAttribute(name: string, value: string) {
        if (name === 'data-theme') theme = value;
      },
    },
  };
  new Function('localStorage', 'document', script)(storage, document);
  return theme;
}

describe('the first-paint boot', () => {
  it('is found', () => {
    expect(BOOT_STYLE.trim()).not.toBe('');
    expect(TOKENS_CSS).toContain(":root[data-theme='dark']");
  });

  it("the app injects the script at the end of index.html's head, so after the redirect", () => {
    expect(VITE_CONFIG).toContain("import { THEME_BOOT_SCRIPT } from '../../config/theme'");
    expect(VITE_CONFIG).toMatch(/children: THEME_BOOT_SCRIPT,\s*injectTo: 'head',/);
    expect(INDEX_HTML).not.toContain('<script data-theme-boot>');
  });

  it("the docs run the same script in their head, before VitePress's own", () => {
    // VitePress appends its check-dark-mode script after the configured head entries.
    expect(DOCS_CONFIG).toMatch(/\['script', \{ id: 'theme-boot' \}, THEME_BOOT_SCRIPT\]/);
    expect(DOCS_CONFIG).toContain("import { THEME_BOOT_SCRIPT } from '../../config/theme'");
  });

  it('the boot style comes after the GitHub Pages redirect script', () => {
    const redirectEnd = INDEX_HTML.indexOf('<!-- End Single Page Apps for GitHub Pages -->');
    expect(redirectEnd).toBeGreaterThan(0);
    expect(INDEX_HTML.indexOf('<style data-theme-boot>')).toBeGreaterThan(redirectEnd);
    expect(INDEX_HTML.indexOf('<style data-theme-boot>')).toBeLessThan(
      INDEX_HTML.indexOf('</head>'),
    );
  });

  it('applies a stored override on any page: no path check', () => {
    expect(THEME_BOOT_SCRIPT).not.toContain('location');
    expect(runBoot(THEME_BOOT_SCRIPT, fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(runBoot(THEME_BOOT_SCRIPT, fakeStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light');
  });

  it.each([
    ['nothing stored', fakeStorage({})],
    ["VueUse's auto", fakeStorage({ [THEME_STORAGE_KEY]: 'auto' })],
    ['garbage', fakeStorage({ [THEME_STORAGE_KEY]: '{not json' })],
    ['a JSON "dark"', fakeStorage({ [THEME_STORAGE_KEY]: '"dark"' })],
    ['a throwing localStorage', fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }, true)],
  ])('%s follows the system', (_case, storage) => {
    expect(runBoot(THEME_BOOT_SCRIPT, storage)).toBe(DEFAULT_THEME);
  });

  it('moves a legacy override to the shared key, once', () => {
    const storage = fakeStorage({ [LEGACY_THEME_STORAGE_KEY]: '"dark"' });
    expect(runBoot(THEME_BOOT_SCRIPT, storage)).toBe('dark');
    expect(Object.fromEntries(storage.store)).toEqual({ [THEME_STORAGE_KEY]: 'dark' });
  });

  it('drops a legacy System, and never overwrites a shared choice', () => {
    const system = fakeStorage({ [LEGACY_THEME_STORAGE_KEY]: '"system"' });
    expect(runBoot(THEME_BOOT_SCRIPT, system)).toBe('system');
    expect(system.store.size).toBe(0);

    const both = fakeStorage({
      [LEGACY_THEME_STORAGE_KEY]: '"dark"',
      [THEME_STORAGE_KEY]: 'light',
    });
    expect(runBoot(THEME_BOOT_SCRIPT, both)).toBe('light');
    expect(Object.fromEntries(both.store)).toEqual({ [THEME_STORAGE_KEY]: 'light' });
  });

  it("moves a legacy override over VitePress's 'auto', which any docs visit leaves", () => {
    const storage = fakeStorage({
      [LEGACY_THEME_STORAGE_KEY]: '"dark"',
      [THEME_STORAGE_KEY]: 'auto',
    });
    expect(runBoot(THEME_BOOT_SCRIPT, storage)).toBe('dark');
    expect(Object.fromEntries(storage.store)).toEqual({ [THEME_STORAGE_KEY]: 'dark' });
  });

  it("the first-paint style's colour equals dark --ps-surface in tokens.css", () => {
    const darkRoles = TOKENS_CSS.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\}/)?.[1] ?? '';
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
