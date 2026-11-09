import { useState } from 'react';
import {
  THEME_LABELS,
  nextTheme,
  themeButtonLabel,
  type ThemeChoice,
} from '../explore/theme-defaults';
import { setTheme } from '../explore/theme-state';
import { useTheme } from './use-theme';

/** The button's icon shows the current choice. */
const THEME_ICONS = {
  system: 'sun-moon',
  light: 'sun',
  dark: 'moon',
} as const satisfies Record<ThemeChoice, string>;

/**
 * The app bar's theme switch (design decision 16), before Help on desktop and tablet: one icon
 * button that steps System → Dark → Light → System and applies each at once. Its icon shows the
 * current choice; its name and tooltip say the choice and what a press does. A screen reader may
 * not read the new name of the focused button, so a press also announces the new choice. On
 * phones and in landscape the button is hidden with the other actions and the More sheet's Theme
 * row takes over.
 */
export function ThemeToggle() {
  const theme = useTheme();
  // Empty until the first press, so loading the page announces nothing.
  const [announcement, setAnnouncement] = useState('');

  const cycle = () => {
    const next = nextTheme(theme);
    setTheme(next);
    setAnnouncement(`Theme: ${THEME_LABELS[next]}`);
  };

  return (
    <>
      <ps-icon-button
        data-driver-id="theme"
        icon={THEME_ICONS[theme]}
        label={themeButtonLabel(theme)}
        onClick={cycle}
      ></ps-icon-button>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}
