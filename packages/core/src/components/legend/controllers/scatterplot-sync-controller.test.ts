/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactiveControllerHost } from 'lit';
import {
  ScatterplotSyncController,
  type ScatterplotSyncCallbacks,
} from './scatterplot-sync-controller';
import type { IScatterplotElement } from '../scatterplot-interface';
import { LEGEND_EVENTS } from '../config';

describe('ScatterplotSyncController', () => {
  let controller: ScatterplotSyncController;
  let mockHost: ReactiveControllerHost & Element;
  let mockCallbacks: ScatterplotSyncCallbacks;
  let mockScatterplot: IScatterplotElement;

  beforeEach(() => {
    vi.useFakeTimers();

    mockHost = Object.assign(document.createElement('div'), {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    });

    mockCallbacks = {
      onDataChange: vi.fn(),
      onAnnotationChange: vi.fn(),
      getHiddenValues: vi.fn().mockReturnValue([]),
      getOtherItems: vi.fn().mockReturnValue([]),
      getLegendItems: vi.fn().mockReturnValue([
        { value: 'cat1', zOrder: 0, color: '#f00', shape: 'circle' },
        { value: 'cat2', zOrder: 1, color: '#0f0', shape: 'square' },
      ]),
      getOtherConcreteValues: vi.fn().mockReturnValue([]),
    };

    mockScatterplot = createMockScatterplot();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up any added elements
    document.body.innerHTML = '';
  });

  describe('constructor', () => {
    it('registers itself with the host', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      expect(mockHost.addController).toHaveBeenCalledWith(controller);
    });

    it('initializes with default settings', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      expect(controller.scatterplotSelector).toBe('protspace-scatterplot');
      expect(controller.autoSync).toBe(true);
      expect(controller.autoHide).toBe(true);
    });
  });

  describe('hostConnected', () => {
    it('attempts to discover scatterplot when autoSync is true', () => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      expect(controller.scatterplot).toBe(mockScatterplot);
    });

    it('does not discover scatterplot when autoSync is false', () => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.autoSync = false;
      controller.hostConnected();

      expect(controller.scatterplot).toBe(null);
    });

    it('retries discovery when scatterplot not immediately available', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      expect(controller.scatterplot).toBe(null);

      // Add scatterplot after a delay
      document.body.appendChild(mockScatterplot as unknown as Node);
      vi.advanceTimersByTime(150); // First retry at 100ms

      expect(controller.scatterplot).toBe(mockScatterplot);
    });
  });

  describe('hostDisconnected', () => {
    it('cleans up event listeners and discovery mechanisms', () => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      const removeEventListenerSpy = vi.spyOn(mockScatterplot, 'removeEventListener');
      controller.hostDisconnected();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        LEGEND_EVENTS.DATA_CHANGE,
        expect.any(Function),
      );
    });

    it('stops discovery retries', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      controller.hostDisconnected();

      // Add scatterplot after disconnect - should not be discovered
      document.body.appendChild(mockScatterplot as unknown as Node);
      vi.advanceTimersByTime(1000);

      expect(controller.scatterplot).toBe(null);
    });
  });

  describe('scatterplot getter', () => {
    it('returns null when no scatterplot discovered', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      expect(controller.scatterplot).toBe(null);
    });

    it('returns the discovered scatterplot element', () => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      expect(controller.scatterplot).toBe(mockScatterplot);
    });
  });

  describe('isMultilabelAnnotation', () => {
    beforeEach(() => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();
    });

    it('returns false when no scatterplot', () => {
      controller.hostDisconnected();
      expect(controller.isMultilabelAnnotation('annotation')).toBe(false);
    });

    it('returns false for single-value annotations', () => {
      mockScatterplot.getCurrentData = () => ({
        protein_ids: ['p1', 'p2'],
        projections: [],
        annotations: { single: { values: ['a', 'b'] } },
        annotation_data: {
          single: [0, 1],
        },
      });

      expect(controller.isMultilabelAnnotation('single')).toBe(false);
    });

    it('returns true for multilabel annotations', () => {
      mockScatterplot.getCurrentData = () => ({
        protein_ids: ['p1', 'p2'],
        projections: [],
        annotations: { multi: { values: ['a;b', 'c'] } },
        annotation_data: {
          multi: [[0, 1], [2]],
        },
      });

      expect(controller.isMultilabelAnnotation('multi')).toBe(true);
    });

    it('returns false when annotation data is missing', () => {
      mockScatterplot.getCurrentData = () => ({
        protein_ids: ['p1'],
        projections: [],
        annotations: {},
        annotation_data: {},
      });

      expect(controller.isMultilabelAnnotation('missing')).toBe(false);
    });
  });

  describe('forceSync', () => {
    it('calls onDataChange callback with current data', () => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      // Reset the mock after initial sync
      vi.mocked(mockCallbacks.onDataChange).mockClear();

      controller.forceSync();

      expect(mockCallbacks.onDataChange).toHaveBeenCalledWith(expect.any(Object), 'test-feature');
    });

    it('does nothing when no scatterplot', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.forceSync();

      expect(mockCallbacks.onDataChange).not.toHaveBeenCalled();
    });
  });

  describe('syncHiddenValues', () => {
    beforeEach(() => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();
    });

    it('syncs hidden values to scatterplot', () => {
      mockCallbacks.getHiddenValues = vi.fn().mockReturnValue(['hidden1', 'hidden2']);
      mockCallbacks.getOtherItems = vi.fn().mockReturnValue([]);

      controller.syncHiddenValues();

      expect(mockScatterplot.hiddenAnnotationValues).toEqual(['hidden1', 'hidden2']);
    });

    it('expands Other to concrete values', () => {
      mockCallbacks.getHiddenValues = vi.fn().mockReturnValue(['Other']);
      mockCallbacks.getOtherItems = vi.fn().mockReturnValue([
        { value: 'other1', count: 5 },
        { value: 'other2', count: 3 },
      ]);

      controller.syncHiddenValues();

      expect(mockScatterplot.hiddenAnnotationValues).toEqual(['other1', 'other2']);
    });

    it('syncs other concrete values', () => {
      mockCallbacks.getOtherConcreteValues = vi.fn().mockReturnValue(['other1', 'other2']);

      controller.syncHiddenValues();

      expect(mockScatterplot.otherAnnotationValues).toEqual(['other1', 'other2']);
    });

    it('does nothing when autoHide is false', () => {
      controller.autoHide = false;
      mockCallbacks.getHiddenValues = vi.fn().mockReturnValue(['hidden1']);

      controller.syncHiddenValues();

      expect(mockScatterplot.hiddenAnnotationValues).toEqual([]);
    });
  });

  describe('syncOtherValues', () => {
    beforeEach(() => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();
    });

    it('syncs other concrete values to scatterplot', () => {
      mockCallbacks.getOtherConcreteValues = vi.fn().mockReturnValue(['a', 'b', 'c']);

      controller.syncOtherValues();

      expect(mockScatterplot.otherAnnotationValues).toEqual(['a', 'b', 'c']);
    });
  });

  describe('updateConfig', () => {
    beforeEach(() => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();
    });

    it('updates scatterplot config with new values', () => {
      mockScatterplot.config = { existing: 'value' };

      controller.updateConfig({ pointSize: 100 });

      expect(mockScatterplot.config).toEqual({
        existing: 'value',
        pointSize: 100,
      });
    });

    it('preserves existing config values', () => {
      mockScatterplot.config = { a: 1, b: 2 };

      controller.updateConfig({ b: 3, c: 4 });

      expect(mockScatterplot.config).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('preserves config identity for no-op updates', () => {
      mockScatterplot.config = { pointSize: 100 };
      const previousConfig = mockScatterplot.config;

      controller.updateConfig({ pointSize: 100 });

      expect(mockScatterplot.config).toBe(previousConfig);
    });
  });

  describe('syncNumericAnnotationSettings', () => {
    beforeEach(() => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();
    });

    it('preserves scatterplot property identities when numeric settings are unchanged', () => {
      const numericAnnotationSettings = {};
      const annotationSortModes = { score: 'size-desc' as const };
      const numericManualOrderIdsByAnnotation = {};
      mockCallbacks.getNumericAnnotationSettings = vi
        .fn()
        .mockReturnValue(numericAnnotationSettings);
      mockCallbacks.getAnnotationSortModes = vi.fn().mockReturnValue(annotationSortModes);
      mockCallbacks.getNumericManualOrderIds = vi
        .fn()
        .mockReturnValue(numericManualOrderIdsByAnnotation);

      controller.syncNumericAnnotationSettings();
      controller.syncNumericAnnotationSettings();

      expect(mockScatterplot.numericAnnotationSettings).toBe(numericAnnotationSettings);
      expect(mockScatterplot.annotationSortModes).toBe(annotationSortModes);
      expect(mockScatterplot.numericManualOrderIdsByAnnotation).toBe(
        numericManualOrderIdsByAnnotation,
      );
    });
  });

  describe('dispatchZOrderChange', () => {
    it('dispatches event to scatterplot when available', () => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      const dispatchSpy = vi.spyOn(mockScatterplot, 'dispatchEvent');

      controller.dispatchZOrderChange();

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LEGEND_EVENTS.ZORDER_CHANGE,
          detail: {
            zOrderMapping: { cat1: 0, cat2: 1 },
          },
        }),
      );
    });

    it('dispatches bubbling event to host when no scatterplot', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      const dispatchSpy = vi.spyOn(mockHost, 'dispatchEvent');

      controller.dispatchZOrderChange();

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LEGEND_EVENTS.ZORDER_CHANGE,
          bubbles: true,
        }),
      );
    });
  });

  describe('dispatchColorMappingChange', () => {
    it('dispatches event with color and shape mappings', () => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      const dispatchSpy = vi.spyOn(mockScatterplot, 'dispatchEvent');

      controller.dispatchColorMappingChange();

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LEGEND_EVENTS.COLORMAPPING_CHANGE,
          detail: {
            colorMapping: { cat1: '#f00', cat2: '#0f0' },
            shapeMapping: { cat1: 'circle', cat2: 'square' },
            colorOnly: false,
          },
        }),
      );
    });
  });

  describe('getIsolationState', () => {
    it('returns default state when no scatterplot', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);

      const state = controller.getIsolationState();

      expect(state).toEqual({
        isolationMode: false,
        isolationHistory: [],
      });
    });

    it('returns isolation state from scatterplot', () => {
      mockScatterplot.isIsolationMode = () => true;
      mockScatterplot.getIsolationHistory = () => [['p1', 'p2']];

      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      const state = controller.getIsolationState();

      expect(state).toEqual({
        isolationMode: true,
        isolationHistory: [['p1', 'p2']],
      });
    });

    it('returns false for isolation mode when not supported', () => {
      delete mockScatterplot.isIsolationMode;
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      const state = controller.getIsolationState();

      expect(state.isolationMode).toBe(false);
    });
  });

  describe('event handling', () => {
    beforeEach(() => {
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();
      vi.mocked(mockCallbacks.onDataChange).mockClear();
    });

    it('handles data-change events from scatterplot', () => {
      const event = new CustomEvent(LEGEND_EVENTS.DATA_CHANGE, {
        detail: { data: { protein_ids: ['p1'] } },
      });
      mockScatterplot.dispatchEvent(event);

      expect(mockCallbacks.onDataChange).toHaveBeenCalled();
    });

    it('handles annotation-change events from control bar', () => {
      const controlBar = document.createElement('protspace-control-bar');
      document.body.appendChild(controlBar);

      // Reconnect to pick up the control bar
      controller.hostDisconnected();
      controller.hostConnected();

      const event = new CustomEvent(LEGEND_EVENTS.ANNOTATION_CHANGE, {
        detail: { annotation: 'new-annotation' },
      });
      controlBar.dispatchEvent(event);

      expect(mockCallbacks.onAnnotationChange).toHaveBeenCalledWith('new-annotation');
    });
  });

  describe('discovery with MutationObserver', () => {
    it('discovers scatterplot when added to DOM dynamically', async () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      expect(controller.scatterplot).toBe(null);

      // Simulate dynamic addition
      document.body.appendChild(mockScatterplot as unknown as Node);

      // Allow MutationObserver to fire
      await vi.runAllTimersAsync();

      expect(controller.scatterplot).toBe(mockScatterplot);
    });

    it('stops all discovery after max attempts', () => {
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      // Run through all retry attempts (10 * 100ms = 1000ms)
      // Implementation cleans up MutationObserver after max retries
      vi.advanceTimersByTime(1100);

      expect(controller.scatterplot).toBe(null);

      // Add scatterplot after max retries - should NOT be discovered
      // because all discovery mechanisms are cleaned up
      document.body.appendChild(mockScatterplot as unknown as Node);
      vi.advanceTimersByTime(200);

      expect(controller.scatterplot).toBe(null);
    });
  });
});

/**
 * Creates a mock scatterplot element with the required interface
 */
function createMockScatterplot(): IScatterplotElement {
  const element = document.createElement('protspace-scatterplot') as unknown as IScatterplotElement;

  element.getCurrentData = vi.fn().mockReturnValue({
    protein_ids: ['p1', 'p2'],
    projections: { pca: { x: [0, 1], y: [0, 1] } },
    annotations: ['test-feature'],
    annotation_data: { 'test-feature': ['a', 'b'] },
  });

  Object.defineProperty(element, 'selectedAnnotation', {
    value: 'test-feature',
    writable: true,
    configurable: true,
  });

  element.hiddenAnnotationValues = [];
  element.otherAnnotationValues = [];
  element.config = {};

  return element;
}
