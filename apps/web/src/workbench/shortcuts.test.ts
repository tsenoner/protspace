import { describe, expect, it } from 'vitest';
import { formatKeys, SHORTCUT_GROUPS, type Shortcut, type ShortcutGroup } from './shortcuts';

describe('shortcuts', () => {
  it('formats Mod as ⌘ on Mac and Ctrl elsewhere', () => {
    expect(formatKeys(['Mod', 'K'], true)).toBe('⌘K');
    expect(formatKeys(['Mod', 'K'], false)).toBe('Ctrl+K');
    expect(formatKeys(['Mod', 'Click'], true)).toBe('⌘+Click');
    expect(formatKeys(['Mod', 'Click'], false)).toBe('Ctrl+Click');
    expect(formatKeys(['Escape'], true)).toBe('Esc');
    expect(formatKeys(['ArrowDown'], false)).toBe('↓');
  });

  it('every group has a title and at least one shortcut', () => {
    const groups: readonly ShortcutGroup[] = SHORTCUT_GROUPS;
    expect(groups.map((group) => group.title)).toEqual([
      'Plot',
      'Selection',
      'History',
      'Search',
      'Legend',
      'Structure viewer',
      'Figure editor',
    ]);
    for (const group of groups) {
      const shortcuts: readonly Shortcut[] = group.items;
      expect(shortcuts.length).toBeGreaterThan(0);
      for (const shortcut of shortcuts) {
        expect(shortcut.keys.length).toBeGreaterThan(0);
        expect(shortcut.action.trim()).not.toBe('');
      }
    }
  });

  it('the legend group lists I', () => {
    const legend = SHORTCUT_GROUPS.find((group) => group.title === 'Legend');
    expect(
      legend?.items.some((shortcut) => shortcut.keys.length === 1 && shortcut.keys[0] === 'I'),
    ).toBe(true);
  });

  it('lists the Escape steps in the order one press at a time takes them', () => {
    const escapes = (title: string) =>
      SHORTCUT_GROUPS.find((group) => group.title === title)
        ?.items.filter((shortcut) => shortcut.keys.join('+') === 'Escape')
        .map((shortcut) => shortcut.action);
    expect(escapes('Plot')).toEqual([
      'Close an expanded stack of duplicate points',
      'Hide the EAT connectors',
    ]);
    expect(escapes('Selection')).toEqual(['Clear the selection, then return to Move and zoom']);
    expect(escapes('Figure editor')).toEqual([
      'Deselect the overlay or inset, then close the editor',
    ]);
  });

  it('the History group lists undo and redo', () => {
    const history = SHORTCUT_GROUPS.find((group) => group.title === 'History');
    expect(history?.items).toEqual([
      { keys: ['Mod', 'Z'], action: 'Undo the last selection, show-only or filter step' },
      { keys: ['Shift', 'Mod', 'Z'], action: 'Redo' },
    ]);
    expect(formatKeys(['Shift', 'Mod', 'Z'], true)).toBe('⇧⌘Z');
    expect(formatKeys(['Shift', 'Mod', 'Z'], false)).toBe('Shift+Ctrl+Z');
  });

  it('the Figure editor group lists Delete, then Escape that deselects before it closes', () => {
    const editor = SHORTCUT_GROUPS.find((group) => group.title === 'Figure editor');
    expect(editor?.items).toEqual([
      { keys: ['Delete'], action: 'Remove the selected overlay or inset' },
      { keys: ['Escape'], action: 'Deselect the overlay or inset, then close the editor' },
    ]);
  });
});
