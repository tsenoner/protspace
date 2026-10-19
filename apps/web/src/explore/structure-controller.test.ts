import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, type LayoutMode } from './layout-defaults';
import { getLayout, resetLayoutForTests, updateLayout } from './layout-state';
import {
  createStructureController,
  isStructureVisible,
  type StructureController,
} from './structure-controller';
import {
  getWorkbenchStatus,
  resetWorkbenchStatusForTests,
  setStructureSheet,
} from './workbench-status';

/** The viewer's surface the controller uses, over a real EventTarget. */
function fakeViewer() {
  const events = new EventTarget();
  const viewer = {
    autoShow: true,
    showTips: true,
    title: 'Protein Structure',
    proteinId: null as string | null,
    proteinChoices: [] as readonly string[],
    style: {
      display: 'none',
      removeProperty(name: string) {
        if (name === 'display') this.display = '';
        return '';
      },
    },
    loadProtein: vi.fn((proteinId: string) => {
      viewer.proteinId = proteinId;
    }),
    // As the element does: forget the protein, then tell listeners.
    close: vi.fn(() => {
      viewer.proteinId = null;
      events.dispatchEvent(new CustomEvent('structure-close', { detail: { proteinId: null } }));
    }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  return viewer;
}

/** The layout-mode source, answered by the test: set() notifies only on a change of mode. */
function fakeLayoutMode(initial: LayoutMode) {
  let mode = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => mode,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: LayoutMode) {
      if (next === mode) return;
      mode = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** The plot's surface the controller uses: its tooltip actions and the tooltip-action event. */
function fakePlot() {
  const events = new EventTarget();
  return {
    tooltipActions: [] as readonly { id: string; label: string }[],
    tapTooltips: true,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
}

const controllers: StructureController[] = [];

function setup({ mode = 'desktop' as LayoutMode } = {}) {
  const viewer = fakeViewer();
  const plot = fakePlot();
  const layoutMode = fakeLayoutMode(mode);
  const controller = createStructureController({
    viewer: viewer as never,
    plotElement: plot as never,
    layoutMode,
  });
  controllers.push(controller);
  return { viewer, plot, layoutMode, controller };
}

beforeEach(() => {
  resetLayoutForTests();
  resetWorkbenchStatusForTests();
});

afterEach(() => {
  while (controllers.length) controllers.pop()!.dispose();
});

describe('isStructureVisible', () => {
  it('isStructureVisible: always off desktop; on desktop docked follows the sidebar and floating is visible', () => {
    const collapsed = { ...DEFAULT_LAYOUT, sidebarOpen: false };
    for (const mode of ['tablet', 'phone', 'landscape'] as const) {
      expect(isStructureVisible(collapsed, mode)).toBe(true);
    }
    expect(isStructureVisible(DEFAULT_LAYOUT, 'desktop')).toBe(true);
    expect(isStructureVisible(collapsed, 'desktop')).toBe(false);
    expect(isStructureVisible({ ...collapsed, structurePlacement: 'floating' }, 'desktop')).toBe(
      true,
    );
  });

  it('isStructureVisible: a structure hidden from the rail is not visible on desktop, docked or floating', () => {
    const hidden = { ...DEFAULT_LAYOUT, structureHidden: true };
    expect(isStructureVisible(hidden, 'desktop')).toBe(false);
    expect(isStructureVisible({ ...hidden, structurePlacement: 'floating' }, 'desktop')).toBe(
      false,
    );
    for (const mode of ['tablet', 'phone', 'landscape'] as const) {
      expect(isStructureVisible(hidden, mode)).toBe(true);
    }
  });
});

describe('createStructureController', () => {
  it('sets autoShow, showTips and the title and clears the inline display', () => {
    const { viewer } = setup();
    expect(viewer.autoShow).toBe(false);
    expect(viewer.showTips).toBe(false);
    expect(viewer.title).toBe('Structure');
    expect(viewer.style.display).toBe('');
  });

  it('a request while visible loads at once and publishes the protein', () => {
    const { viewer, controller } = setup();
    controller.request('P12345');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P12345');
    expect(getWorkbenchStatus().structureProteinId).toBe('P12345');
  });

  it('a request while hidden only publishes the protein', () => {
    const { viewer, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P12345');
    expect(viewer.loadProtein).not.toHaveBeenCalled();
    expect(getWorkbenchStatus().structureProteinId).toBe('P12345');
  });

  it('becoming visible, by layout or by crossing 951 px, loads the waiting protein once', () => {
    const { viewer, layoutMode, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    updateLayout({ sidebarOpen: true });
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    updateLayout({ sidebarWidth: 320 });
    expect(viewer.loadProtein).toHaveBeenCalledOnce();

    updateLayout({ sidebarOpen: false });
    controller.request('P2');
    layoutMode.set('tablet');
    expect(viewer.loadProtein).toHaveBeenCalledTimes(2);
    expect(viewer.loadProtein).toHaveBeenLastCalledWith('P2');
    layoutMode.set('desktop');
    layoutMode.set('tablet');
    expect(viewer.loadProtein).toHaveBeenCalledTimes(2);
  });

  it('a waiting protein loads when the mode leaves desktop, for a phone as for a tablet', () => {
    const { viewer, layoutMode, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    expect(viewer.loadProtein).not.toHaveBeenCalled();
    layoutMode.set('phone');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    layoutMode.set('landscape');
    expect(viewer.loadProtein).toHaveBeenCalledOnce();
  });

  it('starts off desktop with nothing waiting: a request while collapsed loads at once', () => {
    const { viewer, controller } = setup({ mode: 'phone' });
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
  });

  it('structure-close forgets the protein', () => {
    const { viewer, controller } = setup();
    controller.request('P1');
    viewer.close();
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
    // Hidden and shown again: nothing waits, so nothing loads.
    updateLayout({ sidebarOpen: false });
    updateLayout({ sidebarOpen: true });
    expect(viewer.loadProtein).toHaveBeenCalledOnce();
  });

  it('clear closes a loaded viewer and does nothing when empty', () => {
    const { viewer, controller } = setup();
    controller.request('P1');
    controller.clear();
    expect(viewer.close).toHaveBeenCalledOnce();
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
    controller.clear();
    expect(viewer.close).toHaveBeenCalledOnce();
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
  });

  it('clear forgets a protein that waits while the structure is hidden', () => {
    const { viewer, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    controller.clear();
    expect(viewer.close).not.toHaveBeenCalled();
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
    updateLayout({ sidebarOpen: true });
    expect(viewer.loadProtein).not.toHaveBeenCalled();
  });

  it('dispose stops following the layout, the breakpoint and the viewer', () => {
    const { viewer, layoutMode, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    controller.dispose();
    updateLayout({ sidebarOpen: true });
    layoutMode.set('tablet');
    expect(viewer.loadProtein).not.toHaveBeenCalled();
    viewer.close();
    expect(getWorkbenchStatus().structureProteinId).toBe('P1');
  });

  it('offers View structure only while docked and collapsed on desktop', () => {
    const { plot, layoutMode } = setup();
    const viewStructure = [{ id: 'view-structure', label: 'View structure' }];
    expect(plot.tooltipActions).toEqual([]);
    updateLayout({ sidebarOpen: false });
    expect(plot.tooltipActions).toEqual(viewStructure);
    updateLayout({ structurePlacement: 'floating' });
    expect(plot.tooltipActions).toEqual([]);
    updateLayout({ structurePlacement: 'docked' });
    expect(plot.tooltipActions).toEqual(viewStructure);
    layoutMode.set('tablet');
    expect(plot.tooltipActions).toEqual([]);
    layoutMode.set('desktop');
    expect(plot.tooltipActions).toEqual(viewStructure);
    updateLayout({ sidebarOpen: true });
    expect(plot.tooltipActions).toEqual([]);
  });

  it('View structure opens the sidebar, which loads the waiting protein', () => {
    const { viewer, plot, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    expect(viewer.loadProtein).not.toHaveBeenCalled();

    plot.dispatchEvent(
      new CustomEvent('tooltip-action', { detail: { id: 'view-structure', proteinId: 'P1' } }),
    );

    expect(getLayout().sidebarOpen).toBe(true);
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    expect(plot.tooltipActions).toEqual([]);
  });

  it('a hidden structure: a request waits, View structure is offered and shows it again', () => {
    const { viewer, plot, controller } = setup();
    const viewStructure = [{ id: 'view-structure', label: 'View structure' }];
    updateLayout({ structureHidden: true });
    expect(plot.tooltipActions).toEqual(viewStructure);
    controller.request('P1');
    expect(viewer.loadProtein).not.toHaveBeenCalled();

    plot.dispatchEvent(
      new CustomEvent('tooltip-action', { detail: { id: 'view-structure', proteinId: 'P1' } }),
    );

    expect(getLayout()).toMatchObject({ structureHidden: false, sidebarOpen: true });
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    expect(plot.tooltipActions).toEqual([]);
  });

  it('View structure shows a hidden floating card without opening the sidebar', () => {
    const { viewer, plot, controller } = setup();
    updateLayout({ structurePlacement: 'floating', sidebarOpen: false, structureHidden: true });
    controller.request('P1');
    plot.dispatchEvent(
      new CustomEvent('tooltip-action', { detail: { id: 'view-structure', proteinId: 'P1' } }),
    );
    expect(getLayout()).toMatchObject({ structureHidden: false, sidebarOpen: false });
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
  });

  it('View structure loads the protein the tooltip named, not the one that was waiting', () => {
    const { viewer, plot, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    plot.dispatchEvent(
      new CustomEvent('tooltip-action', { detail: { id: 'view-structure', proteinId: 'P2' } }),
    );
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P2');
    expect(getWorkbenchStatus().structureProteinId).toBe('P2');
  });

  it('ignores other tooltip actions', () => {
    const { viewer, plot } = setup();
    updateLayout({ sidebarOpen: false });
    plot.dispatchEvent(
      new CustomEvent('tooltip-action', { detail: { id: 'copy-id', proteinId: 'P1' } }),
    );
    expect(getLayout().sidebarOpen).toBe(false);
    expect(viewer.loadProtein).not.toHaveBeenCalled();
  });
});

describe('createStructureController selection', () => {
  it('select shows a single added protein', () => {
    const { viewer, controller } = setup();
    controller.select(['A', 'B']);
    expect(viewer.loadProtein).toHaveBeenLastCalledWith('B');
    controller.select(['A', 'B', 'C']);
    expect(viewer.loadProtein).toHaveBeenLastCalledWith('C');
    // Added anywhere, not only at the end.
    controller.select(['D', 'A', 'B', 'C']);
    expect(viewer.loadProtein).toHaveBeenLastCalledWith('D');
    expect(viewer.proteinChoices).toEqual(['D', 'A', 'B', 'C']);
    expect(getWorkbenchStatus().structureProteinId).toBe('D');
  });

  it('select keeps the shown protein while it stays selected and does not reload', () => {
    const { viewer, controller } = setup();
    controller.select(['A', 'B']);
    controller.select(['B', 'C', 'D']);
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('B');
    expect(viewer.proteinChoices).toEqual(['B', 'C', 'D']);
    expect(getWorkbenchStatus().structureProteinId).toBe('B');
  });

  it('select falls back to the last when the shown one leaves', () => {
    const { viewer, controller } = setup();
    controller.select(['A', 'B']);
    controller.select(['C', 'D']);
    expect(viewer.loadProtein).toHaveBeenCalledTimes(2);
    expect(viewer.loadProtein).toHaveBeenLastCalledWith('D');
  });

  it('select([]) keeps the structure and clears the choices', () => {
    const { viewer, controller } = setup();
    controller.select(['A', 'B']);
    controller.select([]);
    expect(viewer.loadProtein).toHaveBeenCalledOnce();
    expect(viewer.proteinId).toBe('B');
    expect(viewer.proteinChoices).toEqual([]);
    expect(getWorkbenchStatus().structureProteinId).toBe('B');
  });

  it('structure-protein-change publishes the picked protein', () => {
    const { viewer, controller } = setup();
    controller.select(['A', 'B']);
    // The viewer loads the pick itself, then tells the controller.
    viewer.proteinId = 'A';
    viewer.dispatchEvent(
      new CustomEvent('structure-protein-change', { detail: { proteinId: 'A' } }),
    );
    expect(getWorkbenchStatus().structureProteinId).toBe('A');
    // The picked protein then stays while it is selected.
    controller.select(['B', 'A']);
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('B');
  });

  it('clear empties the choices', () => {
    const { viewer, controller } = setup();
    controller.select(['A', 'B']);
    controller.clear();
    expect(viewer.proteinChoices).toEqual([]);
    // A new selection after a clear compares with nothing.
    controller.select(['C']);
    expect(viewer.loadProtein).toHaveBeenLastCalledWith('C');
  });

  it('while hidden, select only updates waiting', () => {
    const { viewer, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.select(['A', 'B']);
    expect(viewer.loadProtein).not.toHaveBeenCalled();
    expect(viewer.proteinChoices).toEqual(['A', 'B']);
    expect(getWorkbenchStatus().structureProteinId).toBe('B');
    // The waiting protein counts as shown: it stays while it is selected.
    controller.select(['B']);
    updateLayout({ sidebarOpen: true });
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('B');
  });
});

const OFFER = [{ id: 'view-structure', label: 'View structure' }];

function viewStructure(plot: ReturnType<typeof fakePlot>, proteinId: string) {
  plot.dispatchEvent(
    new CustomEvent('tooltip-action', { detail: { id: 'view-structure', proteinId } }),
  );
}

describe('createStructureController on phones and tablets', () => {
  it('phone, folded: the plot offers View structure and taps pin', () => {
    const { plot, controller } = setup({ mode: 'phone' });
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
    controller.request('P1');
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });

  it('phone, expanded: no actions and tapTooltips false', () => {
    const { plot, controller } = setup({ mode: 'phone' });
    controller.request('P1');
    setStructureSheet('expanded');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(false);
    setStructureSheet('folded');
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });

  it('View structure on a phone requests the protein and expands the sheet, and never opens the sidebar', () => {
    const { viewer, plot } = setup({ mode: 'phone' });
    updateLayout({ sidebarOpen: false });
    viewStructure(plot, 'P2');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P2');
    expect(getWorkbenchStatus()).toMatchObject({
      structureProteinId: 'P2',
      structureSheet: 'expanded',
    });
    expect(getLayout().sidebarOpen).toBe(false);
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(false);
  });

  it('close resets the sheet to folded', () => {
    const { viewer, plot, controller } = setup({ mode: 'phone' });
    controller.request('P1');
    setStructureSheet('expanded');
    viewer.close();
    expect(getWorkbenchStatus()).toMatchObject({
      structureProteinId: null,
      structureSheet: 'folded',
    });
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });

  it('a new protein after none opens folded', () => {
    const { controller } = setup({ mode: 'phone' });
    // A state left from before (the sheet cannot show with no protein) still starts over.
    setStructureSheet('expanded');
    controller.request('P1');
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
    controller.clear();
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
  });

  it('a second protein keeps the sheet as it is', () => {
    const { controller } = setup({ mode: 'phone' });
    controller.request('P1');
    controller.request('P2');
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
    setStructureSheet('expanded');
    // A tap above the expanded sheet selects a protein, which shows in it.
    controller.select(['P3']);
    expect(getWorkbenchStatus()).toMatchObject({
      structureProteinId: 'P3',
      structureSheet: 'expanded',
    });
  });

  it('landscape follows the same sheet rule', () => {
    const { plot, controller } = setup({ mode: 'landscape' });
    expect(plot.tooltipActions).toEqual(OFFER);
    controller.request('P1');
    setStructureSheet('expanded');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(false);
  });

  it('tablet offers nothing and taps pin', () => {
    const { viewer, plot, controller } = setup({ mode: 'tablet' });
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(true);
    controller.request('P1');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    setStructureSheet('expanded');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(true);
  });

  it("a mode change applies the new mode's rule", () => {
    const { plot, controller, layoutMode } = setup({ mode: 'phone' });
    controller.request('P1');
    setStructureSheet('expanded');
    layoutMode.set('tablet');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(true);
    layoutMode.set('landscape');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(false);
    layoutMode.set('desktop');
    expect(plot.tapTooltips).toBe(true);
  });

  it('desktop keeps taps pinning', () => {
    const { plot } = setup({ mode: 'desktop' });
    expect(plot.tapTooltips).toBe(true);
    updateLayout({ sidebarOpen: false });
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });

  it('dispose stops following the sheet', () => {
    const { plot, controller } = setup({ mode: 'phone' });
    controller.request('P1');
    controller.dispose();
    setStructureSheet('expanded');
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });
});
