# Explore Workbench, Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation every later phase uses: `--ps-*` design tokens on the document root, Inter and a fixed root font size, Lucide icons, one Escape order, and a tested kit of `ps-*` controls. Today's explore layout keeps working; only its font and root font size change.

**Architecture:** The tokens live in one Lit `css` module, `packages/core/src/styles/theme.ts`. Core adopts it into the document when imported, and custom properties inherit into every shadow root. The kit is a set of small Lit elements in `packages/core/src/components/kit/`. They are built on the browser's `popover` attribute and `<dialog>`, positioned with Floating UI, and coordinated by one layer stack (`kit/layers.ts`) that owns Escape and outside-press dismissal. Kit behaviour is tested in real Chromium through a new Vitest browser project; all existing tests keep their jsdom setup.

**Tech Stack:** Lit 3 (legacy decorators: `experimentalDecorators: true`, `useDefineForClassFields: false`), TypeScript 6, Vite 8, Vitest 4.1.9 (jsdom projects plus browser mode with `@vitest/browser-playwright`), Playwright 1.61, `@floating-ui/dom` 1.x, `lucide` 0.462.0, `@fontsource-variable/inter` 5.x, Tailwind 4, React 19.

**Spec:** `openspec/changes/explore-workbench/design.md`: decisions 5 (tokens), 6 (palette), 7 (type), 8 (kit), 11 (layer stack) and 20 (testing); `proposal.md` for scope.

**Worktree:** `/Users/heispv/Documents/protspace_web/protspace-workbench`, branch `feat/explore-workbench`. Run every command from there.

## Global Constraints

- Every design token is a CSS custom property named `--ps-*`, declared only in `packages/core/src/styles/theme.ts`.
- New core stylesheets hold no raw colours (`#…`, `rgb()`, `hsl()`, `white`, `black`) and no literal font sizes; they read `--ps-*` tokens. Size literals such as `360px` for widths are fine.
- New code never declares tokens on `:host`; tokens come from `:root`.
- `css` literals live only in `*.styles.ts` files or `styles/` folders (ESLint rule in `eslint.config.mjs`; `styles-integrity.test.ts` finds them by glob). Non-style modules must not live in `packages/core/src/styles/`, because the integrity test treats every export there as a stylesheet.
- Kit elements use the `ps-` tag prefix; feature elements keep `protspace-`.
- Icons come from Lucide only, at stroke width 1.75 and sizes 14, 16 or 20 px.
- Popovers use `popover="manual"`; dialogs use `<dialog>.showModal()`. Both render in the top layer.
- Escape follows one order, owned by `kit/layers.ts`: the top open layer first, then registered fallbacks in ascending `order` (`ESCAPE_ORDER.connectors = 10`, `ESCAPE_ORDER.selection = 20`).
- Fonts are self-hosted; never load a third-party font CDN.
- Target browsers: the last two versions of Chrome, Edge, Firefox and Safari.
- Light accent values: fill `#007ab5` under white text, hover `#00699c`, accent text `#0369a1`, focus ring `#0284c7`. Dark: fill `#38bdf8` under `#04121c` text, hover `#7dd3fc`, accent text `#38bdf8`, focus `#38bdf8`.
- Every new export needs a consumer in the same commit (knip runs in the pre-commit hook); the task's own test file importing it is enough. Public kit API is exported from `packages/core/src/components/kit/index.ts`, which `packages/core/src/index.ts` re-exports.
- Commits: Angular `type(scope): subject`, subject under 72 characters, at most two lines, never a `Co-Authored-By` or Claude trailer. Commit when the task's tests pass. The husky hook runs `pnpm precommit` (lint-staged, type-check, knip, docs build); never bypass it on a task's final commit.
- Run core tests package-scoped: `pnpm --filter @protspace/core exec vitest --run --project unit <file>` or `--project browser <file>`.
- Dev and e2e servers use ports other than 8080 and 8091 (the user's). For e2e set `PLAYWRIGHT_PORT`, e.g. `PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec>`.
- Baseline before phase 1: core 191 test files, utils 21, app 27, all passing.

## Review Focus

1. A popover or dialog removed from the DOM while open (a React unmount, a re-render) must not leave a stale layer: Escape must still reach the next layer or the fallbacks. Tests in Tasks 1.7 and 1.9.
2. The anchor of an open popover is removed: closing must not throw, and focus lands on `document.body`. Test in Task 1.7.
3. Nested layers (a menu inside a dialog): Escape closes the menu first, and a press elsewhere inside the dialog closes the menu but not the dialog. Test in Task 1.9.
4. An anchor at the viewport's bottom-right corner: the popover flips and shifts so it stays fully on screen. Test in Task 1.7.
5. A menu item with a very long label truncates instead of widening the panel past the viewport. Test in Task 1.8.

---

### Task 1.1: Real-browser test project for core

The kit relies on the `popover` attribute, `<dialog>` and constructable stylesheets, none of which jsdom implements. This task adds a Vitest browser project that runs `*.browser.test.ts` files in Chromium, and leaves every existing test where it is.

**Files:**

- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/components/kit/platform.browser.test.ts`
- Modify: `packages/core/package.json` (dev dependency `@vitest/browser-playwright`)
- Modify: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` (install Chromium before `pnpm test:ci`)

**Interfaces:**

- Produces: the `unit` and `browser` Vitest projects. Later tasks name browser tests `*.browser.test.ts` and run them with `--project browser`.

- [ ] **Step 1: Record the baseline**

Run: `pnpm --filter @protspace/core exec vitest --run 2>&1 | tail -4`
Expected: `Test Files  191 passed (191)`

- [ ] **Step 2: Add the Playwright provider**

Run: `pnpm --filter @protspace/core add -D @vitest/browser-playwright@4.1.9`
Expected: `packages/core/package.json` lists it under `devDependencies`, and `pnpm-lock.yaml` changes.

- [ ] **Step 3: Write the failing platform test**

Create `packages/core/src/components/kit/platform.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

// The kit builds on these platform features. jsdom has none of them, which is why kit
// behaviour is tested in a real browser.
describe('browser platform the kit relies on', () => {
  it('supports the popover attribute', () => {
    const el = document.createElement('div');
    el.popover = 'manual';
    document.body.append(el);
    el.showPopover();
    expect(el.matches(':popover-open')).toBe(true);
    el.hidePopover();
    el.remove();
  });

  it('opens a modal dialog', () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    expect(dialog.matches(':modal')).toBe(true);
    dialog.close();
    dialog.remove();
  });

  it('adopts constructable stylesheets into the document', () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(':root { --probe: 1px; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    expect(getComputedStyle(document.documentElement).getPropertyValue('--probe').trim()).toBe(
      '1px',
    );
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/kit/platform.browser.test.ts`
Expected: FAIL: `el.showPopover is not a function` (or a similar error), because the file runs in Node without a DOM.

- [ ] **Step 5: Add the Vitest config with two projects**

Create `packages/core/vitest.config.ts`:

```ts
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Vitest reads this file instead of vite.config.ts, so the library build's plugins (dts) stay out
// of test runs. `unit` keeps every existing test (each file opts into jsdom with a docblock);
// `browser` runs *.browser.test.ts in Chromium, for code that needs the popover attribute,
// <dialog>, layout or constructable stylesheets.
export default defineConfig({
  worker: { format: 'es' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
```

- [ ] **Step 6: Run both projects**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser`
Expected: PASS, 1 file, 3 tests.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit 2>&1 | tail -4`
Expected: `Test Files  191 passed (191)`, the same as the baseline.

- [ ] **Step 7: Install Chromium in the CI jobs that run unit tests**

In `.github/workflows/ci.yml` and in `.github/workflows/deploy.yml`, add this step directly before the step that runs `pnpm test:ci`:

```yaml
- name: Install Chromium for the core browser tests
  run: pnpm exec playwright install --only-shell chromium
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/vitest.config.ts packages/core/package.json pnpm-lock.yaml \
  packages/core/src/components/kit/platform.browser.test.ts .github/workflows/ci.yml .github/workflows/deploy.yml
git commit -m "test(core): run kit tests in Chromium with Vitest browser mode"
```

---

### Task 1.2: Theme tokens, adopted by core

**Files:**

- Create: `packages/core/src/styles/theme.ts`
- Create: `packages/core/src/components/kit/adopt-theme.ts`
- Create: `packages/core/src/components/kit/adopt-theme.test.ts`
- Create: `packages/core/src/styles/theme.browser.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Produces: `theme: CSSResult` (`styles/theme.ts`, the only export of that module); `adoptTheme(doc?: Document): void` (`kit/adopt-theme.ts`); the token names below. Every later task uses exactly these names.

| Group    | Tokens                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Surfaces | `--ps-surface`, `--ps-surface-muted`, `--ps-surface-raised`, `--ps-surface-hover`                                                                                                                                                                                              |
| Lines    | `--ps-border`, `--ps-border-strong`                                                                                                                                                                                                                                            |
| Text     | `--ps-text`, `--ps-text-muted`, `--ps-text-faint`, `--ps-text-on-accent`                                                                                                                                                                                                       |
| Accent   | `--ps-accent`, `--ps-accent-hover`, `--ps-accent-text`, `--ps-accent-tint`, `--ps-focus`                                                                                                                                                                                       |
| Status   | `--ps-danger`, `--ps-warning`, `--ps-success`                                                                                                                                                                                                                                  |
| Overlays | `--ps-tooltip-bg`, `--ps-tooltip-text`, `--ps-scrim`, `--ps-shadow-sm`, `--ps-shadow-md`, `--ps-shadow-lg`                                                                                                                                                                     |
| Type     | `--ps-font-sans`, `--ps-text-xs` (11px), `--ps-text-sm` (12px), `--ps-text-base` (13px), `--ps-text-md` (14px), `--ps-text-lg` (16px), `--ps-text-xl` (20px), `--ps-weight-regular`, `--ps-weight-medium`, `--ps-weight-semibold`, `--ps-leading-tight`, `--ps-leading-normal` |
| Space    | `--ps-space-0-5` (2px), `--ps-space-1` (4px), `--ps-space-1-5` (6px), `--ps-space-2` (8px), `--ps-space-3` (12px), `--ps-space-4` (16px), `--ps-space-5` (20px), `--ps-space-6` (24px)                                                                                         |
| Shape    | `--ps-radius-sm` (4px), `--ps-radius` (6px), `--ps-radius-lg` (10px), `--ps-radius-full`                                                                                                                                                                                       |
| Sizes    | `--ps-control-sm` (28px), `--ps-control-md` (32px), `--ps-row` (28px), `--ps-touch-target` (40px), `--ps-focus-width` (2px), `--ps-focus-offset` (2px)                                                                                                                         |
| Motion   | `--ps-duration-fast` (120ms), `--ps-duration` (160ms), `--ps-ease`                                                                                                                                                                                                             |

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/kit/adopt-theme.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { theme } from '../../styles/theme';
import { adoptTheme } from './adopt-theme';

function themeTextIn(doc: Document): string {
  const adopted = (doc.adoptedStyleSheets ?? []).flatMap((s) =>
    [...s.cssRules].map((r) => r.cssText),
  );
  const styles = [...doc.querySelectorAll('style[data-ps-theme]')].map((s) => s.textContent ?? '');
  return [...adopted, ...styles].join('\n');
}

describe('adoptTheme', () => {
  it('adds the token sheet to a document exactly once', () => {
    const doc = document.implementation.createHTMLDocument('probe');
    adoptTheme(doc);
    adoptTheme(doc);
    const copies =
      doc.querySelectorAll('style[data-ps-theme]').length + (doc.adoptedStyleSheets?.length ?? 0);
    expect(copies).toBe(1);
    expect(themeTextIn(doc)).toContain('--ps-surface');
  });
});

describe('theme', () => {
  it('puts light values on :root and dark values under data-theme="dark" and system', () => {
    const text = theme.cssText;
    expect(text).toMatch(/:root\s*\{[^}]*--ps-surface:\s*#ffffff/);
    expect(text).toMatch(/:root\[data-theme='dark'\]\s*\{[^}]*--ps-surface:\s*#0f172a/);
    expect(text).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-theme='system'\]/,
    );
  });
});
```

Create `packages/core/src/styles/theme.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptTheme } from '../components/kit/adopt-theme';

const root = document.documentElement;
const token = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

describe('theme tokens in a real cascade', () => {
  beforeAll(() => adoptTheme());
  afterEach(() => root.removeAttribute('data-theme'));

  it('uses the light values by default', () => {
    expect(token(root, '--ps-surface')).toBe('#ffffff');
    expect(token(root, '--ps-accent')).toBe('#007ab5');
    expect(getComputedStyle(root).colorScheme).toBe('light');
  });

  it('switches to the dark values with data-theme="dark"', () => {
    root.dataset.theme = 'dark';
    expect(token(root, '--ps-surface')).toBe('#0f172a');
    expect(getComputedStyle(root).colorScheme).toBe('dark');
  });

  it('reaches inside shadow roots without the component declaring anything', () => {
    const host = document.createElement('div');
    const inner = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('span'));
    document.body.append(host);
    root.dataset.theme = 'dark';
    expect(token(inner, '--ps-text')).toBe('#f1f5f9');
    host.remove();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/adopt-theme.test.ts`
Expected: FAIL: `Failed to resolve import "../../styles/theme"`.

- [ ] **Step 3: Write the token module**

Create `packages/core/src/styles/theme.ts`:

```ts
import { css } from 'lit';

/**
 * The design tokens: the only place in core with literal colours, sizes and durations.
 * Components read these custom properties and never declare them on :host, which would block the
 * page's theme. Core adopts this sheet into the document (components/kit/adopt-theme.ts), and
 * custom properties inherit into every shadow root. Role colours come from the slate and sky ramps
 * named in the comments; the ramps are not variables, so every variable here has a user
 * (style-lint.test.ts checks this).
 *
 * Light values sit on :root. Dark values apply under [data-theme='dark'], and under
 * [data-theme='system'] when the OS prefers dark. Until the theme switch lands nothing sets
 * data-theme, so pages stay light.
 */

const lightRoles = css`
  --ps-surface: #ffffff;
  --ps-surface-muted: #f8fafc; /* slate-50 */
  --ps-surface-raised: #ffffff;
  --ps-surface-hover: #f1f5f9; /* slate-100 */
  --ps-border: #e2e8f0; /* slate-200 */
  --ps-border-strong: #cbd5e1; /* slate-300 */
  --ps-text: #0f172a; /* slate-900 */
  --ps-text-muted: #475569; /* slate-600 */
  --ps-text-faint: #94a3b8; /* slate-400, for placeholders and captions only */
  --ps-text-on-accent: #ffffff;
  --ps-accent: #007ab5; /* brand cyan #00a3e0 deepened: 4.7:1 under white text */
  --ps-accent-hover: #00699c;
  --ps-accent-text: #0369a1; /* sky-700, 5.9:1 on white */
  --ps-accent-tint: #e0f2fe; /* sky-100 */
  --ps-focus: #0284c7; /* sky-600, 4.1:1 on white; non-text needs 3:1 */
  --ps-danger: #dc2626; /* red-600 */
  --ps-warning: #b45309; /* amber-700 */
  --ps-success: #15803d; /* green-700 */
  --ps-tooltip-bg: #0f172a;
  --ps-tooltip-text: #f8fafc;
  --ps-scrim: rgb(15 23 42 / 0.45);
  --ps-shadow-sm: 0 1px 2px rgb(15 23 42 / 0.06);
  --ps-shadow-md: 0 4px 12px -2px rgb(15 23 42 / 0.12);
  --ps-shadow-lg: 0 12px 32px -12px rgb(15 23 42 / 0.24), 0 2px 6px rgb(15 23 42 / 0.06);
`;

const darkRoles = css`
  --ps-surface: #0f172a; /* slate-900 */
  --ps-surface-muted: #131d33;
  --ps-surface-raised: #162036;
  --ps-surface-hover: #1e293b; /* slate-800 */
  --ps-border: #1e293b;
  --ps-border-strong: #334155; /* slate-700 */
  --ps-text: #f1f5f9; /* slate-100 */
  --ps-text-muted: #94a3b8; /* slate-400 */
  --ps-text-faint: #64748b; /* slate-500 */
  --ps-text-on-accent: #04121c;
  --ps-accent: #38bdf8; /* sky-400, 8.3:1 on the dark surface */
  --ps-accent-hover: #7dd3fc; /* sky-300 */
  --ps-accent-text: #38bdf8;
  --ps-accent-tint: rgb(56 189 248 / 0.16);
  --ps-focus: #38bdf8;
  --ps-danger: #f87171; /* red-400 */
  --ps-warning: #fbbf24; /* amber-400 */
  --ps-success: #4ade80; /* green-400 */
  --ps-tooltip-bg: #e2e8f0;
  --ps-tooltip-text: #0f172a;
  --ps-scrim: rgb(2 6 23 / 0.65);
  --ps-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.5);
  --ps-shadow-md: 0 6px 16px -4px rgb(0 0 0 / 0.6);
  --ps-shadow-lg: 0 16px 40px -12px rgb(0 0 0 / 0.75), 0 0 0 1px #24324a;
