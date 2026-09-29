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
    vi.unstubAllGlobals();
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

  it('forwards a callback action and a secondary action (sonner cancel) that run on click', () => {
    const retry = vi.fn();
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy, location: { href: '' } });

    notify.error({
      title: "Couldn't load.",
      action: { label: 'Retry', onClick: retry },
      secondaryAction: { label: 'Report this', href: 'https://example.org/report' },
    });

    const [, payload] = mockedToast.error.mock.calls[0];
    expect(payload.action.label).toBe('Retry');
    expect(payload.cancel.label).toBe('Report this');
    payload.action.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
    payload.cancel.onClick();
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.org/report',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('lets a notification show again right after one of its actions was used', () => {
    const options = {
      title: "Couldn't load.",
      dedupeKey: 'example-load-error:x',
      action: { label: 'Retry', onClick: vi.fn() },
    };
    notify.error(options);
    notify.error(options);
    expect(mockedToast.error).toHaveBeenCalledTimes(1);

    // Retry dismisses the toast; if it fails again, that must be shown.
    mockedToast.error.mock.calls[0][1].action.onClick();
    notify.error(options);
    expect(mockedToast.error).toHaveBeenCalledTimes(2);
  });

  it('omits the action key when no action is provided', () => {
    notify.success({ title: 'Export ready.' });

    const [, payload] = mockedToast.success.mock.calls[0];
    expect(payload).not.toHaveProperty('action');
  });
});
