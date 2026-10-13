import { describe, expect, it } from 'vitest';
import { isEditableEventPath } from './platform';

describe('isEditableEventPath', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('a path through an %s is editable', (tagName) => {
    expect(isEditableEventPath([{ tagName }, { tagName: 'BODY' }])).toBe(true);
  });

  it('a path through a contentEditable element is editable', () => {
    expect(isEditableEventPath([{ tagName: 'DIV', isContentEditable: true }])).toBe(true);
  });

  it('a plain button is not', () => {
    expect(
      isEditableEventPath([{ tagName: 'BUTTON', isContentEditable: false }, { tagName: 'BODY' }]),
    ).toBe(false);
  });

  it('an empty path is not', () => {
    expect(isEditableEventPath([])).toBe(false);
  });

  it('finds an input behind a shadow root (a kit field inside a component)', () => {
    const shadowRoot = { host: { tagName: 'PS-INPUT' } };
    expect(
      isEditableEventPath([{ tagName: 'INPUT' }, shadowRoot, { tagName: 'PS-INPUT' }, null]),
    ).toBe(true);
  });
});
