/**
 * Hollow (EAT) markers keep a hole on every shape. Compiles the real point shader, which the live
 * and export renderers share, against a bare WebGL2 context and draws each shape twice, filled and
 * hollow, at the sprite sizes of shape size 10 and 64 (6 and 15 CSS px) at dpr 1 and 2. A pixel
 * the filled glyph covers but the hollow one leaves clear is hole; one both cover is ring.
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
}

async function drawGlyphs(page: Page, shape: number, size: number): Promise<GlyphPixels> {
  return page.evaluate(
    ({ vert, frag, shape, size }) => {
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
      gl.uniform3f(loc('u_knockoutColor'), 1, 1, 1);
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
      // Filled on the left, hollow on the right, each centred on a pixel centre.
      const centres = [
        [32.5, 64.5],
        [96.5, 64.5],
      ];
      attrib('a_dataPosition', 2, centres.flat());
      attrib('a_pointSize', 1, [size, size]);
      attrib('a_color', 4, [0.2, 0.4, 0.8, 1, 0.2, 0.4, 0.8, 1]);
      attrib('a_predicted', 1, [0, 1]);
      attrib('a_depth', 1, [0, 0]);
      attrib('a_labelCount', 1, [1, 1]);
      attrib('a_shape', 1, [shape, shape]);
      gl.drawArrays(gl.POINTS, 0, 2);

      const pixels = new Uint8Array(W * W * 4);
      gl.readPixels(0, 0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const alpha = (x: number, y: number) => pixels[(y * W + x) * 4 + 3] / 255;

      let hole = 0;
      let ring = 0;
      const half = Math.ceil(size / 2) + 1;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const filled = alpha(32 + dx, 64 + dy);
          const hollow = alpha(96 + dx, 64 + dy);
          if (filled < 0.95) continue;
          if (hollow < 0.1) hole++;
          else if (hollow > 0.9) ring++;
        }
      }
      let ringRun = 0;
      for (let dx = -half; dx <= 0; dx++) {
        if (alpha(96 + dx, 64) > 0.5) ringRun++;
        else if (ringRun > 0) break;
      }
      return { hole, ring, ringRun };
    },
    { vert, frag, shape, size },
  );
}

test.describe('hollow markers', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    // Shape size 10 at dpr 2 (the default for 10,000 proteins on a retina screen), and 64 at
    // dpr 1 and 2.
    for (const [shapeSize, dpr] of [
      [10, 2],
      [64, 1],
      [64, 2],
    ]) {
      const size = spritePx(shapeSize, dpr);
      test(`a hollow ${name} keeps a hole and a ring at shape size ${shapeSize}, dpr ${dpr}`, async ({
        page,
      }) => {
        const pixels = await drawGlyphs(page, shape, size);
        expect(pixels.hole).toBeGreaterThan(0);
        expect(pixels.ring).toBeGreaterThan(0);
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
});
