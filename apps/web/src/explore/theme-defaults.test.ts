import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEME_CHOICES, nextTheme, themeButtonLabel } from './theme-defaults';

describe('the theme cycle', () => {
  it('starts on System and offers System, Dark, Light in that order', () => {
    expect(DEFAULT_THEME).toBe('system');
    expect(THEME_CHOICES).toEqual(['system', 'dark', 'light']);
  });

  it('steps System → Dark → Light → System', () => {
    expect(nextTheme('system')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('system');
  });
});

describe("the theme button's name", () => {
  it('names the current mode and what a press does', () => {
    expect(themeButtonLabel('system')).toBe('Theme: System. Switch to Dark');
    expect(themeButtonLabel('dark')).toBe('Theme: Dark. Switch to Light');
    expect(themeButtonLabel('light')).toBe('Theme: Light. Switch to System');
  });
});
