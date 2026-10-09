import { afterEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../lib/notify';
import { bindControlBarEvents } from './control-bar-events';

vi.mock('../lib/notify', () => ({ notify: { warning: vi.fn() } }));

describe('control bar events', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the selection-disabled warning as a toast', () => {
    const controlBar = new EventTarget();
    bindControlBarEvents({
      addControlBarListener: (type, listener, options) =>
        controlBar.addEventListener(type, listener, options),
    });

    controlBar.dispatchEvent(
      new CustomEvent('selection-disabled-notification', {
        detail: {
          message: 'Selection mode disabled: Only 1 point remaining',
          severity: 'warning',
          source: 'control-bar',
          context: { reason: 'insufficient-data', dataSize: 1 },
        },
      }),
    );

    expect(notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Selection mode disabled.',
        description: 'Selection mode disabled: Only 1 point remaining',
      }),
    );
  });
});
