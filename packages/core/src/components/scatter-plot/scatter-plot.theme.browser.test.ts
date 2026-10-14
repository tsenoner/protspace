import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import type { ProtspaceScatterplot } from './scatter-plot';
import './scatter-plot';

/** The private members these cases watch. */
interface PlotPrivates {
  _webglRenderer: {
    invalidateCategoryStyles(): void;
    invalidateDepthOrder(): void;
    invalidateStyleCache(): void;
  } | null;
  _renderLoop: { request(): void };
}

const root = document.documentElement;
// Pure red: its blends with its ×0.5 rim and with white keep R ≥ 127, so no edge pixel can come
// near the slate #64748b the capture case counts.
const FAMILY_A = [0xff, 0x00, 0x00];
const DARK_OTHER = [0x64, 0x74, 0x8b];
const LIGHT_OTHER = [0x88, 0x88, 0x88];

beforeAll(() => adoptTheme());
afterEach(() => {
  root.removeAttribute('data-theme');
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const near = (rgb: number[], want: number[]) => rgb.every((c, i) => Math.abs(c - want[i]) <= 3);

/** Four proteins far apart: P1 and P4 in family A, P2 and P3 in B, which the plot draws as Other. */
function makeData(): VisualizationData {
  return {
    protein_ids: ['P1', 'P2', 'P3', 'P4'],
    projections: [
      { name: 'umap', dimension: 2, data: new Float32Array([0, 0, 0, 10, 10, 0, 10, 10]) },
    ],
    annotations: {
      fam: {
        kind: 'categorical',
        values: ['A', 'B'],
        colors: ['#ff0000', '#cc3311'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: { fam: Int32Array.from([0, 1, 1, 0]) },
  } as unknown as VisualizationData;
}

/** The RGB the plot's WebGL canvas holds at a protein's centre. */
function pixelAt(plot: ProtspaceScatterplot, id: string): number[] {
  const canvas = plot.shadowRoot!.querySelector('canvas')!;
  const rect = canvas.getBoundingClientRect();
  const at = plot.getProteinClientPosition(id);
  if (!at || rect.width === 0) return [-1, -1, -1];
  const x = Math.round((at.x - rect.left) * (canvas.width / rect.width));
  const y = Math.round((at.y - rect.top) * (canvas.height / rect.height));
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

/** A drawn plot: mounted at 480×360 with opaque points, so a centre pixel is the point's colour. */
async function mountPlot(): Promise<ProtspaceScatterplot> {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.otherAnnotationValues = ['B'];
  plot.config = { baseOpacity: 1 };
  plot.data = makeData();
  document.body.append(plot);
  await plot.updateComplete;
  await vi.waitFor(() => expect(near(pixelAt(plot, 'P1'), FAMILY_A)).toBe(true), {
    timeout: 5_000,
  });
  return plot;
}

describe('scatterplot theme', () => {
  it('in dark the host background is #0b1120', async () => {
    const plot = await mountPlot();
    expect(getComputedStyle(plot).backgroundColor).toBe('rgb(255, 255, 255)');
    root.dataset.theme = 'dark';
    expect(getComputedStyle(plot).backgroundColor).toBe('rgb(11, 17, 32)');
  });

  it("in dark an Other point's pixel is the dark grey (±3 per channel after blending)", async () => {
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => {
      const rgb = pixelAt(plot, 'P2');
      expect(near(rgb, DARK_OTHER), `P2 is ${rgb}`).toBe(true);
    });
  });

  it('switching dark → light requests one render and restyles colour only', async () => {
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), DARK_OTHER)).toBe(true));
    const privates = plot as unknown as PlotPrivates;
    const renderer = privates._webglRenderer!;
    const restyle = vi.spyOn(renderer, 'invalidateCategoryStyles');
    const resort = vi.spyOn(renderer, 'invalidateDepthOrder');
    const restage = vi.spyOn(renderer, 'invalidateStyleCache');
    const request = vi.spyOn(privates._renderLoop, 'request');

    root.dataset.theme = 'light';
    await tick();

    expect(restyle).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(resort).not.toHaveBeenCalled();
    expect(restage).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), LIGHT_OTHER)).toBe(true));
  });

  it("re-setting data-theme='dark' renders nothing", async () => {
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), DARK_OTHER)).toBe(true));
    const privates = plot as unknown as PlotPrivates;
    const restyle = vi.spyOn(privates._webglRenderer!, 'invalidateCategoryStyles');
    const request = vi.spyOn(privates._renderLoop, 'request');

    root.dataset.theme = 'dark';
    await tick();

    expect(restyle).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('captureAtResolution in dark gives #888888 Other points on #ffffff', async () => {
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), DARK_OTHER)).toBe(true));

    const out = plot.captureAtResolution(480, 360);
    const data = out.getContext('2d')!.getImageData(0, 0, out.width, out.height).data;
    let light = 0;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      const rgb = [data[i], data[i + 1], data[i + 2]];
      if (near(rgb, LIGHT_OTHER)) light++;
      if (near(rgb, DARK_OTHER)) dark++;
    }
    expect(Array.from(data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(light).toBeGreaterThan(0);
    // The live view's dark grey never reaches the export (its rims and anti-aliasing are
    // neutral greys, never the slate-blue #64748b).
    expect(dark).toBe(0);
  });

  it('a plot mounted in dark draws in the dark greys from the start, with no theme restyle', async () => {
    const proto = customElements.get('protspace-scatterplot')!.prototype as unknown as {
      _handleThemeChange(): void;
    };
    const restyle = vi.spyOn(proto, '_handleThemeChange');
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), DARK_OTHER)).toBe(true));
    // Review Focus 2: a dark load adds no render. If the greys were first read while the plot was
    // detached (the light fallback), connect() would flip them to dark and restyle once.
    expect(restyle).not.toHaveBeenCalled();
  });
});
