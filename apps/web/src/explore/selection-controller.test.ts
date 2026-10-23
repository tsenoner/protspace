/**
 * The selection the control bar coordinated, moved into the app (design decision 9). Ported
 * from `control-bar.after-paint.test.ts` (search box, Clear, Isolate, new dataset),
 * `control-bar.events.test.ts` and the helpers' tests in `control-bar-helpers.test.ts`.
 */
import type {
  ProtspacePlotTools,
  ProtspaceProteinSearch,
  ProtspaceScatterplot,
  ProtspaceSelectionBar,
} from '@protspace/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSelectionController,
  mergeProteinSelections,
  toggleProteinSelection,
} from './selection-controller';
import { undoEntrySize, type UndoEntry } from './undo-controller';
import { createUndoHistory } from './undo-history';
import { ESCAPE_ORDER } from '../../../../packages/core/src/components/kit/layers';

// Lit cannot load in node: AfterPaintCommit and ESCAPE_ORDER are plain TS, read from core's source.
vi.mock('@protspace/core', async () => {
  const { AfterPaintCommit } =
    await import('../../../../packages/core/src/utils/after-paint-commit');
  const { ESCAPE_ORDER } = await import('../../../../packages/core/src/components/kit/layers');
  return { AfterPaintCommit, ESCAPE_ORDER };
});

/** In node there is no requestAnimationFrame: a commit "after the paint" is a 0 ms timer. */
const afterPaint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const fire = (target: EventTarget, type: string, detail?: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail }));
/**
 * A stand-in for the layer stack's Escape fallbacks: `press()` runs them as one Escape press does,
 * in ascending order, until one acts.
 */
function fakeEscape() {
  const handlers = new Map<number, (event: KeyboardEvent) => boolean>();
  const register = vi.fn((order: number, handle: (event: KeyboardEvent) => boolean) => {
    handlers.set(order, handle);
    return () => {
      handlers.delete(order);
    };
  });
  const press = (): boolean => {
    for (const order of [...handlers.keys()].sort((a, b) => a - b)) {
      if (handlers.get(order)!(new Event('keydown') as KeyboardEvent)) return true;
    }
    return false;
  };
  return { register, press, handlers };
}
const click = (proteinId: string, modifierKeys?: { ctrl?: boolean; meta?: boolean }) => ({
  proteinId,
  modifierKeys: modifierKeys && {
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
    ...modifierKeys,
  },
});

/** The plot's edge chrome; every zoom fits the points clear of it. */
const INSETS = { top: 0, right: 0, bottom: 90, left: 48 };

