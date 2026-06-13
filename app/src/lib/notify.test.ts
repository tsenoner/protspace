import { afterEach, describe, expect, it, vi } from 'vitest';

const mockedToast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../components/ui/sonner', () => ({
  toast: mockedToast,
}));

import { notify, resetNotifyStateForTests } from './notify';

describe('notify', () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetNotifyStateForTests();
  });

  it('forwards success notifications with the default duration', () => {
    notify.success({ title: 'Export ready.' });

    expect(mockedToast.success).toHaveBeenCalledWith('Export ready.', {
      description: undefined,
      duration: 4_000,
    });
  });

  it('dedupes repeated warning notifications when the same dedupe key is reused', () => {
    notify.warning({
      title: 'Selection mode disabled.',
      dedupeKey: 'selection-disabled',
    });
    notify.warning({
      title: 'Selection mode disabled.',
      dedupeKey: 'selection-disabled',
    });

    expect(mockedToast.warning).toHaveBeenCalledTimes(1);
  });

  it('does not dedupe notifications when no dedupe key is provided', () => {
    notify.error({ title: 'Export failed.' });
    notify.error({ title: 'Export failed.' });

    expect(mockedToast.error).toHaveBeenCalledTimes(2);
  });

  it('forwards an action to sonner as a label and onClick handler', () => {
    notify.error({
      title: 'Export failed.',
      action: { label: 'Report this', href: 'mailto:hello@protspace.app?subject=x' },
    });

    const [, payload] = mockedToast.error.mock.calls[0];
    expect(payload.action).toEqual({
      label: 'Report this',
      onClick: expect.any(Function),
    });
  });

  it('omits the action key when no action is provided', () => {
    notify.success({ title: 'Export ready.' });

    const [, payload] = mockedToast.success.mock.calls[0];
    expect(payload).not.toHaveProperty('action');
  });
});
