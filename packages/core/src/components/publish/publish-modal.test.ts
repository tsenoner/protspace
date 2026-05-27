/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import './publish-modal';
import type { ProtspacePublishModal } from './publish-modal';

interface PublishInternals {
  _state: {
    widthPx: number;
    heightPx: number;
    dpi: number;
    resample: boolean;
    aspectLocked: boolean;
    unit: 'px' | 'mm' | 'in' | 'cm';
    preset: string;
  };
  _legendItems: Array<{ value: string }>;
  _legendTitle: string;
}

function makeModal(): ProtspacePublishModal {
  const modal = document.createElement('protspace-publish-modal') as ProtspacePublishModal;
  document.body.appendChild(modal);
  return modal;
}

describe('<protspace-publish-modal> legend reader', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads legend state from legendElement property when provided', async () => {
    const legend = document.createElement('div') as unknown as HTMLElement & {
      getLegendExportData: () => unknown;
    };
    legend.getLegendExportData = () => ({
      annotation: 'family',
      otherItemsCount: 0,
      items: [{ value: 'A', color: '#fff', shape: 'circle', count: 1, isVisible: true }],
    });

    const modal = makeModal();
    (modal as unknown as { legendElement: HTMLElement }).legendElement = legend;
    await modal.updateComplete;

    const internals = modal as unknown as PublishInternals;
    expect(internals._legendTitle).toBe('family');
    expect(internals._legendItems).toHaveLength(1);
    expect(internals._legendItems[0].value).toBe('A');
  });
});