function setup() {
  const plot = Object.assign(new EventTarget(), {
    selectedProteinIds: [] as string[],
    data: null as { protein_ids: string[] } | null,
    selectionMode: false,
    selectionTool: 'rectangle' as 'rectangle' | 'lasso',
    isolateSelection: vi.fn(),
    resetIsolation: vi.fn(),
    resetZoom: vi.fn(),
    zoomToProteins: vi.fn(() => true),
    touchTooltipInsets: INSETS,
    getIsolationHistory: vi.fn((): string[][] => []),
    popIsolation: vi.fn(),
  });
  const tools = Object.assign(new EventTarget(), {
    tool: 'pan',
    selectionDisabled: false,
    focusTool: vi.fn(),
  });
  const bar = Object.assign(new EventTarget(), {
    selectedCount: 0,
    canIsolate: true,
    returnFocus: null as ((action: 'clear' | 'isolate') => void) | null,
  });
  const search = Object.assign(new EventTarget(), {
    availableProteinIds: [] as string[],
    selectedProteinIds: [] as string[],
    reportNotInView: vi.fn(),
  });
  const interaction = { handleSelectionChange: vi.fn() };
  const escape = fakeEscape();
  const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const history = createUndoHistory<UndoEntry>({ size: undoEntrySize });
  const controller = createSelectionController({
    plotElement: plot as unknown as ProtspaceScatterplot,
    plotTools: tools as unknown as ProtspacePlotTools,
    selectionBar: bar as unknown as ProtspaceSelectionBar,
    proteinSearch: search as unknown as ProtspaceProteinSearch,
    interactionController: interaction,
    registerEscape: escape.register,
    notify,
    history,
  });
  return { controller, plot, tools, bar, search, interaction, escape, notify, history };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('selection controller: clicks and brushes', () => {
  it('a plain click selects one protein and a second click on the only one deselects it', () => {
    const m = setup();

    fire(m.plot, 'protein-click', click('P1', {}));
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    expect(m.search.selectedProteinIds).toEqual(['P1']);
    expect(m.bar.selectedCount).toBe(1);
    expect(m.interaction.handleSelectionChange).toHaveBeenLastCalledWith(['P1']);

    fire(m.plot, 'protein-click', click('P2', {}));
    expect(m.plot.selectedProteinIds).toEqual(['P2']);

    fire(m.plot, 'protein-click', click('P2', {}));
    expect(m.plot.selectedProteinIds).toEqual([]);
    expect(m.interaction.handleSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('a ⌘- or Ctrl-click, or any selection tool, toggles', () => {
    const m = setup();
    fire(m.plot, 'protein-click', click('P1', {}));

    fire(m.plot, 'protein-click', click('P2', { ctrl: true }));
    expect(m.plot.selectedProteinIds).toEqual(['P1', 'P2']);
    fire(m.plot, 'protein-click', click('P1', { meta: true }));
    expect(m.plot.selectedProteinIds).toEqual(['P2']);

    fire(m.tools, 'plot-tool-change', { tool: 'rectangle' });
    fire(m.plot, 'protein-click', click('P3', {}));
    expect(m.plot.selectedProteinIds).toEqual(['P2', 'P3']);
  });

  it('a protein-click without modifierKeys reads as a plain click', () => {
    const m = setup();
    fire(m.plot, 'protein-click', { proteinId: 'P00595' });
    expect(m.search.selectedProteinIds).toEqual(['P00595']);
    fire(m.plot, 'protein-click', { proteinId: 'P00596' });
    expect(m.search.selectedProteinIds).toEqual(['P00596']);
  });

  it('a brush merges under a selection tool and replaces otherwise', () => {
    const m = setup();
    fire(m.plot, 'brush-selection', { proteinIds: ['P1', 'P2'], isMultiple: true });
    fire(m.plot, 'brush-selection', { proteinIds: ['P3'], isMultiple: true });
    expect(m.plot.selectedProteinIds).toEqual(['P3']);

    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });
    fire(m.plot, 'brush-selection', {
      proteinIds: ['P4', 'P3'],
      isMultiple: true,
      idsUnique: true,
    });
    expect(m.plot.selectedProteinIds).toEqual(['P3', 'P4']);
  });
});

describe('selection controller: the search box', () => {
  it('search adds and removes commit after the paint', async () => {
    const m = setup();

    fire(m.search, 'add-selection', { proteinId: 'P1' });
    fire(m.search, 'add-selection-multiple', { proteinIds: ['P2', 'P3'] });
    fire(m.search, 'remove-selection', { proteinId: 'P2' });

    // Shown at once, so each pick builds on the last…
    expect(m.search.selectedProteinIds).toEqual(['P1', 'P3']);
    expect(m.bar.selectedCount).toBe(2);
    // …and pushed to the plot once, after the paint.
    expect(m.plot.selectedProteinIds).toEqual([]);
    expect(m.interaction.handleSelectionChange).not.toHaveBeenCalled();

    await afterPaint();

    expect(m.plot.selectedProteinIds).toEqual(['P1', 'P3']);
    expect(m.interaction.handleSelectionChange).toHaveBeenCalledOnce();
    expect(m.interaction.handleSelectionChange).toHaveBeenCalledWith(['P1', 'P3']);
  });

  it('a selection committed at once drops a waiting search pick', async () => {
    const m = setup();
    fire(m.search, 'add-selection', { proteinId: 'P1' });

    fire(m.search, 'selection-change', { proteinIds: ['P3'] });
    expect(m.plot.selectedProteinIds).toEqual(['P3']);

    await afterPaint();
    expect(m.plot.selectedProteinIds).toEqual(['P3']);
    expect(m.search.selectedProteinIds).toEqual(['P3']);
  });

  it('ignores an add of a protein already selected and a remove of one that is not', async () => {
    const m = setup();
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });
    m.interaction.handleSelectionChange.mockClear();

    fire(m.search, 'add-selection', { proteinId: 'P1' });
    fire(m.search, 'remove-selection', { proteinId: 'P9' });
    fire(m.search, 'add-selection-multiple', { proteinIds: ['P1'] });
    await afterPaint();

    expect(m.interaction.handleSelectionChange).not.toHaveBeenCalled();
  });

  it('add-selection zooms once after paint', async () => {
    const m = setup();

    fire(m.search, 'add-selection', { proteinId: 'P1', source: 'typed' });
    expect(m.plot.zoomToProteins).not.toHaveBeenCalled();

    await afterPaint();

    expect(m.plot.zoomToProteins).toHaveBeenCalledOnce();
    expect(m.plot.zoomToProteins).toHaveBeenCalledWith(['P1'], { insets: INSETS });
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    expect(m.search.reportNotInView).not.toHaveBeenCalled();
  });

  it('a newer pick replaces a waiting one, and only it zooms', async () => {
    const m = setup();
    fire(m.search, 'add-selection', { proteinId: 'P1', source: 'typed' });
    fire(m.search, 'add-selection', { proteinId: 'P2', source: 'suggestion' });

    await afterPaint();

    expect(m.plot.zoomToProteins).toHaveBeenCalledOnce();
    expect(m.plot.zoomToProteins).toHaveBeenCalledWith(['P2'], { insets: INSETS });
  });

  it('a false zoom reports not in view', async () => {
    const m = setup();
    m.plot.zoomToProteins.mockReturnValue(false);

    fire(m.search, 'add-selection', { proteinId: 'P1', source: 'typed' });
    await afterPaint();

    expect(m.search.reportNotInView).toHaveBeenCalledWith('P1');
    // Selected anyway: the report says why nothing moved.
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
  });

  it('add-selection-multiple appends only the IDs not yet selected, in their order', async () => {
    const m = setup();
    fire(m.search, 'selection-change', { proteinIds: ['P1', 'P3'] });

    fire(m.search, 'add-selection-multiple', { proteinIds: ['P2', 'P3'] });
    await afterPaint();

    expect(m.plot.selectedProteinIds).toEqual(['P1', 'P3', 'P2']);
  });

  it('add-selection-multiple does not zoom', async () => {
    const m = setup();

    fire(m.search, 'add-selection-multiple', { proteinIds: ['P1', 'P2'], missing: ['X'] });
    await afterPaint();

    expect(m.plot.selectedProteinIds).toEqual(['P1', 'P2']);
    expect(m.plot.zoomToProteins).not.toHaveBeenCalled();
  });
});

