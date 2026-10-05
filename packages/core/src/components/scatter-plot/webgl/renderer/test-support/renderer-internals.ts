/**
 * The private `WebGLRenderer` members the suites read or stub, typed off the
 * class. `type-check` skips `*.test.ts` but not this file, so renaming or
 * retyping one of them fails here instead of leaving a suite reading `undefined`.
 */
import type { WebGLRenderer } from '../webgl-renderer';

interface RendererInternals {
  resources: WebGLRenderer['resources'];
  /** Looked up by the first render, which the suites read it after. */
  pointAttribLocations: NonNullable<WebGLRenderer['pointAttribLocations']>;
  stageArrays: WebGLRenderer['stageArrays'];
  recordIds: WebGLRenderer['recordIds'];
  sortOrder: WebGLRenderer['sortOrder'];
  atlas: WebGLRenderer['atlas'];
  stagedRecords: WebGLRenderer['stagedRecords'];
  markTexture: WebGLRenderer['markTexture'];
  contourPalette: WebGLRenderer['contourPalette'];
  densityDisabled: WebGLRenderer['densityDisabled'];
  degradeReported: WebGLRenderer['degradeReported'];
  gammaPipelineAvailable: WebGLRenderer['gammaPipelineAvailable'];
  missingFloatExtension: WebGLRenderer['missingFloatExtension'];
  exportRenderer: WebGLRenderer['exportRenderer'];
  getEffectiveGamma: WebGLRenderer['getEffectiveGamma'];
  renderWithGammaCorrection: WebGLRenderer['renderWithGammaCorrection'];
}

/** `renderer` itself, with its private members in view. */
export function internalsOf(renderer: WebGLRenderer): RendererInternals {
  return renderer as unknown as RendererInternals;
}
