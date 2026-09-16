/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import type { CSSResult, CSSResultGroup } from 'lit';

/**
 * Lit's `css` is a *tagged* template, so an illegal escape sequence in it does
 * not raise — per the ES2018 template-literal revision the cooked string
 * becomes `undefined`, and the whole stylesheet silently collapses to the text
 * "undefined" or to nothing at all. jsdom never evaluates CSS, so no other test
 * notices.
 *
 * Every stylesheet module is found by glob rather than listed — `*.styles.ts`,
 * the files in a component's `styles/` folder, and the shared sheets beside this
 * file — so a new one is covered the moment it exists. ESLint rejects a `css`
 * literal anywhere else in `packages/core/src`, so no sheet sits out of reach.
 */
const STYLE_MODULES = Object.entries(
  import.meta.glob<Record<string, CSSResultGroup>>(
    ['../components/**/*.styles.ts', '../components/**/styles/*.ts', './*.ts', '!./*.test.ts'],
    { eager: true },
  ),
).flatMap(([path, exports]) =>
  Object.entries(exports).map(([name, group]) => [`${path} ${name}`, group] as const),
);

/** Flatten a CSSResultGroup (a CSSResult or an arbitrarily nested array). */
function flatten(group: CSSResultGroup): CSSResult[] {
  return Array.isArray(group) ? group.flatMap(flatten) : [group as CSSResult];
}

describe('component stylesheets', () => {
  it('discovers the style modules', () => {
    // Guards the glob itself: a pattern that matches nothing would pass vacuously.
    expect(STYLE_MODULES.map(([name]) => name)).toContain(
      '../components/structure-viewer/structure-viewer.styles.ts structureViewerStyles',
    );
  });

  it.each(STYLE_MODULES)('%s produces real CSS', (_name, group) => {
    const sheets = flatten(group);
    expect(sheets.length).toBeGreaterThan(0);

    for (const sheet of sheets) {
      const cssText = sheet.cssText;

      // An illegal escape makes the cooked string `undefined`, which stringifies
      // into the sheet rather than throwing. Comments are dropped first: prose in
      // one may say "undefined", but a collapsed chunk never lands inside one.
      expect(typeof cssText).toBe('string');
      expect(cssText.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bundefined\b/);

      // A sheet that parses but declares nothing is the other shape this failure
      // takes; every module here carries at least one rule.
      expect(cssText).toContain('{');
    }
  });
});