describe('selection controller: the selection bar and the plot tools', () => {
  it('Clear empties the selection', async () => {
    const m = setup();
    fire(m.search, 'add-selection', { proteinId: 'P1' });
    await afterPaint();

    fire(m.bar, 'clear-selections');

    expect(m.search.selectedProteinIds).toEqual([]);
    expect(m.bar.selectedCount).toBe(0);
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    await afterPaint();
    expect(m.plot.selectedProteinIds).toEqual([]);
    expect(m.interaction.handleSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('Isolate lands a waiting search pick first', () => {
    const m = setup();
    let selectedAtIsolate: string[] = [];
    m.plot.isolateSelection.mockImplementation(() => {
      selectedAtIsolate = [...m.plot.selectedProteinIds];
    });
    fire(m.search, 'add-selection', { proteinId: 'P1' });

    fire(m.bar, 'isolate-data');

    expect(m.plot.isolateSelection).toHaveBeenCalledOnce();
    expect(selectedAtIsolate).toEqual(['P1']);
  });

  it('zoom-to-selection flushes a waiting pick, then zooms to the selection', () => {
    const m = setup();
    fire(m.search, 'add-selection', { proteinId: 'P1' });

    fire(m.bar, 'zoom-to-selection');

    // Landed before the zoom: the plot frames what the bar counts.
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    expect(m.plot.zoomToProteins).toHaveBeenCalledExactlyOnceWith(['P1'], { insets: INSETS });
  });

  it('copy-selection writes the ids one per line and notifies success', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const m = setup();
    fire(m.search, 'selection-change', { proteinIds: ['P1', 'P2'] });

    fire(m.bar, 'copy-selection');

    await vi.waitFor(() => expect(m.notify.success).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledExactlyOnceWith('P1\nP2');
    expect(m.notify.success.mock.calls[0][0].title).toBe('Copied 2 protein IDs');
    expect(m.notify.error).not.toHaveBeenCalled();
  });

  it('a clipboard rejection notifies an error', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
    });
    const m = setup();
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });

    fire(m.bar, 'copy-selection');

    await vi.waitFor(() => expect(m.notify.error).toHaveBeenCalledOnce());
    expect(m.notify.error.mock.calls[0][0].title).toBe('Could not copy the IDs');
    expect(m.notify.success).not.toHaveBeenCalled();
  });

  it("the bar's count follows every commit", () => {
    const m = setup();
    fire(m.plot, 'protein-click', click('P1', {}));
    expect(m.bar.selectedCount).toBe(1);
    fire(m.plot, 'brush-selection', { proteinIds: ['P1', 'P2', 'P3'] });
    expect(m.bar.selectedCount).toBe(3);
    fire(m.search, 'remove-selection', { proteinId: 'P2' });
    expect(m.bar.selectedCount).toBe(2);
  });

  it('selectProteins selects exactly those ids in one undo step and zooms only when asked', () => {
    const m = setup();
    fire(m.plot, 'protein-click', click('P1', {}));
    m.controller.selectProteins(['P2'], { zoom: true });
    expect(m.plot.selectedProteinIds).toEqual(['P2']);
    expect(m.interaction.handleSelectionChange).toHaveBeenLastCalledWith(['P2']);
    expect(m.plot.zoomToProteins).toHaveBeenCalledExactlyOnceWith(['P2'], { insets: INSETS });
    expect(m.history.peekUndo()).toMatchObject({ before: ['P1'], after: ['P2'] });

    m.controller.selectProteins(['P3', 'P4']);
    expect(m.plot.selectedProteinIds).toEqual(['P3', 'P4']);
    expect(m.bar.selectedCount).toBe(2);
    expect(m.plot.zoomToProteins).toHaveBeenCalledTimes(1);
    m.history.undo();
    expect(m.history.peekUndo()).toMatchObject({ before: ['P1'], after: ['P2'] });
  });

  it('selectProteins records no undo step for the selection already shown', () => {
    const m = setup();
    m.controller.selectProteins(['P2']);
    const first = m.history.peekUndo();
    m.controller.selectProteins(['P2'], { zoom: true });
    expect(m.history.peekUndo()).toBe(first);
    m.history.undo();
    expect(m.history.canUndo()).toBe(false);
    expect(m.plot.zoomToProteins).toHaveBeenCalledExactlyOnceWith(['P2'], { insets: INSETS });
  });

  it('selectProteins reports nothing when the protein is out of view', () => {
    const m = setup();
    m.plot.zoomToProteins.mockReturnValue(false);
    m.controller.selectProteins(['P9'], { zoom: true });
    expect(m.plot.selectedProteinIds).toEqual(['P9']);
    expect(m.search.reportNotInView).not.toHaveBeenCalled();
  });

  it('resetIsolation resets the plot', () => {
    const m = setup();
    m.controller.resetIsolation();
    expect(m.plot.resetIsolation).toHaveBeenCalledOnce();
  });

  it('Fit to view resets the zoom', () => {
    const m = setup();
    fire(m.tools, 'fit-view');
    expect(m.plot.resetZoom).toHaveBeenCalledOnce();
  });

  it("a tool change sets the plot's mode and tool", () => {
    const m = setup();

    fire(m.tools, 'plot-tool-change', { tool: 'rectangle' });
    expect(m.plot.selectionMode).toBe(true);
    expect(m.plot.selectionTool).toBe('rectangle');
    expect(m.tools.tool).toBe('rectangle');

    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });
    expect(m.plot.selectionTool).toBe('lasso');

    fire(m.tools, 'plot-tool-change', { tool: 'pan' });
    expect(m.plot.selectionMode).toBe(false);
    // Move keeps the last selection tool, as turning selection mode off did.
    expect(m.plot.selectionTool).toBe('lasso');
  });
});

