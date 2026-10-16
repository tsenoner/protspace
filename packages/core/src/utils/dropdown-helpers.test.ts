// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { handleDropdownEscape } from './dropdown-helpers';

describe('handleDropdownEscape', () => {
  it('closes and takes the press', () => {
    const onClose = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    handleDropdownEscape(event, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing with a press another owner already handled (a shown tooltip hid itself)', () => {
    const onClose = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    event.preventDefault();
    handleDropdownEscape(event, onClose);
    expect(onClose).not.toHaveBeenCalled();
  });
});
