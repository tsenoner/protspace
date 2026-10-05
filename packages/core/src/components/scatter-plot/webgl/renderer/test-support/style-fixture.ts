import type { WebGLStyleGetters } from '../../types';
import type { createStyleGetters } from '../../../styling/style-getters';

/**
 * `WebGLStyleGetters` over whatever style getters `current()` returns at each
 * call, so a suite swaps them mid-session as the scatter plot does on a legend
 * or selection change.
 */
export function liveStyle(current: () => ReturnType<typeof createStyleGetters>): WebGLStyleGetters {
  return {
    getColors: (p) => current().getColors(p),
    getPointSize: (p) => current().getPointSize(p),
    getOpacity: (p) => current().getOpacity(p),
    getDepth: (p) => current().getDepth(p),
    getShape: (p) => current().getPointShape(p),
    isPredicted: (p) => current().isPredicted(p),
    isMultilabel: () => current().isMultilabel(),
    createStylePass: () => current().createStylePass(),
  };
}
