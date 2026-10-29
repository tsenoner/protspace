import type { PsMenu } from '@protspace/core';
import { useEffect, useRef } from 'react';
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice } from '../explore/theme-defaults';
import { setTheme } from '../explore/theme-state';
import { useTheme } from './use-theme';

/** The button's icon shows the current choice. */
const THEME_ICONS = {
  system: 'sun-moon',
  light: 'sun',
  dark: 'moon',
} as const satisfies Record<ThemeChoice, string>;

/**
 * The app bar's theme switch (design decision 16), between Import/Export and Help on desktop and
 * tablet: an icon button opening a radio menu. On phones and in landscape the button is hidden
 * with the other actions (its ps-menu stays rendered) and the More sheet's Theme row takes over.
 */
export function ThemeMenu() {
  const theme = useTheme();
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      setTheme((event as CustomEvent<{ value: string }>).detail.value as ThemeChoice);
    };
    element.addEventListener('ps-select', onSelect);
    return () => element.removeEventListener('ps-select', onSelect);
  }, []);

  const toggle = () => {
    if (menu.current) menu.current.open = !menu.current.open;
  };

  return (
    <>
      <ps-icon-button
        ref={trigger}
        data-driver-id="theme"
        icon={THEME_ICONS[theme]}
        label="Theme"
        onClick={toggle}
      ></ps-icon-button>
      <ps-menu ref={menu} label="Theme" placement="bottom-end">
        {THEME_CHOICES.map((choice) => (
          <ps-menu-item key={choice} type="radio" value={choice} checked={choice === theme}>
            {THEME_LABELS[choice]}
          </ps-menu-item>
        ))}
      </ps-menu>
    </>
  );
}
