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

  it('Escape reads clear the selection, then return to Move and zoom', () => {
    const selection = SHORTCUT_GROUPS.find((group) => group.title === 'Selection');
    const escape = selection?.items.find((shortcut) => shortcut.keys.join('+') === 'Escape');
    expect(escape?.action).toBe('Clear the selection, then return to Move and zoom');
  });
});
