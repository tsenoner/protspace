/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactiveControllerHost } from 'lit';
import type Sortable from 'sortablejs';
import { DragController, type DragCallbacks } from './drag-controller';
import type { LegendItem } from '../types';

describe('DragController', () => {
  let controller: DragController;
  let mockHost: ReactiveControllerHost;
  let mockCallbacks: DragCallbacks;
  let mockLegendItems: LegendItem[];
  let mockContainer: HTMLElement;

  beforeEach(() => {
    mockLegendItems = [
      { value: 'cat1', zOrder: 0, color: '#ff0000', shape: 'circle', count: 10, isVisible: true },
      { value: 'cat2', zOrder: 1, color: '#00ff00', shape: 'circle', count: 8, isVisible: true },
      { value: 'cat3', zOrder: 2, color: '#0000ff', shape: 'circle', count: 6, isVisible: true },
      { value: 'Other', zOrder: 3, color: '#999999', shape: 'circle', count: 4, isVisible: true },
    ] as LegendItem[];

    mockHost = {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    };

    mockCallbacks = {
      getLegendItems: vi.fn().mockReturnValue(mockLegendItems),
      setLegendItems: vi.fn(),
      onReorder: vi.fn(),
      onMergeToOther: vi.fn(),
      onSortModeChange: vi.fn(),
      onDropComplete: vi.fn(),
    };

    mockContainer = document.createElement('div');
    mockContainer.className = 'legend-items';

    // Add mock legend item elements with data-value attributes
    mockLegendItems.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'legend-item';
      el.setAttribute('data-value', item.value);
      mockContainer.appendChild(el);
    });

    controller = new DragController(mockHost, mockCallbacks);
  });

  afterEach(() => {
    // restoreDom() schedules a requestAnimationFrame; destroy first so no callback
    // touches a Sortable instance after teardown.
    controller.destroy();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should register with host', () => {
      expect(mockHost.addController).toHaveBeenCalledWith(controller);
    });

    it('should initialize Sortable instance on container', () => {
      controller.initialize(mockContainer);
      expect(controller.getInstance()).not.toBeNull();
      expect(controller.isInitialized()).toBe(true);
    });

    it('should not reinitialize on same container', () => {
      controller.initialize(mockContainer);
      const firstInstance = controller.getInstance();

      controller.initialize(mockContainer);
      const secondInstance = controller.getInstance();

      // Should be the same instance (not reinitialized)
      expect(firstInstance).toBe(secondInstance);
    });

    it('should reinitialize on different container', () => {
      controller.initialize(mockContainer);
      const firstInstance = controller.getInstance();

      const newContainer = document.createElement('div');
      controller.initialize(newContainer);
      const secondInstance = controller.getInstance();

      expect(firstInstance).not.toBe(secondInstance);
    });
  });

  describe('cleanup', () => {
    it('should destroy Sortable instance on disconnect', () => {
      controller.initialize(mockContainer);
      expect(controller.getInstance()).not.toBeNull();

      controller.hostDisconnected();
      expect(controller.getInstance()).toBeNull();
      expect(controller.isInitialized()).toBe(false);
    });

    it('should handle destroy when no instance exists', () => {
      expect(() => controller.destroy()).not.toThrow();
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(controller.isInitialized()).toBe(false);
    });
  });

  describe('drag handlers', () => {
    // The handlers are private; Sortable is the only caller, so reach them through
    // the options the controller handed to it.
    const options = () => controller.getInstance()!.options;
    const row = (value: string) =>
      mockContainer.querySelector<HTMLElement>(`[data-value="${value}"]`)!;
    const rowOrder = () =>
      Array.from(mockContainer.children).map((el) => el.getAttribute('data-value'));
    const stateCallbacks = () => [
      mockCallbacks.setLegendItems,
      mockCallbacks.onReorder,
      mockCallbacks.onMergeToOther,
      mockCallbacks.onSortModeChange,
      mockCallbacks.onDropComplete,
    ];

    /** Run a drag the way Sortable does: start, move the row in the DOM, end. */
    function drag(value: string, oldIndex: number | undefined, newIndex: number | undefined) {
      const item = row(value);
      options().onStart!({ from: mockContainer, item } as Sortable.SortableEvent);
      if (oldIndex !== undefined && newIndex !== undefined) {
        const others = Array.from(mockContainer.children).filter((el) => el !== item);
        mockContainer.insertBefore(item, others[newIndex] ?? null);
      }
      options().onEnd!({ from: mockContainer, item, oldIndex, newIndex } as Sortable.SortableEvent);
    }

    beforeEach(() => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
      row('Other').classList.add('legend-item-other');
      controller.initialize(mockContainer);
    });

    it('reorders: switches to manual sort and reassigns z-orders in the new order', () => {
      drag('cat1', 0, 1);

      expect(mockCallbacks.onSortModeChange).toHaveBeenCalledWith('manual');
      const items = vi.mocked(mockCallbacks.setLegendItems).mock.calls[0][0];
      expect(items.map((i) => [i.value, i.zOrder])).toEqual([
        ['cat2', 0],
        ['cat1', 1],
        ['cat3', 2],
        ['Other', 3],
      ]);
      expect(mockCallbacks.onReorder).toHaveBeenCalledOnce();
      expect(mockCallbacks.onDropComplete).toHaveBeenCalledWith('cat1');
      expect(mockCallbacks.onMergeToOther).not.toHaveBeenCalled();
      // The DOM goes back to its pre-drag order so Lit re-renders it from state.
      expect(rowOrder()).toEqual(['cat1', 'cat2', 'cat3', 'Other']);
      expect(mockHost.requestUpdate).toHaveBeenCalled();
    });

    it('highlights Other and refuses the move while hovering it', () => {
      const result = options().onMove!(
        { related: row('Other') } as Sortable.MoveEvent,
        new MouseEvent('mousemove'),
      );

      expect(result).toBe(false);
      expect(row('Other').classList.contains('legend-item-merge-target')).toBe(true);

      options().onMove!(
        { related: row('cat2') } as Sortable.MoveEvent,
        new MouseEvent('mousemove'),
      );
      expect(row('Other').classList.contains('legend-item-merge-target')).toBe(false);
    });

    it('merges into Other when dropped while Other is highlighted', () => {
      options().onMove!(
        { related: row('Other') } as Sortable.MoveEvent,
        new MouseEvent('mousemove'),
      );
      // Sortable reports no index change: onMove returned false.
      drag('cat2', 1, 1);

      expect(mockCallbacks.onMergeToOther).toHaveBeenCalledWith('cat2');
      expect(row('Other').classList.contains('legend-item-merge-target')).toBe(false);
      expect(mockCallbacks.setLegendItems).not.toHaveBeenCalled();
      expect(mockCallbacks.onReorder).not.toHaveBeenCalled();
    });

    it("merges into Other when the drop lands on Other's index", () => {
      drag('cat1', 0, 3);

      expect(mockCallbacks.onMergeToOther).toHaveBeenCalledWith('cat1');
      expect(mockCallbacks.setLegendItems).not.toHaveBeenCalled();
      expect(rowOrder()).toEqual(['cat1', 'cat2', 'cat3', 'Other']);
    });

    it('refuses a drop past Other', () => {
      // With Other last, a drop on its index is the merge above; the guard only
      // sees an index past the end of the item list.
      drag('cat1', 0, 4);

      for (const callback of stateCallbacks()) expect(callback).not.toHaveBeenCalled();
      expect(rowOrder()).toEqual(['cat1', 'cat2', 'cat3', 'Other']);
    });

    it.each([
      ['the same index', 'cat2', 1, 1],
      ['an undefined index', 'cat2', 1, undefined],
      // Sortable's indices disagree with the z-order, but the item is already in place.
      ['an unchanged order', 'cat1', 1, 0],
    ])('does nothing for %s', (_label, value, oldIndex, newIndex) => {
      drag(value, oldIndex, newIndex);

      for (const callback of stateCallbacks()) expect(callback).not.toHaveBeenCalled();
      expect(rowOrder()).toEqual(['cat1', 'cat2', 'cat3', 'Other']);
    });

    it('does nothing for a row without data-value', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      row('cat2').removeAttribute('data-value');

      options().onEnd!({
        from: mockContainer,
        item: mockContainer.children[1],
        oldIndex: 1,
        newIndex: 0,
      } as Sortable.SortableEvent);

      for (const callback of stateCallbacks()) expect(callback).not.toHaveBeenCalled();
    });

    it('does nothing for a row the legend does not know', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      row('cat2').setAttribute('data-value', 'stale');

      options().onEnd!({
        from: mockContainer,
        item: mockContainer.children[1],
        oldIndex: 1,
        newIndex: 0,
      } as Sortable.SortableEvent);

      for (const callback of stateCallbacks()) expect(callback).not.toHaveBeenCalled();
    });
  });
});
