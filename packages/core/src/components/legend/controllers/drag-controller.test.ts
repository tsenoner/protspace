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
      getDisplayedItems: vi.fn().mockReturnValue(mockLegendItems),
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

  describe('touch drag', () => {
    it('delays a drag only for touch, so a swipe over a handle scrolls the list', () => {
      controller.initialize(mockContainer);
      const sortable = controller.getInstance()!;
      expect(sortable.option('handle')).toBe('.drag-handle');
      expect(sortable.option('delay')).toBe(250);
      expect(sortable.option('delayOnTouchOnly')).toBe(true);
      // Sortable keeps 5 where it drags by touch itself (Chrome for Android, iOS); where it uses
      // native drag and drop, as in jsdom, it forces 1.
      const native = (sortable as unknown as { nativeDraggable: boolean }).nativeDraggable;
      expect(sortable.option('touchStartThreshold')).toBe(native ? 1 : 5);
      expect(sortable.option('fallbackClass')).toBe('sortable-fallback');
    });

    it('does not put the floating row copy back when it restores the rows', () => {
      controller.initialize(mockContainer);
      const sortable = controller.getInstance()!;
      const ghost = document.createElement('div');
      ghost.className = 'legend-item sortable-fallback';
      mockContainer.appendChild(ghost);

      sortable.option('onStart')!({ from: mockContainer } as Sortable.SortableEvent);
      // Sortable takes the copy away on drop, before `onEnd`.
      ghost.remove();
      sortable.option('onEnd')!({
        from: mockContainer,
        item: mockContainer.children[0] as HTMLElement,
        oldIndex: 0,
        newIndex: 0,
      } as Sortable.SortableEvent);

      expect(mockContainer.querySelector('.sortable-fallback')).toBeNull();
      expect(mockContainer.children).toHaveLength(mockLegendItems.length);
    });

    it('removes a leftover .sortable-fallback on end', () => {
      controller.initialize(mockContainer);
      const sortable = controller.getInstance()!;
      const ghost = document.createElement('div');
      ghost.className = 'legend-item sortable-fallback';
      mockContainer.appendChild(ghost);

      sortable.option('onStart')!({ from: mockContainer } as Sortable.SortableEvent);
      sortable.option('onEnd')!({
        from: mockContainer,
        item: mockContainer.children[0] as HTMLElement,
        oldIndex: 0,
        newIndex: 0,
      } as Sortable.SortableEvent);

      expect(mockContainer.querySelector('.sortable-fallback')).toBeNull();
      expect(mockContainer.children).toHaveLength(mockLegendItems.length);
    });

    it('keeps a finger move from scrolling the list only while a row is lifted', () => {
      controller.initialize(mockContainer);
      const sortable = controller.getInstance()!;
      const move = () => {
        const event = new Event('touchmove', { bubbles: true, cancelable: true });
        mockContainer.children[0].dispatchEvent(event);
        return event.defaultPrevented;
      };

      expect(move()).toBe(false);
      sortable.option('onStart')!({ from: mockContainer } as Sortable.SortableEvent);
      expect(move()).toBe(true);
      sortable.option('onEnd')!({
        from: mockContainer,
        item: mockContainer.children[0] as HTMLElement,
        oldIndex: 0,
        newIndex: 0,
      } as Sortable.SortableEvent);
      expect(move()).toBe(false);
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

    it('reorders by the drawn order when a separation sort draws rows off their zOrder', () => {
      // silhouette-desc draws cat3, cat1, cat2, Other; the zOrder is still cat1, cat2, cat3.
      const drawn = ['cat3', 'cat1', 'cat2', 'Other'].map(
        (value) => mockLegendItems.find((item) => item.value === value)!,
      );
      vi.mocked(mockCallbacks.getDisplayedItems).mockReturnValue(drawn);
      for (const item of drawn) mockContainer.appendChild(row(item.value));

      // Drag the third row (cat2) to the top.
      drag('cat2', 2, 0);

      const items = vi.mocked(mockCallbacks.setLegendItems).mock.calls[0][0];
      expect(items.map((i) => [i.value, i.zOrder])).toEqual([
        ['cat2', 0],
        ['cat3', 1],
        ['cat1', 2],
        ['Other', 3],
      ]);
      expect(mockCallbacks.onSortModeChange).toHaveBeenCalledWith('manual');
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

    it.each([
      ['without data-value', (el: HTMLElement) => el.removeAttribute('data-value')],
      ['the legend does not know', (el: HTMLElement) => el.setAttribute('data-value', 'stale')],
    ])('does nothing for a row %s', (_label, corrupt) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const item = row('cat2');
      corrupt(item);

      options().onEnd!({
        from: mockContainer,
        item,
        oldIndex: 1,
        newIndex: 0,
      } as Sortable.SortableEvent);

      for (const callback of stateCallbacks()) expect(callback).not.toHaveBeenCalled();
    });
  });
});