describe('selection controller: plot events', () => {
  it('data-isolation clears the selection', () => {
    const m = setup();
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });
    m.interaction.handleSelectionChange.mockClear();

    fire(m.plot, 'data-isolation', { isolationMode: true, isolationHistory: [['P1']] });

    expect(m.search.selectedProteinIds).toEqual([]);
    expect(m.bar.selectedCount).toBe(0);
    // The plot cleared its own selection when it isolated.
    expect(m.interaction.handleSelectionChange).not.toHaveBeenCalled();
  });

  it('auto-disable-selection returns to Move, disables the tools with one point left and warns', () => {
    const m = setup();
    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });

    fire(m.plot, 'auto-disable-selection', { reason: 'insufficient-data', dataSize: 1 });

    expect(m.tools.tool).toBe('pan');
    expect(m.plot.selectionMode).toBe(false);
    expect(m.tools.selectionDisabled).toBe(true);
    expect(m.bar.canIsolate).toBe(false);
    expect(m.notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Selection mode disabled.',
        description: 'Selection mode disabled: Only 1 protein remaining',
      }),
    );

    // Back to the full data: the tools work again.
    fire(m.plot, 'data-isolation-reset', { isolationMode: false, isolationHistory: [] });
    expect(m.tools.selectionDisabled).toBe(false);
    expect(m.bar.canIsolate).toBe(true);
  });

  it("data-change hands the search the dataset's ids and the plot's selection", () => {
    const m = setup();
    m.plot.selectedProteinIds = ['P2'];

    fire(m.plot, 'data-change', { data: { protein_ids: ['P1', 'P2'] } });

    expect(m.search.availableProteinIds).toEqual(['P1', 'P2']);
    expect(m.search.selectedProteinIds).toEqual(['P2']);
    expect(m.bar.selectedCount).toBe(1);
  });

  it('the search offers the whole dataset, not only the proteins in view', () => {
    const m = setup();
    m.plot.data = { protein_ids: ['P1', 'P2', 'P3'] };

    fire(m.plot, 'data-change', { data: { protein_ids: ['P1'] } }); // a filtered view

    expect(m.search.availableProteinIds).toEqual(['P1', 'P2', 'P3']);
  });

  it('undoing a Show only that left one protein re-enables the tools', () => {
    const m = setup();
    fire(m.plot, 'auto-disable-selection', { reason: 'insufficient-data', dataSize: 1 });
    expect(m.tools.selectionDisabled).toBe(true);

    fire(m.plot, 'data-isolation', {
      isolationHistory: [['P1', 'P2'], ['P1']],
      isolationMode: true,
      dataSize: 2,
    });

    expect(m.tools.selectionDisabled).toBe(false);
    expect(m.bar.canIsolate).toBe(true);
    expect(m.tools.tool).toBe('pan');
    expect(m.plot.selectionMode).toBe(false);
  });
});