describe('<protspace-publish-modal> dimensions section', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders width input in mm by default', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const widthInput = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="width"]',
    );
    expect(widthInput).not.toBeNull();
    // Default state is flexible, 2048 px @ 300 dpi → 173.4 mm
    expect(parseFloat(widthInput!.value)).toBeCloseTo(173.4, 0);
  });

  it('typing width-mm with Resample=ON updates widthPx', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;
    const widthInput = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="width"]',
    )!;
    widthInput.value = '89';
    widthInput.dispatchEvent(new Event('change'));
    await modal.updateComplete;
    // 89 mm @ 300 dpi = 1051 px
    expect(internals._state.widthPx).toBe(1051);
    expect(internals._state.resample).toBe(true);
  });

  it('toggling Resample=OFF then changing DPI does not change widthPx', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;
    const initialPx = internals._state.widthPx;

    const resampleCb = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="resample"]',
    )!;
    resampleCb.checked = false;
    resampleCb.dispatchEvent(new Event('change'));
    await modal.updateComplete;

    const dpiInput = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="dpi"]',
    )!;
    dpiInput.value = '600';
    dpiInput.dispatchEvent(new Event('change'));
    await modal.updateComplete;

    expect(internals._state.widthPx).toBe(initialPx);
    expect(internals._state.dpi).toBe(600);
  });

  it('clicking the chain-link icon toggles aspectLocked', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;
    expect(internals._state.aspectLocked).toBe(true);
    const chainBtn = modal.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-publish-input="aspect-lock"]',
    )!;
    chainBtn.click();
    await modal.updateComplete;
    expect(internals._state.aspectLocked).toBe(false);
  });

  it('shows the chain link svg group corresponding to the current locked state', async () => {
    const modal = makeModal();
    await modal.updateComplete;

    const chainBtn = modal.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-publish-input="aspect-lock"]',
    )!;

    // Default state: locked. The locked group should be in the DOM.
    expect(chainBtn.classList.contains('locked')).toBe(true);
    expect(chainBtn.querySelector('.aspect-lock-state-locked')).not.toBeNull();
    expect(chainBtn.querySelector('.aspect-lock-state-unlocked')).not.toBeNull();
    // Both groups exist; CSS toggles which is visible.

    // Toggle off and confirm the class flips on the button.
    chainBtn.click();
    await modal.updateComplete;
    expect(chainBtn.classList.contains('locked')).toBe(false);
  });

  it('renders bracket paths that connect Width and Height to the chain', async () => {
    const modal = makeModal();
    await modal.updateComplete;

    const chainBtn = modal.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-publish-input="aspect-lock"]',
    )!;
    const brackets = chainBtn.querySelectorAll('.aspect-lock-bracket');
    // At least two bracket paths: one above the chain (toward width row),
    // one below (toward height row). Decorative spurs may add more.
    expect(brackets.length).toBeGreaterThanOrEqual(2);
  });

  it('does not render the memory MB readout', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector('.publish-dim-memory')).toBeNull();
    expect(modal.shadowRoot!.textContent).not.toMatch(/MB in memory/);
  });

  it('clicking a preset while Resample=OFF flips Resample=ON', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;

    // Turn Resample off first.
    const resampleCb = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="resample"]',
    )!;
    resampleCb.checked = false;
    resampleCb.dispatchEvent(new Event('change'));
    await modal.updateComplete;
    expect(internals._state.resample).toBe(false);

    // Click Nature 1 col preset.
    const presetBtns = modal.shadowRoot!.querySelectorAll<HTMLButtonElement>('.publish-preset-btn');
    const nature1 = Array.from(presetBtns).find((b) => /Nature.*1 col/i.test(b.textContent ?? ''));
    expect(nature1).not.toBeUndefined();
    nature1!.click();
    await modal.updateComplete;

    expect(internals._state.resample).toBe(true);
    expect(internals._state.preset).toBe('nature-1col');
  });

  it('applying a preset preserves the current aspect ratio', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;

    // Force a non-default aspect ratio (3:2 portrait-ish).
    internals._state = { ...internals._state, widthPx: 2000, heightPx: 1500 };
    const aspectBefore = internals._state.heightPx / internals._state.widthPx;
    expect(aspectBefore).toBeCloseTo(0.75, 4);

    // Apply Nature 1-col preset (89mm @ 300 dpi → 1051px wide; preset would
    // otherwise force max height 247mm = 2917px).
    const presetBtns = modal.shadowRoot!.querySelectorAll<HTMLButtonElement>('.publish-preset-btn');
    const nature1 = Array.from(presetBtns).find((b) => /Nature.*1 col/i.test(b.textContent ?? ''));
    nature1!.click();
    await modal.updateComplete;

    expect(internals._state.widthPx).toBe(1051);
    // Aspect must match what we had before, not the preset's max-height aspect.
    const aspectAfter = internals._state.heightPx / internals._state.widthPx;
    expect(aspectAfter).toBeCloseTo(aspectBefore, 2);
    // Concretely: 1051 × 0.75 ≈ 788
    expect(internals._state.heightPx).toBe(788);
  });

  it('applying a preset clamps height at the preset max-height', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;

    // Force a very tall aspect ratio (5:1) that would exceed Nature's 247mm cap.
    internals._state = { ...internals._state, widthPx: 1000, heightPx: 5000 };

    const presetBtns = modal.shadowRoot!.querySelectorAll<HTMLButtonElement>('.publish-preset-btn');
    const nature1 = Array.from(presetBtns).find((b) => /Nature.*1 col/i.test(b.textContent ?? ''));
    nature1!.click();
    await modal.updateComplete;

    // Width pinned to 1051. Aspect 5.0 × 1051 = 5255, but cap is
    // mmToPx(247, 300) = round(247 × 300 / 25.4) = 2917.
    expect(internals._state.widthPx).toBe(1051);
    expect(internals._state.heightPx).toBe(2917);
  });

  it('width input is disabled while a journal preset is active', async () => {
    const modal = makeModal();
    await modal.updateComplete;

    const presetBtns = modal.shadowRoot!.querySelectorAll<HTMLButtonElement>('.publish-preset-btn');
    const nature1 = Array.from(presetBtns).find((b) => /Nature.*1 col/i.test(b.textContent ?? ''));
    nature1!.click();
    await modal.updateComplete;

    const widthInput = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="width"]',
    )!;
    const widthSlider = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="width-slider"]',
    )!;
    expect(widthInput.disabled).toBe(true);
    expect(widthSlider.disabled).toBe(true);

    // Height stays editable.
    const heightInput = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="height"]',
    )!;
    expect(heightInput.disabled).toBe(false);
  });

  it('editing height while a preset is active clamps at maxHeightMm and keeps preset', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;

    const presetBtns = modal.shadowRoot!.querySelectorAll<HTMLButtonElement>('.publish-preset-btn');
    const nature1 = Array.from(presetBtns).find((b) => /Nature.*1 col/i.test(b.textContent ?? ''));
    nature1!.click();
    await modal.updateComplete;
    expect(internals._state.preset).toBe('nature-1col');

    // Try to push height beyond Nature's 247mm = 2917px cap.
    const heightSlider = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="height-slider"]',
    )!;
    heightSlider.value = '8000';
    heightSlider.dispatchEvent(new Event('input'));
    await modal.updateComplete;

    expect(internals._state.heightPx).toBe(2917);
    // Preset stays — clamping is part of the preset, not a custom edit.
    expect(internals._state.preset).toBe('nature-1col');
    // Width also stays pinned to preset.
    expect(internals._state.widthPx).toBe(1051);
  });

  it('aspect-lock chain is disabled and renders unlocked while a preset pins width', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;

    const presetBtns = modal.shadowRoot!.querySelectorAll<HTMLButtonElement>('.publish-preset-btn');
    const nature1 = Array.from(presetBtns).find((b) => /Nature.*1 col/i.test(b.textContent ?? ''));
    nature1!.click();
    await modal.updateComplete;

    const chainBtn = modal.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-publish-input="aspect-lock"]',
    )!;
    // Even though aspectLocked is true in state, the visual must show unlocked
    // because width can't move with height — the link is meaningless.
    expect(internals._state.aspectLocked).toBe(true);
    expect(chainBtn.disabled).toBe(true);
    expect(chainBtn.classList.contains('locked')).toBe(false);
    expect(chainBtn.title).toMatch(/journal preset/i);

    // Clicking the disabled chain must not flip aspectLocked.
    chainBtn.click();
    await modal.updateComplete;
    expect(internals._state.aspectLocked).toBe(true);

    // Switching to flexible re-enables the chain.
    const flexible = Array.from(presetBtns).find((b) => /Flexible/i.test(b.textContent ?? ''));
    flexible!.click();
    await modal.updateComplete;
    expect(chainBtn.disabled).toBe(false);
    expect(chainBtn.classList.contains('locked')).toBe(true);
  });

  it('editing height within bounds stays in preset', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as PublishInternals;

    const presetBtns = modal.shadowRoot!.querySelectorAll<HTMLButtonElement>('.publish-preset-btn');
    const nature1 = Array.from(presetBtns).find((b) => /Nature.*1 col/i.test(b.textContent ?? ''));
    nature1!.click();
    await modal.updateComplete;

    const heightInput = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="height"]',
    )!;
    // Default unit is mm; 100mm @ 300 dpi = 1181px, well under cap.
    heightInput.value = '100';
    heightInput.dispatchEvent(new Event('change'));
    await modal.updateComplete;

    expect(internals._state.heightPx).toBe(1181);
    expect(internals._state.preset).toBe('nature-1col');
    expect(internals._state.widthPx).toBe(1051);
  });
});

