// Public kit API (design decision 8). Each kit task adds its exports here. Importing the kit, as
// `@protspace/core` and the `@protspace/core/kit` entry both do, adopts the theme into the
// document once, so every component reads --ps-* tokens from :root (design decision 5).
import { adoptTheme } from './adopt-theme';

if (typeof document !== 'undefined') adoptTheme();

export { icon, type IconName, type IconSize } from './icon';
export { ESCAPE_ORDER, onEscapeFallback, pushLayer, topLayer, type Layer } from './layers';
export { PsButton, PsIconButton, type ButtonSize, type ButtonVariant } from './button';
export { PsTooltip } from './tooltip';
export type { Placement } from './position';
export { PsPopover } from './popover';
export { PsMenu, PsMenuGroup, PsMenuItem, PsMenuLabel, type MenuItemType } from './menu';
export { PsDialog, type DialogSize } from './dialog';
export { PsCheckbox } from './checkbox';
export { PsInput } from './input';
export { PsSegmented, type SegmentedOption } from './segmented';
export { PsSelect, type SelectOption } from './select';
export { PsSwitch } from './switch';