describe('selection controller: Escape', () => {
  it('the selection fallback clears, then the tool fallback returns to Move, one per press', async () => {
    const m = setup();
    expect(m.escape.register).toHaveBeenCalledWith(ESCAPE_ORDER.selection, expect.any(Function));
    expect(m.escape.register).toHaveBeenCalledWith(ESCAPE_ORDER.tool, expect.any(Function));
    fire(m.tools, 'plot-tool-change', { tool: 'rectangle' });
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });

    expect(m.escape.press()).toBe(true);
    expect(m.search.selectedProteinIds).toEqual([]);
    expect(m.tools.tool).toBe('rectangle');
    await afterPaint();
    expect(m.plot.selectedProteinIds).toEqual([]);

    expect(m.escape.press()).toBe(true);
    expect(m.tools.tool).toBe('pan');
    expect(m.plot.selectionMode).toBe(false);

    // Nothing left to undo.
    expect(m.escape.press()).toBe(false);
  });

  it('dispose unregisters both fallbacks', () => {
    const m = setup();
    expect(m.escape.handlers.size).toBe(2);
    m.controller.dispose();
    expect(m.escape.handlers.size).toBe(0);
  });
});

describe('selection controller: lifecycle', () => {
  it('a new dataset drops waiting picks and returns to Move', async () => {
    const m = setup();
    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });
    fire(m.search, 'add-selection', { proteinId: 'P1' });

    m.controller.resetForNewDataset();
    await afterPaint();

    expect(m.plot.selectedProteinIds).toEqual([]);
    expect(m.interaction.handleSelectionChange).not.toHaveBeenCalled();
    expect(m.search.selectedProteinIds).toEqual([]);
    expect(m.bar.selectedCount).toBe(0);
    expect(m.tools.tool).toBe('pan');
  });

  it('dispose stops listening', () => {
    const m = setup();
    m.controller.dispose();

    fire(m.plot, 'protein-click', click('P1', {}));
    expect(m.escape.press()).toBe(false);
    fire(m.bar, 'clear-selections');

    expect(m.plot.selectedProteinIds).toEqual([]);
  });
});

