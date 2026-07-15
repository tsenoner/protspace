import { describe, it, expect } from 'vitest';
import type { TooltipView } from '@protspace/utils';
import { estimateTooltipHeight } from './tooltip-height-estimate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(
  overrides: Partial<TooltipView['blocks'][number]> = {},
): TooltipView['blocks'][number] {
  return {
    key: 'annotation',
    displayValues: ['ValueA'],
    numericValue: null,
    numericType: 'float',
    scores: [],
    evidence: [],
    ...overrides,
  };
}

function makeView(
  overrides: Partial<{
    proteinId: string;
    geneName: string[];
    proteinName: string[];
    uniprotKbId: string[];
    blocks: TooltipView['blocks'];
  }> = {},
): TooltipView {
  return {
    proteinId: 'P12345',
    geneName: [],
    proteinName: [],
    uniprotKbId: [],
    blocks: [],
    ...overrides,
  };
}

// A block that is large enough on its own to push the total above the 160 floor.
// 1 block: BLOCK_SEPARATOR(17) + BLOCK_HEADER_ROW(16) + 4×ANNOTATION_ROW(64) = 97
// + HEADER_HEIGHT(38) + CONTENT_PADDING_V(24) = 159 — just below floor!
// Use 5 displayValues: 17+16+5*16=113; +38+24=175 — safely above 160.
function bigBlock(): TooltipView['blocks'][number] {
  return makeBlock({ displayValues: ['A', 'B', 'C', 'D', 'E'] });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('estimateTooltipHeight', () => {
  it('returns the minimum floor (160) for a minimal view with no blocks or names', () => {
    const view = makeView();
    expect(estimateTooltipHeight(view)).toBe(160);
  });

  it('is always >= 160 regardless of content', () => {
    const heights = [
      estimateTooltipHeight(makeView()),
      estimateTooltipHeight(makeView({ geneName: ['TP53'] })),
      estimateTooltipHeight(makeView({ blocks: [makeBlock()] })),
    ];
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(160);
    }
  });

  it('increases height when proteinName is present (both above floor)', () => {
    // Anchor both views at one big block so raw totals are above 160
    const withoutName = estimateTooltipHeight(makeView({ proteinName: [], blocks: [bigBlock()] }));
    const withName = estimateTooltipHeight(
      makeView({ proteinName: ['Tumor protein p53'], blocks: [bigBlock()] }),
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it('increases height when geneName is present (both above floor)', () => {
    const without = estimateTooltipHeight(makeView({ geneName: [], blocks: [bigBlock()] }));
    const with_ = estimateTooltipHeight(makeView({ geneName: ['TP53'], blocks: [bigBlock()] }));
    expect(with_).toBeGreaterThan(without);
  });

  it('increases height monotonically as more annotation blocks are added', () => {
    // bigBlock() alone pushes first non-zero-block case above 160
    const h1 = estimateTooltipHeight(makeView({ blocks: [bigBlock()] }));
    const h2 = estimateTooltipHeight(makeView({ blocks: [bigBlock(), bigBlock()] }));
    const h3 = estimateTooltipHeight(makeView({ blocks: [bigBlock(), bigBlock(), bigBlock()] }));
    expect(h1).toBeGreaterThan(160); // ensure we are above the floor
    expect(h2).toBeGreaterThan(h1);
    expect(h3).toBeGreaterThan(h2);
  });

  it('increases height when a block has more displayValues rows (both above floor)', () => {
    // Each block is in a view with extra blocks so we stay above 160
    const blockOneRow = makeBlock({ displayValues: ['A'] });
    const blockFiveRows = makeBlock({ displayValues: ['A', 'B', 'C', 'D', 'E'] });
    const h1 = estimateTooltipHeight(makeView({ blocks: [bigBlock(), blockOneRow] }));
    const h5 = estimateTooltipHeight(makeView({ blocks: [bigBlock(), blockFiveRows] }));
    expect(h5).toBeGreaterThan(h1);
  });

  it('adds a row when a block has a numericValue (both above floor)', () => {
    const blockNoNumeric = makeBlock({ numericValue: null, displayValues: ['Bin A'] });
    const blockWithNumeric = makeBlock({ numericValue: 3.14, displayValues: ['Bin A'] });
    // Pair each variant with a bigBlock so both totals exceed 160
    const hNoNumeric = estimateTooltipHeight(makeView({ blocks: [bigBlock(), blockNoNumeric] }));
    const hWithNumeric = estimateTooltipHeight(
      makeView({ blocks: [bigBlock(), blockWithNumeric] }),
    );
    expect(hWithNumeric).toBeGreaterThan(hNoNumeric);
  });

  it('produces a plausible height for a typical single-annotation tooltip', () => {
    // Header-only protein, 1 annotation block with 3 values
    const view = makeView({
      proteinName: ['Tumor protein p53'],
      geneName: ['TP53'],
      blocks: [makeBlock({ displayValues: ['Oncogene', 'Tumor suppressor', 'Kinase'] })],
    });
    const h = estimateTooltipHeight(view);
    // Should be well above the floor and below an unreasonably large value
    expect(h).toBeGreaterThan(160);
    expect(h).toBeLessThan(500);
  });

  it('produces a plausible height for a tall multi-annotation tooltip (5 blocks, many rows)', () => {
    const tallBlock = makeBlock({
      displayValues: ['Val1', 'Val2', 'Val3', 'Val4', 'Val5'],
      numericValue: 42,
    });
    const view = makeView({
      proteinName: ['Some long protein name'],
      geneName: ['GENE1'],
      blocks: [tallBlock, tallBlock, tallBlock, tallBlock, tallBlock],
    });
    const h = estimateTooltipHeight(view);
    // 5 blocks × (17 sep + 16 header + 16 numericRow + 5×16 rows) = 5 × 129 = 645
    // + header 38 + content padding 24 + proteinName 20 + geneName 20 = 102
    // total ≈ 747, well above floor
    expect(h).toBeGreaterThan(600);
  });

  it('two identical views produce equal heights', () => {
    const view1 = makeView({ geneName: ['TP53'], blocks: [bigBlock()] });
    const view2 = makeView({ geneName: ['TP53'], blocks: [bigBlock()] });
    expect(estimateTooltipHeight(view1)).toBe(estimateTooltipHeight(view2));
  });

  it('reserves additional lines for long transferred labels without inflating observed rows', () => {
    const longEc = '3.1.3.67 (phosphatidylinositol-3,4,5-trisphosphate 3-phosphatase)';
    const anchor = bigBlock();
    const predicted = {
      value: longEc,
      confidence: 0.87,
      source: 'P0C5E4',
    };
    const shortTransfer = estimateTooltipHeight(
      makeView({ blocks: [anchor, makeBlock({ displayValues: ['3.1.3.67'], predicted })] }),
    );
    const longTransfer = estimateTooltipHeight(
      makeView({ blocks: [anchor, makeBlock({ displayValues: [longEc], predicted })] }),
    );
    const shortObserved = estimateTooltipHeight(
      makeView({ blocks: [anchor, makeBlock({ displayValues: ['3.1.3.67'] })] }),
    );
    const longObserved = estimateTooltipHeight(
      makeView({ blocks: [anchor, makeBlock({ displayValues: [longEc] })] }),
    );

    expect(longTransfer).toBeGreaterThan(shortTransfer);
    expect(longObserved).toBe(shortObserved);
  });
});
