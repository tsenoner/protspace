import { describe, expect, it, vi } from 'vitest';
import { bindControlBarEvents } from './control-bar-events';

/** Binds the control-bar listeners to a plain event target, with spied controllers. */
function bind() {
  const controlBar = new EventTarget();
  const interactionController = { handleAnnotationChange: vi.fn() };
  const viewController = {
    handleUserAnnotationChange: vi.fn(),
    handleUserProjectionChange: vi.fn(),
    handleUserTooltipAnnotationsChange: vi.fn(),
    handleUserDensityLayerChange: vi.fn(),
  };
  bindControlBarEvents({
    addControlBarListener: (type, listener, options) =>
      controlBar.addEventListener(type, listener, options),
    interactionController: interactionController as never,
    viewController: viewController as never,
  });
  return { controlBar, interactionController, viewController };
}

describe('the control bar events', () => {
  it('an annotation change reaches the interaction and view controllers', () => {
    const { controlBar, interactionController, viewController } = bind();

    controlBar.dispatchEvent(
      new CustomEvent('annotation-change', { detail: { annotation: 'ec' } }),
    );

    expect(interactionController.handleAnnotationChange).toHaveBeenCalledOnce();
    expect(viewController.handleUserAnnotationChange).toHaveBeenCalledOnce();
  });
});