describe('toggleProteinSelection', () => {
  it('adds protein when not selected', () => {
    const result = toggleProteinSelection('P1', ['P2', 'P3']);
    expect(result).toContain('P1');
    expect(result).toContain('P2');
    expect(result).toContain('P3');
    expect(result.length).toBe(3);
  });

  it('removes protein when already selected', () => {
    const result = toggleProteinSelection('P2', ['P1', 'P2', 'P3']);
    expect(result).toContain('P1');
    expect(result).toContain('P3');
    expect(result).not.toContain('P2');
    expect(result.length).toBe(2);
  });

  it('handles empty selection', () => {
    expect(toggleProteinSelection('P1', [])).toEqual(['P1']);
  });

  it('handles removing last selection', () => {
    expect(toggleProteinSelection('P1', ['P1'])).toEqual([]);
  });
});

describe('mergeProteinSelections', () => {
  it('merges two selections', () => {
    const result = mergeProteinSelections(['P1', 'P2'], ['P3', 'P4']);
    expect(result).toEqual(expect.arrayContaining(['P1', 'P2', 'P3', 'P4']));
    expect(result.length).toBe(4);
  });

  it('deduplicates overlapping selections', () => {
    const result = mergeProteinSelections(['P1', 'P2'], ['P2', 'P3']);
    expect(result).toEqual(expect.arrayContaining(['P1', 'P2', 'P3']));
    expect(result.length).toBe(3);
  });

  it('handles empty current selection', () => {
    expect(mergeProteinSelections([], ['P1', 'P2'])).toEqual(expect.arrayContaining(['P1', 'P2']));
  });

  it('handles empty new selections', () => {
    expect(mergeProteinSelections(['P1', 'P2'], [])).toEqual(expect.arrayContaining(['P1', 'P2']));
  });

  it('handles both empty', () => {
    expect(mergeProteinSelections([], [])).toEqual([]);
  });

  // The merge as it was before `newAreDistinct`, which every result must match in order.
  const oldMerge = (current: string[], added: string[]) => {
    const merged = new Set(current);
    added.forEach((id) => merged.add(id));
    return Array.from(merged);
  };

  it.each([
    ['empty current', [], ['P3', 'P1', 'P2']],
    ['disjoint', ['P2', 'P1'], ['P4', 'P3']],
    ['overlapping', ['P2', 'P1'], ['P3', 'P1', 'P4', 'P2']],
    ['repeats in the current selection', ['P1', 'P2', 'P1'], ['P3', 'P2']],
    ['no new ids', ['P2', 'P1'], []],
  ])('matches the old merge for distinct new ids: %s', (_, current, added) => {
    expect(mergeProteinSelections(current, added, true)).toEqual(oldMerge(current, added));
    expect(mergeProteinSelections(current, added)).toEqual(oldMerge(current, added));
  });

  it('matches the old merge on random selections with distinct new ids', () => {
    let seed = 1;
    const rand = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
    for (let run = 0; run < 200; run++) {
      const current = Array.from({ length: rand(8) }, () => `P${rand(12)}`);
      const added = [...new Set(Array.from({ length: rand(8) }, () => `P${rand(12)}`))];
      expect(mergeProteinSelections(current, added, true)).toEqual(oldMerge(current, added));
    }
  });

  it('dedupes repeated new ids when they are not flagged distinct', () => {
    expect(mergeProteinSelections([], ['P1', 'P2', 'P1'])).toEqual(['P1', 'P2']);
    expect(mergeProteinSelections(['P3'], ['P1', 'P3', 'P1'])).toEqual(['P3', 'P1']);
    expect(mergeProteinSelections(['P3'], ['P1', 'P3', 'P1'])).toEqual(
      oldMerge(['P3'], ['P1', 'P3', 'P1']),
    );
  });

  it('returns a copy of distinct new ids when nothing is selected', () => {
    const added = ['P1', 'P2'];
    const result = mergeProteinSelections([], added, true);
    expect(result).toEqual(added);
    expect(result).not.toBe(added);
  });
});

