import { describe, it, expect } from 'vitest';
import type { VisualizationData, PlotDataPoint, AnnotationData } from '@protspace/utils';
import type { DisplayTier, VisibilityInputs, VisibilityModel } from './visibility-model';
import { computeVisibilityModel } from './visibility-model';

/**
 * Unit contract for the pure visibility model.
 *
 * Each `describe` block maps to a row of the design D5 semantics table
 * (openspec/changes/unified-visibility-model/design.md). The model must be
 * bit-for-bit identical to `createStyleGetters`' opacity semantics, so the
 * assertions below are exact (`toBe`), and the opacity tiers are deliberately
 * distinct so a tier can never silently alias another.
 *
 * Both `annotation_data` storage shapes are exercised:
 *   - Int32Array  (single-valued column; sentinel `< 0` = no value)
 *   - number[][]  (multilabel column; empty row = no value)
 */

// Distinct, non-aliasing opacities so no tier can masquerade as another.
const OPACITIES = { base: 0.8, selected: 1.0, faded: 0.2 } as const;

function makeData(
  values: (string | null)[],
  rows: AnnotationData,
  annotationKey = 'annot',
): VisualizationData {
  const n = rows.length;
  return {
    protein_ids: Array.from({ length: n }, (_, i) => `p${i}`),
    projections: [{ name: 'proj', data: new Float32Array(n * 3), dimension: 3 }],
    annotations: {
      [annotationKey]: {
        kind: 'categorical',
        values,
        colors: values.map(() => '#ff0000'),
        shapes: values.map(() => 'circle'),
      },
    },
    annotation_data: {
      [annotationKey]: rows,
    },
  };
}

function point(id: string, originalIndex: number): PlotDataPoint {
  return { id, x: 0, y: 0, originalIndex };
}

function baseInputs(overrides: Partial<VisibilityInputs> = {}): VisibilityInputs {
  return {
    data: null,
    selectedAnnotation: 'annot',
    hiddenAnnotationValues: [],
    selectedProteinIds: [],
    highlightedProteinIds: [],
    opacities: { ...OPACITIES },
    ...overrides,
  };
}

