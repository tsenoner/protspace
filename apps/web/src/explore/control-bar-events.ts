import type { SelectionDisabledNotificationDetail } from '@protspace/core';
import { notify } from '../lib/notify';
import { getSelectionDisabledNotification } from './notifications';
import type { InteractionController } from './interaction-controller';
import type { ViewController } from './view-controller';

interface ControlBarEventsOptions {
  addControlBarListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  interactionController: InteractionController;
  viewController: ViewController;
}

export function bindControlBarEvents({
  addControlBarListener,
  interactionController,
  viewController,
}: ControlBarEventsOptions): void {
  addControlBarListener('annotation-change', () => {
    interactionController.handleAnnotationChange();
    viewController.handleUserAnnotationChange();
  });

  addControlBarListener('projection-change', viewController.handleUserProjectionChange);

  addControlBarListener('tooltip-annotations-change', () => {
    viewController.handleUserTooltipAnnotationsChange();
  });

  addControlBarListener('density-layer-change', () => {
    viewController.handleUserDensityLayerChange();
  });

  addControlBarListener('selection-disabled-notification', (event: Event) => {
    const customEvent = event as CustomEvent<SelectionDisabledNotificationDetail>;
    notify.warning(getSelectionDisabledNotification(customEvent.detail));
  });
}
