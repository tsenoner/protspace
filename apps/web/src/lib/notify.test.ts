import { afterEach, describe, expect, it, vi } from 'vitest';

const mockedToast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('../components/ui/sonner', () => ({
  toast: mockedToast,
}));

import { notify, resetNotifyStateForTests, setNotifyTarget } from './notify';

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
  it('returns the toast id; undefined when deduped', () => {
    mockedToast.info.mockReturnValueOnce(7);

    expect(notify.info({ title: 'Saved.', dedupeKey: 'saved' })).toBe(7);
    expect(notify.info({ title: 'Saved.', dedupeKey: 'saved' })).toBeUndefined();
    expect(mockedToast.info).toHaveBeenCalledTimes(1);
  });

  it('dismiss forwards to toast.dismiss', () => {
    notify.dismiss('toast-3');
    expect(mockedToast.dismiss).toHaveBeenCalledWith('toast-3');
  });

  it('setNotifyTarget routes toasts to that toaster id and null stops it', () => {
    setNotifyTarget('workbench');
    notify.warning({ title: 'Selection mode disabled.' });
    expect(mockedToast.warning.mock.calls[0][1]).toMatchObject({ toasterId: 'workbench' });

    setNotifyTarget(null);
    notify.warning({ title: 'Selection mode disabled.' });
    expect(mockedToast.warning.mock.calls[1][1]).not.toHaveProperty('toasterId');
  });

  it('undoable runs onUndo once and dismisses', () => {
    mockedToast.info.mockReturnValueOnce('undo-1');
    const onUndo = vi.fn();

    const handle = notify.undoable({ title: 'Filter removed', onUndo });

    const [title, payload] = mockedToast.info.mock.calls[0];
    expect(title).toBe('Filter removed');
    expect(payload).toMatchObject({ duration: 8_000, action: { label: 'Undo' } });
    payload.action.onClick();
    payload.action.onClick();
    expect(onUndo).toHaveBeenCalledTimes(1);

    handle.dismiss();
    expect(mockedToast.dismiss).toHaveBeenCalledWith('undo-1');
  });

  it('undoable calls onClose on dismiss and on auto-close', () => {
    const onClose = vi.fn();
    notify.undoable({ title: 'Filter removed', onUndo: vi.fn(), onClose });

    const [, payload] = mockedToast.info.mock.calls[0];
    payload.onDismiss();
    payload.onAutoClose();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
