import { useThemeToggle } from './use-theme';

/**
 * The app bar's theme switch (design decision 16), before Help on desktop and tablet: one icon
 * button that flips between light and dark. The page starts from the system's mode; a press
 * stores the other one, and a press back to the system's mode follows the system again. Its icon
 * shows the mode on screen; its name and tooltip say that mode and what a press does, and a press
 * also announces the new mode. On phones and in landscape the button is hidden with the other
 * actions and the More sheet's Theme row takes over.
 */
export function ThemeToggle() {
  const { mode, label, announcement, toggle } = useThemeToggle();

  return (
    <>
      <ps-icon-button
        data-driver-id="theme"
        icon={mode === 'dark' ? 'moon' : 'sun'}
        label={label}
        onClick={toggle}
      ></ps-icon-button>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}
