/**
 * Visual harness for the #369 glyph outline. Not a CI gate — a way to LOOK at the
 * thing, because how heavy an outline should be is a judgement call no unit test
 * can make.
 *
 * It compiles the real point shader (the single source both the live and export
 * renderers use) against a bare WebGL2 context and draws glyphs at several point
 * sizes: curated (filled) beside EAT-predicted (hollow ring), over both a dark
 * and a light surface.
 *
 * Run:  RUN_GLYPH_HARNESS=1 PLAYWRIGHT_BASE_URL=http://localhost:8080 \
 *         pnpm exec playwright test -c apps/web/tests/playwright.config.ts --project=glyph-outline
 * Look: apps/web/tests/__screens__/glyphs.png
 *
 * PLAYWRIGHT_BASE_URL is what disables the config's `webServer` block. The harness never
 * navigates — it draws into a canvas via `setContent` — so without it Playwright spends up to
 * 180 s booting the Vite dev server for a test that never touches it. The URL is never fetched.
 */
import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  POINT_FRAGMENT_SHADER as frag,
  POINT_VERTEX_SHADER as vert,
} from '../../../packages/core/src/components/scatter-plot/webgl/renderer/export-shaders';

const SCREENSHOT = fileURLToPath(new URL('./__screens__/glyphs.png', import.meta.url));

test('glyph outline appearance across point sizes', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 980 });
  await page.setContent('<body style="margin:0"><canvas id="c" width="900" height="960"></canvas>');

  const error = await page.evaluate(
    ({ vert, frag }) => {
      const canvas = document.getElementById('c') as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true });
      if (!gl) return 'no webgl2';

      const compile = (type: number, source: string) => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, source);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          return { err: gl.getShaderInfoLog(sh) ?? 'compile failed', sh: null };
        }
        return { err: null, sh };
      };
      const v = compile(gl.VERTEX_SHADER, vert);
      if (v.err) return 'vertex: ' + v.err;
      const f = compile(gl.FRAGMENT_SHADER, frag);
      if (f.err) return 'fragment: ' + f.err;

      const program = gl.createProgram()!;
      gl.attachShader(program, v.sh!);
      gl.attachShader(program, f.sh!);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        return 'link: ' + gl.getProgramInfoLog(program);
      }
      gl.useProgram(program);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // Dark surface on top half, light on the bottom half.
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 480, 900, 480);
      gl.clearColor(0.07, 0.09, 0.11, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);

      const loc = (n: string) => gl.getUniformLocation(program, n);
      gl.uniform2f(loc('u_resolution'), 900, 960);
      gl.uniform3f(loc('u_transform'), 0, 0, 1);
      gl.uniform1f(loc('u_dpr'), 1);
      gl.uniform1f(loc('u_gamma'), 2.2);
      gl.uniform3f(loc('u_knockoutColor'), 1, 1, 1);
      gl.uniform1i(loc('u_maxLabels'), 1);
      gl.uniform2f(loc('u_labelTextureSize'), 1, 1);

      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, 255]),
      );
      gl.uniform1i(loc('u_labelColors'), 0);

      const attrib = (name: string, size: number, data: number[]) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        const l = gl.getAttribLocation(program, name);
        if (l < 0) return;
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
      };

      // A mid tone, a dark one, and a very pale one — the pale entry is the case
      // that survives on a white surface only because of the rim.
      const COLORS: Array<[number, number, number]> = [
        [0.95, 0.76, 0.06],
        [0.13, 0.35, 0.24],
        [0.95, 0.95, 0.93],
      ];
      const SIZES = [16, 32, 72];
      // Circle AND diamond. The diamond is not decoration: its edgeDist field
      // (1 - (|x|*SQRT3 + |y|)) has |gradient| = 2 where every other shape is 1, so it is the
      // one glyph where "one device pixel" of outline is not one pixel of sprite. Rendering
      // circles only is why a 3x loss of rim on predicted diamonds went unseen once.
      const SHAPES = [0, 2];

      const positions: number[] = [];
      const sizes: number[] = [];
      const colors: number[] = [];
      const predicted: number[] = [];
      const depths: number[] = [];
      const labelCounts: number[] = [];
      const shapes: number[] = [];

      // Rows are shape x point size (small at the top of each band), columns are colour x
      // curated/predicted, so nothing overlaps and the rim stays judgeable. Sizes skew small
      // because that is where the device-pixel floor dominates the radius fraction.
      for (let band = 0; band < 2; band++) {
        SHAPES.forEach((shape, shi) => {
          SIZES.forEach((size, si) => {
            const yBase = (band === 0 ? 60 : 510) + (shi * SIZES.length + si) * 72;
            COLORS.forEach((c, ci) => {
              for (let pred = 0; pred < 2; pred++) {
                positions.push(80 + ci * 260 + pred * 110, yBase);
                sizes.push(size);
                colors.push(c[0], c[1], c[2], 1);
                predicted.push(pred);
                depths.push(0);
                labelCounts.push(1);
                shapes.push(shape);
              }
            });
          });
        });
      }

      attrib('a_dataPosition', 2, positions);
      attrib('a_pointSize', 1, sizes);
      attrib('a_color', 4, colors);
      attrib('a_predicted', 1, predicted);
      attrib('a_depth', 1, depths);
      attrib('a_labelCount', 1, labelCounts);
      attrib('a_shape', 1, shapes);

      gl.drawArrays(gl.POINTS, 0, sizes.length);
      return null;
    },
    { vert, frag },
  );

  if (error) throw new Error('shader harness failed: ' + error);
  await page.locator('#c').screenshot({ path: SCREENSHOT });
});
