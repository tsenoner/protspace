import { expect, test, type Page } from '@playwright/test';
import { dismissTourIfPresent, waitForExploreDataLoad } from './helpers/explore';

interface PlotInternals extends Element {
  config?: Record<string, unknown>;
  data?: { protein_ids?: string[] };
  hiddenAnnotationValues?: string[];
  selectedAnnotation?: string;
  getCurrentData?: () => {
    annotations?: Record<string, { values?: (string | null)[] }>;
  };
}

async function gammaPipelineUnavailable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const win = window as Window & { __densityDegraded__?: string[] };
    return (win.__densityDegraded__ ?? []).includes('gamma-pipeline-unavailable');
  });
}

async function watchForDegraded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as Window & { __densityDegraded__?: string[] };
    win.__densityDegraded__ = [];
    document.addEventListener(
      'renderer-degraded',
      (event: Event) => {
        const reason = (event as CustomEvent<{ context?: { reason?: string } }>).detail?.context
          ?.reason;
        if (reason) win.__densityDegraded__?.push(reason);
      },
      true,
    );
  });
}

async function centreAlpha(page: Page, half = 24): Promise<number> {
  return page.evaluate((h) => {
    const plot = document.querySelector('#myPlot');
    const canvas = plot?.shadowRoot?.querySelector('canvas[data-key]') as HTMLCanvasElement | null;
    if (!canvas) return -1;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(canvas, 0, 0);
    const x = Math.max(0, Math.round(canvas.width / 2) - h);
    const y = Math.max(0, Math.round(canvas.height / 2) - h);
    const { data } = ctx.getImageData(x, y, h * 2, h * 2);
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i];
    return sum / (data.length / 4);
  }, half);
}

async function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot');
    const canvas = plot?.shadowRoot?.querySelector('canvas[data-key]') as HTMLCanvasElement | null;
    if (!canvas) return -1;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return painted;
  });
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

async function setDensity(page: Page, mode: 'off' | 'auto' | 'on'): Promise<void> {
  await page.evaluate((value) => {
    const plot = document.querySelector('#myPlot') as PlotInternals | null;
    if (plot) plot.config = { ...(plot.config ?? {}), densityLayer: value };
  }, mode);
  await settle(page);
}

async function centreBlock(page: Page, half = 64): Promise<number[]> {
  return page.evaluate((h) => {
    const plot = document.querySelector('#myPlot');
    const canvas = plot?.shadowRoot?.querySelector('canvas[data-key]') as HTMLCanvasElement | null;
    if (!canvas) return [];
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(canvas, 0, 0);
    const x = Math.max(0, Math.round(canvas.width / 2) - h);
    const y = Math.max(0, Math.round(canvas.height / 2) - h);
    return Array.from(ctx.getImageData(x, y, h * 2, h * 2).data);
  }, half);
}

function differingPixels(a: readonly number[], b: readonly number[]): number {
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs(a[i + c] - b[i + c]) > 8) {
        differing++;
        break;
      }
    }
  }
  return differing;
}

type ContourMode = 'off' | 'contour-on';

async function setContour(page: Page, mode: ContourMode): Promise<void> {
  await page.evaluate((value) => {
    const plot = document.querySelector('#myPlot') as PlotInternals | null;
    if (plot)
      plot.config = {
        ...(plot.config ?? {}),
        densityLayer: value === 'off' ? 'off' : 'on',
        densityStyle: 'contour',
      };
  }, mode);
  await settle(page);
}

async function showOnly(page: Page, shown: readonly string[]): Promise<void> {
  await page.evaluate((keep) => {
    const plot = document.querySelector('#myPlot') as PlotInternals | null;
    const annotation = plot?.selectedAnnotation ?? '';
    const values = plot?.getCurrentData?.()?.annotations?.[annotation]?.values ?? [];
    const all = new Set(values.map((v) => (v === null || v === undefined ? '__NA__' : v)));
    if (plot) plot.hiddenAnnotationValues = [...all].filter((v) => !keep.includes(v));
  }, shown);
  await settle(page);
}

