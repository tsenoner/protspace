import type { Page } from '@playwright/test';

/**
 * Simulate a WebGL2 device with a given `MAX_TEXTURE_SIZE`, including the
 * driver-side refusal of anything larger.
 *
 * Stubbing `gl.getParameter` alone proves nothing: it changes what the app
 * believes, while the real driver on the test machine accepts the allocation
 * regardless. Simulating the refusal is what makes an assertion about the
 * renderer's behaviour meaningful — and it reproduces the exact shape of the
 * real failure: `texImage2D` past the limit raises `GL_INVALID_VALUE`, which is
 * not a JS exception, so nothing unwinds and the texture is left unallocated.
 *
 * It patches the prototype, so it sees EVERY WebGL2 texture in the page, not
 * just the label atlas — including the renderer's canvas-sized gamma-pipeline
 * colour target. Pick a `limit` above the plot canvas's physical size, or the
 * stats will blame the renderer for an allocation the atlas work never made.
 */
interface SimulatedGlStats {
  /** [width, height] of every allocation the simulated device refused. */
  refusedAllocations: Array<[number, number]>;
  /** Updates issued against a texture that was never successfully allocated. */
  refusedUpdates: number;
}

declare global {
  interface Window {
    __glSim?: SimulatedGlStats;
  }
}

export async function simulateTextureLimit(page: Page, limit: number): Promise<void> {
  await page.addInitScript((maxTextureSize: number) => {
    const MAX_TEXTURE_SIZE = 0x0d33;
    const INVALID_VALUE = 0x0501;
    const INVALID_OPERATION = 0x0502;

    const stats: SimulatedGlStats = { refusedAllocations: [], refusedUpdates: 0 };
    window.__glSim = stats;

    const proto = WebGL2RenderingContext.prototype;
    const originalGetParameter = proto.getParameter;
    const originalTexImage2D = proto.texImage2D;
    const originalTexSubImage2D = proto.texSubImage2D;
    const originalGetError = proto.getError;
    const originalBindTexture = proto.bindTexture;

    const boundTexture = new WeakMap<WebGL2RenderingContext, WebGLTexture | null>();
    const allocated = new WeakSet<WebGLTexture>();
    const pendingError = new WeakMap<WebGL2RenderingContext, number>();

    proto.getParameter = function patchedGetParameter(this: WebGL2RenderingContext, name: number) {
      if (name === MAX_TEXTURE_SIZE) return maxTextureSize;
      return originalGetParameter.call(this, name);
    };

    proto.bindTexture = function patchedBindTexture(
      this: WebGL2RenderingContext,
      target: number,
      texture: WebGLTexture | null,
    ) {
      boundTexture.set(this, texture);
      return originalBindTexture.call(this, target, texture);
    };

    proto.texImage2D = function patchedTexImage2D(
      this: WebGL2RenderingContext,
      ...args: unknown[]
    ) {
      const texture = boundTexture.get(this) ?? null;
      // Only the explicit-dimension overloads carry width/height at 3 and 4. The
      // 6-argument DOM-source form — texImage2D(target, level, internalformat,
      // format, type, source) — puts enum values there instead (RGBA is 6408,
      // UNSIGNED_BYTE is 5121), which would read as an enormous allocation and be
      // recorded as a refusal the renderer never issued, then evict the texture
      // from `allocated` so its next update counted as a refused update too.
      const hasExplicitSize = args.length >= 9;
      const width = hasExplicitSize ? (args[3] as number) : null;
      const height = hasExplicitSize ? (args[4] as number) : null;

      if (
        typeof width === 'number' &&
        typeof height === 'number' &&
        (width > maxTextureSize || height > maxTextureSize)
      ) {
        stats.refusedAllocations.push([width, height]);
        pendingError.set(this, INVALID_VALUE);
        if (texture) allocated.delete(texture);
        return undefined;
      }

      if (texture) allocated.add(texture);
      return (originalTexImage2D as (...a: unknown[]) => unknown).apply(this, args);
    };

    proto.texSubImage2D = function patchedTexSubImage2D(
      this: WebGL2RenderingContext,
      ...args: unknown[]
    ) {
      const texture = boundTexture.get(this) ?? null;
      if (texture && !allocated.has(texture)) {
        stats.refusedUpdates += 1;
        pendingError.set(this, INVALID_OPERATION);
        return undefined;
      }
      return (originalTexSubImage2D as (...a: unknown[]) => unknown).apply(this, args);
    };

    proto.getError = function patchedGetError(this: WebGL2RenderingContext) {
      const simulated = pendingError.get(this);
      if (simulated !== undefined) {
        pendingError.delete(this); // getError clears the flag it reports
        return simulated;
      }
      return originalGetError.call(this);
    };
  }, limit);
}

export async function simulatedGlStats(page: Page): Promise<SimulatedGlStats> {
  return page.evaluate(() => window.__glSim ?? { refusedAllocations: [], refusedUpdates: 0 });
}

/** Distinct opaque colours present in the plot canvas, as "r,g,b" keys. */
export async function distinctCanvasColors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document
      .querySelector('#myPlot')
      ?.shadowRoot?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return [];
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue; // skip background and anti-alias fringe
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return [...seen];
  });
}