interface InsetInternals {
  _state: {
    insets: Array<{
      sourceRect: { x: number; y: number; w: number; h: number };
      targetRect: { x: number; y: number; w: number; h: number };
      border: number;
      connector: string;
      pointSizeScale?: number;
    }>;
  };
  _captureInsetRenders: (
    plotEl: unknown,
    state: unknown,
    plotRect: { w: number; h: number },
    bgColor: string,
  ) => Array<HTMLCanvasElement | null>;
  _lastInsetCanvases: Array<HTMLCanvasElement | null>;
  _lastInsetRenderAt: number;
  _insetRenderCache: Map<string, HTMLCanvasElement>;
  _settleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Stub plot element that returns a 4×4 canvas tagged via dataset so tests
 * can verify which call produced which canvas, plus the geometric-zoom hooks
 * (getDataExtent, getRenderInfo) the modal relies on.
 */
function makeStubPlot(): {
  element: HTMLElement;
  callCount: () => number;
  reset: () => void;
} {
  let calls = 0;
  const el = document.createElement('div') as HTMLElement & {
    captureAtResolution: (w: number, h: number, opts: Record<string, unknown>) => HTMLCanvasElement;
    getDataExtent: () => { xMin: number; xMax: number; yMin: number; yMax: number };
    getRenderInfo: () => {
      marginLeft: number;
      marginRight: number;
      marginTop: number;
      marginBottom: number;
    };
  };
  el.captureAtResolution = (w, h) => {
    calls++;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    c.dataset.callIndex = String(calls);
    return c;
  };
  el.getDataExtent = () => ({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
  el.getRenderInfo = () => ({
    marginLeft: 20,
    marginRight: 20,
    marginTop: 20,
    marginBottom: 20,
  });
  return {
    element: el,
    callCount: () => calls,
    reset: () => {
      calls = 0;
    },
  };
}

describe('<protspace-publish-modal> Dot size slider', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a Dot size slider for each inset (range 0.5–20×, default reads from state)', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as InsetInternals;
    internals._state = {
      ...internals._state,
      insets: [
        {
          sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
          targetRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
          border: 2,
          connector: 'lines',
          pointSizeScale: 3.5,
        },
      ],
    };
    (modal as unknown as { requestUpdate: () => void }).requestUpdate();
    await modal.updateComplete;

    const labels = Array.from(modal.shadowRoot!.querySelectorAll('label')).map(
      (l) => l.textContent?.trim() ?? '',
    );
    expect(labels.some((t) => /Dot size/i.test(t))).toBe(true);

    // The Number input bound to pointSizeScale renders the current value.
    const valueInputs = modal.shadowRoot!.querySelectorAll<HTMLInputElement>(
      '.publish-row-input[type="number"]',
    );
    const pointInput = Array.from(valueInputs).find((i) => i.value === '3.5');
    expect(pointInput).toBeDefined();
    expect(pointInput!.min).toBe('0.5');
    expect(pointInput!.max).toBe('20');
  });
});

