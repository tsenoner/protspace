import { describe, expect, it } from 'vitest';
import {
  chooseMode,
  DEFAULT_THEME,
  otherMode,
  parseStoredTheme,
  resolveTheme,
  storedTheme,
  THEME_STORAGE_KEY,
  themeButtonLabel,
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

describe('choosing a mode', () => {
  it('a choice resolves against the OS', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('a press shows the other mode', () => {
    expect(otherMode('light')).toBe('dark');
    expect(otherMode('dark')).toBe('light');
  });

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
