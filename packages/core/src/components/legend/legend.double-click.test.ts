// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import './legend';
import { LEGEND_EVENTS } from './config';
import {
  mountLegendWithScatterplot,
  type MockScatterplot,
} from './test-support/legend-scatterplot-harness';

// Hidden values persist per dataset: an in-memory store keeps one test's clicks out of the next.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

function makeData(): VisualizationData {
  return {
    protein_ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(12) }],
    annotations: {
      family: {
        kind: 'categorical',
        values: ['A', 'B', 'C'],
        colors: ['#ff0000', '#00ff00', '#0000ff'],
        shapes: ['circle', 'circle', 'circle'],
      },
    },
    annotation_data: { family: new Int32Array([0, 0, 0, 1, 1, 2]) },
  };
}

async function setup() {
  const mounted = await mountLegendWithScatterplot(makeData(), 'family');
  const { legend, plot } = mounted;

  // Every hidden set the legend hands the plot: a state the plot would stage on its own.
  const handedToPlot: string[][] = [];
  Object.defineProperty(plot, 'hiddenAnnotationValues', {
    configurable: true,
    get: () => handedToPlot.at(-1) ?? [],
    set: (next: string[]) => {
      handedToPlot.push([...next]);
    },
  });
  const actions: string[] = [];
  legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) => {
    actions.push(`${e.detail.action}:${e.detail.value}`);
  }) as EventListener);

  const main = (value: string) =>
    legend.shadowRoot!.querySelector(`[data-value="${value}"] .legend-item-main`) as HTMLElement;
  const click = (value: string, detail: number, pointerType?: string) => {
    const event = new MouseEvent('click', { bubbles: true, composed: true, detail });
    if (pointerType) Object.defineProperty(event, 'pointerType', { value: pointerType });
    main(value).dispatchEvent(event);
  };
  const dblclick = (value: string) =>
    main(value).dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, composed: true, detail: 2 }),
    );
  const key = (value: string, k: string) =>
    main(value).dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
    );
  const visible = () =>
    (legend as unknown as { _legendItems: { value: string; isVisible: boolean }[] })._legendItems
      .filter((i) => i.isVisible)
      .map((i) => i.value)
      .sort();

  return {
    ...mounted,
    handedToPlot,
    actions,
    click,
    dblclick,
    key,
    visible,
    plot: plot as MockScatterplot,
  };
}

describe('legend item double-click', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles a single click at once', async () => {
    const { click, visible, handedToPlot, actions } = await setup();

    click('A', 1);

    expect(visible()).toEqual(['B', 'C']);
    expect(handedToPlot).toEqual([['A']]);
    expect(actions).toEqual(['toggle:A']);
  });

  it('isolates on click, click, dblclick without a show in between', async () => {
    const { click, dblclick, visible, handedToPlot, actions } = await setup();

    click('A', 1);
    click('A', 2);
    dblclick('A');

    expect(visible()).toEqual(['A']);
    // The hide of the first click, then the isolate: no hide -> show -> isolate.
    expect(handedToPlot).toEqual([['A'], ['B', 'C']]);
    expect(actions).toEqual(['toggle:A', 'isolate:A']);
  });

  it('isolates a hidden item', async () => {
    const { click, dblclick, visible, handedToPlot } = await setup();
    click('A', 1);
    const hidden = handedToPlot.length;

    click('A', 1);
    click('A', 2);
    dblclick('A');

    expect(visible()).toEqual(['A']);
    expect(handedToPlot.slice(hidden)).toEqual([[], ['B', 'C']]);
  });

  it('toggles the second click of two clicks on different items', async () => {
    const { click, visible } = await setup();

    click('A', 1);
    click('B', 2);

    expect(visible()).toEqual(['C']);
  });

  it('toggles every click of a triple click after the double-click isolated', async () => {
    const { click, dblclick, visible } = await setup();

    click('A', 1);
    click('A', 2);
    dblclick('A');
    click('A', 3);

    // The third click hides the only visible item, which shows everything again.
    expect(visible()).toEqual(['A', 'B', 'C']);
  });

  it('toggles a click with no detail, as a screen reader or script sends it', async () => {
    const { click, visible, handedToPlot } = await setup();

    click('A', 0);
    click('A', 0);

    expect(visible()).toEqual(['A', 'B', 'C']);
    expect(handedToPlot).toEqual([['A'], []]);
  });

  it('keeps toggling both taps of a touch double-tap, then isolates', async () => {
    const { click, dblclick, visible, handedToPlot } = await setup();

    click('A', 1, 'touch');
    click('A', 2, 'touch');
    expect(visible()).toEqual(['A', 'B', 'C']);
    dblclick('A');

    expect(visible()).toEqual(['A']);
    expect(handedToPlot).toEqual([['A'], [], ['B', 'C']]);
  });

  it('isolates on a dblclick that no click preceded', async () => {
    const { dblclick, visible, handedToPlot } = await setup();

    dblclick('A');

    expect(visible()).toEqual(['A']);
    expect(handedToPlot).toEqual([['B', 'C']]);
  });

  it('leaves the keyboard paths as they were', async () => {
    const { key, visible, actions } = await setup();

    key('A', 'Enter');
    expect(visible()).toEqual(['B', 'C']);
    key('A', ' ');
    expect(visible()).toEqual(['A', 'B', 'C']);
    key('B', 'i');
    expect(visible()).toEqual(['B']);

    expect(actions).toEqual(['toggle:A', 'toggle:A', 'isolate:B']);
  });
});