describe('<protspace-publish-modal> _captureInsetRenders', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns [] without touching plotEl when state has no insets', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as InsetInternals;
    const plot = makeStubPlot();
    const renders = internals._captureInsetRenders(
      plot.element,
      { insets: [] },
      { w: 1000, h: 800 },
      '#ffffff',
    );
    expect(renders).toEqual([]);
    expect(plot.callCount()).toBe(0);
  });

  it('renders at the target rect pixel dims, not at plot dims', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as InsetInternals;
    const plot = makeStubPlot();
    const inset = {
      sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      targetRect: { x: 0.5, y: 0.5, w: 0.3, h: 0.4 },
      border: 2,
      connector: 'lines',
      pointSizeScale: 1,
    };
    const [canvas] = internals._captureInsetRenders(
      plot.element,
      { insets: [inset] },
      { w: 1000, h: 800 },
      '#ffffff',
    );
    expect(canvas).not.toBeNull();
    // target.w = 0.3 × 1000 = 300; target.h = 0.4 × 800 = 320
    expect(canvas!.width).toBe(300);
    expect(canvas!.height).toBe(320);
  });

  it('caches by sourceRect+targetDims; second call hits cache (no extra plot render)', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as InsetInternals;
    const plot = makeStubPlot();
    const inset = {
      sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      targetRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
      border: 2,
      connector: 'lines',
      pointSizeScale: 1,
    };
    const args = [plot.element, { insets: [inset] }, { w: 1000, h: 800 }, '#ffffff'] as const;
    internals._captureInsetRenders(...args);
    expect(plot.callCount()).toBe(1);
    internals._captureInsetRenders(...args);
    expect(plot.callCount()).toBe(1); // cache hit, no new WebGL pass
  });

  it('fast-path: high-frequency target resize reuses last canvas (no new render)', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as InsetInternals;
    const plot = makeStubPlot();
    const baseInset = {
      sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      targetRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
      border: 2,
      connector: 'lines',
      pointSizeScale: 1,
    };
    // First call: full render establishes _lastInsetRenderAt
    internals._captureInsetRenders(
      plot.element,
      { insets: [baseInset] },
      { w: 1000, h: 800 },
      '#ffffff',
    );
    expect(plot.callCount()).toBe(1);

    // Within the 80 ms fast-path window, simulate the user dragging — change
    // target dims a few times. Each call should reuse _lastInsetCanvases[0]
    // instead of triggering a fresh WebGL pass.
    for (let i = 0; i < 5; i++) {
      internals._captureInsetRenders(
        plot.element,
        {
          insets: [
            {
              ...baseInset,
              targetRect: { x: 0.5, y: 0.5, w: 0.2 + i * 0.01, h: 0.2 + i * 0.01 },
            },
          ],
        },
        { w: 1000, h: 800 },
        '#ffffff',
      );
    }
    expect(plot.callCount()).toBe(1); // no extra renders during the fast-path burst
  });

  it('settle timer schedules a fresh render once activity stops', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as InsetInternals;

    // Inject a far-past _lastInsetRenderAt so the next call is NOT fastPath
    // (we want a real first render to seed _lastInsetCanvases).
    const plot = makeStubPlot();
    const baseInset = {
      sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      targetRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
      border: 2,
      connector: 'lines',
      pointSizeScale: 1,
    };
    internals._captureInsetRenders(
      plot.element,
      { insets: [baseInset] },
      { w: 1000, h: 800 },
      '#ffffff',
    );
    expect(plot.callCount()).toBe(1);

    // Trigger fastPath: change target dims while we're still inside the
    // 80 ms window since the fresh render. This should arm _settleTimer.
    internals._captureInsetRenders(
      plot.element,
      {
        insets: [{ ...baseInset, targetRect: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 } }],
      },
      { w: 1000, h: 800 },
      '#ffffff',
    );
    expect(internals._settleTimer).not.toBeNull();
  });

  it('returns null per inset when plotEl lacks captureAtResolution / getDataExtent', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as InsetInternals;
    const stub = document.createElement('div'); // no API surface
    const renders = internals._captureInsetRenders(
      stub,
      {
        insets: [
          {
            sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
            targetRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
            border: 2,
            connector: 'lines',
            pointSizeScale: 1,
          },
        ],
      },
      { w: 1000, h: 800 },
      '#ffffff',
    );
    expect(renders).toEqual([null]);
  });
});

