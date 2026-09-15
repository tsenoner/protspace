import { describe, expect, it } from 'vitest';
import type { CSSResult, CSSResultGroup } from 'lit';

import { annotationSelectStyles } from '../components/control-bar/annotation-select.styles';
import { controlBarStyles } from '../components/control-bar/control-bar.styles';
import { queryBuilderStyles } from '../components/control-bar/query-builder.styles';
import { searchStyles } from '../components/control-bar/search.styles';
import { dataLoaderStyles } from '../components/data-loader/data-loader.styles';
import { legendStyles } from '../components/legend/legend.styles';
import { publishModalStyles } from '../components/publish/publish-modal.styles';
import { scatterplotStyles } from '../components/scatter-plot/scatter-plot.styles';
import { structureViewerStyles } from '../components/structure-viewer/structure-viewer.styles';

/**
 * Lit's `css` is a *tagged* template, so an illegal escape sequence in it does
 * not raise — per the ES2018 template-literal revision the cooked string
 * becomes `undefined`, and the whole stylesheet silently collapses to the text
 * "undefined" or to nothing at all.
 *
 * `content: '\00b7'` did exactly that to the structure viewer: the shadow root
 * went from 37 CSS rules to 0, and every other gate stayed green — `tsc`,
 * `knip`, the full component suite and the docs build — because jsdom never
 * evaluates CSS. The component rendered completely unstyled and nothing said
 * a word.
 *
 * One assertion on `cssText` catches that entire class of mistake, for every
 * style module, at effectively no cost. Any new `*.styles.ts` belongs in the
 * table below.
 */
const STYLE_MODULES: ReadonlyArray<readonly [string, CSSResultGroup]> = [
  ['annotationSelectStyles', annotationSelectStyles],
  ['controlBarStyles', controlBarStyles],
  ['queryBuilderStyles', queryBuilderStyles],
  ['searchStyles', searchStyles],
  ['dataLoaderStyles', dataLoaderStyles],
  ['legendStyles', legendStyles],
  ['publishModalStyles', publishModalStyles],
  ['scatterplotStyles', scatterplotStyles],
  ['structureViewerStyles', structureViewerStyles],
];

/** Flatten a CSSResultGroup (a CSSResult or an arbitrarily nested array). */
function flatten(group: CSSResultGroup): CSSResult[] {
  return Array.isArray(group) ? group.flatMap(flatten) : [group as CSSResult];
}

describe('component stylesheets', () => {
  it.each(STYLE_MODULES)('%s produces real CSS', (_name, group) => {
    const sheets = flatten(group);
    expect(sheets.length).toBeGreaterThan(0);

    for (const sheet of sheets) {
      const cssText = sheet.cssText;

      // An illegal escape makes the cooked string `undefined`, which stringifies
      // into the sheet rather than throwing.
      expect(typeof cssText).toBe('string');
      expect(cssText).not.toMatch(/\bundefined\b/);

      // A sheet that parses but declares nothing is the other shape this failure
      // takes; every module here carries at least one rule.
      expect(cssText.trim()).not.toBe('');
      expect(cssText).toContain('{');
    }
  });
});
