import { test, type BrowserContext, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import {
  IMAGES_DIR,
  dismissProductTour,
  waitForDataLoad,
  waitForLegend,
  waitForStructureViewer,
  clickProteinPoint,
} from './helpers';

// Static screenshots share one page across the whole spec — the dataset is
// large to load and parse, so we pay that cost once in beforeAll and reset
// only the per-test mutations in beforeEach.
let sharedContext: BrowserContext | null = null;
let sharedPage: Page | null = null;

function getPage(): Page {
  if (!sharedPage) {
    throw new Error('sharedPage not initialized — beforeAll did not run');
  }
  return sharedPage;
}

test.beforeAll(async ({ browser }) => {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  sharedContext = await browser.newContext({
    viewport: { width: 1536, height: 864 },
  });
  sharedPage = await sharedContext.newPage();

  await sharedPage.goto('/explore');
  await dismissProductTour(sharedPage);
  await waitForDataLoad(sharedPage);
  await waitForLegend(sharedPage);
  await waitForControlBar(sharedPage);
});

test.afterAll(async () => {
  if (sharedPage) {
    await sharedPage.close();
    sharedPage = null;
  }
  if (sharedContext) {
    await sharedContext.close();
    sharedContext = null;
  }
});

/**
 * Roll back any DOM/state changes a prior test may have left behind, so each
 * test starts from a known-clean page without paying the goto/load cost again.
 *
 * Cleans up: injected callout overlays (control-bar-annotated), the publish
 * modal (figure-editor tests), the structure viewer (structure-viewer.png),
 * the filter query (filter-query-builder.png), and any open shadow-DOM
 * dropdowns / modals (Escape closes them at the Lit/native level).
 */
async function resetStaticState(page: Page): Promise<void> {
  // Close any open dropdown / modal via Escape — handles control-bar-projection,
  // -annotation, -export, query builder, and the publish modal's outer trap.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    // Annotated control bar appends red callout circles to document.body.
    document.querySelectorAll('div[data-test-callout]').forEach((el) => el.remove());

    // Figure editor leaves a publish modal element behind even after Escape.
    document.querySelectorAll('protspace-publish-modal').forEach((el) => el.remove());

    // structure-viewer.png unhides the viewer and selects a protein.
    const sv = document.querySelector('#myStructureViewer') as HTMLElement | null;
    if (sv) sv.style.display = 'none';
    const plot = document.querySelector('#myPlot') as
      | (HTMLElement & { selectedProteinIds?: string[] })
      | null;
    if (plot && Array.isArray(plot.selectedProteinIds)) plot.selectedProteinIds = [];

    // filter-query-builder seeds an example query — clear it.
    const cb = document.querySelector('#myControlBar') as
      | (HTMLElement & { filterQuery?: unknown[]; requestUpdate?: () => void })
      | null;
    if (cb) {
      cb.filterQuery = [];
      cb.requestUpdate?.();
    }
  });

  // Brief settle for Lit/rAF updates following the resets above.
  await page.waitForTimeout(150);
}

/**
 * Open the Figure Editor and wait for its preview canvas to render.
 * Dispatches the same event the Export-menu's "Figure Editor" button fires —
 * skips dropdown timing and viewport clipping.
 */
async function openFigureEditor(
  page: import('@playwright/test').Page,
  timeout = 10_000,
): Promise<void> {
  await page.evaluate(() => {
    const cb = document.querySelector('protspace-control-bar');
    cb?.dispatchEvent(new CustomEvent('open-publish-editor', { bubbles: true, composed: true }));
  });

  await page.waitForFunction(() => !!document.querySelector('protspace-publish-modal'), {
    timeout,
  });
  await page.waitForFunction(
    () => {
      const m = document.querySelector('protspace-publish-modal') as
        | (HTMLElement & { shadowRoot: ShadowRoot })
        | null;
      const c = m?.shadowRoot?.querySelector('.publish-preview-canvas') as HTMLCanvasElement | null;
      return !!c && c.width > 0 && c.height > 0;
    },
    { timeout, polling: 250 },
  );
  // Settle: rAF redraw + font readiness.
  await page.waitForTimeout(800);
}

/**
 * Wait for the control bar to be fully rendered with all elements styled.
 * This fixes the gray control-bar issue by waiting for shadow DOM elements.
 */
