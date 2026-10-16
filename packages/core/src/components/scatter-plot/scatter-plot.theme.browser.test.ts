import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adoptStyles } from 'lit';
import { userEvent } from 'vitest/browser';
import type { TooltipView, VisualizationData } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import { contrast } from '../../test-support/contrast';
import { colourChannels } from '../../test-support/css-colour';
import type { ProtspaceScatterplot } from './scatter-plot';
import './scatter-plot';
import { scatterplotStyles } from './scatter-plot.styles';
import './tooltips/protein-tooltip';

/** The private members these cases watch. */
interface PlotPrivates {
  _webglRenderer: {
    invalidateCategoryStyles(): void;
    invalidateDepthOrder(): void;
    invalidateStyleCache(): void;
  } | null;
  _renderLoop: { request(): void };
  _drawnPointRadiusCss(): number;
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

/** The RGB the plot's WebGL canvas holds at a protein's centre, or `dx` CSS px to its right. */
function pixelAt(plot: ProtspaceScatterplot, id: string, dx = 0): number[] {
  const canvas = plot.shadowRoot!.querySelector('canvas')!;
  const rect = canvas.getBoundingClientRect();
  const at = plot.getProteinClientPosition(id);
  if (!at || rect.width === 0) return [-1, -1, -1];
  const x = Math.round((at.x + dx - rect.left) * (canvas.width / rect.width));
  const y = Math.round((at.y - rect.top) * (canvas.height / rect.height));
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

/** A drawn plot: mounted at 480×360 with opaque points, so a centre pixel is the point's colour. */
async function mountPlot(
  familyA = '#ff0000',
  config: Record<string, unknown> = {},
): Promise<ProtspaceScatterplot> {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.otherAnnotationValues = ['B'];
  plot.config = { baseOpacity: 1, ...config };
  const data = makeData();
  (data.annotations.fam as { colors: string[] }).colors[0] = familyA;
  plot.data = data;
  document.body.append(plot);
  await plot.updateComplete;
  const want = [1, 3, 5].map((i) => parseInt(familyA.slice(i, i + 2), 16));
  await vi.waitFor(() => expect(near(pixelAt(plot, 'P1'), want)).toBe(true), {
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

  it("an expanded spider's nodes take the theme's Other grey on a switch", async () => {
    root.dataset.theme = 'dark';
    // P2 and P3 (family B, drawn as Other) share a position, so they form a duplicate stack.
    const data = makeData();
    data.projections[0].data = new Float32Array([0, 0, 10, 10, 10, 10, 0, 10]);
    const plot = document.createElement('protspace-scatterplot');
    plot.style.cssText = 'display: block; width: 480px; height: 360px';
    plot.selectedAnnotation = 'fam';
    plot.otherAnnotationValues = ['B'];
    plot.config = { baseOpacity: 1, enableDuplicateStackUI: true };
    plot.data = data;
    document.body.append(plot);
    await plot.updateComplete;
    await vi.waitFor(() => expect(plot.getDuplicateStacks()).toHaveLength(1), { timeout: 3_000 });
    const at = plot.getProteinClientPosition('P2')!;
    plot
      .shadowRoot!.querySelector('svg')!
      .dispatchEvent(
        new MouseEvent('click', { clientX: at.x, clientY: at.y, bubbles: true, composed: true }),
      );
    expect(plot.hasExpandedDuplicateStack()).toBe(true);
    const fills = () =>
      Array.from(
        plot.shadowRoot!.querySelectorAll('.dup-spiderfy-node-circle'),
        (node) => getComputedStyle(node).fill,
      );
    await vi.waitFor(() => expect(fills()).toEqual(['rgb(100, 116, 139)', 'rgb(100, 116, 139)']));

    root.dataset.theme = 'light';
    await vi.waitFor(() => expect(fills()).toEqual(['rgb(136, 136, 136)', 'rgb(136, 136, 136)']));

    root.dataset.theme = 'dark';
    await vi.waitFor(() => expect(fills()).toEqual(['rgb(100, 116, 139)', 'rgb(100, 116, 139)']));
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

  it('in dark a near-black point gets a light rim; light and exports keep the darkened rim', async () => {
    // Kelly's Very Dark Gray at radius ~30 CSS px, so 0.9 of the radius is well inside the rim.
    const big = { pointSize: 8100 };
    const rimOf = (plot: ProtspaceScatterplot) =>
      pixelAt(plot, 'P1', 0.9 * (plot as unknown as PlotPrivates)._drawnPointRadiusCss());
    const exportOf = (plot: ProtspaceScatterplot) => {
      const out = plot.captureAtResolution(480, 360);
      return out.getContext('2d')!.getImageData(0, 0, out.width, out.height).data;
    };

    const light = await mountPlot('#222222', big);
    // The rim darkens the point's own colour: #222222 × 0.5 in linear light is about #191919.
    const lightRim = rimOf(light);
    expect(near(lightRim, [0x19, 0x19, 0x19]), `light rim is ${lightRim}`).toBe(true);
    const lightExport = exportOf(light);
    light.remove();

    root.dataset.theme = 'dark';
    const dark = await mountPlot('#222222', big);
    const darkRim = rimOf(dark);
    const ratio = contrast(`rgb(${darkRim.join(', ')})`, '#0b1120');
    expect(ratio, `dark rim is ${darkRim}, ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(2);
    // Exports always draw the light rules on white, whatever the live theme.
    expect(exportOf(dark)).toEqual(lightExport);
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

/**
 * A host carrying the plot's own stylesheet (scatterplotStyles, as the plot's shadow root adopts
 * it) with the marks the plot draws over its points, so each overlay's colour is read without a
 * dataset or WebGL.
 */
function overlayProbe(): ShadowRoot {
  const host = document.createElement('div');
  host.className = 'overlay-probe';
  const root = host.attachShadow({ mode: 'open' });
  adoptStyles(root, scatterplotStyles);
  root.innerHTML = `
    <canvas width="20" height="20"></canvas>
    <svg width="200" height="200">
      <g class="brush-container"><rect class="selection" width="20" height="20"></rect></g>
      <path class="lasso-path" d="M0 0 L20 20 L0 20 Z"></path>
      <line class="eat-provenance-connector" x1="0" y1="0" x2="20" y2="20"></line>
      <circle class="eat-provenance-endpoint" cx="10" cy="10" r="4"></circle>
      <circle class="dup-spiderfy-node-circle" cx="30" cy="30" r="4"></circle>
    </svg>
    <div class="plot-indicator">1,000 points</div>
    <div class="connector-status"><span>2 connectors off screen</span><button type="button">×</button></div>`;
  document.body.append(host);
  return root;
}

const TOOLTIP_VIEW: TooltipView = {
  proteinId: 'P12345',
  geneName: ['KIN1'],
  proteinName: ['Serine kinase'],
  uniprotKbId: ['KIN1_HUMAN'],
  blocks: [
    {
      key: 'ec',
      label: 'EC number',
      displayValues: ['2.7.11.1'],
      numericValue: null,
      numericType: 'float',
      scores: [],
      evidence: [],
      predicted: { value: '2.7.11.1', confidence: 0.8, source: 'Q99999' },
    },
  ],
};

/** A hover tooltip with an EAT-transferred annotation, as the plot shows it. */
async function mountTooltip(): Promise<ShadowRoot> {
  const tooltip = document.createElement('protspace-protein-tooltip');
  tooltip.view = TOOLTIP_VIEW;
  tooltip.className = 'visible';
  document.body.append(tooltip);
  await tooltip.updateComplete;
  return tooltip.shadowRoot!;
}

const styleOf = (root: ShadowRoot, selector: string) =>
  getComputedStyle(root.querySelector(selector)!);

describe('plot overlays, chips and tooltip follow the theme', () => {
  beforeAll(() => adoptTheme());
  afterEach(() => {
    document
      .querySelectorAll('.overlay-probe, protspace-protein-tooltip')
      .forEach((el) => el.remove());
    document.documentElement.removeAttribute('data-theme');
  });

  it('the brush selection and lasso stroke with the dark accent', () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    for (const selector of ['.brush-container rect.selection', '.lasso-path']) {
      // sky-400, the dark --ps-accent.
      expect(styleOf(root, selector).stroke).toBe('rgb(56, 189, 248)');
      const [r, g, b, alpha] = colourChannels(styleOf(root, selector).fill);
      expect([r, g, b]).toEqual([56, 189, 248]);
      // Translucent, so the points under a brush stay visible.
      expect(alpha).toBeCloseTo(0.15, 2);
    }
  });

  it('the EAT connector reads #94a3b8 and the endpoint #2dd4bf', () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    expect(styleOf(root, '.eat-provenance-connector').stroke).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, '.eat-provenance-endpoint').stroke).toBe('rgb(45, 212, 191)');
  });

  it('in light the connector stays #475569 and the endpoint #0f766e', () => {
    const root = overlayProbe();
    expect(styleOf(root, '.eat-provenance-connector').stroke).toBe('rgb(71, 85, 105)');
    expect(styleOf(root, '.eat-provenance-endpoint').stroke).toBe('rgb(15, 118, 110)');
  });

  it('the spiderfy node rim is the dark plot background', () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    // #0b1120, the dark --ps-plot-bg.
    expect(styleOf(root, '.dup-spiderfy-node-circle').stroke).toBe('rgb(11, 17, 32)');
  });

  it("the plot's SVG layer stacks above its canvas", () => {
    const root = overlayProbe();
    // Brush, lasso and spider marks live in the SVG and must sit over the WebGL canvas.
    expect(styleOf(root, 'svg').zIndex).toBe('3');
    expect(styleOf(root, 'canvas').zIndex).toBe('1');
    expect(styleOf(root, '.plot-indicator').zIndex).toBe('10');
    expect(styleOf(root, '.connector-status').zIndex).toBe('10');
  });

  it('the point-count chip is 11 px, weight 500, in Inter', () => {
    const root = overlayProbe();
    for (const selector of ['.plot-indicator', '.connector-status']) {
      const chip = styleOf(root, selector);
      expect(chip.fontSize, selector).toBe('11px');
      expect(chip.fontWeight, selector).toBe('500');
      expect(chip.fontFamily, selector).toMatch(/^"Inter Variable"/);
    }
    expect(styleOf(root, '.connector-status button').fontSize).toBe('16px');
  });

  it('the plot host keeps the documented size properties', () => {
    const host = overlayProbe().host;
    const prop = (name: string) => getComputedStyle(host).getPropertyValue(name).trim();
    expect(prop('--protspace-height')).toBe('600px');
    expect(prop('--protspace-width')).toBe('100%');
    expect(prop('--protspace-border-radius')).toBe('6px');
    expect(prop('--protspace-brush-stroke-width')).toBe('1px');
    // Declared for years, read by nothing: gone.
    expect(prop('--protspace-point-size')).toBe('');
    expect(prop('--protspace-transition-duration')).toBe('');
  });

  it('the plot indicator and connector chip sit on the dark raised surface with light text', () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    const indicator = styleOf(root, '.plot-indicator');
    const chip = styleOf(root, '.connector-status');
    // #162036, the dark --ps-surface-raised; #1e293b, the dark --ps-border.
    expect(indicator.backgroundColor).toBe('rgb(22, 32, 54)');
    expect(indicator.borderTopColor).toBe('rgb(30, 41, 59)');
    expect(indicator.color).toBe('rgb(148, 163, 184)');
    expect(chip.backgroundColor).toBe('rgb(22, 32, 54)');
    expect(chip.color).toBe('rgb(241, 245, 249)');
    expect(styleOf(root, '.connector-status button').color).toBe('rgb(148, 163, 184)');
  });

  it('the connector chip button shows the focus ring in dark', async () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    // The probe's only focusable control.
    await userEvent.tab();
    expect(root.activeElement).toBe(root.querySelector('.connector-status button'));
    const button = styleOf(root, '.connector-status button');
    // sky-400, the dark --ps-focus, 2 px out from the button.
    expect(button.outlineStyle).toBe('solid');
    expect(button.outlineColor).toBe('rgb(56, 189, 248)');
    expect(button.outlineOffset).toBe('2px');
  });

  it('the tooltip card is dark with readable text and the EAT bar violet-400', async () => {
    document.documentElement.dataset.theme = 'dark';
    const root = await mountTooltip();
    expect(styleOf(root, '.tooltip').backgroundColor).toBe('rgb(22, 32, 54)');
    expect(styleOf(root, '.tooltip').borderTopColor).toBe('rgb(30, 41, 59)');
    // #131d33, the dark --ps-surface-muted, under the dark --ps-text.
    expect(styleOf(root, '.tooltip-header').backgroundColor).toBe('rgb(19, 29, 51)');
    expect(styleOf(root, '.tooltip-protein-id').color).toBe('rgb(241, 245, 249)');
    expect(styleOf(root, '.tooltip-annotation-header').color).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, '.tooltip-annotation').color).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, '.eat-confidence-track > span').backgroundColor).toBe(
      'rgb(167, 139, 250)',
    );
  });

  it('in light the tooltip stays white with the violet-600 EAT bar', async () => {
    const root = await mountTooltip();
    expect(styleOf(root, '.tooltip').backgroundColor).toBe('rgb(255, 255, 255)');
    expect(styleOf(root, '.tooltip-protein-id').color).toBe('rgb(15, 23, 42)');
    expect(styleOf(root, '.eat-confidence-track > span').backgroundColor).toBe('rgb(124, 58, 237)');
  });
});