`;

const sizes = css`
  --ps-font-sans:
    'Inter Variable', 'Inter Fallback', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --ps-text-xs: 11px;
  --ps-text-sm: 12px;
  --ps-text-base: 13px;
  --ps-text-md: 14px;
  --ps-text-lg: 16px;
  --ps-text-xl: 20px;
  --ps-weight-regular: 400;
  --ps-weight-medium: 500;
  --ps-weight-semibold: 600;
  --ps-leading-tight: 1.25;
  --ps-leading-normal: 1.45;
  --ps-space-0-5: 2px;
  --ps-space-1: 4px;
  --ps-space-1-5: 6px;
  --ps-space-2: 8px;
  --ps-space-3: 12px;
  --ps-space-4: 16px;
  --ps-space-5: 20px;
  --ps-space-6: 24px;
  --ps-radius-sm: 4px;
  --ps-radius: 6px;
  --ps-radius-lg: 10px;
  --ps-radius-full: 9999px;
  --ps-control-sm: 28px;
  --ps-control-md: 32px;
  --ps-row: 28px;
  --ps-touch-target: 40px;
  --ps-focus-width: 2px;
  --ps-focus-offset: 2px;
  --ps-duration-fast: 120ms;
  --ps-duration: 160ms;
  --ps-ease: cubic-bezier(0.2, 0, 0, 1);
`;

export const theme = css`
  :root {
    color-scheme: light;
    ${lightRoles}
    ${sizes}
  }
  :root[data-theme='dark'] {
    color-scheme: dark;
    ${darkRoles}
  }
  @media (prefers-color-scheme: dark) {
    :root[data-theme='system'] {
      color-scheme: dark;
      ${darkRoles}
    }
  }
`;
```

- [ ] **Step 4: Write `adoptTheme`**

Create `packages/core/src/components/kit/adopt-theme.ts`:

```ts
import { theme } from '../../styles/theme';

const adopted = new WeakSet<Document>();

/**
 * Adds the token sheet to a document, once. It uses a constructable stylesheet where the browser
 * has them, and a <style data-ps-theme> element otherwise (jsdom). Adopted sheets sort after the
 * page's own stylesheets, so a page overrides a token with a more specific selector, for example
 * `:root:root { --ps-accent: … }`.
 */
export function adoptTheme(doc: Document = document): void {
  if (adopted.has(doc)) return;
  adopted.add(doc);
  const sheet = theme.styleSheet;
  if (sheet && 'adoptedStyleSheets' in doc) {
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    return;
  }
  const style = doc.createElement('style');
  style.dataset.psTheme = '';
  style.textContent = theme.cssText;
  doc.head.append(style);
}
```

- [ ] **Step 5: Adopt the tokens when core is imported**

At the top of `packages/core/src/index.ts`, after the existing imports, add:

```ts
import { adoptTheme } from './components/kit/adopt-theme';

// Every component reads --ps-* tokens from the document root (design decision 5).
if (typeof document !== 'undefined') adoptTheme();
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/adopt-theme.test.ts src/styles/styles-integrity.test.ts`
Expected: PASS. The integrity test now also discovers `theme.ts` and finds real CSS in it.

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/styles/theme.browser.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm --filter @protspace/core exec vitest --run 2>&1 | tail -4`
Expected: all files pass: 192 unit files (the baseline plus `adopt-theme.test.ts`) and 2 browser files.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/styles/theme.ts packages/core/src/styles/theme.browser.test.ts \
  packages/core/src/components/kit/adopt-theme.ts packages/core/src/components/kit/adopt-theme.test.ts packages/core/src/index.ts
git commit -m "feat(core): add --ps-* design tokens and adopt them into the document"
```

---

### Task 1.3: The web app picks up the foundation

**Files:**

- Modify: `apps/web/package.json` (dependency `@fontsource-variable/inter`)
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/index.css`
- Create: `apps/web/tests/foundation.spec.ts`

**Interfaces:**

- Consumes: the tokens from Task 1.2.
- Produces: Tailwind utilities for the tokens, for the React shell in phase 2: `bg-ps-surface`, `text-ps-text`, `border-ps-border`, `font-ps`, `text-ps-base`, `rounded-ps`, `shadow-ps-lg`, and so on (`--color-ps-*`, `--font-ps`, `--text-ps-*`, `--radius-ps*`, `--shadow-ps-*`).

- [ ] **Step 1: Write the failing e2e test**

Create `apps/web/tests/foundation.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { openExplore } from './helpers/explore';