async function waitForControlBar(
  page: import('@playwright/test').Page,
  timeout = 15000,
): Promise<void> {
  await page.waitForSelector('#myControlBar', { timeout });

  // Wait for the control bar shadow DOM to be fully rendered
  await page.waitForFunction(
    () => {
      const controlBar = document.querySelector('#myControlBar') as any;
      if (!controlBar || !controlBar.shadowRoot) return false;

      // Check that key elements exist
      const controlBarDiv = controlBar.shadowRoot.querySelector('.control-bar');
      const projectionTrigger = controlBar.shadowRoot.querySelector('#projection-trigger');
      const annotationSelect = controlBar.shadowRoot.querySelector(
        'protspace-annotation-select',
      ) as any;
      const buttons = controlBar.shadowRoot.querySelectorAll('button');

      if (!controlBarDiv || !projectionTrigger || !annotationSelect || buttons.length < 3)
        return false;

      // Check that projection trigger has text content (data is loaded)
      const triggerText = projectionTrigger.textContent?.trim();
      if (!triggerText) return false;

      // Check that annotation select has annotations loaded
      return annotationSelect.annotations && annotationSelect.annotations.length > 0;
    },
    { timeout, polling: 200 },
  );

  // Settle for two frames so any Lit transition is committed.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('Interface Overview Screenshots', () => {
  test.beforeEach(async () => {
    await resetStaticState(getPage());
  });

  test('interface-overview.png - Full page layout', async () => {
    const page = getPage();
    await page.screenshot({
      path: path.join(IMAGES_DIR, 'interface-overview.png'),
      fullPage: false,
    });
    console.log('📸 Captured: interface-overview.png');
  });

  test('scatterplot-example.png - Scatterplot with colored proteins', async () => {
    const page = getPage();
    const plot = page.locator('#myPlot');
    await plot.screenshot({
      path: path.join(IMAGES_DIR, 'scatterplot-example.png'),
    });
    console.log('📸 Captured: scatterplot-example.png');
  });

  test('legend-panel.png - Legend with categories', async () => {
    const page = getPage();
    const legend = page.locator('#myLegend');
    await legend.screenshot({
      path: path.join(IMAGES_DIR, 'legend-panel.png'),
    });
    console.log('📸 Captured: legend-panel.png');
  });

  test('structure-viewer.png - 3D structure viewer', async () => {
    const page = getPage();
    // Click on a protein to load it in the structure viewer
    await clickProteinPoint(page);

    // Wait for the structure viewer to load and WebGL to be ready
    await waitForStructureViewer(page, 30000);

    // Additional wait to ensure structure is fully rendered
    await page.waitForTimeout(2000);

    // Capture the structure viewer element
    // Since it's in a shadow DOM, we'll use captureShadowElement or get bounding box
    const viewer = page.locator('#myStructureViewer');
    const box = await viewer.boundingBox();

    if (box) {
      // Capture with some padding
      await page.screenshot({
        path: path.join(IMAGES_DIR, 'structure-viewer.png'),
        clip: {
          x: Math.max(0, box.x - 10),
          y: Math.max(0, box.y - 10),
          width: box.width + 20,
          height: box.height + 20,
        },
      });
    } else {
      // Fallback: try to screenshot the element directly
      await viewer.screenshot({
        path: path.join(IMAGES_DIR, 'structure-viewer.png'),
      });
    }

    console.log('📸 Captured: structure-viewer.png');
  });
});

