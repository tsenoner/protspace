/**
 * Hollow (EAT) markers keep a hole on every shape. Compiles the real point shader, which the live
 * and export renderers share, against a bare WebGL2 context and draws each shape twice, filled and
 * hollow, at several shape sizes and dprs and at several sub-pixel positions. A pixel the filled
 * glyph covers but the hollow one leaves clear is hole; one both cover is ring.
 *
 * Never navigates (it draws via `setContent`), so it needs no app server.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  POINT_FRAGMENT_SHADER as frag,
  POINT_VERTEX_SHADER as vert,
} from '../../../packages/core/src/components/scatter-plot/webgl/renderer/point-shaders';

/** Shape indices as the shader reads them (getShapeIndex). */
const SHAPES = {
  circle: 0,
  square: 1,
  diamond: 2,
  'triangle-up': 3,
  'triangle-down': 4,
  plus: 5,
} as const;

/** Device px of a sprite: 2 · √(8 · shapeSize) / 3 CSS px, times the dpr. */
const spritePx = (shapeSize: number, dpr: number) => ((2 * Math.sqrt(8 * shapeSize)) / 3) * dpr;

interface GlyphPixels {
  hole: number;
  ring: number;
  /** Opaque pixels from the left edge of the centre row inward, hollow glyph. */
  ringRun: number;
  /** The hollow glyph's most opaque pixel. */
  hollowPeak: number;
}

interface DrawOptions {
  /** Where the centre lands in its pixel: 0.5 its centre, 0 its corner. */
  offset?: number;
  /** The point's opacity: 1 shown, the config's fadedOpacity (0.15) faded. */
  alpha?: number;
  /** The plot background (u_knockoutColor), as sRGB 0-1. */
  background?: [number, number, number];
}

async function drawGlyphs(
  page: Page,
  shape: number,
  size: number,
  { offset = 0.5, alpha = 1, background = [1, 1, 1] }: DrawOptions = {},
): Promise<GlyphPixels> {
  return page.evaluate(
    ({ vert, frag, shape, size, offset, alpha, background }) => {
      const W = 128;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = W;
      const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true });
      if (!gl) throw new Error('no webgl2');
      const compile = (type: number, source: string) => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, source);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(sh) ?? 'compile failed');
        }
        return sh;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
      }
      gl.useProgram(program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const loc = (n: string) => gl.getUniformLocation(program, n);
      gl.uniform2f(loc('u_resolution'), W, W);
      gl.uniform4f(loc('u_transform'), 0, 0, 1, 1);
      gl.uniform1f(loc('u_dpr'), 1);
      gl.uniform1f(loc('u_pointScale'), 1);
      gl.uniform1f(loc('u_gamma'), 2.2);
      gl.uniform3f(loc('u_knockoutColor'), ...background);
      gl.uniform1i(loc('u_maxLabels'), 1);
      gl.uniform2f(loc('u_labelTextureSize'), 1, 1);

      const attrib = (name: string, n: number, data: number[]) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        const l = gl.getAttribLocation(program, name);
        if (l < 0) return;
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, n, gl.FLOAT, false, 0, 0);
      };
      // Filled on the left, hollow on the right, each `offset` px into a pixel: 0.5 is the
      // pixel's centre, 0 its corner.
      const centres = [
        [32 + offset, 64 + offset],
        [96 + offset, 64 + offset],
      ];
      attrib('a_dataPosition', 2, centres.flat());
      attrib('a_pointSize', 1, [size, size]);
      attrib('a_color', 4, [0.2, 0.4, 0.8, alpha, 0.2, 0.4, 0.8, alpha]);
      attrib('a_predicted', 1, [0, 1]);
      attrib('a_depth', 1, [0, 0]);
      attrib('a_labelCount', 1, [1, 1]);
      attrib('a_shape', 1, [shape, shape]);
      gl.drawArrays(gl.POINTS, 0, 2);

      const pixels = new Uint8Array(W * W * 4);
      gl.readPixels(0, 0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const pixelAlpha = (x: number, y: number) => pixels[(y * W + x) * 4 + 3] / 255;

      let hole = 0;
      let ring = 0;
      let hollowPeak = 0;
      // Opaque enough to count as covered: most of the point's own alpha.
      const covered = 0.95 * alpha;
      const half = Math.ceil(size / 2) + 1;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const filled = pixelAlpha(32 + dx, 64 + dy);
          const hollow = pixelAlpha(96 + dx, 64 + dy);
          hollowPeak = Math.max(hollowPeak, hollow);
          if (filled < covered) continue;
          if (hollow < 0.1) hole++;
          else if (hollow > 0.9) ring++;
        }
      }
      let ringRun = 0;
      for (let dx = -half; dx <= 0; dx++) {
        if (pixelAlpha(96 + dx, 64) > 0.5) ringRun++;
        else if (ringRun > 0) break;
      }
      return { hole, ring, ringRun, hollowPeak };
    },
    { vert, frag, shape, size, offset, alpha, background },
  );
}

