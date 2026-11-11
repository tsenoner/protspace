import { useState } from 'react';
import { THEME_MODE_LABELS, themeButtonLabel } from '../explore/theme-defaults';
import { getResolvedTheme, toggleThemeMode } from '../explore/theme-state';
import { useResolvedTheme } from './use-theme';

/**
 * The app bar's theme switch (design decision 16), before Help on desktop and tablet: one icon
 * button that flips between light and dark. The page starts from the system's mode; a press
 * stores the other one, and a press back to the system's mode follows the system again. Its icon
 * shows the mode on screen; its name and tooltip say that mode and what a press does. A screen
 * reader may not read the new name of the focused button, so a press also announces the new
 * mode. On phones and in landscape the button is hidden with the other actions and the More
 * sheet's Theme row takes over.
 */
export function ThemeToggle() {
  const mode = useResolvedTheme();
  // Empty until the first press, so loading the page announces nothing.
  const [announcement, setAnnouncement] = useState('');

  const toggle = () => {
    toggleThemeMode();
    setAnnouncement(`Theme: ${THEME_MODE_LABELS[getResolvedTheme()]}`);
  };

  return (
    <>
      <ps-icon-button
        data-driver-id="theme"
        icon={mode === 'dark' ? 'moon' : 'sun'}
        label={themeButtonLabel(mode)}
        onClick={toggle}
      ></ps-icon-button>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}