test.describe('Control Bar Screenshots', () => {
  test.beforeEach(async () => {
    await resetStaticState(getPage());
  });

  test('control-bar-annotated.png - Annotated control bar with numbered callouts', async () => {
    const page = getPage();
    // Inject numbered callout annotations
    await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar') as any;
      if (!controlBar?.shadowRoot) return;

      const shadowRoot = controlBar.shadowRoot;

      // Define annotations with their target selectors
      const annotations = [
        { selector: '.projection-container', label: '1', offset: { x: -15, y: -40 } },
        { selector: '#annotation-select', label: '2', offset: { x: -15, y: -40 } },
        { selector: '.search-group', label: '3', offset: { x: -15, y: -40 } },
        { selector: 'button:has(.icon)', label: '4', offset: { x: -15, y: -40 }, nth: 0 }, // Select
        { selector: 'button:has(.icon)', label: '5', offset: { x: -15, y: -40 }, nth: 1 }, // Clear
        { selector: 'button:has(.icon)', label: '6', offset: { x: -15, y: -40 }, nth: 2 }, // Isolate
        { selector: '.filter-container', label: '7', offset: { x: -15, y: -40 } },
        {
          selector: '.export-container.right-controls-export',
          label: '8',
          offset: { x: -15, y: -40 },
        },
        { selector: '.right-controls-data', label: '9', offset: { x: -15, y: -40 } },
      ];

      annotations.forEach(({ selector, label, offset, nth }) => {
        let element: Element | null;
        if (nth !== undefined) {
          const elements = shadowRoot.querySelectorAll(selector);
          element = elements[nth] || null;
        } else {
          element = shadowRoot.querySelector(selector);
        }

        if (!element) return;

        const rect = element.getBoundingClientRect();

        // Create callout circle
        const callout = document.createElement('div');
        callout.style.cssText = `
          position: fixed;
          left: ${rect.left + rect.width / 2 + (offset?.x || -15)}px;
          top: ${rect.top + (offset?.y || -40)}px;
          width: 40px;
          height: 40px;
          background: #dc2626;
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          font-weight: bold;
          font-family: system-ui, sans-serif;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          z-index: 10000;
        `;
        callout.textContent = label;
        callout.dataset.testCallout = 'true';
        document.body.appendChild(callout);
      });
    });

    await page.waitForTimeout(200);

    // Get control bar bounds plus extra space for annotations above
    const controlBar = page.locator('#myControlBar');
    const box = await controlBar.boundingBox();

    if (box) {
      await page.screenshot({
        path: path.join(IMAGES_DIR, 'control-bar-annotated.png'),
        clip: {
          x: Math.max(0, box.x - 10),
          y: Math.max(0, box.y - 35), // Extra space for callouts above
          width: box.width + 20,
          height: box.height + 45,
        },
      });
    } else {
      await controlBar.screenshot({
        path: path.join(IMAGES_DIR, 'control-bar-annotated.png'),
      });
    }

    console.log('📸 Captured: control-bar-annotated.png');
  });

  test('control-bar-projection.png - Projection dropdown with options overlay', async () => {
    const page = getPage();
    // Click the projection trigger to open the real custom dropdown
    await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar') as any;
      if (!controlBar?.shadowRoot) return;

      const trigger = controlBar.shadowRoot.querySelector('#projection-trigger');
      if (trigger) {
        (trigger as HTMLElement).click();
      }
    });

    // Wait for dropdown menu to appear
    await page.waitForFunction(
      () => {
        const controlBar = document.querySelector('#myControlBar') as any;
        if (!controlBar?.shadowRoot) return false;
        return !!controlBar.shadowRoot.querySelector('.dropdown-menu');
      },
      { timeout: 5000, polling: 200 },
    );

    await page.waitForTimeout(200);

    // Get bounds of the projection container including the open dropdown
    const clipRegion = await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar') as any;
      if (!controlBar?.shadowRoot) return null;

      const container = controlBar.shadowRoot.querySelector('.projection-container');
      const dropdownMenu = controlBar.shadowRoot.querySelector('.dropdown-menu');

      if (!container) return null;

      const containerBounds = container.getBoundingClientRect();
      const menuBounds = dropdownMenu?.getBoundingClientRect();

      if (!menuBounds) {
        return {
          x: containerBounds.left,
          y: containerBounds.top,
          width: containerBounds.width,
          height: containerBounds.height,
        };
      }

      // Encompass both the trigger and the dropdown menu
      const minX = Math.min(containerBounds.left, menuBounds.left);
      const minY = Math.min(containerBounds.top, menuBounds.top);
      const maxX = Math.max(containerBounds.right, menuBounds.right);
      const maxY = Math.max(containerBounds.bottom, menuBounds.bottom);

      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    });

    if (clipRegion) {
      await page.screenshot({
        path: path.join(IMAGES_DIR, 'control-bar-projection.png'),
        clip: {
          x: Math.max(0, clipRegion.x - 10),
          y: Math.max(0, clipRegion.y - 10),
          width: clipRegion.width + 20,
          height: clipRegion.height + 20,
        },
      });
    } else {
      const controlBar = page.locator('#myControlBar');
      await controlBar.screenshot({
        path: path.join(IMAGES_DIR, 'control-bar-projection.png'),
      });
    }

    console.log('📸 Captured: control-bar-projection.png');
  });

  test('control-bar-annotation.png - Annotation dropdown with options overlay', async () => {
    const page = getPage();
    // Click the annotation select trigger to open the real dropdown
    await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar') as any;
      if (!controlBar?.shadowRoot) return;

      const annotationSelect = controlBar.shadowRoot.querySelector('protspace-annotation-select');
      if (!annotationSelect?.shadowRoot) return;

      const trigger = annotationSelect.shadowRoot.querySelector('.dropdown-trigger');
      if (trigger) {
        (trigger as HTMLElement).click();
      }
    });

    // Wait for annotation dropdown menu to appear
    await page.waitForFunction(
      () => {
        const controlBar = document.querySelector('#myControlBar') as any;
        if (!controlBar?.shadowRoot) return false;

        const annotationSelect = controlBar.shadowRoot.querySelector('protspace-annotation-select');
        if (!annotationSelect?.shadowRoot) return false;

        return !!annotationSelect.shadowRoot.querySelector('.dropdown-menu');
      },
      { timeout: 5000, polling: 200 },
    );

    await page.waitForTimeout(200);

    // Get bounds of the annotation select including the open dropdown
    const clipRegion = await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar') as any;
      if (!controlBar?.shadowRoot) return null;

      const annotationSelect = controlBar.shadowRoot.querySelector('protspace-annotation-select');
      if (!annotationSelect?.shadowRoot) return null;

      const container = annotationSelect.shadowRoot.querySelector('.annotation-select-container');
      const dropdownMenu = annotationSelect.shadowRoot.querySelector('.dropdown-menu');

      if (!container) return null;

      const containerBounds = container.getBoundingClientRect();
      const menuBounds = dropdownMenu?.getBoundingClientRect();

      if (!menuBounds) {
        return {
          x: containerBounds.left,
          y: containerBounds.top,
          width: containerBounds.width,
          height: containerBounds.height,
        };
      }

      // Encompass both the trigger and the dropdown menu
      const minX = Math.min(containerBounds.left, menuBounds.left);
      const minY = Math.min(containerBounds.top, menuBounds.top);
      const maxX = Math.max(containerBounds.right, menuBounds.right);
      const maxY = Math.max(containerBounds.bottom, menuBounds.bottom);

      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    });

    if (clipRegion) {
      await page.screenshot({
        path: path.join(IMAGES_DIR, 'control-bar-annotation.png'),
        clip: {
          x: Math.max(0, clipRegion.x - 10),
          y: Math.max(0, clipRegion.y - 10),
          width: clipRegion.width + 20,
          height: clipRegion.height + 20,
        },
      });
    } else {
      const controlBar = page.locator('#myControlBar');
      await controlBar.screenshot({
        path: path.join(IMAGES_DIR, 'control-bar-annotation.png'),
      });
    }

    console.log('📸 Captured: control-bar-annotation.png');
  });

  test('figure-editor-overview.png - Figure Editor modal full layout', async () => {
    const page = getPage();
    await openFigureEditor(page);
    await page.screenshot({
      path: path.join(IMAGES_DIR, 'figure-editor-overview.png'),
      fullPage: false,
    });
    console.log('📸 Captured: figure-editor-overview.png');
  });

  test('figure-editor-presets.png - Journal preset grid (sidebar close-up)', async () => {
    const page = getPage();
    await openFigureEditor(page);

    const clip = await page.evaluate(() => {
      const m = document.querySelector('protspace-publish-modal') as
        | (HTMLElement & { shadowRoot: ShadowRoot })
        | null;
      const sidebar = m?.shadowRoot?.querySelector('.publish-sidebar') as HTMLElement | null;
      if (!sidebar) return null;
      const r = sidebar.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 540) };
    });

    if (clip) {
      await page.screenshot({
        path: path.join(IMAGES_DIR, 'figure-editor-presets.png'),
        clip,
      });
    } else {
      await page.screenshot({ path: path.join(IMAGES_DIR, 'figure-editor-presets.png') });
    }
    console.log('📸 Captured: figure-editor-presets.png');
  });

  test('figure-editor-overlays.png - Editor with circle, arrow, and label overlays', async () => {
    const page = getPage();
    await openFigureEditor(page);

    await page.evaluate(() => {
      const m = document.querySelector('protspace-publish-modal') as
        | (HTMLElement & {
            _state: Record<string, unknown>;
            requestUpdate: () => void;
          })
        | null;
      if (!m) return;
      const cur = m._state as Record<string, unknown>;
      // Hand-placed coordinates from a real editor session: a rotated circle
      // around the PLD cluster (right) with a "PLD" label, plus an arrow
      // pointing into the Kunitz cluster (upper-left) with its label.
      m._state = {
        ...cur,
        overlays: [
          {
            type: 'circle',
            cx: 0.8737195856124373,
            cy: 0.6619266620785421,
            rx: 0.04240957253752543,
            ry: 0.046662343237108606,
            rotation: -0.20396168731157882,
            color: '#000000',
            strokeWidth: 2,
          },
          {
            type: 'label',
            x: 0.8490372746852966,
            y: 0.5941603427694406,
            text: 'PLD',
            fontSize: 24,
            rotation: 0,
            color: '#000000',
          },
          {
            type: 'label',
            x: 0.3576617410178119,
            y: 0.42456087994542974,
            text: 'Kunitz',
            fontSize: 24,
            rotation: 0,
            color: '#000000',
          },
          {
            type: 'arrow',
            x1: 0.36300882685603014,
            y1: 0.40204531889495226,
            x2: 0.4461934912139551,
            y2: 0.19846201398362892,
            color: '#000000',
            width: 4,
          },
        ],
      };
      m.requestUpdate();
    });
    // Allow rAF redraw and font load to complete.
    await page.waitForTimeout(600);

    await page.screenshot({
      path: path.join(IMAGES_DIR, 'figure-editor-overlays.png'),
      fullPage: false,
    });
    console.log('📸 Captured: figure-editor-overlays.png');
  });

  test('figure-editor-zoom-inset.png - Editor with a zoom inset placed', async () => {
    const page = getPage();
    await openFigureEditor(page);

    await page.evaluate(() => {
      const m = document.querySelector('protspace-publish-modal') as
        | (HTMLElement & {
            _state: Record<string, unknown>;
            requestUpdate: () => void;
          })
        | null;
      if (!m) return;
      const cur = m._state as Record<string, unknown>;
      // Hand-placed source/target from a real editor session: source rect
      // tightly bounds a small mid-plot cluster; target rect drops the
      // magnified view into the lower-left whitespace.
      m._state = {
        ...cur,
        insets: [
          {
            sourceRect: {
              x: 0.30612982591154486,
              y: 0.475006394952251,
              w: 0.0630622977144123,
              h: 0.04193489938608458,
            },
            targetRect: {
              x: 0.056294980577438314,
              y: 0.693431318212824,
              w: 0.279788520581097,
              h: 0.18605258427284216,
            },
            border: 2,
            connector: 'lines',
            pointSizeScale: 2.3,
          },
        ],
      };
      m.requestUpdate();
    });
    // Inset re-render is async (WebGL pass); give it room to settle.
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: path.join(IMAGES_DIR, 'figure-editor-zoom-inset.png'),
      fullPage: false,
    });
    console.log('📸 Captured: figure-editor-zoom-inset.png');
  });

  test('filter-query-builder.png - Filter modal with example conditions', async () => {
    const page = getPage();
    // Pre-populate the filter query so the modal opens with a meaningful state.
    // Pick the first annotation and its first two unique non-null values from
    // the currently loaded data — keeps the test independent of the dataset.
    await page.evaluate(() => {
      const cb = document.querySelector('#myControlBar') as
        | (HTMLElement & {
            annotations: string[];
            _currentData?: {
              annotations?: Record<string, { values: (string | null)[] }>;
            };
            filterQuery: unknown[];
            requestUpdate: () => void;
          })
        | null;
      if (!cb) return;
      const ann = cb.annotations?.[0];
      if (!ann) return;
      const raw = cb._currentData?.annotations?.[ann]?.values ?? [];
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const v of raw) {
        if (typeof v !== 'string' || !v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        unique.push(v);
        if (unique.length === 2) break;
      }
      cb.filterQuery = [{ id: 'q-demo-1', annotation: ann, values: unique }];
      cb.requestUpdate();
    });

    // Open the filter modal via the same path the user clicks.
    await page.evaluate(() => {
      const cb = document.querySelector('#myControlBar') as
        | (HTMLElement & {
            shadowRoot: ShadowRoot | null;
          })
        | null;
      const trigger = cb?.shadowRoot?.querySelector(
        '.filter-container .dropdown-trigger',
      ) as HTMLElement | null;
      trigger?.click();
    });

    await page.waitForFunction(
      () => {
        const cb = document.querySelector('#myControlBar') as
          | (HTMLElement & {
              shadowRoot: ShadowRoot | null;
            })
          | null;
        return !!cb?.shadowRoot?.querySelector('.query-builder-modal');
      },
      { timeout: 5_000, polling: 200 },
    );
    // Let the query builder finish first paint and resolve match counts.
    await page.waitForTimeout(800);

    const clip = await page.evaluate(() => {
      const cb = document.querySelector('#myControlBar') as
        | (HTMLElement & {
            shadowRoot: ShadowRoot | null;
          })
        | null;
      const modal = cb?.shadowRoot?.querySelector('.query-builder-modal') as HTMLElement | null;
      if (!modal) return null;
      const r = modal.getBoundingClientRect();
      return {
        x: Math.max(0, r.left - 12),
        y: Math.max(0, r.top - 12),
        width: r.width + 24,
        height: r.height + 24,
      };
    });

    if (clip) {
      await page.screenshot({
        path: path.join(IMAGES_DIR, 'filter-query-builder.png'),
        clip,
      });
    } else {
      await page.screenshot({ path: path.join(IMAGES_DIR, 'filter-query-builder.png') });
    }
    console.log('📸 Captured: filter-query-builder.png');
  });

  test('control-bar-export.png - Export menu', async () => {
    const page = getPage();
    // Open export dropdown
    await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar') as any;
      if (!controlBar?.shadowRoot) return;

      // Find and click the export button
      const exportContainer = controlBar.shadowRoot.querySelector(
        '.export-container.right-controls-export',
      );
      const exportButton = exportContainer?.querySelector('button');
      if (exportButton) {
        exportButton.click();
      }
    });

    await page.waitForTimeout(500);

    // Calculate clip region for export button and dropdown
    const clipRegion = await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar') as any;
      if (!controlBar?.shadowRoot) return null;

      const exportContainer = controlBar.shadowRoot.querySelector(
        '.export-container.right-controls-export',
      );
      const exportMenu = controlBar.shadowRoot.querySelector('.export-menu');

      if (!exportContainer) return null;

      const containerBounds = exportContainer.getBoundingClientRect();
      const exportMenuBounds = exportMenu?.getBoundingClientRect();

      if (!exportMenuBounds) {
        return {
          x: Math.max(0, containerBounds.left - 10),
          y: Math.max(0, containerBounds.top - 10),
          width: containerBounds.width + 20,
          height: containerBounds.height + 20,
        };
      }

      // Calculate region that encompasses both the export button and dropdown
      const minX = Math.min(containerBounds.left, exportMenuBounds.left);
      const minY = Math.min(containerBounds.top, exportMenuBounds.top);
      const maxX = Math.max(containerBounds.right, exportMenuBounds.right);
      const maxY = Math.max(containerBounds.bottom, exportMenuBounds.bottom);

      return {
        x: Math.max(0, minX - 10),
        y: Math.max(0, minY - 10),
        width: maxX - minX + 20,
        height: maxY - minY + 20,
      };
    });

    if (clipRegion) {
      await page.screenshot({
        path: path.join(IMAGES_DIR, 'control-bar-export.png'),
        clip: clipRegion,
      });
    } else {
      const controlBar = page.locator('#myControlBar');
      await controlBar.screenshot({
        path: path.join(IMAGES_DIR, 'control-bar-export.png'),
      });
    }

    console.log('📸 Captured: control-bar-export.png');
  });
});