/** Where a point's centre lands in its pixel, from the corner (0) to the centre (0.5). */
const OFFSETS = [0, 0.125, 0.25, 0.375, 0.5];
const ALL_SHAPES = Object.keys(SHAPES) as (keyof typeof SHAPES)[];

/**
 * Shape sizes and dprs at which a shape keeps a hole wherever its point lands. Shape size 10 is
 * the default near 10,000 proteins. At dpr 1 a size-10 diamond or plus is under 8 device px
 * across, so whether a pixel of hole survives depends on the sub-pixel position; they need about
 * size 32 to keep one everywhere (docs/explore/eat.md says so).
 */
const HOLE_EVERYWHERE: [shapeSize: number, dpr: number, shapes: (keyof typeof SHAPES)[]][] = [
  [10, 2, ALL_SHAPES],
  [10, 1, ['circle', 'square', 'triangle-up', 'triangle-down']],
  [32, 1, ALL_SHAPES],
  [64, 1, ALL_SHAPES],
  [64, 2, ALL_SHAPES],
];

test.describe('hollow markers', () => {
  for (const [shapeSize, dpr, shapes] of HOLE_EVERYWHERE) {
    for (const name of shapes) {
      const size = spritePx(shapeSize, dpr);
      test(`a hollow ${name} keeps a hole and a ring at shape size ${shapeSize}, dpr ${dpr}, wherever it lands`, async ({
        page,
      }) => {
        for (const offset of OFFSETS) {
          const pixels = await drawGlyphs(page, SHAPES[name], size, { offset });
          expect(pixels.hole, `hole at offset ${offset}`).toBeGreaterThan(0);
          // A one-pixel ring off a pixel centre splits over two partly covered pixels, so only a
          // centred point is sure to show a fully opaque one, and only on a sprite of 8 device px
          // or more: below that the anti-aliased edges cover the whole ring.
          if (offset === 0.5 && size >= 8) expect(pixels.ring).toBeGreaterThan(0);
        }
      });
    }
  }

  test('the ring is about 12% of the diameter: at least a pixel, at most a sixth', async ({
    page,
  }) => {
    for (const size of [spritePx(64, 1), spritePx(64, 2), spritePx(128, 2)]) {
      const { ringRun } = await drawGlyphs(page, SHAPES.circle, size);
      expect(ringRun).toBeGreaterThanOrEqual(1);
      // Plus one for the anti-aliased outer edge pixel.
      expect(ringRun).toBeLessThanOrEqual(Math.ceil(size / 6) + 1);
    }
  });

  test('a faded hollow marker stays readable on a dark plot, and only there', async ({ page }) => {
    const size = spritePx(10, 2);
    const light = await drawGlyphs(page, SHAPES.circle, size, { alpha: 0.15 });
    const dark = await drawGlyphs(page, SHAPES.circle, size, {
      alpha: 0.15,
      background: [15 / 255, 23 / 255, 42 / 255],
    });
    const shownDark = await drawGlyphs(page, SHAPES.circle, size, {
      background: [15 / 255, 23 / 255, 42 / 255],
    });
    // Light keeps the configured fade.
    expect(light.hollowPeak).toBeCloseTo(0.15, 1);
    // Dark raises it (2.5x, capped at 0.5), still well under a shown marker.
    expect(dark.hollowPeak).toBeGreaterThan(2 * light.hollowPeak);
    expect(dark.hollowPeak).toBeLessThanOrEqual(0.51);
    expect(shownDark.hollowPeak).toBeGreaterThan(0.95);
    // The ring keeps its hole.
    expect(dark.hole).toBeGreaterThan(0);
  });
});