/** What the undo controller does for a selection or isolation step: pop it, then apply it. */
function undo(m: ReturnType<typeof setup>): void {
  const entry = m.history.undo();
  if (!entry || entry.kind === 'filter') throw new Error('no selection step to undo');
  m.controller.applyHistory(entry, 'undo');
}
function redo(m: ReturnType<typeof setup>): void {
  const entry = m.history.redo();
  if (!entry || entry.kind === 'filter') throw new Error('no selection step to redo');
  m.controller.applyHistory(entry, 'redo');
}

/** The plot's isolation, faked: layers the fake's isolate, pop and reset keep, as the plot does. */
function isolating(m: ReturnType<typeof setup>) {
  const layers: string[][] = [];
  const report = () =>
    fire(m.plot, layers.length > 0 ? 'data-isolation' : 'data-isolation-reset', {
      isolationHistory: layers,
      isolationMode: layers.length > 0,
      dataSize: layers[layers.length - 1]?.length ?? 10,
    });
  m.plot.isolateSelection.mockImplementation(() => {
    if (m.plot.selectedProteinIds.length === 0) return;
    layers.push([...m.plot.selectedProteinIds]);
    m.plot.selectedProteinIds = [];
    report();
  });
  m.plot.popIsolation.mockImplementation(() => {
    layers.pop();
    report();
  });
  m.plot.resetIsolation.mockImplementation(() => {
    layers.length = 0;
    report();
  });
  m.plot.getIsolationHistory.mockImplementation(() => [...layers]);
  return { layers };
}