async function captureFrame(page: Page, key: string): Promise<void> {
  await page.evaluate((k) => {
    const plot = document.querySelector('#myPlot');
    const canvas = plot?.shadowRoot?.querySelector('canvas[data-key]') as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const win = window as Window & { __frames__?: Record<string, Uint8ClampedArray> };
    win.__frames__ = win.__frames__ ?? {};
    win.__frames__[k] = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  }, key);
}

async function unionMasks(page: Page) {
  return page.evaluate(() => {
    const f = (window as Window & { __frames__?: Record<string, Uint8ClampedArray> }).__frames__!;
    const changed = (s: string, i: number) => {
      const on = f[`${s}:on`];
      const off = f[`${s}:off`];
      for (let c = 0; c < 4; c++) if (Math.abs(on[i + c] - off[i + c]) > 8) return true;
      return false;
    };
    let a = 0;
    let b = 0;
    let ab = 0;
    let xor = 0;
    for (let i = 0; i < f['AB:on'].length; i += 4) {
      const inA = changed('A', i);
      const inB = changed('B', i);
      const inAB = changed('AB', i);
      if (inA) a++;
      if (inB) b++;
      if (inAB) ab++;
      if (inAB !== (inA || inB)) xor++;
    }
    return { a, b, ab, xor };
  });
}