interface SelectionInternals {
  _state: {
    overlays: Array<Record<string, unknown>>;
    insets: Array<Record<string, unknown>>;
  };
  _selectedItem: { kind: 'overlay' | 'inset'; index: number } | null;
  requestUpdate: () => void;
}

const sampleCircle = {
  type: 'circle',
  cx: 0.5,
  cy: 0.5,
  rx: 0.1,
  ry: 0.1,
  rotation: 0,
  color: '#000',
  strokeWidth: 2,
};

const sampleInset = {
  sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
  targetRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
  border: 2,
  connector: 'lines',
  pointSizeScale: 1,
};

describe('<protspace-publish-modal> selection + keyboard delete', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('clicking a sidebar overlay item selects it (sets _selectedItem)', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;

    internals._state = { ...internals._state, overlays: [sampleCircle] };
    internals.requestUpdate();
    await modal.updateComplete;

    const item = modal.shadowRoot!.querySelector<HTMLElement>('[data-publish-item="overlay-0"]');
    expect(item).not.toBeNull();
    item!.click();
    await modal.updateComplete;

    expect(internals._selectedItem).toEqual({ kind: 'overlay', index: 0 });
    expect(item!.classList.contains('selected')).toBe(true);
  });

  it('clicking a sidebar inset item selects it', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;

    internals._state = { ...internals._state, insets: [sampleInset] };
    internals.requestUpdate();
    await modal.updateComplete;

    const item = modal.shadowRoot!.querySelector<HTMLElement>('[data-publish-item="inset-0"]');
    item!.click();
    await modal.updateComplete;

    expect(internals._selectedItem).toEqual({ kind: 'inset', index: 0 });
  });

  it('clicking the per-row delete button does not also select the row', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;
    internals._state = { ...internals._state, overlays: [sampleCircle] };
    internals.requestUpdate();
    await modal.updateComplete;

    const deleteBtn = modal.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-publish-item="overlay-0"] .delete-btn',
    );
    deleteBtn!.click();
    await modal.updateComplete;

    expect(internals._state.overlays).toHaveLength(0);
    expect(internals._selectedItem).toBeNull();
  });

  it('Delete key removes the selected overlay', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;
    internals._state = { ...internals._state, overlays: [sampleCircle] };
    internals._selectedItem = { kind: 'overlay', index: 0 };
    internals.requestUpdate();
    await modal.updateComplete;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    await modal.updateComplete;

    expect(internals._state.overlays).toHaveLength(0);
    expect(internals._selectedItem).toBeNull();
  });

  it('Backspace key removes the selected inset', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;
    internals._state = { ...internals._state, insets: [sampleInset] };
    internals._selectedItem = { kind: 'inset', index: 0 };
    internals.requestUpdate();
    await modal.updateComplete;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    await modal.updateComplete;

    expect(internals._state.insets).toHaveLength(0);
    expect(internals._selectedItem).toBeNull();
  });

  it('Backspace inside an input does NOT delete the selected overlay', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;
    const labelOverlay = {
      type: 'label',
      x: 0.5,
      y: 0.5,
      text: 'hi',
      fontSize: 14,
      rotation: 0,
      color: '#000',
    };
    internals._state = { ...internals._state, overlays: [labelOverlay] };
    internals._selectedItem = { kind: 'overlay', index: 0 };
    internals.requestUpdate();
    await modal.updateComplete;

    // Find the label-text input inside the overlay row.
    const input = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-item="overlay-0"] input[type="text"]',
    );
    expect(input).not.toBeNull();
    // Dispatch Backspace as if focus is on that input — composedPath() will
    // include the input through shadow DOM, so the handler must skip it.
    input!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, composed: true }),
    );
    await modal.updateComplete;

    expect(internals._state.overlays).toHaveLength(1);
    expect(internals._selectedItem).toEqual({ kind: 'overlay', index: 0 });
  });

  it('Escape clears selection without removing the item', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;
    internals._state = { ...internals._state, overlays: [sampleCircle] };
    internals._selectedItem = { kind: 'overlay', index: 0 };
    internals.requestUpdate();
    await modal.updateComplete;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await modal.updateComplete;

    expect(internals._state.overlays).toHaveLength(1);
    expect(internals._selectedItem).toBeNull();
  });

  it('keydown is a no-op when nothing is selected', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;
    internals._state = {
      ...internals._state,
      overlays: [sampleCircle],
      insets: [sampleInset],
    };
    internals.requestUpdate();
    await modal.updateComplete;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    await modal.updateComplete;

    expect(internals._state.overlays).toHaveLength(1);
    expect(internals._state.insets).toHaveLength(1);
  });

  it('removing the modal removes the keydown listener', async () => {
    const modal = makeModal();
    await modal.updateComplete;
    const internals = modal as unknown as SelectionInternals;
    internals._state = { ...internals._state, overlays: [sampleCircle] };
    internals._selectedItem = { kind: 'overlay', index: 0 };
    internals.requestUpdate();
    await modal.updateComplete;

    modal.remove();

    // Without the listener, Delete must NOT mutate state any further.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(internals._state.overlays).toHaveLength(1);
  });
});

