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

export function createSelectionDisabledNotificationDetail(
  reason: string,
  dataSize: number,
): SelectionDisabledNotificationDetail {
  const message =
    reason === 'insufficient-data'
      ? `Selection mode disabled: Only ${dataSize} point${dataSize !== 1 ? 's' : ''} remaining`
      : 'Selection mode disabled';

  return {
    message,
    severity: 'warning',
    source: 'control-bar',
    context: {
      reason,
      dataSize,
    },
  };
}
