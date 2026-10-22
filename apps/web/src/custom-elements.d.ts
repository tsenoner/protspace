/**
 * TypeScript declarations for ProtSpace custom web components.
 *
 * React 19 scopes JSX under the `react` module's own `JSX` namespace
 * (`React.JSX`) rather than the legacy global `JSX`, so custom elements
 * are registered by augmenting `declare module 'react'`.
 */
import type * as React from 'react';
import type {
  PsButton,
  PsCheckbox,
  PsDialog,
  PsIconButton,
  PsInput,
  PsMenu,
  PsMenuGroup,
  PsMenuItem,
  PsPopover,
  PsSegmented,
  PsSelect,
  PsSwitch,
  PsTooltip,
} from '@protspace/core';

/**
 * A kit tag takes the named public properties of its class; React 19 sets a prop as a property when
 * the element has one, else as an attribute. Refs stay `HTMLElement` so any element ref fits.
 * Hyphenated attributes and `on<event>` listeners for the kit's custom events are listed per tag.
 */
type KitProps<E, K extends keyof E = never, Extra = unknown> = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement>,
  HTMLElement
> &
  Partial<Pick<E, K>> &
  Extra;

type ButtonKeys = 'variant' | 'size' | 'disabled' | 'describedBy' | 'expanded' | 'hasPopup';

/** `ps-close` reaches the owner when the overlay closes by itself (Escape, outside press, pick). */
interface CloseEvents {
  'onps-close'?: (event: CustomEvent) => void;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'protspace-data-loader': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'data-driver-id'?: string;
        },
        HTMLElement
      >;
      'protspace-import-menu': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'data-driver-id'?: string;
        },
        HTMLElement
      >;
      'protspace-export-menu': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
        },
        HTMLElement
      >;
      'protspace-projection-select': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-projection-metadata': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-annotation-select': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-contours-menu': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-plot-tools': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string; 'data-driver-id'?: string },
        HTMLElement
      >;
      'protspace-selection-bar': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-plot-status': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-protein-search': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'data-driver-id'?: string;
          placeholder?: string;
        },
        HTMLElement
      >;
      'protspace-query-builder': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          embedded?: boolean;
        },
        HTMLElement
      >;
      'protspace-eat-panel': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          compact?: boolean;
        },
        HTMLElement
      >;
      'protspace-scatterplot': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'data-driver-id'?: string;
          'hide-status'?: string;
        },
        HTMLElement
      >;
      'protspace-legend': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'auto-sync'?: string;
          'auto-hide'?: string;
          'scatterplot-selector'?: string;
          'data-driver-id'?: string;
        },
        HTMLElement
      >;
      'protspace-structure-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          height?: string;
          'show-header'?: string;
          'show-close-button'?: string;
          'auto-sync'?: string;
          'scatterplot-selector'?: string;
        },
        HTMLElement
      >;
      'protspace-info-popover': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          label?: string;
          description?: string;
          align?: 'left' | 'right';
        },
        HTMLElement
      >;
      'ps-button': KitProps<PsButton, ButtonKeys>;
      'ps-icon-button': KitProps<
        PsIconButton,
        ButtonKeys | 'icon' | 'label' | 'pressed' | 'tooltipPlacement'
      >;
      'ps-tooltip': KitProps<
        PsTooltip,
        'text' | 'placement' | 'anchor' | 'namesTarget',
        { 'names-target'?: boolean }
      >;
      'ps-popover': KitProps<
        PsPopover,
        'anchor' | 'placement' | 'open' | 'panelRole' | 'panelLabel',
        CloseEvents & {
          'panel-role'?: string;
          'panel-label'?: string;
          'onps-open'?: (event: CustomEvent) => void;
        }
      >;
      'ps-menu': KitProps<
        PsMenu,
        'anchor' | 'open' | 'placement' | 'label' | 'searchable' | 'searchPlaceholder',
        CloseEvents & {
          'search-placeholder'?: string;
          'onps-select'?: (event: CustomEvent<{ value: string; checked: boolean }>) => void;
        }
      >;
      'ps-menu-group': KitProps<PsMenuGroup, 'label'>;
      'ps-menu-item': KitProps<PsMenuItem, 'value' | 'type' | 'checked' | 'disabled'>;
      'ps-menu-label': KitProps<HTMLElement>;
      'ps-dialog': KitProps<PsDialog, 'open' | 'heading' | 'size' | 'dismissible', CloseEvents>;
      'ps-input': KitProps<
        PsInput,
        'value' | 'type' | 'placeholder' | 'label' | 'invalid' | 'disabled'
      >;
      'ps-select': KitProps<PsSelect, 'options' | 'value' | 'label' | 'disabled'>;
      'ps-checkbox': KitProps<PsCheckbox, 'checked' | 'indeterminate' | 'disabled' | 'label'>;
      'ps-switch': KitProps<PsSwitch, 'checked' | 'disabled' | 'label'>;
      'ps-segmented': KitProps<PsSegmented, 'options' | 'value' | 'label'>;
    }
  }
}