test.describe('design foundation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('explore keeps a 16px root, adopts the tokens and self-hosts Inter', async ({ page }) => {
    const fontHosts: string[] = [];
    page.on('request', (request) => {
      const host = new URL(request.url()).host;
      if (/fonts\.(googleapis|gstatic)\.com/.test(host)) fontHosts.push(host);
    });
    await openExplore(page);
    const result = await page.evaluate(async () => {
      const faces = await document.fonts.load('13px "Inter Variable"');
      const root = getComputedStyle(document.documentElement);
      return {
        rootSize: root.fontSize,
        accent: root.getPropertyValue('--ps-accent').trim(),
        interFaces: faces.length,
      };
    });
    expect(result.rootSize).toBe('16px');
    expect(result.accent).toBe('#007ab5');
    expect(result.interFaces).toBeGreaterThan(0);
    expect(fontHosts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e foundation`
Expected: FAIL: `rootSize` is `12.528px` (the viewport-scaled root), and `interFaces` is 0.

- [ ] **Step 3: Add the font**

Run: `pnpm --filter @protspace/app add @fontsource-variable/inter@^5`

In `apps/web/src/main.tsx`, add this import before `import './index.css';`:

```ts
import '@fontsource-variable/inter';
```

- [ ] **Step 4: Edit `apps/web/src/index.css`**

Delete this block (the viewport-scaled root font size, design decision 7):

```css
/* The explorer scales its dense UI with the viewport; text pages keep the browser default. */
@media (min-width: 1380px) {
  html:has(.explore-wrapper) {
    font-size: clamp(0.75rem, 0.87vw, 1.125rem);
  }
}
```

After the `@plugin 'tailwindcss-animate';` line, add the metric-matched fallback for Inter, which limits layout shift while the font loads:

```css
/* Arial sized to Inter's metrics, so text barely moves when Inter swaps in. */
@font-face {
  font-family: 'Inter Fallback';
  src: local('Arial');
  ascent-override: 90.44%;
  descent-override: 22.52%;
  line-gap-override: 0%;
  size-adjust: 107.12%;
}
```

Inside the existing `@theme inline { … }` block, after its last entry, add the bridge to the core tokens:

```css
/* Core's --ps-* tokens (packages/core/src/styles/theme.ts), for the explore shell. */
--color-ps-surface: var(--ps-surface);
--color-ps-surface-muted: var(--ps-surface-muted);
--color-ps-surface-raised: var(--ps-surface-raised);
--color-ps-surface-hover: var(--ps-surface-hover);
--color-ps-border: var(--ps-border);
--color-ps-border-strong: var(--ps-border-strong);
--color-ps-text: var(--ps-text);
--color-ps-text-muted: var(--ps-text-muted);
--color-ps-text-faint: var(--ps-text-faint);
--color-ps-text-on-accent: var(--ps-text-on-accent);
--color-ps-accent: var(--ps-accent);
--color-ps-accent-hover: var(--ps-accent-hover);
--color-ps-accent-text: var(--ps-accent-text);
--color-ps-accent-tint: var(--ps-accent-tint);
--color-ps-focus: var(--ps-focus);
--color-ps-danger: var(--ps-danger);
--color-ps-warning: var(--ps-warning);
--color-ps-success: var(--ps-success);
--color-ps-scrim: var(--ps-scrim);
--font-ps: var(--ps-font-sans);
--text-ps-xs: var(--ps-text-xs);
--text-ps-sm: var(--ps-text-sm);
--text-ps-base: var(--ps-text-base);
--text-ps-md: var(--ps-text-md);
--text-ps-lg: var(--ps-text-lg);
--text-ps-xl: var(--ps-text-xl);
--radius-ps-sm: var(--ps-radius-sm);
--radius-ps: var(--ps-radius);
--radius-ps-lg: var(--ps-radius-lg);
--shadow-ps-sm: var(--ps-shadow-sm);
--shadow-ps-md: var(--ps-shadow-md);
--shadow-ps-lg: var(--ps-shadow-lg);
```

- [ ] **Step 5: Run the e2e test again**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e foundation`
Expected: PASS.

- [ ] **Step 6: Check the app's own tests and build**

Run: `pnpm --filter @protspace/app exec vitest --run 2>&1 | tail -4`
Expected: `Test Files  27 passed (27)`.

Run: `pnpm --filter @protspace/app build 2>&1 | tail -3`
Expected: the build succeeds, and `apps/web/dist/assets/` contains `inter-*.woff2` files.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/main.tsx apps/web/src/index.css apps/web/tests/foundation.spec.ts
git commit -m "feat(web): self-host Inter, fix the root font size, bridge --ps tokens"
```

---

### Task 1.4: Icon helper on Lucide

**Files:**

- Modify: `packages/core/package.json` (dependency `lucide`)
- Create: `packages/core/src/components/kit/icon.ts`
- Create: `packages/core/src/components/kit/icon.test.ts`
- Create: `packages/core/src/components/kit/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Produces: `icon(name: IconName, size?: IconSize): TemplateResult`; `iconMarkup(name: IconName, size?: IconSize): string`; `type IconName`; `type IconSize = 14 | 16 | 20`. Later tasks add icons to the `ICONS` map when they first need them.

- [ ] **Step 1: Add Lucide**

Run: `pnpm --filter @protspace/core add lucide@0.462.0`

Check the icon shape: `grep -n "type IconNode" packages/core/node_modules/lucide/dist/lucide.d.ts`. Expected: `type IconNode = [elementName: SVGElementType, attrs: SVGProps][];`. If instead the icons are `['svg', attrs, children]`, map `node[2]` where step 3 maps `node`.

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/components/kit/icon.test.ts`:

```ts
/** @vitest-environment jsdom */
import { render } from 'lit';
import { describe, expect, it } from 'vitest';
import { icon, iconMarkup } from './icon';

describe('icon', () => {
  it('renders a Lucide icon as an inline, decorative SVG at the requested size', () => {
    const host = document.createElement('div');
    render(icon('search', 20), host);
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.children.length).toBeGreaterThan(0);
  });

  it('defaults to 16px and reuses the same markup', () => {
    expect(iconMarkup('x')).toBe(iconMarkup('x', 16));
    expect(iconMarkup('x')).toContain('width="16"');
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/icon.test.ts`
Expected: FAIL: `Failed to resolve import "./icon"`.

- [ ] **Step 4: Write the helper**

Create `packages/core/src/components/kit/icon.ts`:

```ts
import { html, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Check, ChevronDown, Search, X } from 'lucide';

type IconNode = ReadonlyArray<
  readonly [string, Readonly<Record<string, string | number | undefined>>]
>;

// The curated set. Each phase adds the icons it first needs; explicit imports keep the bundle to them.
const ICONS = {
  check: Check,
  'chevron-down': ChevronDown,
  search: Search,
  x: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;
export type IconSize = 14 | 16 | 20;

const cache = new Map<string, string>();

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The SVG source of an icon. Icons are decorative (aria-hidden): the control around one carries
 * the accessible name. One stroke width everywhere (design decision 8).
 */
export function iconMarkup(name: IconName, size: IconSize = 16): string {
  const key = `${name}:${size}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    const children = (ICONS[name] as IconNode)
      .map(([tag, attrs]) => {
        const attributes = Object.entries(attrs)
          .filter(([attr, value]) => attr !== 'key' && value !== undefined)
          .map(([attr, value]) => `${attr}="${escapeAttr(String(value))}"`)
          .join(' ');
        return `<${tag} ${attributes}></${tag}>`;
      })
      .join('');
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" class="ps-icon" width="${size}" height="${size}" ` +
      `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
    cache.set(key, svg);
  }
  return svg;
}

/** An icon for a Lit template. The markup comes from the static Lucide set, never from input. */
export function icon(name: IconName, size: IconSize = 16): TemplateResult {
  return html`${unsafeHTML(iconMarkup(name, size))}`;
}
```

- [ ] **Step 5: Start the kit's public entry**

Create `packages/core/src/components/kit/index.ts`:

```ts
// Public kit API (design decision 8). Each kit task adds its exports here.
export { icon, type IconName, type IconSize } from './icon';
```

In `packages/core/src/index.ts`, next to the other component exports, add:

```ts
export * from './components/kit';
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/icon.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/components/kit/icon.ts \
  packages/core/src/components/kit/icon.test.ts packages/core/src/components/kit/index.ts packages/core/src/index.ts
git commit -m "feat(core): add a Lucide icon helper for the kit"
```

---

### Task 1.5: Layer stack

**Files:**

- Create: `packages/core/src/components/kit/layers.ts`
- Create: `packages/core/src/components/kit/layers.test.ts`
- Create: `packages/core/src/components/kit/focus.ts`
- Modify: `packages/core/src/components/kit/index.ts`

**Interfaces:**

- Produces:
  - `interface Layer { close(): void; readonly elements: readonly Element[]; readonly dismissOnOutsidePress?: boolean }`
  - `pushLayer(layer: Layer): () => void` (the returned function releases the layer; calling it twice is safe)
  - `topLayer(): Layer | undefined`
  - `onEscapeFallback(order: number, handle: (event: KeyboardEvent) => boolean): () => void`
  - `ESCAPE_ORDER = { connectors: 10, selection: 20 }`
  - `deepActiveElement(): HTMLElement | null` and `flatContains(container: Node, node: Node | null): boolean` (`kit/focus.ts`). `flatContains` walks the flat tree (slot assignments and shadow hosts), so content slotted through several shadow roots still counts as inside.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/kit/layers.test.ts`:

```ts
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESCAPE_ORDER, onEscapeFallback, pushLayer, topLayer, type Layer } from './layers';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

function open(elements: Element[] = [], extra: Partial<Layer> = {}) {
  const close = vi.fn();
  const layer: Layer = { close, elements, ...extra };
  const release = pushLayer(layer);
  cleanups.push(release);
  return { layer, close, release };
}
function element(): HTMLElement {
  return document.body.appendChild(document.createElement('div'));
}
function escape(target: EventTarget = document.body): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}
function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, composed: true }));
}

describe('Escape', () => {
  it('closes only the top layer', () => {
    const lower = open();
    const upper = open();
    escape();
    expect(upper.close).toHaveBeenCalledOnce();
    expect(lower.close).not.toHaveBeenCalled();
  });

  it('reaches the next layer once the top one is released', () => {
    const lower = open();
    const upper = open();
    upper.release();
    upper.release();
    expect(topLayer()).toBe(lower.layer);
    escape();
    expect(lower.close).toHaveBeenCalledOnce();
  });

  it('runs the fallbacks in ascending order when no layer is open, stopping at the first that handles it', () => {
    const calls: string[] = [];
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, () => (calls.push('selection'), true)));
    cleanups.push(
      onEscapeFallback(ESCAPE_ORDER.connectors, () => (calls.push('connectors'), false)),
    );
    escape();
    expect(calls).toEqual(['connectors', 'selection']);
  });

  it('does not reach the fallbacks while a layer is open', () => {
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    open();
    escape();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('stops the key from reaching the page while it closes a layer', () => {
    const pageHandler = vi.fn();
    document.body.addEventListener('keydown', pageHandler);
    open();
    escape();
    expect(pageHandler).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', pageHandler);
  });
});

describe('outside press', () => {
  it('closes the top layer when the press starts and ends outside it', () => {
    const inside = element();
    const outside = element();
    const { close } = open([inside]);
    press(outside);
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the layer open for a drag that starts inside and ends outside', () => {
    const inside = element();
    const outside = element();
    const { close } = open([inside]);
    press(inside, outside);
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps the layer open when the press starts outside and ends inside', () => {
    const inside = element();
    const outside = element();
    const { close } = open([inside]);
    press(outside, inside);
    expect(close).not.toHaveBeenCalled();
  });

  it('counts elements inside a shadow root as inside the layer', () => {
    const host = element();
    const button = host
      .attachShadow({ mode: 'open' })
      .appendChild(document.createElement('button'));
    const { close } = open([host]);
    press(button);
    expect(close).not.toHaveBeenCalled();
  });

  it('ignores outside presses for a layer that opts out', () => {
    const { close } = open([element()], { dismissOnOutsidePress: false });
    press(element());
    expect(close).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/layers.test.ts`
Expected: FAIL: `Failed to resolve import "./layers"`.

- [ ] **Step 3: Write the layer stack**

Create `packages/core/src/components/kit/layers.ts`:

```ts
/**
 * One stack of open layers (popovers, menus, dialogs, sheets) for the whole page (design decision
 * 11). Escape closes only the top layer. With no layer open, Escape goes to the registered
 * fallbacks in ascending order (EAT connectors, then the selection), and the first that handles it
 * wins. A press that starts and ends outside the top layer closes it, so a drag that ends outside
 * closes nothing.
 */
export interface Layer {
  /** Closes the layer. The owner then calls the release function pushLayer returned. */
  close(): void;
  /** Elements that belong to the layer, including its anchor; a press on them is not outside. */
  readonly elements: readonly Element[];
  /** Close on a press that starts and ends outside the layer. Defaults to true. */
  readonly dismissOnOutsidePress?: boolean;
}

/** Order of the Escape fallbacks when no layer is open; lower runs first. */
export const ESCAPE_ORDER = { connectors: 10, selection: 20 } as const;

interface Fallback {
  readonly order: number;
  readonly handle: (event: KeyboardEvent) => boolean;
}

const stack: Layer[] = [];
const fallbacks: Fallback[] = [];
let pressStartedOutside = false;
let installed = false;

/** Opens a layer on top of the stack. Returns its release function, safe to call more than once. */
export function pushLayer(layer: Layer): () => void {
  install();
  stack.push(layer);
  return () => {
    const index = stack.indexOf(layer);
    if (index !== -1) stack.splice(index, 1);
  };
}

export function topLayer(): Layer | undefined {
  return stack[stack.length - 1];
}

/** Registers what Escape does when no layer is open. `handle` returns true when it acted. */
export function onEscapeFallback(
  order: number,
  handle: (event: KeyboardEvent) => boolean,
): () => void {
  install();
  const entry: Fallback = { order, handle };
  fallbacks.push(entry);
  fallbacks.sort((a, b) => a.order - b.order);
  return () => {
    const index = fallbacks.indexOf(entry);
    if (index !== -1) fallbacks.splice(index, 1);
  };
}

function isInside(layer: Layer, event: Event): boolean {
  const path = event.composedPath();
  return layer.elements.some((el) => path.includes(el));
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing) return;
  const top = topLayer();
  if (top) {
    event.preventDefault();
    event.stopImmediatePropagation();
    top.close();
    return;
  }
  for (const fallback of [...fallbacks]) {
    if (fallback.handle(event)) {
      event.preventDefault();
      return;
    }
  }
}

function onPointerDown(event: Event): void {
  const top = topLayer();
  pressStartedOutside = !!top && top.dismissOnOutsidePress !== false && !isInside(top, event);
}

function onPointerUp(event: Event): void {
  const top = topLayer();
  const close = pressStartedOutside && !!top && !isInside(top, event);
  pressStartedOutside = false;
  if (close) top!.close();
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Capture on window runs before any component's own handler.
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);
}
```

Create `packages/core/src/components/kit/focus.ts`:

```ts
/** The focused element, looking through open shadow roots. */
export function deepActiveElement(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el as HTMLElement | null;
}

/**
 * Whether `node` renders inside `container`, following slot assignments and shadow hosts. A menu
 * item slotted through ps-menu into ps-popover is inside the popover, though not its DOM child.
 */
export function flatContains(container: Node, node: Node | null): boolean {
  while (node) {
    if (node === container) return true;
    node = (node as Element).assignedSlot ?? node.parentNode ?? (node as ShadowRoot).host ?? null;
  }
  return false;
}
```

Append to `packages/core/src/components/kit/index.ts`:

```ts
export { ESCAPE_ORDER, onEscapeFallback, pushLayer, topLayer, type Layer } from './layers';
```

(`focus.ts` is internal; its first consumer arrives in Task 1.7. To keep knip quiet until then, add these tests to `layers.test.ts`:)

```ts
import { deepActiveElement, flatContains } from './focus';

describe('focus helpers', () => {
  it('find the focused element inside a shadow root', () => {
    const host = element();
    const input = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('input'));
    input.focus();
    expect(deepActiveElement()).toBe(input);
  });

  it('count content slotted through two shadow roots as inside the inner host', () => {
    // outer host renders <inner-host><div><slot></slot></div></inner-host>; inner host slots its child.
    const outer = element();
    const item = outer.appendChild(document.createElement('span'));
    const innerHost = outer
      .attachShadow({ mode: 'open' })
      .appendChild(document.createElement('div'));
    innerHost
      .appendChild(document.createElement('div'))
      .appendChild(document.createElement('slot'));
    innerHost.attachShadow({ mode: 'open' }).appendChild(document.createElement('slot'));
    expect(flatContains(innerHost, item)).toBe(true);
    expect(flatContains(innerHost, element())).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/layers.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/components/kit/layers.ts packages/core/src/components/kit/layers.test.ts \
  packages/core/src/components/kit/focus.ts packages/core/src/components/kit/index.ts
git commit -m "feat(core): add the layer stack that owns Escape and outside presses"
```

---

### Task 1.6: Positioning helper, buttons and tooltip

**Files:**

- Modify: `packages/core/package.json` (dependency `@floating-ui/dom`)
- Create: `packages/core/src/components/kit/position.ts`
- Create: `packages/core/src/components/kit/kit-shared.styles.ts`
- Create: `packages/core/src/components/kit/button.styles.ts`
- Create: `packages/core/src/components/kit/button.ts`
- Create: `packages/core/src/components/kit/tooltip.styles.ts`
- Create: `packages/core/src/components/kit/tooltip.ts`
- Create: `packages/core/src/components/kit/button.browser.test.ts`
- Modify: `packages/core/src/components/kit/index.ts`

**Interfaces:**

- Consumes: `icon` (Task 1.4); the tokens (Task 1.2).
- Produces:
  - `anchorTo(anchor: Element, floating: HTMLElement, placement: Placement, gap?: number): () => void` (`kit/position.ts`; returns the stop function); `type Placement` re-exported from Floating UI.
  - `focusRing`, `kitHost`, `reducedMotion` (`kit-shared.styles.ts`)
  - `<ps-button variant="primary|secondary|ghost|danger" size="sm|md" disabled>` with slots `start`, default, `end`; class `PsButton`.
  - `<ps-icon-button icon label variant size disabled .pressed>`; class `PsIconButton`. `label` is required; it becomes the inner button's `aria-label` and the tooltip.
  - `<ps-tooltip text placement .anchor>`; class `PsTooltip`. It anchors to `anchor`, or else to its previous element sibling. It shows after 500 ms of hover or at once on keyboard focus, and hides on leave, blur or Escape.

- [ ] **Step 1: Add Floating UI**

Run: `pnpm --filter @protspace/core add @floating-ui/dom@^1`

- [ ] **Step 2: Write the failing tests**

Create `packages/core/src/components/kit/button.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsButton, PsIconButton } from './button';
import './button';

beforeAll(() => adoptTheme());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function mount<T extends HTMLElement & { updateComplete: Promise<unknown> }>(
  markup: string,
): Promise<T> {
  document.body.innerHTML = markup;
  const el = document.body.firstElementChild as T;
  await el.updateComplete;
  return el;
}
const inner = (host: Element) => host.shadowRoot!.querySelector('button')!;
const tip = (host: Element) =>
  host.shadowRoot!.querySelector('ps-tooltip')!.shadowRoot!.querySelector('.tip')!;

describe('ps-button', () => {
  it('renders a native button that reports clicks', async () => {
    const el = await mount<PsButton>('<ps-button variant="primary">Export</ps-button>');
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    inner(el).click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(inner(el).type).toBe('button');
  });

  it('reports no clicks while disabled', async () => {
    const el = await mount<PsButton>('<ps-button disabled>Export</ps-button>');
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    inner(el).click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('takes the primary fill from the tokens', async () => {
    const el = await mount<PsButton>('<ps-button variant="primary">Export</ps-button>');
    expect(getComputedStyle(inner(el)).backgroundColor).toBe('rgb(0, 122, 181)');
  });
});

describe('ps-icon-button', () => {
  it('uses its label as the accessible name', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    expect(inner(el).getAttribute('aria-label')).toBe('Close');
    expect(inner(el).querySelector('svg')).not.toBeNull();
  });

  it('reports a toggle state through aria-pressed only when pressed is set', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="search" label="Search"></ps-icon-button>',
    );
    expect(inner(el).hasAttribute('aria-pressed')).toBe(false);
    el.pressed = true;
    await el.updateComplete;
    expect(inner(el).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows its label as a tooltip on keyboard focus and hides it on Escape', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    await userEvent.tab();
    expect(tip(el).matches(':popover-open')).toBe(true);
    expect(tip(el).textContent).toBe('Close');
    await userEvent.keyboard('{Escape}');
    expect(tip(el).matches(':popover-open')).toBe(false);
  });

  it('shows the tooltip after 500ms of hover and hides it when the pointer leaves', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    inner(el).dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(499);
    expect(tip(el).matches(':popover-open')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tip(el).matches(':popover-open')).toBe(true);
    inner(el).dispatchEvent(new PointerEvent('pointerleave'));
    expect(tip(el).matches(':popover-open')).toBe(false);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/button.browser.test.ts`
Expected: FAIL: `Failed to resolve import "./button"`.

- [ ] **Step 4: Write the positioning helper and shared styles**

Create `packages/core/src/components/kit/position.ts`:

```ts
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';

export type { Placement };

/**
 * Keeps a top-layer element next to its anchor until the returned function runs. Fixed
 * positioning is what a top-layer element needs; flip and shift keep it on screen.
 */
export function anchorTo(
  anchor: Element,
  floating: HTMLElement,
  placement: Placement,
  gap = 6,
): () => void {
  const update = () =>
    computePosition(anchor, floating, {
      placement,
      strategy: 'fixed',
      middleware: [offset(gap), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
    });
  return autoUpdate(anchor, floating, update);
}
```

Create `packages/core/src/components/kit/kit-shared.styles.ts`:

```ts
import { css } from 'lit';

/** Font and colour every kit element starts from. */
export const kitHost = css`
  :host {
    font-family: var(--ps-font-sans);
    font-size: var(--ps-text-base);
    line-height: var(--ps-leading-tight);
    color: var(--ps-text);
  }
`;

/** The one keyboard focus ring (design decision 8). */
export const focusRing = css`
  :focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }
  @media (forced-colors: active) {
    :focus-visible {
      outline-color: Highlight;
    }
  }
`;

/** Kit animations stop for people who asked for less motion. */
export const reducedMotion = css`
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition-duration: 0ms !important;
      animation-duration: 0ms !important;
    }
  }
`;
```

- [ ] **Step 5: Write the button styles and elements**

Create `packages/core/src/components/kit/button.styles.ts`:

```ts
import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from './kit-shared.styles';

export const buttonStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--ps-space-1-5);
      height: var(--ps-control-md);
      padding: 0 var(--ps-space-3);
      border: 1px solid transparent;
      border-radius: var(--ps-radius);
      background: transparent;
      color: var(--ps-text);
      font: inherit;
      font-weight: var(--ps-weight-medium);
      white-space: nowrap;
      cursor: pointer;
      transition:
        background-color var(--ps-duration-fast) var(--ps-ease),
        border-color var(--ps-duration-fast) var(--ps-ease),
        color var(--ps-duration-fast) var(--ps-ease);
    }
    :host([size='sm']) button {
      height: var(--ps-control-sm);
      padding: 0 var(--ps-space-2);
    }
    :host([variant='primary']) button {
      background: var(--ps-accent);
      color: var(--ps-text-on-accent);
    }
    :host([variant='primary']) button:hover:not(:disabled) {
      background: var(--ps-accent-hover);
    }
    :host([variant='secondary']) button,
    :host([variant='danger']) button {
      background: var(--ps-surface);
      border-color: var(--ps-border-strong);
    }
    :host([variant='danger']) button {
      color: var(--ps-danger);
    }
    :host([variant='ghost']) button {
      color: var(--ps-text-muted);
    }
    :host([variant='secondary']) button:hover:not(:disabled),
    :host([variant='danger']) button:hover:not(:disabled),
    :host([variant='ghost']) button:hover:not(:disabled) {
      background: var(--ps-surface-hover);
    }
    button[aria-pressed='true'] {
      background: var(--ps-accent-tint);
      color: var(--ps-accent-text);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .icon-only {
      width: var(--ps-control-md);
      padding: 0;
    }
    :host([size='sm']) .icon-only {
      width: var(--ps-control-sm);
      padding: 0;
    }
    @media (pointer: coarse) {
      button {
        min-height: var(--ps-touch-target);
      }
      .icon-only {
        min-width: var(--ps-touch-target);
      }
    }
  `,
];
```

Create `packages/core/src/components/kit/button.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { buttonStyles } from './button.styles';
import { icon, type IconName } from './icon';
import './tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/** A text button. Put an icon in the `start` slot. */
@customElement('ps-button')
export class PsButton extends LitElement {
  static styles = buttonStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ reflect: true }) variant: ButtonVariant = 'secondary';
  @property({ reflect: true }) size: ButtonSize = 'md';
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html`<button part="button" type="button" ?disabled=${this.disabled}>
      <slot name="start"></slot><slot></slot><slot name="end"></slot>
    </button>`;
  }
}

/** An icon-only button. `label` is required: it is the accessible name and the tooltip. */
@customElement('ps-icon-button')
export class PsIconButton extends LitElement {
  static styles = buttonStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property() icon: IconName = 'x';
  @property() label = '';
  @property({ reflect: true }) variant: ButtonVariant = 'ghost';
  @property({ reflect: true }) size: ButtonSize = 'md';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Set for toggles such as the plot's tools; leave unset for plain actions. */
  @property({ type: Boolean }) pressed?: boolean;

  render() {
    if (!this.label) console.warn(`<ps-icon-button icon="${this.icon}"> needs a label`);
    return html`<button
        part="button"
        class="icon-only"
        type="button"
        aria-label=${this.label}
        aria-pressed=${this.pressed === undefined ? nothing : String(this.pressed)}
        ?disabled=${this.disabled}
      >
        ${icon(this.icon, this.size === 'sm' ? 14 : 16)}
      </button>
      <ps-tooltip text=${this.label}></ps-tooltip>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-button': PsButton;
    'ps-icon-button': PsIconButton;
  }
}
```

- [ ] **Step 6: Write the tooltip**

Create `packages/core/src/components/kit/tooltip.styles.ts`:

```ts
import { css } from 'lit';

export const tooltipStyles = css`
  :host {
    display: contents;
  }
  .tip {
    position: fixed;
    inset: auto;
    margin: 0;
    max-width: 280px;
    padding: var(--ps-space-1) var(--ps-space-2);
    border: 0;
    border-radius: var(--ps-radius);
    background: var(--ps-tooltip-bg);
    color: var(--ps-tooltip-text);
    font-family: var(--ps-font-sans);
    font-size: var(--ps-text-sm);
    line-height: var(--ps-leading-tight);
    box-shadow: var(--ps-shadow-md);
    pointer-events: none;
  }
`;
```

Create `packages/core/src/components/kit/tooltip.ts`:

```ts
import { LitElement, html, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { anchorTo, type Placement } from './position';
import { tooltipStyles } from './tooltip.styles';

const HOVER_DELAY_MS = 500;

/**
 * A short label for a control. It replaces native `title` tooltips (design decision 8). It is not a
 * layer: Escape hides it without being consumed.
 */
@customElement('ps-tooltip')
export class PsTooltip extends LitElement {
  static styles = tooltipStyles;

  @property() text = '';
  @property() placement: Placement = 'top';
  /** The described element; defaults to the previous element sibling. */
  @property({ attribute: false }) anchor: Element | null = null;

  @query('.tip') private tip!: HTMLElement;
  private target: Element | null = null;
  private timer = 0;
  private stopPositioning?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    queueMicrotask(() => this.bind());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.hide();
    this.unbind();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('anchor')) this.bind();
  }

  render() {
    return html`<div class="tip" part="tip" popover="manual" role="tooltip">${this.text}</div>`;
  }

  show(): void {
    if (!this.text || !this.target || !this.isConnected) return;
    if (!this.tip.matches(':popover-open')) this.tip.showPopover();
    this.stopPositioning ??= anchorTo(this.target, this.tip, this.placement);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.stopPositioning?.();
    this.stopPositioning = undefined;
    if (this.tip?.matches(':popover-open')) this.tip.hidePopover();
  }

  private bind(): void {
    const next = this.anchor ?? this.previousElementSibling;
    if (next === this.target) return;
    this.unbind();
    this.target = next;
    next?.addEventListener('pointerenter', this.onEnter);
    next?.addEventListener('pointerleave', this.onLeave);
    next?.addEventListener('focusin', this.onFocus);
    next?.addEventListener('focusout', this.onLeave);
    next?.addEventListener('keydown', this.onKeydown);
  }

  private unbind(): void {
    this.target?.removeEventListener('pointerenter', this.onEnter);
    this.target?.removeEventListener('pointerleave', this.onLeave);
    this.target?.removeEventListener('focusin', this.onFocus);
    this.target?.removeEventListener('focusout', this.onLeave);
    this.target?.removeEventListener('keydown', this.onKeydown);
    this.target = null;
  }

  private onEnter = () => {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(), HOVER_DELAY_MS);
  };

  private onLeave = () => this.hide();

  private onFocus = (event: Event) => {
    if ((event.target as Element).matches(':focus-visible')) this.show();
  };

  private onKeydown = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape') this.hide();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-tooltip': PsTooltip;
  }
}
```

Append to `packages/core/src/components/kit/index.ts`:

```ts
export { PsButton, PsIconButton, type ButtonSize, type ButtonVariant } from './button';
export { PsTooltip } from './tooltip';
export type { Placement } from './position';
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/button.browser.test.ts`
Expected: PASS, 7 tests.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/styles-integrity.test.ts`
Expected: PASS. The integrity test now also covers the three new `*.styles.ts` modules.

- [ ] **Step 8: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/components/kit
git commit -m "feat(core): add ps-button, ps-icon-button and ps-tooltip to the kit"
```

---

### Task 1.7: `ps-popover`

**Files:**

- Create: `packages/core/src/components/kit/popover.styles.ts`
- Create: `packages/core/src/components/kit/popover.ts`
- Create: `packages/core/src/components/kit/popover.browser.test.ts`
- Modify: `packages/core/src/components/kit/index.ts`

**Interfaces:**

- Consumes: `anchorTo`, `pushLayer`, `deepActiveElement`, `kitHost`, `reducedMotion`.
- Produces: `<ps-popover .anchor open placement panel-role panel-label>`; class `PsPopover`.
  - The owner sets `open`. The popover dispatches `ps-open` (bubbles, composed) after opening and `ps-close` after closing itself on Escape or an outside press.
  - `dismiss(): void` closes it and dispatches `ps-close`.
  - The panel's role defaults to `dialog`; `ps-menu` sets it to `none` or `dialog`.
  - CSS part `panel`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/kit/popover.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adoptTheme } from './adopt-theme';
import { ESCAPE_ORDER, onEscapeFallback } from './layers';
import type { PsPopover } from './popover';
import './popover';

beforeAll(() => adoptTheme());
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (pop: PsPopover) => {
  await pop.updateComplete;
  await frame();
  await frame();
};
const panel = (pop: PsPopover) => pop.shadowRoot!.querySelector('.panel') as HTMLElement;
function escape(): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}
function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

async function setup() {
  document.body.innerHTML = `
    <div class="clip" style="overflow: hidden; transform: translateX(0); width: 140px; height: 40px">
      <button id="anchor">Open</button>
      <ps-popover><p id="content">Panel content</p><button id="inside">Inside</button></ps-popover>
    </div>
    <button id="outside">Outside</button>`;
  const anchor = document.getElementById('anchor')!;
  const pop = document.querySelector('ps-popover')!;
  pop.anchor = anchor;
  await pop.updateComplete;
  return { anchor, pop };
}

describe('ps-popover', () => {
  it('opens in the top layer, where an ancestor with overflow and a transform cannot clip it', async () => {
    const { pop } = await setup();
    pop.open = true;
    await settle(pop);
    expect(panel(pop).matches(':popover-open')).toBe(true);
    const clip = document.querySelector('.clip')!.getBoundingClientRect();
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.bottom).toBeGreaterThan(clip.bottom);
    const hit = document.elementFromPoint(rect.left + 10, rect.bottom - 10);
    expect(hit?.closest('ps-popover')).toBe(pop);
  });

  it('sits next to its anchor', async () => {
    const { anchor, pop } = await setup();
    pop.open = true;
    await settle(pop);
    expect(panel(pop).getBoundingClientRect().top).toBeCloseTo(
      anchor.getBoundingClientRect().bottom + 6,
      0,
    );
  });

  it('flips and shifts to stay on screen at the bottom-right corner', async () => {
    const { anchor, pop } = await setup();
    // Outside the transformed .clip: a transformed ancestor would make `fixed` relative to itself.
    document.body.append(anchor);
    anchor.style.cssText = 'position: fixed; right: 0; bottom: 0';
    pop.open = true;
    await settle(pop);
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(rect.top).toBeGreaterThanOrEqual(0);
  });

  it('closes on Escape, tells the owner, and returns focus to the anchor', async () => {
    const { anchor, pop } = await setup();
    const onClose = vi.fn();
    pop.addEventListener('ps-close', onClose);
    anchor.focus();
    pop.open = true;
    await settle(pop);
    document.getElementById('inside')!.focus();
    escape();
    await settle(pop);
    expect(pop.open).toBe(false);
    expect(panel(pop).matches(':popover-open')).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on a press outside but not on a drag that started inside or a press on the anchor', async () => {
    const { anchor, pop } = await setup();
    pop.open = true;
    await settle(pop);
    press(document.getElementById('inside')!, document.getElementById('outside')!);
    press(anchor);
    expect(pop.open).toBe(true);
    press(document.getElementById('outside')!);
    expect(pop.open).toBe(false);
  });

  it('releases its layer when removed while open', async () => {
    const { pop } = await setup();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    pop.open = true;
    await settle(pop);
    pop.remove();
    escape();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('closes cleanly when its anchor was removed, leaving focus on the body', async () => {
    const { anchor, pop } = await setup();
    anchor.focus();
    pop.open = true;
    await settle(pop);
    document.getElementById('inside')!.focus();
    anchor.remove();
    pop.open = false;
    await settle(pop);
    expect(panel(pop).matches(':popover-open')).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps exactly one layer through rapid open and close', async () => {
    const { pop } = await setup();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    pop.open = true;
    await pop.updateComplete;
    pop.open = false;
    await pop.updateComplete;
    pop.open = true;
    await settle(pop);
    escape();
    expect(pop.open).toBe(false);
    escape();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/popover.browser.test.ts`
Expected: FAIL: `Failed to resolve import "./popover"`.

- [ ] **Step 3: Write the styles and the element**

Create `packages/core/src/components/kit/popover.styles.ts`:

```ts
import { css } from 'lit';
import { kitHost, reducedMotion } from './kit-shared.styles';

export const popoverStyles = [
  kitHost,
  reducedMotion,
  css`
    :host {
      display: contents;
    }
    .panel {
      position: fixed;
      inset: auto;
      margin: 0;
      box-sizing: border-box;
      min-width: 160px;
      max-width: min(360px, calc(100vw - 16px));
      max-height: min(480px, calc(100vh - 16px));
      overflow: auto;
      padding: 0;
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      color: var(--ps-text);
      box-shadow: var(--ps-shadow-lg);
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
      opacity: 0;
      translate: 0 -2px;
      transition:
        opacity var(--ps-duration-fast) var(--ps-ease),
        translate var(--ps-duration-fast) var(--ps-ease),
        overlay var(--ps-duration-fast) allow-discrete,
        display var(--ps-duration-fast) allow-discrete;
    }
    .panel:popover-open {
      opacity: 1;
      translate: 0 0;
    }
    @starting-style {
      .panel:popover-open {
        opacity: 0;
        translate: 0 -2px;
      }
    }
  `,
];
```

Create `packages/core/src/components/kit/popover.ts`:

```ts
import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { deepActiveElement, flatContains } from './focus';
import { pushLayer } from './layers';
import { popoverStyles } from './popover.styles';
import { anchorTo, type Placement } from './position';

/**
 * An anchored panel in the top layer. The owner sets `open`; the popover closes itself on Escape
 * or an outside press and then dispatches `ps-close`.
 */
@customElement('ps-popover')
export class PsPopover extends LitElement {
  static styles = popoverStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property() placement: Placement = 'bottom-start';
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: 'panel-role' }) panelRole = 'dialog';
  @property({ attribute: 'panel-label' }) panelLabel = '';

  @query('.panel') private panel!: HTMLElement;
  private releaseLayer?: () => void;
  private stopPositioning?: () => void;
  private returnFocusTo: HTMLElement | null = null;

  render() {
    return html`<div
      class="panel"
      part="panel"
      popover="manual"
      role=${this.panelRole}
      aria-label=${this.panelLabel || nothing}
    >
      <slot></slot>
    </div>`;
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('open')) {
      if (this.open) this.show();
      else this.hide();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardown();
  }

  /** Closes the popover and tells the owner. */
  dismiss(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent('ps-close', { bubbles: true, composed: true }));
  }

  private show(): void {
    if (!this.anchor || this.releaseLayer) return;
    this.returnFocusTo = deepActiveElement();
    this.panel.showPopover();
    this.stopPositioning = anchorTo(this.anchor, this.panel, this.placement);
    this.releaseLayer = pushLayer({ close: () => this.dismiss(), elements: [this, this.anchor] });
    this.dispatchEvent(new CustomEvent('ps-open', { bubbles: true, composed: true }));
  }

  private hide(): void {
    if (!this.releaseLayer) return;
    const focusWasInside = this.containsFocus();
    this.teardown();
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    if (!focusWasInside) return;
    if (target?.isConnected) target.focus();
    else (deepActiveElement() ?? document.body).blur();
  }

  private teardown(): void {
    this.stopPositioning?.();
    this.stopPositioning = undefined;
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    if (this.panel?.matches(':popover-open')) this.panel.hidePopover();
  }

  // Slotted content (a menu's items) is not a DOM child of the popover, so test the flat tree.
  private containsFocus(): boolean {
    return flatContains(this, deepActiveElement());
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-popover': PsPopover;
  }
}
```

Append to `packages/core/src/components/kit/index.ts`:

```ts
export { PsPopover } from './popover';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/popover.browser.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/components/kit
git commit -m "feat(core): add ps-popover, an anchored top-layer panel"
```

---

### Task 1.8: `ps-menu`

**Files:**

- Create: `packages/core/src/components/kit/menu.styles.ts`
- Create: `packages/core/src/components/kit/menu.ts`
- Create: `packages/core/src/components/kit/menu.browser.test.ts`
- Modify: `packages/core/src/components/kit/index.ts`

**Interfaces:**

- Consumes: `PsPopover` (`ps-open`, `ps-close`, `panel-role`, `panel-label`), `icon`, the shared styles.
- Produces:
  - `<ps-menu .anchor open placement label searchable search-placeholder>`; class `PsMenu`. It dispatches `ps-select` with `detail: { value: string; checked: boolean }`, and `ps-close` when it closes.
  - `<ps-menu-item value type="item|checkbox|radio" checked disabled>` with a default slot and an `end` slot; class `PsMenuItem`. Checkbox items toggle and keep the menu open; the other types close it.
  - `<ps-menu-label>`; class `PsMenuLabel`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/kit/menu.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adoptTheme } from './adopt-theme';
import type { PsMenu, PsMenuItem } from './menu';
import './menu';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function key(name: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true }),
  );
}
const focused = () => (document.activeElement as PsMenuItem | null)?.value;