test.describe('density layer pixels', () => {
  test('composites above the points and respects hidden categories', async ({ page }) => {
    await watchForDegraded(page);
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await settle(page);

    test.skip(
      await gammaPipelineUnavailable(page),
      'renderer reported gamma-pipeline-unavailable: no float render targets here',
    );

    const withoutLayer = await centreAlpha(page);
    expect(withoutLayer, 'canvas pixels not readable').toBeGreaterThanOrEqual(0);

    await setDensity(page, 'on');
    const withLayer = await centreAlpha(page);
    expect(withLayer, 'turning the density layer on added no coverage').toBeGreaterThan(
      withoutLayer,
    );

    const paintedWithAll = await paintedPixels(page);
    expect(paintedWithAll, 'nothing was painted with the layer on').toBeGreaterThan(0);

    const survivor = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as PlotInternals | null;
      const annotation = plot?.selectedAnnotation ?? '';
      const values = plot?.getCurrentData?.()?.annotations?.[annotation]?.values ?? [];
      const unique = Array.from(new Set(values.filter((v): v is string => typeof v === 'string')));
      if (plot) plot.hiddenAnnotationValues = unique.slice(1);
      return unique[0] ?? null;
    });
    expect(survivor, 'no categorical values to hide').toBeTruthy();
    await settle(page);

    await expect
      .poll(() => paintedPixels(page), {
        message: 'hidden categories still contribute to the density layer',
        timeout: 15_000,
      })
      .toBeLessThan(paintedWithAll / 2);
    expect(await paintedPixels(page), 'the surviving category vanished too').toBeGreaterThan(0);
  });

  test('?density=contour-on paints a different layer from ?density=on', async ({ page }) => {
    await watchForDegraded(page);
    await page.goto('/explore?density=on');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await settle(page);

    test.skip(
      await gammaPipelineUnavailable(page),
      'renderer reported gamma-pipeline-unavailable: no float render targets here',
    );

    const heatmapAlpha = await centreAlpha(page);
    const heatmapBlock = await centreBlock(page);
    expect(heatmapAlpha, 'canvas pixels not readable').toBeGreaterThan(0);
    expect(heatmapBlock.length, 'canvas pixels not readable').toBeGreaterThan(0);

    await page.goto('/explore?density=contour-on');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await settle(page);

    const contourBlock = await centreBlock(page);
    const changed = differingPixels(heatmapBlock, contourBlock);
    expect(changed, 'contour renders the same pixels as the heatmap').toBeGreaterThan(
      heatmapBlock.length / 4 / 20,
    );

    const contourAlpha = await centreAlpha(page);
    expect(contourAlpha, 'the contour layer added no coverage').toBeGreaterThan(0);
    expect(
      await page.locator('protspace-control-bar').evaluate((bar) => {
        const select = bar.shadowRoot?.querySelector('#density-layer-select');
        return (select as HTMLSelectElement | null)?.value ?? '';
      }),
    ).toBe('contour-on');
  });
  test("contour rings are the union of each category's own rings", async ({ page }) => {
    await watchForDegraded(page);
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await settle(page);

    test.skip(
      await gammaPipelineUnavailable(page),
      'renderer reported gamma-pipeline-unavailable: no float render targets here',
    );

    const first = 'long (4 C-C) scorpion toxin superfamily';
    const second = 'short scorpion toxin superfamily';
    const legendValues = await page.evaluate(() => {
      const legend = document.querySelector('protspace-legend');
      return Array.from(
        legend?.shadowRoot?.querySelectorAll('.legend-item[data-value]') ?? [],
        (el) => el.getAttribute('data-value') ?? '',
      );
    });
    expect(legendValues).toEqual(expect.arrayContaining([first, second]));

    const sets: Record<string, string[]> = { A: [first], B: [second], AB: [first, second] };
    for (const [name, shown] of Object.entries(sets)) {
      await showOnly(page, shown);
      await setContour(page, 'contour-on');
      await captureFrame(page, `${name}:on`);
      await setContour(page, 'off');
      await captureFrame(page, `${name}:off`);
    }

    const { a, b, ab, xor } = await unionMasks(page);
    console.log(`union masks ${first} + ${second}: A ${a}, B ${b}, AB ${ab}, xor ${xor}`);
    expect(a, `${first} drew no rings`).toBeGreaterThan(0);
    expect(b, `${second} drew no rings`).toBeGreaterThan(0);
    expect(xor, 'the {A, B} layer is not the union of the {A} and {B} layers').toBeLessThanOrEqual(
      0.05 * ab,
    );
  });

  test('a selected point in the densest block stays above the contour layer', async ({ page }) => {
    await watchForDegraded(page);
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await settle(page);

    test.skip(
      await gammaPipelineUnavailable(page),
      'renderer reported gamma-pipeline-unavailable: no float render targets here',
    );

    const target = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as Element & {
        _plotData: { length: number; xs: Float32Array; ys: Float32Array; proteinIds: string[] };
        _scales: { x: (v: number) => number; y: (v: number) => number };
        _transform: { x: number; y: number; k: number };
      };
      const { _plotData: pd, _scales: sc, _transform: t } = plot;
      const cell = 16;
      const pos = (i: number) => [t.x + t.k * sc.x(pd.xs[i]), t.y + t.k * sc.y(pd.ys[i])];
      const counts = new Map<string, number>();
      for (let i = 0; i < pd.length; i++) {
        const [x, y] = pos(i);
        const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const [best, count] = [...counts.entries()].sort((p, q) => q[1] - p[1])[0];
      const [cx, cy] = best.split(',').map((v) => (Number(v) + 0.5) * cell);
      let pick = 0;
      let dist = Infinity;
      for (let i = 0; i < pd.length; i++) {
        const [x, y] = pos(i);
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < dist) {
          dist = d;
          pick = i;
        }
      }
      const [x, y] = pos(pick);
      return { id: pd.proteinIds[pick], x, y, count };
    });
    expect(target.count, 'no dense block found').toBeGreaterThan(5);

    const pixel = () =>
      page.evaluate(({ x, y }) => {
        const plot = document.querySelector('#myPlot');
        const canvas = plot?.shadowRoot?.querySelector('canvas[data-key]') as HTMLCanvasElement;
        const dpr = canvas.width / canvas.getBoundingClientRect().width;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d')!;
        ctx.drawImage(canvas, 0, 0);
        return Array.from(ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data);
      }, target);
    const maxDelta = (p: number[], q: number[]) => Math.max(...p.map((v, c) => Math.abs(v - q[c])));

    await setContour(page, 'off');
    const offUnselected = await pixel();
    await setContour(page, 'contour-on');
    expect(maxDelta(await pixel(), offUnselected), 'the layer paints nothing here').toBeGreaterThan(
      8,
    );

    await page.evaluate((id) => {
      const plot = document.querySelector('#myPlot') as Element & { selectedProteinIds: string[] };
      plot.selectedProteinIds = [id];
    }, target.id);
    await settle(page);
    const on = await pixel();
    await setContour(page, 'off');
    const off = await pixel();
    expect(off[3], 'the selected point is not drawn').toBeGreaterThan(0);
    expect(
      maxDelta(on, off),
      `selected pixel ${on} with the layer, ${off} without`,
    ).toBeLessThanOrEqual(8);
  });
});