describe('selection controller: undo history', () => {
  it('a commit records before and after; undo restores the previous selection; redo re-applies', () => {
    const m = setup();
    fire(m.plot, 'protein-click', click('P1', {}));
    fire(m.plot, 'brush-selection', { proteinIds: ['P2', 'P3'] });
    const brush = m.history.peekUndo();
    expect(brush).toMatchObject({ kind: 'selection', before: ['P1'], after: ['P2', 'P3'] });

    undo(m);
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    expect(m.bar.selectedCount).toBe(1);
    // Applying a step records none: the click is still the step below.
    expect(m.history.peekUndo()).toMatchObject({ before: [], after: ['P1'] });

    redo(m);
    expect(m.plot.selectedProteinIds).toEqual(['P2', 'P3']);
    expect(m.history.peekUndo()).toBe(brush);
    expect(m.history.canRedo()).toBe(false);
  });

  it('an identical commit records nothing', () => {
    const m = setup();
    // Clear with nothing selected: an empty selection over an empty one.
    fire(m.bar, 'clear-selections');
    expect(m.history.canUndo()).toBe(false);
  });

  it('a search add records one step', async () => {
    const m = setup();
    fire(m.search, 'add-selection', { proteinId: 'P1' });
    // Recorded when committed, before the plot takes it after the paint.
    expect(m.history.peekUndo()).toMatchObject({ kind: 'selection', before: [], after: ['P1'] });
    await afterPaint();
    m.history.undo();
    expect(m.history.canUndo()).toBe(false);
  });

  it("Escape's clear is undoable", async () => {
    const m = setup();
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });
    m.escape.press();
    await afterPaint();
    expect(m.plot.selectedProteinIds).toEqual([]);

    undo(m);
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
  });

  it('isolate then undo pops one layer and restores the selection', () => {
    const m = setup();
    const iso = isolating(m);
    fire(m.search, 'selection-change', { proteinIds: ['P1', 'P2'] });
    fire(m.bar, 'isolate-data');
    expect(iso.layers).toEqual([['P1', 'P2']]);
    expect(m.history.peekUndo()).toMatchObject({
      kind: 'isolate',
      layer: ['P1', 'P2'],
      selectionBefore: ['P1', 'P2'],
    });

    undo(m);
    expect(m.plot.popIsolation).toHaveBeenCalledOnce();
    expect(iso.layers).toEqual([]);
    expect(m.plot.selectedProteinIds).toEqual(['P1', 'P2']);

    redo(m);
    expect(iso.layers).toEqual([['P1', 'P2']]);
  });

  it('reset isolation then undo re-isolates every layer', () => {
    const m = setup();
    const iso = isolating(m);
    fire(m.search, 'selection-change', { proteinIds: ['P1', 'P2', 'P3'] });
    fire(m.bar, 'isolate-data');
    fire(m.search, 'selection-change', { proteinIds: ['P1', 'P2'] });
    fire(m.bar, 'isolate-data');
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });

    m.controller.resetIsolation();
    expect(iso.layers).toEqual([]);
    expect(m.history.peekUndo()).toMatchObject({
      kind: 'reset-isolation',
      layers: [
        ['P1', 'P2', 'P3'],
        ['P1', 'P2'],
      ],
      selectionBefore: ['P1'],
    });

    undo(m);
    expect(iso.layers).toEqual([
      ['P1', 'P2', 'P3'],
      ['P1', 'P2'],
    ]);
    expect(m.plot.selectedProteinIds).toEqual(['P1']);

    redo(m);
    expect(iso.layers).toEqual([]);
    // Redo applies the step it took back; it records no new one.
    expect(m.history.canRedo()).toBe(false);
    expect(m.history.peekUndo()?.kind).toBe('reset-isolation');
  });

  it('a waiting search pick is flushed before an undo', async () => {
    const m = setup();
    fire(m.plot, 'protein-click', click('P1', {}));
    fire(m.search, 'add-selection', { proteinId: 'P2' });
    expect(m.plot.selectedProteinIds).toEqual(['P1']);

    undo(m);
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    expect(m.interaction.handleSelectionChange).toHaveBeenLastCalledWith(['P1']);
    // The pick's own landing, after the paint, does not come back over the undo, and its zoom
    // never runs: the undo took the pick back.
    await afterPaint();
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    expect(m.search.selectedProteinIds).toEqual(['P1']);
    expect(m.plot.zoomToProteins).not.toHaveBeenCalled();
  });
});