async function setup(extra = '', attrs = '') {
  document.body.innerHTML = `
    <button id="anchor">Color by</button>
    <ps-menu label="Color by" ${attrs}>
      <ps-menu-label>UniProt</ps-menu-label>
      <ps-menu-item value="family" type="radio" checked>Protein family</ps-menu-item>
      <ps-menu-item value="species" type="radio">Species</ps-menu-item>
      <ps-menu-item value="ec" type="radio" disabled>EC number</ps-menu-item>
      <ps-menu-item value="length" type="radio">Length</ps-menu-item>
      ${extra}
    </ps-menu>`;
  const anchor = document.getElementById('anchor')!;
  const menu = document.querySelector('ps-menu') as PsMenu;
  menu.anchor = anchor;
  anchor.focus();
  menu.open = true;
  await menu.updateComplete;
  await frame();
  await frame();
  return { anchor, menu };
}

describe('ps-menu', () => {
  it('focuses the checked item when it opens', async () => {
    await setup();
    expect(focused()).toBe('family');
  });

  it('moves with the arrow keys, skips disabled items and wraps', async () => {
    await setup();
    key('ArrowDown');
    expect(focused()).toBe('species');
    key('ArrowDown');
    expect(focused()).toBe('length');
    key('ArrowDown');
    expect(focused()).toBe('family');
    key('ArrowUp');
    expect(focused()).toBe('length');
    key('Home');
    expect(focused()).toBe('family');
    key('End');
    expect(focused()).toBe('length');
  });

  it('jumps to an item by typing its first letters', async () => {
    await setup();
    key('l');
    expect(focused()).toBe('length');
  });

  it('selects with Enter, tells the owner, closes and returns focus to the anchor', async () => {
    const { anchor, menu } = await setup();
    const onSelect = vi.fn();
    menu.addEventListener('ps-select', onSelect);
    key('ArrowDown');
    key('Enter');
    await menu.updateComplete;
    await frame();
    expect(onSelect.mock.calls[0][0].detail).toEqual({ value: 'species', checked: true });
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(anchor);
    expect(menu.querySelector<PsMenuItem>('[value="family"]')!.checked).toBe(false);
  });

  it('toggles checkbox items and stays open', async () => {
    const { menu } = await setup(
      '<ps-menu-item value="tooltip" type="checkbox">Show in tooltip</ps-menu-item>',
    );
    const item = menu.querySelector<PsMenuItem>('[value="tooltip"]')!;
    item.click();
    await menu.updateComplete;
    expect(item.checked).toBe(true);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(menu.open).toBe(true);
  });

  it('exposes menu roles', async () => {
    const { menu } = await setup();
    expect(menu.querySelector('[value="species"]')!.getAttribute('role')).toBe('menuitemradio');
    const list = menu.shadowRoot!.querySelector('[role="menu"]')!;
    expect(list.getAttribute('aria-label')).toBe('Color by');
  });

  it('filters items as you type in a searchable menu', async () => {
    const { menu } = await setup('', 'searchable');
    const input = menu.shadowRoot!.querySelector('input')!;
    expect(menu.shadowRoot!.activeElement).toBe(input);
    input.value = 'spe';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await menu.updateComplete;
    const visible = [...menu.querySelectorAll<PsMenuItem>('ps-menu-item')]
      .filter((i) => !i.hidden)
      .map((i) => i.value);
    expect(visible).toEqual(['species']);
    key('ArrowDown');
    expect(focused()).toBe('species');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await menu.updateComplete;
    expect(menu.shadowRoot!.querySelector('.empty')?.textContent).toBe('No matches');
  });

  it('truncates a very long label instead of widening past the viewport', async () => {
    const { menu } = await setup(
      `<ps-menu-item value="long">${'metalloproteinase '.repeat(12)}</ps-menu-item>`,
    );
    const panel = menu
      .shadowRoot!.querySelector('ps-popover')!
      .shadowRoot!.querySelector('.panel')!;
    const rect = panel.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(360);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/menu.browser.test.ts`
Expected: FAIL: `Failed to resolve import "./menu"`.

- [ ] **Step 3: Write the styles**

Create `packages/core/src/components/kit/menu.styles.ts`:

```ts
import { css } from 'lit';
import { focusRing, kitHost } from './kit-shared.styles';

export const menuStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: contents;
    }
    ps-popover::part(panel) {
      min-width: 200px;
    }
    .items {
      display: flex;
      flex-direction: column;
      padding: var(--ps-space-1);
    }
    .search {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      margin: var(--ps-space-1) var(--ps-space-1) 0;
      padding: 0 var(--ps-space-2);
      height: var(--ps-control-sm);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      color: var(--ps-text-faint);
    }
    .search:focus-within {
      border-color: var(--ps-focus);
      box-shadow: 0 0 0 1px var(--ps-focus);
    }
    .search input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ps-text);
      font: inherit;
    }
    .empty {
      margin: 0;
      padding: var(--ps-space-2) var(--ps-space-3);
      color: var(--ps-text-muted);
    }
  `,
];

export const menuItemStyles = [
  kitHost,
  css`
    :host {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      min-height: var(--ps-row);
      padding: 0 var(--ps-space-2);
      border-radius: var(--ps-radius-sm);
      outline: none;
      cursor: default;
      user-select: none;
    }
    :host([hidden]) {
      display: none;
    }
    :host(:hover),
    :host(:focus) {
      background: var(--ps-surface-hover);
    }
    :host([aria-checked='true']) {
      color: var(--ps-accent-text);
      font-weight: var(--ps-weight-medium);
    }
    :host([disabled]) {
      color: var(--ps-text-faint);
      background: transparent;
    }
    .mark {
      display: inline-flex;
      width: 14px;
      color: var(--ps-accent-text);
    }
    .label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (pointer: coarse) {
      :host {
        min-height: var(--ps-touch-target);
      }
    }
  `,
];

export const menuLabelStyles = [
  kitHost,
  css`
    :host {
      display: block;
      padding: var(--ps-space-2) var(--ps-space-2) var(--ps-space-1);
      color: var(--ps-text-faint);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    :host([hidden]) {
      display: none;
    }
  `,
];
```

- [ ] **Step 4: Write the elements**

Create `packages/core/src/components/kit/menu.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { icon } from './icon';
import { menuItemStyles, menuLabelStyles, menuStyles } from './menu.styles';
import './popover';
import type { Placement } from './position';

export type MenuItemType = 'item' | 'checkbox' | 'radio';

const TYPEAHEAD_RESET_MS = 500;

/** One entry of a ps-menu. */
@customElement('ps-menu-item')
export class PsMenuItem extends LitElement {
  static styles = menuItemStyles;

  @property() value = '';
  @property() type: MenuItemType = 'item';
  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
  }

  protected willUpdate(): void {
    const role =
      this.type === 'checkbox'
        ? 'menuitemcheckbox'
        : this.type === 'radio'
          ? 'menuitemradio'
          : 'menuitem';
    this.setAttribute('role', role);
    if (this.type === 'item') this.removeAttribute('aria-checked');
    else this.setAttribute('aria-checked', String(this.checked));
    if (this.disabled) this.setAttribute('aria-disabled', 'true');
    else this.removeAttribute('aria-disabled');
  }

  render() {
    return html`<span class="mark"
        >${this.type !== 'item' && this.checked ? icon('check', 14) : nothing}</span
      >
      <span class="label"><slot></slot></span>
      <slot name="end"></slot>`;
  }
}

/** A caption above a group of items. */
@customElement('ps-menu-label')
export class PsMenuLabel extends LitElement {
  static styles = menuLabelStyles;

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'presentation');
  }

  render() {
    return html`<slot></slot>`;
  }
}

/** A menu in a ps-popover: arrow keys, Home and End, type-ahead, optional search. */
@customElement('ps-menu')
export class PsMenu extends LitElement {
  static styles = menuStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property() placement: Placement = 'bottom-start';
  @property() label = '';
  @property({ type: Boolean }) searchable = false;
  @property({ attribute: 'search-placeholder' }) searchPlaceholder = 'Search';

  @state() private query = '';
  @query('input') private searchInput?: HTMLInputElement;
  private typed = '';
  private typedTimer = 0;

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeydown);
    this.addEventListener('click', this.onClick);
  }

  private get items(): PsMenuItem[] {
    return [...this.querySelectorAll('ps-menu-item')];
  }

  private get navigable(): PsMenuItem[] {
    return this.items.filter((item) => !item.disabled && !item.hidden);
  }

  render() {
    const noMatches = this.searchable && this.query.trim() !== '' && this.navigable.length === 0;
    return html`<ps-popover
      .anchor=${this.anchor}
      .open=${this.open}
      placement=${this.placement}
      panel-role=${this.searchable ? 'dialog' : 'none'}
      panel-label=${this.label}
      @ps-open=${this.onOpen}
      @ps-close=${this.onPopoverClose}
    >
      ${this.searchable
        ? html`<div class="search">
            ${icon('search', 14)}
            <input
              type="search"
              .value=${this.query}
              placeholder=${this.searchPlaceholder}
              aria-label=${this.searchPlaceholder}
              @input=${this.onSearch}
            />
          </div>`
        : nothing}
      <div class="items" role="menu" aria-label=${this.label}><slot></slot></div>
      ${noMatches ? html`<p class="empty">No matches</p>` : nothing}
    </ps-popover>`;
  }

  private onOpen = (event: Event) => {
    event.stopPropagation();
    this.query = '';
    this.applyFilter();
    queueMicrotask(() => {
      if (this.searchable) this.searchInput?.focus();
      else this.focusItem(this.items.find((i) => i.checked && !i.disabled) ?? this.navigable[0]);
    });
  };

  private onPopoverClose = (event: Event) => {
    event.stopPropagation();
    this.close();
  };

  private close(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent('ps-close', { bubbles: true, composed: true }));
  }

  private onSearch = (event: Event) => {
    this.query = (event.target as HTMLInputElement).value;
    this.applyFilter();
  };

  private applyFilter(): void {
    const q = this.query.trim().toLowerCase();
    for (const item of this.items)
      item.hidden = q !== '' && !(item.textContent ?? '').toLowerCase().includes(q);
    for (const label of this.querySelectorAll('ps-menu-label')) label.hidden = q !== '';
    this.requestUpdate();
  }

  private focusItem(item: PsMenuItem | undefined): void {
    for (const each of this.items) each.tabIndex = each === item ? 0 : -1;
    item?.focus();
  }

  private onKeydown = (event: KeyboardEvent) => {
    const items = this.navigable;
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as PsMenuItem);
    const last = items.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusItem(items[current < 0 || current === last ? 0 : current + 1]);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.focusItem(items[current <= 0 ? last : current - 1]);
        return;
      case 'Home':
      case 'End':
        if (current < 0) return;
        event.preventDefault();
        this.focusItem(items[event.key === 'Home' ? 0 : last]);
        return;
      case 'Enter':
      case ' ':
        if (current < 0) return;
        event.preventDefault();
        this.activate(items[current]);
        return;
      default:
        if (
          current >= 0 &&
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          this.typeAhead(event.key, items, current);
        }
    }
  };

  private typeAhead(char: string, items: PsMenuItem[], current: number): void {
    clearTimeout(this.typedTimer);
    this.typed += char.toLowerCase();
    this.typedTimer = window.setTimeout(() => (this.typed = ''), TYPEAHEAD_RESET_MS);
    const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
    const match = ordered.find((item) =>
      (item.textContent ?? '').trim().toLowerCase().startsWith(this.typed),
    );
    if (match) this.focusItem(match);
  }

  private onClick = (event: Event) => {
    const item = (event.target as Element).closest?.('ps-menu-item');
    if (item && !item.disabled && this.contains(item)) this.activate(item);
  };

  private activate(item: PsMenuItem): void {
    if (item.type === 'checkbox') item.checked = !item.checked;
    else if (item.type === 'radio')
      for (const each of this.items) if (each.type === 'radio') each.checked = each === item;
    this.dispatchEvent(
      new CustomEvent('ps-select', {
        bubbles: true,
        composed: true,
        detail: { value: item.value, checked: item.checked },
      }),
    );
    if (item.type !== 'checkbox') this.close();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-menu': PsMenu;
    'ps-menu-item': PsMenuItem;
    'ps-menu-label': PsMenuLabel;
  }
}
```

Append to `packages/core/src/components/kit/index.ts`:

```ts
export { PsMenu, PsMenuItem, PsMenuLabel, type MenuItemType } from './menu';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/menu.browser.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/components/kit
git commit -m "feat(core): add ps-menu with keyboard navigation and search"
```

---

### Task 1.9: `ps-dialog`

**Files:**

- Create: `packages/core/src/components/kit/dialog.styles.ts`
- Create: `packages/core/src/components/kit/dialog.ts`
- Create: `packages/core/src/components/kit/dialog.browser.test.ts`
- Modify: `packages/core/src/components/kit/index.ts`

**Interfaces:**

- Consumes: `pushLayer`, `deepActiveElement`, `PsIconButton`, the shared styles; `PsMenu` in its tests.
- Produces: `<ps-dialog open heading size="sm|md|lg|full" dismissible>` with a default slot and slots `header-actions` and `footer`; class `PsDialog`.
  - It dispatches `ps-close` when it closes itself (Escape, the close button, or a press on the backdrop when `dismissible`).
  - `dismiss(): void`.
  - The element marked `autofocus` in its content gets focus on open; otherwise the dialog frame does.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/kit/dialog.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsDialog } from './dialog';
import './dialog';
import { ESCAPE_ORDER, onEscapeFallback } from './layers';
import type { PsMenu } from './menu';
import './menu';

beforeAll(() => adoptTheme());
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (el: { updateComplete: Promise<unknown> }) => {
  await el.updateComplete;
  await frame();
  await frame();
};
const nativeDialog = (d: PsDialog) => d.shadowRoot!.querySelector('dialog')!;
function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

async function setup() {
  document.body.innerHTML = `
    <button id="opener">Settings</button>
    <ps-dialog heading="Legend settings">
      <button id="menu-anchor" autofocus>Palette</button>
      <p id="text">Body text</p>
      <ps-menu label="Palette"><ps-menu-item value="kelly">Kelly</ps-menu-item></ps-menu>
      <ps-button slot="footer">Reset</ps-button>
    </ps-dialog>`;
  const opener = document.getElementById('opener')!;
  const dialog = document.querySelector('ps-dialog') as PsDialog;
  const menu = document.querySelector('ps-menu') as PsMenu;
  menu.anchor = document.getElementById('menu-anchor');
  opener.focus();
  dialog.open = true;
  await settle(dialog);
  return { opener, dialog, menu };
}

describe('ps-dialog', () => {
  it('opens as a modal dialog, labelled by its heading, with focus on the autofocus element', async () => {
    const { dialog } = await setup();
    expect(nativeDialog(dialog).matches(':modal')).toBe(true);
    expect(nativeDialog(dialog).getAttribute('aria-labelledby')).toBe('heading');
    expect(document.activeElement?.id).toBe('menu-anchor');
  });

  it('closes on a real Escape key, once, and returns focus to the opener', async () => {
    const { opener, dialog } = await setup();
    const onClose = vi.fn();
    dialog.addEventListener('ps-close', onClose);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(dialog.open).toBe(false);
    expect(nativeDialog(dialog).open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it('closes from its close button', async () => {
    const { dialog } = await setup();
    dialog
      .shadowRoot!.querySelector('ps-icon-button')!
      .shadowRoot!.querySelector('button')!
      .click();
    await settle(dialog);
    expect(dialog.open).toBe(false);
  });

  it('closes on a press on the backdrop but not inside the frame', async () => {
    const { dialog } = await setup();
    press(document.getElementById('text')!);
    expect(dialog.open).toBe(true);
    press(nativeDialog(dialog));
    expect(dialog.open).toBe(false);
  });

  it('closes a menu opened inside it first, on Escape and on a press elsewhere in the dialog', async () => {
    const { dialog, menu } = await setup();
    menu.open = true;
    await settle(menu);
    await userEvent.keyboard('{Escape}');
    await settle(menu);
    expect(menu.open).toBe(false);
    expect(dialog.open).toBe(true);
    menu.open = true;
    await settle(menu);
    press(document.getElementById('text')!);
    await settle(menu);
    expect(menu.open).toBe(false);
    expect(dialog.open).toBe(true);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(dialog.open).toBe(false);
  });

  it('releases its layer when removed while open', async () => {
    const { dialog } = await setup();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    dialog.remove();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('hides the footer when nothing is slotted into it', async () => {
    document.body.innerHTML = '<ps-dialog heading="Info"><p>Only text</p></ps-dialog>';
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    dialog.open = true;
    await settle(dialog);
    expect(dialog.shadowRoot!.querySelector('footer')!.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/dialog.browser.test.ts`
Expected: FAIL: `Failed to resolve import "./dialog"`.

- [ ] **Step 3: Write the styles and the element**

Create `packages/core/src/components/kit/dialog.styles.ts`:

```ts
import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from './kit-shared.styles';

export const dialogStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: contents;
    }
    dialog {
      box-sizing: border-box;
      width: min(480px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      padding: 0;
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      color: var(--ps-text);
      box-shadow: var(--ps-shadow-lg);
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
    }
    :host([size='sm']) dialog {
      width: min(360px, calc(100vw - 32px));
    }
    :host([size='lg']) dialog {
      width: min(720px, calc(100vw - 32px));
    }
    :host([size='full']) dialog {
      width: calc(100vw - 32px);
      height: calc(100vh - 32px);
    }
    dialog::backdrop {
      background: var(--ps-scrim);
    }
    .frame {
      display: flex;
      flex-direction: column;
      max-height: calc(100vh - 34px);
      height: 100%;
      outline: none;
    }
    header {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      padding: var(--ps-space-3) var(--ps-space-3) var(--ps-space-3) var(--ps-space-5);
      border-bottom: 1px solid var(--ps-border);
    }
    h2 {
      flex: 1;
      margin: 0;
      font-size: var(--ps-text-lg);
      font-weight: var(--ps-weight-semibold);
    }
    .body {
      flex: 1;
      overflow: auto;
      padding: var(--ps-space-5);
      line-height: var(--ps-leading-normal);
    }
    footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--ps-space-2);
      padding: var(--ps-space-3) var(--ps-space-5);
      border-top: 1px solid var(--ps-border);
    }
    footer[hidden] {
      display: none;
    }
  `,
];
```

Create `packages/core/src/components/kit/dialog.ts`:

```ts
import { LitElement, html, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import './button';
import { dialogStyles } from './dialog.styles';
import { deepActiveElement } from './focus';
import { pushLayer } from './layers';

export type DialogSize = 'sm' | 'md' | 'lg' | 'full';

/**
 * A modal window on the native <dialog>: top layer, inert background, focus kept inside. Escape and
 * backdrop presses go through the layer stack, so a menu open inside the dialog closes first.
 */
@customElement('ps-dialog')
export class PsDialog extends LitElement {
  static styles = dialogStyles;

  @property({ type: Boolean, reflect: true }) open = false;
  @property() heading = '';
  @property({ reflect: true }) size: DialogSize = 'md';
  /** A press and release on the backdrop closes the dialog. */
  @property({ type: Boolean }) dismissible = true;

  @state() private hasFooter = false;
  @query('dialog') private dialog!: HTMLDialogElement;
  @query('.frame') private frame!: HTMLElement;
  private releaseLayer?: () => void;
  private returnFocusTo: HTMLElement | null = null;

  render() {
    return html`<dialog part="dialog" aria-labelledby="heading" @cancel=${this.onCancel}>
      <div class="frame" tabindex="-1">
        <header>
          <h2 id="heading">${this.heading}</h2>
          <slot name="header-actions"></slot>
          <ps-icon-button icon="x" label="Close" @click=${this.dismiss}></ps-icon-button>
        </header>
        <div class="body"><slot></slot></div>
        <footer ?hidden=${!this.hasFooter}>
          <slot name="footer" @slotchange=${this.onFooterChange}></slot>
        </footer>
      </div>
    </dialog>`;
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('open')) {
      if (this.open) this.show();
      else this.hide();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.releaseLayer?.();
    this.releaseLayer = undefined;
  }

  /** Closes the dialog and tells the owner. */
  dismiss = (): void => {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent('ps-close', { bubbles: true, composed: true }));
  };

  private show(): void {
    if (this.releaseLayer) return;
    this.returnFocusTo = deepActiveElement();
    this.dialog.showModal();
    this.releaseLayer = pushLayer({
      close: this.dismiss,
      elements: [this.frame],
      dismissOnOutsidePress: this.dismissible,
    });
    (this.querySelector<HTMLElement>('[autofocus]') ?? this.frame).focus();
  }

  private hide(): void {
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    if (this.dialog?.open) this.dialog.close();
    if (this.returnFocusTo?.isConnected) this.returnFocusTo.focus();
    this.returnFocusTo = null;
  }

  private onCancel = (event: Event) => {
    event.preventDefault();
    this.dismiss();
  };

  private onFooterChange = (event: Event) => {
    this.hasFooter = (event.target as HTMLSlotElement).assignedElements().length > 0;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-dialog': PsDialog;
  }
}
```

Append to `packages/core/src/components/kit/index.ts`:

```ts
export { PsDialog, type DialogSize } from './dialog';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/dialog.browser.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/components/kit
git commit -m "feat(core): add ps-dialog on the native dialog element"
```

---

### Task 1.10: Form controls

**Files:**

- Create: `packages/core/src/components/kit/field.styles.ts`, `packages/core/src/components/kit/choice.styles.ts`
- Create: `packages/core/src/components/kit/input.ts`, `select.ts`, `checkbox.ts`, `switch.ts`, `segmented.ts` (all in `packages/core/src/components/kit/`)
- Create: `packages/core/src/components/kit/fields.browser.test.ts`
- Modify: `packages/core/src/components/kit/icon.ts` (add `minus`), `packages/core/src/components/kit/index.ts`

**Interfaces:**

- Consumes: `icon`, the shared styles.
- Produces. Each control dispatches `change` from its host (bubbles), and native `input` events still reach the host.
  - `<ps-input value type="text|search|number" placeholder label invalid disabled>` with slots `start` and `end`; class `PsInput`.
  - `<ps-select .options value label disabled>`, where `options: SelectOption[]` and `interface SelectOption { value: string; label: string; disabled?: boolean }`; class `PsSelect`. It renders a styled native `<select>`.
  - `<ps-checkbox checked indeterminate disabled>` with a default slot for its label; class `PsCheckbox`.
  - `<ps-switch checked disabled label>` with a default slot; class `PsSwitch`.
  - `<ps-segmented .options value label>`, where `options: SegmentedOption[]` and `interface SegmentedOption { value: string; label: string }`. Its `change` event carries `detail: { value: string }`; class `PsSegmented`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/kit/fields.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsCheckbox } from './checkbox';
import './checkbox';
import type { PsInput } from './input';
import './input';
import type { PsSegmented } from './segmented';
import './segmented';
import type { PsSelect } from './select';
import './select';
import type { PsSwitch } from './switch';
import './switch';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

async function mount<T extends HTMLElement & { updateComplete: Promise<unknown> }>(
  markup: string,
): Promise<T> {
  document.body.innerHTML = markup;
  const el = document.body.firstElementChild as T;
  await el.updateComplete;
  return el;
}

describe('ps-input', () => {
  it('keeps value in sync with typing and re-dispatches change from the host', async () => {
    const el = await mount<PsInput>('<ps-input label="Max legend items" value="13"></ps-input>');
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    const input = el.shadowRoot!.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('Max legend items');
    await userEvent.fill(input, '20');
    expect(el.value).toBe('20');
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('marks itself invalid for assistive technology', async () => {
    const el = await mount<PsInput>('<ps-input label="Size" invalid></ps-input>');
    expect(el.shadowRoot!.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('ps-select', () => {
  it('renders a native select from options and reports the new value', async () => {
    const el = await mount<PsSelect>('<ps-select label="Palette"></ps-select>');
    el.options = [
      { value: 'kelly', label: 'Kelly' },
      { value: 'okabe', label: 'Okabe-Ito' },
    ];
    el.value = 'kelly';
    await el.updateComplete;
    const select = el.shadowRoot!.querySelector('select')!;
    expect(select.options.length).toBe(2);
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    await userEvent.selectOptions(select, 'okabe');
    expect(el.value).toBe('okabe');
    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe('ps-checkbox', () => {
  it('toggles on click and clears indeterminate', async () => {
    const el = await mount<PsCheckbox>('<ps-checkbox indeterminate>Show duplicates</ps-checkbox>');
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    await userEvent.click(el.shadowRoot!.querySelector('label')!);
    expect(el.checked).toBe(true);
    expect(el.indeterminate).toBe(false);
    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe('ps-switch', () => {
  it('is a switch that toggles with Space', async () => {
    const el = await mount<PsSwitch>('<ps-switch label="Contours"></ps-switch>');
    const button = el.shadowRoot!.querySelector('button')!;
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-checked')).toBe('false');
    button.focus();
    await userEvent.keyboard(' ');
    expect(el.checked).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });
});

describe('ps-segmented', () => {
  it('is a radio group that moves with the arrow keys', async () => {
    const el = await mount<PsSegmented>('<ps-segmented label="Color by"></ps-segmented>');
    el.options = [
      { value: 'plddt', label: 'pLDDT' },
      { value: 'ted', label: 'TED domains' },
    ];
    el.value = 'plddt';
    await el.updateComplete;
    const radios = [...el.shadowRoot!.querySelectorAll('[role="radio"]')] as HTMLElement[];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    radios[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(el.value).toBe('ted');
    expect(onChange.mock.calls[0][0].detail).toEqual({ value: 'ted' });
    expect(el.shadowRoot!.activeElement).toBe(radios[1]);
  });

  it('keeps one option reachable by Tab when no value is set', async () => {
    const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
    el.options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    await el.updateComplete;
    const tabbable = [...el.shadowRoot!.querySelectorAll('[role="radio"]')].filter(
      (r) => r.getAttribute('tabindex') === '0',
    );
    expect(tabbable.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/fields.browser.test.ts`
Expected: FAIL: `Failed to resolve import "./checkbox"`.

- [ ] **Step 3: Add the `minus` icon**

In `packages/core/src/components/kit/icon.ts`, add `Minus` to the `lucide` import, and add `minus: Minus,` to `ICONS`.

- [ ] **Step 4: Write the styles**

Create `packages/core/src/components/kit/field.styles.ts`:

```ts
import { css } from 'lit';
import { focusRing, kitHost } from './kit-shared.styles';

export const fieldStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .field {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      box-sizing: border-box;
      width: 100%;
      height: var(--ps-control-md);
      padding: 0 var(--ps-space-2);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text-faint);
    }
    .field:focus-within {
      border-color: var(--ps-focus);
      box-shadow: 0 0 0 1px var(--ps-focus);
    }
    :host([invalid]) .field {
      border-color: var(--ps-danger);
    }
    :host([disabled]) .field {
      background: var(--ps-surface-muted);
    }
    input,
    select {
      flex: 1;
      min-width: 0;
      height: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ps-text);
      font: inherit;
    }
    input::placeholder {
      color: var(--ps-text-faint);
    }
    .select {
      padding: 0;
    }
    .select select {
      appearance: none;
      padding: 0 var(--ps-space-6) 0 var(--ps-space-2);
      cursor: pointer;
    }
    .select .ps-icon {
      position: absolute;
      right: var(--ps-space-2);
      pointer-events: none;
      color: var(--ps-text-muted);
    }
    @media (pointer: coarse) {
      .field {
        min-height: var(--ps-touch-target);
      }
    }
  `,
];
```

Create `packages/core/src/components/kit/choice.styles.ts`:

```ts
import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from './kit-shared.styles';

export const checkboxStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: inline-flex;
    }
    label {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-2);
      cursor: pointer;
    }
    input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: inherit;
    }
    .box {
      display: inline-grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius-sm);
      background: var(--ps-surface);
      color: var(--ps-text-on-accent);
    }
    .box .ps-icon {
      visibility: hidden;
    }
    input:checked + .box,
    input:indeterminate + .box {
      border-color: var(--ps-accent);
      background: var(--ps-accent);
    }
    input:checked + .box .ps-icon,
    input:indeterminate + .box .ps-icon {
      visibility: visible;
    }
    input:focus-visible + .box {
      outline: var(--ps-focus-width) solid var(--ps-focus);
      outline-offset: var(--ps-focus-offset);
    }
    :host([disabled]) label {
      cursor: not-allowed;
      opacity: 0.5;
    }
  `,
];

export const switchStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-2);
    }
    button {
      position: relative;
      width: 32px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: var(--ps-radius-full);
      background: var(--ps-border-strong);
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }
    button[aria-checked='true'] {
      background: var(--ps-accent);
    }
    .thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: var(--ps-radius-full);
      background: var(--ps-surface);
      box-shadow: var(--ps-shadow-sm);
      transition: translate var(--ps-duration-fast) var(--ps-ease);
    }
    button[aria-checked='true'] .thumb {
      translate: 14px 0;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  `,
];

export const segmentedStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: inline-flex;
    }
    [role='radiogroup'] {
      display: inline-flex;
      gap: var(--ps-space-0-5);
      padding: var(--ps-space-0-5);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface-muted);
    }
    button {
      height: calc(var(--ps-control-sm) - 6px);
      padding: 0 var(--ps-space-2);
      border: 0;
      border-radius: var(--ps-radius-sm);
      background: transparent;
      color: var(--ps-text-muted);
      font: inherit;
      cursor: pointer;
    }
    button[aria-checked='true'] {
      background: var(--ps-surface);
      color: var(--ps-text);
      box-shadow: var(--ps-shadow-sm);
    }
  `,
];
```

- [ ] **Step 5: Write the elements**

Create `packages/core/src/components/kit/input.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { fieldStyles } from './field.styles';

/** A text field. `label` names it when no visible label is associated. */
@customElement('ps-input')
export class PsInput extends LitElement {
  static styles = fieldStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property() value = '';
  @property() type: 'text' | 'search' | 'number' = 'text';
  @property() placeholder = '';
  @property() label = '';
  @property({ type: Boolean, reflect: true }) invalid = false;
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html`<div class="field">
      <slot name="start"></slot>
      <input
        part="input"
        .value=${live(this.value)}
        type=${this.type}
        placeholder=${this.placeholder || nothing}
        aria-label=${this.label || nothing}
        aria-invalid=${this.invalid ? 'true' : nothing}
        ?disabled=${this.disabled}
        @input=${this.onInput}
        @change=${this.onChange}
      />
      <slot name="end"></slot>
    </div>`;
  }

  private onInput = (event: Event) => {
    this.value = (event.target as HTMLInputElement).value;
  };

  // `change` does not cross the shadow boundary, so the host dispatches its own.
  private onChange = () => this.dispatchEvent(new Event('change', { bubbles: true }));
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-input': PsInput;
  }
}
```

Create `packages/core/src/components/kit/select.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fieldStyles } from './field.styles';
import { icon } from './icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A styled native <select>, so phones keep their own picker. */
@customElement('ps-select')
export class PsSelect extends LitElement {
  static styles = fieldStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ attribute: false }) options: SelectOption[] = [];
  @property() value = '';
  @property() label = '';
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html`<div class="field select">
      <select
        part="select"
        aria-label=${this.label || nothing}
        ?disabled=${this.disabled}
        @change=${this.onChange}
      >
        ${this.options.map(
          (option) =>
            html`<option
              value=${option.value}
              ?disabled=${option.disabled}
              ?selected=${option.value === this.value}
            >
              ${option.label}
            </option>`,
        )}
      </select>
      ${icon('chevron-down', 14)}
    </div>`;
  }

  private onChange = (event: Event) => {
    this.value = (event.target as HTMLSelectElement).value;
    this.dispatchEvent(new Event('change', { bubbles: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-select': PsSelect;
  }
}
```

Create `packages/core/src/components/kit/checkbox.ts`:

```ts
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { checkboxStyles } from './choice.styles';
import { icon } from './icon';

/** A checkbox with its label in the default slot. */
@customElement('ps-checkbox')
export class PsCheckbox extends LitElement {
  static styles = checkboxStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean }) indeterminate = false;
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html`<label>
      <input
        part="input"
        type="checkbox"
        .checked=${live(this.checked)}
        .indeterminate=${this.indeterminate}
        ?disabled=${this.disabled}
        @change=${this.onChange}
      />
      <span class="box">${icon(this.indeterminate ? 'minus' : 'check', 14)}</span>
      <slot></slot>
    </label>`;
  }

  private onChange = (event: Event) => {
    this.checked = (event.target as HTMLInputElement).checked;
    this.indeterminate = false;
    this.dispatchEvent(new Event('change', { bubbles: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-checkbox': PsCheckbox;
  }
}
```

Create `packages/core/src/components/kit/switch.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { switchStyles } from './choice.styles';

/** An on/off switch. `label` names it when the default slot is empty. */
@customElement('ps-switch')
export class PsSwitch extends LitElement {
  static styles = switchStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property() label = '';

  render() {
    return html`<button
        part="switch"
        type="button"
        role="switch"
        aria-checked=${String(this.checked)}
        aria-label=${this.label || nothing}
        ?disabled=${this.disabled}
        @click=${this.toggle}
      >
        <span class="thumb"></span>
      </button>
      <slot></slot>`;
  }

  private toggle = () => {
    this.checked = !this.checked;
    this.dispatchEvent(new Event('change', { bubbles: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-switch': PsSwitch;
  }
}
```

Create `packages/core/src/components/kit/segmented.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { segmentedStyles } from './choice.styles';

export interface SegmentedOption {
  value: string;
  label: string;
}

/** A small set of mutually exclusive choices: a radio group with arrow-key movement. */
@customElement('ps-segmented')
export class PsSegmented extends LitElement {
  static styles = segmentedStyles;

  @property({ attribute: false }) options: SegmentedOption[] = [];
  @property() value = '';
  @property() label = '';

  render() {
    const selected = this.options.findIndex((option) => option.value === this.value);
    return html`<div
      part="group"
      role="radiogroup"
      aria-label=${this.label || nothing}
      @keydown=${this.onKeydown}
    >
      ${this.options.map(
        (option, index) =>
          html`<button
            type="button"
            role="radio"
            aria-checked=${String(index === selected)}
            tabindex=${index === (selected < 0 ? 0 : selected) ? 0 : -1}
            data-value=${option.value}
            @click=${() => this.select(option.value)}
          >
            ${option.label}
          </button>`,
      )}
    </div>`;
  }

  private select(value: string, focus = false): void {
    if (value !== this.value) {
      this.value = value;
      this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value } }));
    }
    if (focus) {
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)?.focus(),
      );
    }
  }

  private onKeydown = (event: KeyboardEvent) => {
    const step = ['ArrowRight', 'ArrowDown'].includes(event.key)
      ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key)
        ? -1
        : 0;
    const count = this.options.length;
    if (step === 0 || count === 0) return;
    event.preventDefault();
    const current = this.options.findIndex((option) => option.value === this.value);
    const next = current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count;
    this.select(this.options[next].value, true);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-segmented': PsSegmented;
  }
}
```

Append to `packages/core/src/components/kit/index.ts`:

```ts
export { PsCheckbox } from './checkbox';
export { PsInput } from './input';
export { PsSegmented, type SegmentedOption } from './segmented';
export { PsSelect, type SelectOption } from './select';
export { PsSwitch } from './switch';
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/fields.browser.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/components/kit
git commit -m "feat(core): add input, select, checkbox, switch and segmented to the kit"
```

---

### Task 1.11: Style lint test

**Files:**

- Create: `packages/core/src/styles/style-lint.test.ts`
- Modify (only if Step 5 finds unused tokens): `packages/core/src/styles/theme.ts`

**Interfaces:**

- Consumes: `theme`; every style module under `packages/core/src`; the sources of `packages/core/src` and `apps/web/src`.
- Produces: the `LEGACY` allowlist. Every later phase deletes the lines for the modules it migrates.

- [ ] **Step 1: Write the test**

Create `packages/core/src/styles/style-lint.test.ts`:

```ts
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
  // Filled in Step 3.
]);

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:white|black)\b/i;
const CORE_SRC = fileURLToPath(new URL('..', import.meta.url));
const WEB_SRC = fileURLToPath(new URL('../../../../apps/web/src', import.meta.url));

function flatten(group: CSSResultGroup): CSSResult[] {
  return Array.isArray(group) ? group.flatMap(flatten) : [group as CSSResult];
}

function cssOf(path: string): string {
  return Object.values(MODULES[path] ?? {})
    .flatMap(flatten)
    .map((sheet) => sheet.cssText)
    .join('\n');
}

/** Declarations that hard-code a colour or a font size, or declare a token outside theme.ts. */
function cssViolations(cssText: string): string[] {
  const found: string[] = [];
  for (const [, property, raw] of cssText.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const value = raw.trim();
    const declaration = `${property}: ${value}`;
    if (property.startsWith('--ps-')) found.push(declaration);
    else if (property.startsWith('--')) continue;
    else if (COLOUR.test(value)) found.push(declaration);
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

const definedTokens = () =>
  new Set([...theme.cssText.matchAll(/(--ps-[\w-]+)\s*:/g)].map((m) => m[1]));
const paths = Object.keys(MODULES).sort();

describe('style lint', () => {
  it('flags hard-coded colours, literal font sizes and tokens declared outside theme.ts', () => {
    expect(
      cssViolations(
        '.a { color: #fff; background: rgb(0 0 0 / 0.5); font-size: 12px; --ps-text: red; }',
      ),
    ).toEqual(['color: #fff', 'background: rgb(0 0 0 / 0.5)', 'font-size: 12px', '--ps-text: red']);
    expect(
      cssViolations(
        '.a:hover { color: var(--ps-text); font-size: var(--ps-text-sm); font: inherit; --x: 1px; }',
      ),
    ).toEqual([]);
  });

  it.each(paths.filter((path) => !LEGACY.has(path)))(
    '%s reads colours and font sizes from tokens',
    (path) => {
      expect(cssViolations(cssOf(path))).toEqual([]);
    },
  );

  it('defines every --ps token a stylesheet reads', () => {
    const defined = definedTokens();
    const read = new Set(
      paths.flatMap((path) => [...cssOf(path).matchAll(/var\((--ps-[\w-]+)/g)].map((m) => m[1])),
    );
    expect([...read].filter((token) => !defined.has(token))).toEqual([]);
  });

  it('uses every token theme.ts defines', () => {
    const sources = [...sourceFiles(CORE_SRC), ...sourceFiles(WEB_SRC)]
      .filter((file) => !file.endsWith(join('styles', 'theme.ts')))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const unused = [...definedTokens()].filter(
      (token) => !new RegExp(`${token}(?![\\w-])`).test(sources),
    );
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
```

- [ ] **Step 2: Run it with an empty allowlist**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts 2>&1 | grep -E "✗|×|FAIL" | head -40`
Expected: FAIL. The failing "reads colours and font sizes from tokens" cases name the legacy modules, and no `kit/` module fails.

- [ ] **Step 3: Fill `LEGACY` with exactly the failing paths**

Replace the comment in `LEGACY` with one string per failing path from Step 2, keeping the key format (`'../components/legend/styles/item.ts'`). On 2026-10-09 a grep over the sources predicted the following list. The test run is authoritative; aggregate modules that compose a legacy sheet fail too, and a module that passes stays out.

```
../components/common/info-popover.styles.ts
../components/control-bar/annotation-select.styles.ts
../components/control-bar/control-bar.styles.ts
../components/control-bar/query-builder.styles.ts
../components/control-bar/search.styles.ts
../components/control-bar/styles/export.ts
../components/control-bar/styles/layout.ts
../components/legend/category-score-strip.styles.ts
../components/legend/legend.styles.ts
../components/legend/styles/item.ts
../components/legend/styles/layout.ts
../components/legend/styles/modal.ts
../components/legend/styles/theme.ts
../components/publish/publish-modal.styles.ts
../components/scatter-plot/projection-metadata/projection-metadata.styles.ts
../components/scatter-plot/scatter-plot.styles.ts
../components/scatter-plot/tooltips/protein-tooltip.styles.ts
../components/scatter-plot/tooltips/protspace-tips.styles.ts
../components/structure-viewer/structure-viewer.styles.ts
./mixins.ts
./overlay-mixins.ts
./tokens.ts
```

- [ ] **Step 4: Run it again**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: every case passes except, possibly, "uses every token theme.ts defines".

- [ ] **Step 5: Trim unused tokens**

If "uses every token theme.ts defines" fails, delete each listed token from `lightRoles`, `darkRoles` or `sizes` in `packages/core/src/styles/theme.ts`, and from the Tailwind bridge in `apps/web/src/index.css` if it appears there. Later phases add a token in the commit that first uses it. Then rerun:

Run: `pnpm --filter @protspace/core exec vitest --run 2>&1 | tail -4`
Expected: all unit and browser files pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/styles/style-lint.test.ts packages/core/src/styles/theme.ts apps/web/src/index.css
git commit -m "test(core): lint stylesheets for raw colours and font sizes"
```

---

### Task 1.12: Kit gallery (development builds only)

A page at `/dev/kit` that shows every kit control in both themes, for review and as an e2e target. Production builds drop it.

**Files:**

- Create: `apps/web/src/dev/KitGallery.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/custom-elements.d.ts`
- Create: `apps/web/tests/kit-gallery.spec.ts`

**Interfaces:**

- Consumes: every kit element from `@protspace/core`.
- Produces: the route `/dev/kit` (development only), and JSX typings for the `ps-*` elements, which phase 2's shell will reuse.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/web/tests/kit-gallery.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const KIT = [
  'ps-button',
  'ps-icon-button',
  'ps-tooltip',
  'ps-popover',
  'ps-menu',
  'ps-menu-item',
  'ps-menu-label',
  'ps-dialog',
  'ps-input',
  'ps-select',
  'ps-checkbox',
  'ps-switch',
  'ps-segmented',
];

test('the kit gallery shows every control in light and dark without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/dev/kit');
  await expect(page.getByRole('heading', { name: 'Kit' })).toBeVisible();
  const defined = await page.evaluate(
    (tags) => tags.filter((tag) => !customElements.get(tag)),
    KIT,
  );
  expect(defined).toEqual([]);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Species' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Legend settings' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Dark' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e kit-gallery`
Expected: FAIL: the heading "Kit" is not found, because the route does not exist yet.

- [ ] **Step 3: Type the kit elements for JSX**

In `apps/web/src/custom-elements.d.ts`, inside `interface IntrinsicElements`, add one entry per kit tag, using one shared loose type:

```ts
      'ps-button': KitElementProps;
      'ps-icon-button': KitElementProps;
      'ps-tooltip': KitElementProps;
      'ps-popover': KitElementProps;
      'ps-menu': KitElementProps;
      'ps-menu-item': KitElementProps;
      'ps-menu-label': KitElementProps;
      'ps-dialog': KitElementProps;
      'ps-input': KitElementProps;
      'ps-select': KitElementProps;
      'ps-checkbox': KitElementProps;
      'ps-switch': KitElementProps;
      'ps-segmented': KitElementProps;
```

and add, above `declare module 'react'`:

```ts
/** Kit elements take arbitrary attributes and properties; React 19 sets properties on custom elements. */
type KitElementProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement> & Record<string, unknown>,
  HTMLElement
>;
```

- [ ] **Step 4: Write the gallery**

Create `apps/web/src/dev/KitGallery.tsx`:

```tsx
import '@protspace/core';
import type { PsDialog, PsMenu, PsSegmented, PsSelect } from '@protspace/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Every kit control in one place, for review in both themes. Development builds only. */
export default function KitGallery() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const menuAnchor = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);
  const dialog = useRef<PsDialog>(null);
  const select = useRef<PsSelect>(null);
  const segmented = useRef<PsSegmented>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  useEffect(() => {
    if (menu.current) menu.current.anchor = menuAnchor.current;
    if (select.current) {
      select.current.options = [
        { value: 'kelly', label: "Kelly's colours" },
        { value: 'okabe', label: 'Okabe-Ito' },
      ];
      select.current.value = 'kelly';
    }
    if (segmented.current) {
      segmented.current.options = [
        { value: 'plddt', label: 'pLDDT' },
        { value: 'ted', label: 'TED domains' },
      ];
      segmented.current.value = 'plddt';
    }
  }, []);

  return (
    <main className="min-h-screen bg-ps-surface p-8 font-ps text-ps-base text-ps-text">
      <header className="mb-8 flex items-center gap-4">
        <h1 className="text-ps-xl font-semibold">Kit</h1>
        <ps-button size="sm" onClick={() => setTheme('light')}>
          Light
        </ps-button>
        <ps-button size="sm" onClick={() => setTheme('dark')}>
          Dark
        </ps-button>
      </header>

      <Section title="Buttons">
        <ps-button variant="primary">Export figure</ps-button>
        <ps-button variant="secondary">Import</ps-button>
        <ps-button variant="ghost">Cancel</ps-button>
        <ps-button variant="danger">Reset</ps-button>
        <ps-button variant="primary" disabled>
          Disabled
        </ps-button>
        <ps-button variant="secondary" size="sm">
          Small
        </ps-button>
        <ps-icon-button icon="search" label="Search"></ps-icon-button>
        <ps-icon-button icon="x" label="Close" variant="secondary"></ps-icon-button>
      </Section>

      <Section title="Fields">
        <ps-input
          label="Search proteins"
          type="search"
          placeholder="Search proteins or paste IDs"
        ></ps-input>
        <ps-input label="Max legend items" value="13"></ps-input>
        <ps-input label="Shape size" value="abc" invalid></ps-input>
        <ps-select ref={select} label="Palette"></ps-select>
      </Section>

      <Section title="Choices">
        <ps-checkbox checked>Show duplicate counts</ps-checkbox>
        <ps-switch label="Contours" checked></ps-switch>
        <ps-segmented ref={segmented} label="Structure colour"></ps-segmented>
      </Section>

      <Section title="Menu and dialog">
        <ps-button
          ref={menuAnchor}
          onClick={() => menu.current && (menu.current.open = !menu.current.open)}
        >
          Open menu
        </ps-button>
        <ps-menu ref={menu} label="Color by" searchable>
          <ps-menu-label>UniProt</ps-menu-label>
          <ps-menu-item value="family" type="radio" checked>
            Protein family
          </ps-menu-item>
          <ps-menu-item value="species" type="radio">
            Species
          </ps-menu-item>
          <ps-menu-item value="ec" type="radio" disabled>
            EC number
          </ps-menu-item>
          <ps-menu-label>Display</ps-menu-label>
          <ps-menu-item value="tooltip" type="checkbox">
            Show in tooltip
          </ps-menu-item>
        </ps-menu>
        <ps-button onClick={() => dialog.current && (dialog.current.open = true)}>
          Open dialog
        </ps-button>
        <ps-dialog ref={dialog} heading="Legend settings">
          <p>Changes apply as you make them.</p>
          <ps-button slot="footer" variant="danger">
            Reset
          </ps-button>
          <ps-button
            slot="footer"
            variant="primary"
            onClick={() => dialog.current && (dialog.current.open = false)}
          >
            Done
          </ps-button>
        </ps-dialog>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-ps-sm font-semibold uppercase tracking-wide text-ps-text-faint">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}
```

- [ ] **Step 5: Register the route in development builds only**

In `apps/web/src/App.tsx`, add to the imports:

```tsx
import { lazy, Suspense } from 'react';

// Development-only review page for the kit; production builds drop the import entirely.
const KitGallery = import.meta.env.DEV ? lazy(() => import('./dev/KitGallery')) : null;
```

and inside `<Routes>`, before the catch-all `*` route:

```tsx
{
  KitGallery && (
    <Route
      path="/dev/kit"
      element={
        <Suspense fallback={null}>
          <KitGallery />
        </Suspense>
      }
    />
  );
}
```

- [ ] **Step 6: Run the e2e test and check the production build**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e kit-gallery`
Expected: PASS.

Run: `pnpm --filter @protspace/app build 2>&1 | tail -3; grep -rl "Open dialog" apps/web/dist/assets || echo "gallery not in production bundle"`
Expected: the build succeeds and the last line reads `gallery not in production bundle`.

- [ ] **Step 7: Capture the gallery for review**

With a dev server on port 8476 (`pnpm --filter @protspace/app exec vite --port 8476 --strictPort`), take full-page screenshots of `http://localhost:8476/dev/kit` at 1280×900 in light and in dark (click "Dark"). Attach both to the task report. Stop the server afterwards.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/dev/KitGallery.tsx apps/web/src/App.tsx apps/web/src/custom-elements.d.ts apps/web/tests/kit-gallery.spec.ts
git commit -m "feat(web): add a development-only kit gallery at /dev/kit"
```

---

## Phase 1 exit

- [ ] `pnpm --filter @protspace/core exec vitest --run`: every unit and browser file passes (191 baseline files plus the new ones).
- [ ] `pnpm --filter @protspace/utils exec vitest --run` and `pnpm --filter @protspace/app exec vitest --run`: 21 and 27 files pass.
- [ ] `PLAYWRIGHT_PORT=8475 pnpm test:e2e`: the full e2e suite passes, including `foundation` and `kit-gallery`.
- [ ] `pnpm precommit` and `pnpm format:check` pass on the final tree.
- [ ] The explore page at 1280×800 and 1440×900 looks as before apart from the root font size. Attach screenshots to the phase report.
- [ ] Tick 1.1–1.12 in `openspec/changes/explore-workbench/tasks.md`.