describe('<protspace-publish-modal> plot cache key', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('invalidates the plot cache when background toggles white ↔ transparent', async () => {
    const captures: Array<{ bg: string }> = [];
    const fakePlotEl = {
      captureAtResolution: (w: number, h: number, opts: { backgroundColor?: string }) => {
        captures.push({ bg: opts.backgroundColor ?? '' });
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      },
    } as unknown as HTMLElement;

    // jsdom doesn't implement canvas getContext; stub it so composeFigure
    // (called downstream of _redraw) doesn't throw an unhandled exception
    // inside a requestAnimationFrame callback.
    const stubCtx = new Proxy(
      {},
      { get: () => () => undefined },
    ) as unknown as CanvasRenderingContext2D;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return stubCtx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const modal = document.createElement('protspace-publish-modal') as HTMLElement & {
        plotElement: HTMLElement;
        _state: { background: 'white' | 'transparent' };
        requestUpdate: () => void;
        updateComplete: Promise<unknown>;
      };
      modal.plotElement = fakePlotEl;
      document.body.appendChild(modal);
      await modal.updateComplete;

      modal._state = { ...modal._state, background: 'white' };
      modal.requestUpdate();
      await modal.updateComplete;
      await new Promise((r) => requestAnimationFrame(r));

      modal._state = { ...modal._state, background: 'transparent' };
      modal.requestUpdate();
      await modal.updateComplete;
      await new Promise((r) => requestAnimationFrame(r));

      expect(captures.some((c) => c.bg === '#ffffff')).toBe(true);
      expect(captures.some((c) => c.bg === 'rgba(0,0,0,0)')).toBe(true);
      modal.remove();
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });

  it('inset render skips fast-path when invoked from export', async () => {
    const captures: Array<{ w: number; h: number }> = [];
    const fakePlotEl = {
      captureAtResolution: (w: number, h: number) => {
        captures.push({ w, h });
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      },
      getDataExtent: () => ({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 }),
      getRenderInfo: () => ({ marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 }),
    } as unknown as HTMLElement;

    const modal = document.createElement('protspace-publish-modal') as HTMLElement & {
      plotElement: HTMLElement;
      _state: Record<string, unknown>;
      _lastInsetRenderAt: number;
      _lastInsetCanvases: Array<HTMLCanvasElement | undefined>;
      _captureInsetRenders: (
        plotEl: unknown,
        state: unknown,
        plotRect: { w: number; h: number },
        bgColor: string,
        opts?: { forExport?: boolean },
      ) => Array<HTMLCanvasElement | null>;
    };
    modal.plotElement = fakePlotEl;
    document.body.appendChild(modal);
    modal._lastInsetRenderAt = performance.now();
    // Simulate a prior preview-resolution render sitting in the cache. Without
    // the export bypass this is what _handleExport would silently return at
    // tiny preview dims instead of a fresh export-resolution render.
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 100;
    previewCanvas.height = 60;
    modal._lastInsetCanvases = [previewCanvas];
    modal._state = {
      ...(modal._state as Record<string, unknown>),
      insets: [
        {
          sourceRect: { x: 0, y: 0, w: 0.5, h: 0.5 },
          targetRect: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 },
          border: 0,
          connector: 'none',
        },
      ],
    };
    captures.length = 0;

    modal._captureInsetRenders(fakePlotEl, modal._state, { w: 1000, h: 600 }, '#ffffff', {
      forExport: true,
    });

    expect(captures.length).toBeGreaterThan(0);
    modal.remove();
  });
});

