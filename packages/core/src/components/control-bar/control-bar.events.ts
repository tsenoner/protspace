import type { HostMessageEventDetail } from '../../events';

export interface SelectionDisabledNotificationContext {
  reason: string;
  dataSize: number;
}

export interface SelectionDisabledNotificationDetail extends HostMessageEventDetail<
  'control-bar',
  'warning',
  SelectionDisabledNotificationContext
> {}
