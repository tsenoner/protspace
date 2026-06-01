import type {
  ProtspaceControlBar,
  ProtspaceScatterplot,
  SelectionDisabledNotificationDetail,
} from '@protspace/core';
import { notify } from '../lib/notify';
import { getSelectionDisabledNotification } from './notifications';
import type { DatasetController } from './dataset-controller';
import type { InteractionController } from './interaction-controller';
import type { ViewController } from './view-controller';

interface ControlBarEventsOptions {
  addControlBarListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  controlBar: ProtspaceControlBar;
  datasetController: DatasetController;
  handleExport(event: Event): Promise<void>;
  interactionController: InteractionController;
  plotElement: ProtspaceScatterplot;
  viewController: ViewController;
}

export function bindControlBarEvents({
  addControlBarListener,
  controlBar,
  datasetController,
  handleExport,
  interactionController,
  plotElement,
  viewController,
}: ControlBarEventsOptions): void {
  addControlBarListener('annotation-change', () => {
    const nextAnnotation = controlBar.selectedAnnotation || plotElement.selectedAnnotation || '';
    interactionController.handleAnnotationChange(nextAnnotation);
    viewController.handleUserAnnotationChange();
  });

  addControlBarListener('projection-change', viewController.handleUserProjectionChange);

  addControlBarListener('tooltip-annotations-change', () => {
    viewController.handleUserTooltipAnnotationsChange();
  });

  addControlBarListener('selection-disabled-notification', (event: Event) => {
    const customEvent = event as CustomEvent<SelectionDisabledNotificationDetail>;
    notify.warning(getSelectionDisabledNotification(customEvent.detail));
  });

  // This event name is part of the control-bar custom element contract in @protspace/core.
  addControlBarListener('load-demo-dataset', () => {
    void datasetController.loadDefaultDatasetAndClearPersistedFile();
  });

  addControlBarListener('export', (event: Event) => {
    void handleExport(event);
  });
}