describe('<protspace-publish-modal> preset sizeMode sync', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('switches sizeMode to 1-column when applying a 1-column preset', async () => {
    const stubCtx = new Proxy(
      {},
      { get: () => () => undefined },
    ) as unknown as CanvasRenderingContext2D;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return stubCtx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const modal = document.createElement('protspace-publish-modal') as HTMLElement & {
        _state: { sizeMode: string; preset: string };
        _applyPreset: (id: string) => void;
      };
      document.body.appendChild(modal);
      modal._state = { ...modal._state, sizeMode: '2-column' };
      modal._applyPreset('nature-1col');
      expect(modal._state.sizeMode).toBe('1-column');
      modal.remove();
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});

describe('<protspace-publish-modal> disconnect guard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not call _setupOverlay after disconnect during _applyStateAndRebuild', async () => {
    // jsdom doesn't implement canvas getContext; stub it so the redraw
    // path triggered by _applyStateAndRebuild doesn't throw inside a rAF
    // callback.
    const stubCtx = new Proxy(
      {},
      { get: () => () => undefined },
    ) as unknown as CanvasRenderingContext2D;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return stubCtx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const modal = document.createElement('protspace-publish-modal') as HTMLElement & {
        _setupOverlay: () => void;
        _applyStateAndRebuild: (s: unknown) => void;
        _state: Record<string, unknown>;
        plotElement: HTMLElement;
        updateComplete: Promise<unknown>;
      };
      modal.plotElement = document.createElement('div');
      document.body.appendChild(modal);
      // Wait for the first render so firstUpdated() (which itself calls
      // _setupOverlay) has already fired before we start counting.
      await modal.updateComplete;

      let setupCalls = 0;
      const orig = modal._setupOverlay.bind(modal);
      modal._setupOverlay = () => {
        setupCalls++;
        orig();
      };

      modal._applyStateAndRebuild({ ...modal._state });
      modal.remove();

      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => requestAnimationFrame(r));

      expect(setupCalls).toBe(0);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});

