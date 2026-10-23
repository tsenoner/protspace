/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import type { ProtspaceLegend } from '../legend';
import { SettingsController } from './settings-controller';

/** The host members toggle and close touch; the real popover needs showPopover, which jsdom lacks. */
function fakeHost() {
  const host = Object.assign(document.createElement('div'), {
    _settingsAnchor: null as HTMLElement | null,
    _settingsPopover: { flush: vi.fn() },
    _reorder: { clear: vi.fn() },
    _colorPicker: { close: vi.fn() },
    _rowMenu: { close: vi.fn() },
    _otherPopover: { close: vi.fn() },
    _sortMenu: 'family' as string | null,
  });
  return { host, settings: new SettingsController(host as unknown as ProtspaceLegend) };
}

describe('SettingsController', () => {
  it('toggle opens under its anchor, closing the other overlays, and closes when open', () => {
    const { host, settings } = fakeHost();
    const anchor = document.createElement('button');
    settings.toggle(anchor);
    expect(host._settingsAnchor).toBe(anchor);
    expect(host._colorPicker.close).toHaveBeenCalled();
    expect(host._sortMenu).toBeNull();

    settings.toggle(anchor);
    expect(host._settingsAnchor).toBeNull();
    expect(host._settingsPopover.flush).toHaveBeenCalledTimes(1);
  });

  it('close flushes a pending edit and clears the anchor; a second close is a no-op', () => {
    const { host, settings } = fakeHost();
    host._settingsAnchor = document.createElement('button');
    settings.close();
    settings.close();
    expect(host._settingsPopover.flush).toHaveBeenCalledTimes(1);
    expect(host._settingsAnchor).toBeNull();
  });
});