describe('computeVisibilityModel', () => {
  // ── Rule 1 — hidden ⇒ opacity exactly 0 ───────────────────────────────────
  describe('rule 1: hidden points have opacity exactly 0', () => {
    it('Int32Array: hidden value yields exactly 0 (Object.is)', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: ['A'] }));
      const op = model.opacityOf(point('p0', 0));
      expect(op).toBe(0);
    });

    it('nested array: hidden value yields exactly 0', () => {
      const data = makeData(['A', 'B'], [[0], [1]]);
      const model = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: ['A'] }));
      expect(model.opacityOf(point('p0', 0))).toBe(0);
      // non-hidden sibling keeps base opacity
      expect(model.opacityOf(point('p1', 1))).toBe(OPACITIES.base);
    });
  });

  // ── Rule 2 — hidden beats selected/highlighted ────────────────────────────
  describe('rule 2: hidden beats selection and highlight', () => {
    it('a SELECTED point whose only value is hidden → opacity 0, tier hidden', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(
        baseInputs({ data, hiddenAnnotationValues: ['A'], selectedProteinIds: ['p0'] }),
      );
      expect(model.opacityOf(point('p0', 0))).toBe(0);
      expect(model.tierOf(point('p0', 0))).toBe('hidden');
      expect(model.isInteractive(point('p0', 0))).toBe(false);
    });

    it('a HIGHLIGHTED point whose only value is hidden → opacity 0, tier hidden', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(
        baseInputs({ data, hiddenAnnotationValues: ['A'], highlightedProteinIds: ['p0'] }),
      );
      expect(model.opacityOf(point('p0', 0))).toBe(0);
      expect(model.tierOf(point('p0', 0))).toBe('hidden');
    });
  });

  // ── Rule 3 — multilabel hidden only if EVERY value hidden ──────────────────
  describe('rule 3: multilabel hidden iff every value hidden', () => {
    it('partially hidden multilabel point stays visible (base opacity)', () => {
      // p0 has values A and B; only A is hidden → still visible.
      const data = makeData(['A', 'B'], [[0, 1], [1]]);
      const model = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: ['A'] }));
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.base);
      expect(model.tierOf(point('p0', 0))).toBe('base');
    });

    it('fully hidden multilabel point → opacity 0', () => {
      // Use a third value C so the all-hidden hatch does NOT fire:
      // hide only A and B while C stays visible → p0 (values [A, B]) is fully hidden.
      const data3 = makeData(['A', 'B', 'C'], [[0, 1], [2]]);
      const model3 = computeVisibilityModel(
        baseInputs({ data: data3, hiddenAnnotationValues: ['A', 'B'] }),
      );
      expect(model3.opacityOf(point('p0', 0))).toBe(0);
    });

    it('two-value multilabel with all values hidden triggers all-hidden escape hatch', () => {
      // Hiding both A and B = every annotation value hidden → all-hidden hatch
      // rescues opacity (covered in rule 5).
      const data = makeData(['A', 'B'], [[0, 1], [1]]);
      const model = computeVisibilityModel(
        baseInputs({ data, hiddenAnnotationValues: ['A', 'B'] }),
      );
      // sanity: the two-value data triggers the hatch instead
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.base);
    });
  });

  // ── Rule 4 — vacuous truth: zero-value point hidden even with empty set ────
  describe('rule 4: vacuous truth for zero-value points', () => {
    it('Int32Array sentinel -1 → hidden even with empty hidden set', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, -1));
      const model = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: [] }));
      expect(model.opacityOf(point('p1', 1))).toBe(0);
      expect(model.tierOf(point('p1', 1))).toBe('hidden');
    });

    it('nested empty row [] → hidden even with empty hidden set', () => {
      const data = makeData(['A', 'B'], [[0], []]);
      const model = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: [] }));
      expect(model.opacityOf(point('p1', 1))).toBe(0);
    });
  });

  // ── Rule 5 — all-hidden escape hatch ──────────────────────────────────────
  describe('rule 5: all-hidden escape hatch rescues opacity (not colors)', () => {
    it('every value hidden → opacity falls back to base tier, allHidden true', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(
        baseInputs({ data, hiddenAnnotationValues: ['A', 'B'] }),
      );
      expect(model.allHidden).toBe(true);
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.base);
      expect(model.opacityOf(point('p1', 1))).toBe(OPACITIES.base);
    });

    it('all-hidden hatch still applies selection/fade tiers', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(
        baseInputs({
          data,
          hiddenAnnotationValues: ['A', 'B'],
          selectedProteinIds: ['p0'],
        }),
      );
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.selected); // selected
      expect(model.opacityOf(point('p1', 1))).toBe(OPACITIES.faded); // faded
    });
  });

  // ── Rule 6 — value normalization (toInternalValue, __NA__) ─────────────────
  describe('rule 6: value normalization — null and literal __NA__ behave identically', () => {
    it('null value and literal "__NA__" value both hidden when __NA__ hidden', () => {
      // p0 value = null, p1 value = literal "__NA__", p2 value = "real"
      const data = makeData([null, '__NA__', 'real'], Int32Array.of(0, 1, 2));
      const model = computeVisibilityModel(
        baseInputs({ data, hiddenAnnotationValues: ['__NA__'] }),
      );
      expect(model.opacityOf(point('p0', 0))).toBe(0); // null → __NA__
      expect(model.opacityOf(point('p1', 1))).toBe(0); // literal __NA__
      expect(model.opacityOf(point('p2', 2))).toBe(OPACITIES.base); // real, visible
    });
  });

  // ── Rule 7 — selection fading ──────────────────────────────────────────────
  describe('rule 7: selection fading; highlight never fades others', () => {
    it('non-empty selection fades non-selected; selected gets selected opacity', () => {
      const data = makeData(['A', 'B', 'C'], Int32Array.of(0, 1, 2));
      const model = computeVisibilityModel(baseInputs({ data, selectedProteinIds: ['p0'] }));
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.selected);
      expect(model.opacityOf(point('p1', 1))).toBe(OPACITIES.faded);
      expect(model.tierOf(point('p1', 1))).toBe('faded');
    });

    it('highlight-only: highlighted gets selected opacity, others stay base (no fade)', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(
        baseInputs({ data, highlightedProteinIds: ['p0'], selectedProteinIds: [] }),
      );
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.selected);
      expect(model.opacityOf(point('p1', 1))).toBe(OPACITIES.base); // NOT faded
      expect(model.tierOf(point('p1', 1))).toBe('base');
    });
  });

  // ── Rule 8 — baseOpacityOf ignores hidden (feeds depth) ───────────────────
  describe('rule 8: baseOpacityOf ignores hidden state', () => {
    it('hidden point reports base opacity from baseOpacityOf, but 0 from opacityOf', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const hidden = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: ['A'] }));
      const visible = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: [] }));
      // baseOpacityOf is identical whether or not the value is hidden.
      expect(hidden.baseOpacityOf(point('p0', 0))).toBe(OPACITIES.base);
      expect(hidden.baseOpacityOf(point('p0', 0))).toBe(visible.baseOpacityOf(point('p0', 0)));
      // opacityOf still reflects hidden.
      expect(hidden.opacityOf(point('p0', 0))).toBe(0);
    });

    it('baseOpacityOf respects selection tiers independent of hidden', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(
        baseInputs({
          data,
          hiddenAnnotationValues: ['A'],
          selectedProteinIds: ['p0'],
        }),
      );
      // p0 hidden+selected: opacity 0 but base opacity = selected tier.
      expect(model.opacityOf(point('p0', 0))).toBe(0);
      expect(model.baseOpacityOf(point('p0', 0))).toBe(OPACITIES.selected);
    });
  });

  // ── Rule 9 — "Other" never affects opacity ─────────────────────────────────
  describe('rule 9: "Other" bucket has no effect on opacity', () => {
    it('VisibilityInputs has no otherAnnotationValues input — opacity is unaffected by Other', () => {
      // Structural guarantee: the model never receives otherAnnotationValues, so
      // "Other" membership cannot change opacity/tier. A point in any category
      // resolves opacity purely from hidden + selection state.
      const data = makeData(['Alpha', 'Beta'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(baseInputs({ data }));
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.base);
      expect(model.opacityOf(point('p1', 1))).toBe(OPACITIES.base);
    });
  });

  // ── Rule 10 — no data / no selected annotation ⇒ no hidden filter ──────────
  describe('rule 10: no data or no annotation ⇒ no hidden filter, base/fade still apply', () => {
    it('null data → base opacity, hidden values ignored', () => {
      const model = computeVisibilityModel(
        baseInputs({ data: null, hiddenAnnotationValues: ['A'] }),
      );
      expect(model.allHidden).toBe(false);
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.base);
    });

    it('null data still applies selection fading', () => {
      const model = computeVisibilityModel(baseInputs({ data: null, selectedProteinIds: ['p0'] }));
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.selected);
      expect(model.opacityOf(point('p1', 1))).toBe(OPACITIES.faded);
    });

    it('empty selectedAnnotation → base opacity even with hidden values', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(
        baseInputs({ data, selectedAnnotation: '', hiddenAnnotationValues: ['A'] }),
      );
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.base);
    });
  });

  // ── Rule 11 — interactivity is numeric opacity > 0 ─────────────────────────
  describe('rule 11: interactivity is numeric (opacity > 0)', () => {
    it('faded points are interactive under default faded > 0', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(baseInputs({ data, selectedProteinIds: ['p0'] }));
      expect(model.opacityOf(point('p1', 1))).toBe(OPACITIES.faded);
      expect(model.isInteractive(point('p1', 1))).toBe(true);
    });

    it('fadedOpacity 0 makes faded points NON-interactive (numeric, not tier-based)', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(
        baseInputs({
          data,
          selectedProteinIds: ['p0'],
          opacities: { base: 0.8, selected: 1.0, faded: 0 },
        }),
      );
      // Still the FADED tier...
      expect(model.tierOf(point('p1', 1))).toBe('faded');
      // ...but numerically non-interactive because opacity is 0.
      expect(model.opacityOf(point('p1', 1))).toBe(0);
      expect(model.isInteractive(point('p1', 1))).toBe(false);
    });

    it('hidden points are non-interactive', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: ['A'] }));
      expect(model.isInteractive(point('p0', 0))).toBe(false);
    });
  });

  // ── tierOf never collapses selected into base ─────────────────────────────
  describe('tierOf: never collapses selected into base', () => {
    it('returns the full DisplayTier domain distinctly', () => {
      const data = makeData(['A', 'B', 'C', 'D'], Int32Array.of(0, 1, 2, 3));
      const model = computeVisibilityModel(
        baseInputs({
          data,
          hiddenAnnotationValues: ['A'], // p0 hidden
          selectedProteinIds: ['p1'], // p1 selected (=> p2,p3 faded)
        }),
      );
      const tiers: Record<string, DisplayTier> = {
        p0: model.tierOf(point('p0', 0)),
        p1: model.tierOf(point('p1', 1)),
        p2: model.tierOf(point('p2', 2)),
      };
      expect(tiers.p0).toBe('hidden');
      expect(tiers.p1).toBe('selected');
      expect(tiers.p2).toBe('faded');
      // selected is never reported as base
      expect(model.tierOf(point('p1', 1))).not.toBe('base');
    });

    it('base tier when no selection and not hidden', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const model = computeVisibilityModel(baseInputs({ data }));
      expect(model.tierOf(point('p0', 0))).toBe('base');
    });
  });

  // ── Edge: accessor behavior when annotation/annotation_data missing ────────
  describe('edge: selected annotation references missing data (replicate getOpacity)', () => {
    it('annotation_data lacks the selected key → every point opacity 0 (vacuous), !allHidden', () => {
      // Valid annotation entry but no annotation_data rows for it.
      const data: VisualizationData = {
        protein_ids: ['p0', 'p1'],
        projections: [
          {
            name: 'proj',
            data: Float32Array.of(0, 0, 0, 1, 1, 0),
            dimension: 3,
          },
        ],
        annotations: {
          annot: {
            kind: 'categorical',
            values: ['A', 'B'],
            colors: ['#f00', '#0f0'],
            shapes: ['circle', 'circle'],
          },
        },
        annotation_data: {}, // missing rows for 'annot'
      };
      const model = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: [] }));
      expect(model.allHidden).toBe(false);
      expect(model.opacityOf(point('p0', 0))).toBe(0);
      expect(model.opacityOf(point('p1', 1))).toBe(0);
    });

    it('annotation entry missing entirely → every point opacity 0', () => {
      const data: VisualizationData = {
        protein_ids: ['p0', 'p1'],
        projections: [
          {
            name: 'proj',
            data: Float32Array.of(0, 0, 0, 1, 1, 0),
            dimension: 3,
          },
        ],
        annotations: {}, // no 'annot' annotation
        annotation_data: { annot: Int32Array.of(0, 1) },
      };
      const model = computeVisibilityModel(baseInputs({ data }));
      expect(model.opacityOf(point('p0', 0))).toBe(0);
    });

    it('missing-data edge still rescued by all-hidden hatch when every value hidden', () => {
      // annotation present, rows missing, but every value hidden → allHidden true
      // → hidden filter ignored → base opacity (matches computeAllHidden which only
      //   inspects annotation.values + hiddenAnnotationValues).
      const data: VisualizationData = {
        protein_ids: ['p0', 'p1'],
        projections: [
          {
            name: 'proj',
            data: Float32Array.of(0, 0, 0, 1, 1, 0),
            dimension: 3,
          },
        ],
        annotations: {
          annot: {
            kind: 'categorical',
            values: ['A', 'B'],
            colors: ['#f00', '#0f0'],
            shapes: ['circle', 'circle'],
          },
        },
        annotation_data: {},
      };
      const model = computeVisibilityModel(
        baseInputs({ data, hiddenAnnotationValues: ['A', 'B'] }),
      );
      expect(model.allHidden).toBe(true);
      expect(model.opacityOf(point('p0', 0))).toBe(OPACITIES.base);
    });
  });

  // ── Type-surface smoke: all four exports are exercised ─────────────────────
  it('exposes the VisibilityModel surface', () => {
    const data = makeData(['A'], Int32Array.of(0));
    const inputs: VisibilityInputs = baseInputs({ data });
    const model: VisibilityModel = computeVisibilityModel(inputs);
    const tier: DisplayTier = model.tierOf(point('p0', 0));
    expect(['hidden', 'faded', 'base', 'selected']).toContain(tier);
    expect(typeof model.opacityOf(point('p0', 0))).toBe('number');
    expect(typeof model.baseOpacityOf(point('p0', 0))).toBe('number');
    expect(typeof model.isInteractive(point('p0', 0))).toBe('boolean');
    expect(typeof model.allHidden).toBe('boolean');
  });

  // ── Two-level memo support: `previous` lets the O(N) hidden mask be reused ──
  // when the mask-relevant inputs (data, selectedAnnotation, hidden ref) are
  // reference-equal, so a selection-only change never redoes the pass.
  describe('mask reuse via the optional `previous` argument', () => {
    it('reuses the prior mask on a selection-only change (data + hidden refs unchanged)', () => {
      const rows = Int32Array.of(0, 1); // p0 → 'A' (hidden), p1 → 'B'
      const data = makeData(['A', 'B'], rows);
      const hiddenRef = ['A'];
      const first = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: hiddenRef }));
      expect(first.opacityOf(point('p0', 0))).toBe(0);

      // Mutate the mask source IN PLACE (same array reference). makeData stores
      // `rows` into annotation_data by reference without copying, so the
      // in-place write reaches the live data the mask was built from. A reused
      // mask ignores this (it was already computed); a rebuilt mask would see
      // the new value and disagree. If makeData ever starts copying `rows`, this
      // test becomes vacuous — the mutation would no longer reach the mask source.
      rows[0] = 1; // p0 would map to 'B' (not hidden) if the mask were rebuilt

      const second = computeVisibilityModel(
        baseInputs({ data, hiddenAnnotationValues: hiddenRef, selectedProteinIds: ['p0'] }),
        first,
      );
      // Reused mask → p0 still hidden → opacity 0 (hidden beats selected).
      expect(second.opacityOf(point('p0', 0))).toBe(0);
    });

    it('rebuilds the mask when the hidden-values reference changes', () => {
      const data = makeData(['A', 'B'], Int32Array.of(0, 1));
      const first = computeVisibilityModel(baseInputs({ data, hiddenAnnotationValues: ['A'] }));
      expect(first.opacityOf(point('p0', 0))).toBe(0);

      // New hidden array reference (different content) → mask must rebuild.
      const second = computeVisibilityModel(
        baseInputs({ data, hiddenAnnotationValues: ['B'] }),
        first,
      );
      expect(second.opacityOf(point('p0', 0))).toBe(OPACITIES.base); // 'A' no longer hidden
      expect(second.opacityOf(point('p1', 1))).toBe(0); // 'B' now hidden
    });

    it('rebuilds the mask when the data reference changes', () => {
      const dataA = makeData(['A', 'B'], Int32Array.of(0, 1));
      const first = computeVisibilityModel(
        baseInputs({ data: dataA, hiddenAnnotationValues: ['A'] }),
      );
      expect(first.opacityOf(point('p0', 0))).toBe(0);

      const dataB = makeData(['A', 'B'], Int32Array.of(1, 0)); // bins swapped
      const second = computeVisibilityModel(
        baseInputs({ data: dataB, hiddenAnnotationValues: ['A'] }),
        first,
      );
      expect(second.opacityOf(point('p0', 0))).toBe(OPACITIES.base); // p0 → 'B'
      expect(second.opacityOf(point('p1', 1))).toBe(0); // p1 → 'A' (hidden)
    });
  });
});
