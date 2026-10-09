import type { SelectionDisabledNotificationDetail } from '@protspace/core';
import { notify } from '../lib/notify';
import { getSelectionDisabledNotification } from './notifications';

interface ControlBarEventsOptions {
  addControlBarListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

/**
 * The control bar's last host-facing event. The view pickers, Import, Export and Filter have
 * their own controllers; Task 2.9 moves this warning into the selection controller.
 */
export function bindControlBarEvents({ addControlBarListener }: ControlBarEventsOptions): void {
  addControlBarListener('selection-disabled-notification', (event: Event) => {
    const customEvent = event as CustomEvent<SelectionDisabledNotificationDetail>;
    notify.warning(getSelectionDisabledNotification(customEvent.detail));
  });
}
