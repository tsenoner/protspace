import { describe, expect, it } from 'vitest';
import {
  chooseMode,
  DEFAULT_THEME,
  parseStoredTheme,
  resolveTheme,
  storedTheme,
  THEME_STORAGE_KEY,
  themeButtonLabel,
  toggleTheme,
} from './theme-defaults';

describe('the stored theme', () => {
  it("shares VitePress's key and follows the system by default", () => {
    expect(THEME_STORAGE_KEY).toBe('vitepress-theme-appearance');
    expect(DEFAULT_THEME).toBe('system');
  });

  it("reads VueUse's raw values: dark, light, else the system", () => {
    expect(parseStoredTheme('dark')).toBe('dark');
    expect(parseStoredTheme('light')).toBe('light');
    for (const raw of ['auto', null, '"dark"', 'Dark', 'system', ''])
      expect(parseStoredTheme(raw)).toBe('system');
  });

  it('stores an override as is and removes the key for the system', () => {
    expect(storedTheme('dark')).toBe('dark');
    expect(storedTheme('light')).toBe('light');
    expect(storedTheme('system')).toBeNull();
  });
});

describe('a press of the theme button', () => {
  it.each([
    // [choice, OS dark, shown, after a press]
    ['system', false, 'light', 'dark'],
    ['system', true, 'dark', 'light'],
    ['dark', false, 'dark', 'system'],
    ['light', true, 'light', 'system'],
    // An override the OS has since caught up with: a press still flips what is shown.
    ['dark', true, 'dark', 'light'],
    ['light', false, 'light', 'dark'],
  ] as const)(
    '%s on a dark OS (%s) shows %s and a press makes it %s',
    (choice, os, shown, next) => {
      expect(resolveTheme(choice, os)).toBe(shown);
      expect(toggleTheme(choice, os)).toBe(next);
      expect(resolveTheme(toggleTheme(choice, os), os)).not.toBe(shown);
    },
  );

  it("picking the OS's own mode follows the system", () => {
    expect(chooseMode('dark', true)).toBe('system');
    expect(chooseMode('light', false)).toBe('system');
    expect(chooseMode('dark', false)).toBe('dark');
    expect(chooseMode('light', true)).toBe('light');
  });
});

describe("the theme button's name", () => {
  it('names the mode shown and what a press does', () => {
    expect(themeButtonLabel('light')).toBe('Theme: Light. Switch to Dark');
    expect(themeButtonLabel('dark')).toBe('Theme: Dark. Switch to Light');
  });
});