describe('<protspace-publish-modal> fingerprint warning', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the fingerprint warning when saved fingerprint mismatches current', async () => {
    const stubCtx = new Proxy(
      {},
      { get: () => () => undefined },
    ) as unknown as CanvasRenderingContext2D;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return stubCtx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const modal = document.createElement('protspace-publish-modal') as HTMLElement & {
        savedPublishState: Record<string, unknown>;
        currentProjection: { projection: string; dimensionality: number };
        updateComplete: Promise<unknown>;
        shadowRoot: ShadowRoot;
      };
      modal.savedPublishState = {
        viewFingerprint: { projection: 'umap', dimensionality: 2 },
        overlays: [{ type: 'label', x: 0.5, y: 0.5, text: 't', fontSize: 14, color: '#000' }],
      };
      modal.currentProjection = { projection: 'pca', dimensionality: 2 };
      document.body.appendChild(modal);
      await modal.updateComplete;

      const warn = modal.shadowRoot.querySelector('.publish-warning');
      expect(warn).not.toBeNull();
      modal.remove();
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });

  it('does not render the fingerprint warning when fingerprints match', async () => {
    const stubCtx = new Proxy(
      {},
      { get: () => () => undefined },
    ) as unknown as CanvasRenderingContext2D;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return stubCtx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const modal = document.createElement('protspace-publish-modal') as HTMLElement & {
        savedPublishState: Record<string, unknown>;
        currentProjection: { projection: string; dimensionality: number };
        updateComplete: Promise<unknown>;
        shadowRoot: ShadowRoot;
      };
      modal.savedPublishState = {
        viewFingerprint: { projection: 'umap', dimensionality: 2 },
        overlays: [],
      };
      modal.currentProjection = { projection: 'umap', dimensionality: 2 };
      document.body.appendChild(modal);
      await modal.updateComplete;

      const warn = modal.shadowRoot.querySelector('.publish-warning');
      expect(warn).toBeNull();
      modal.remove();
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});
