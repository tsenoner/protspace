/**
 * TypeScript declarations for ProtSpace custom web components.
 *
 * React 19 scopes JSX under the `react` module's own `JSX` namespace
 * (`React.JSX`) rather than the legacy global `JSX`, so custom elements
 * are registered by augmenting `declare module 'react'`.
 */
import type * as React from 'react';

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
      'protspace-control-bar': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'selected-projection'?: string;
          'selected-annotation'?: string;
          'selected-proteins-count'?: string;
          'auto-sync'?: string;
          'scatterplot-selector'?: string;
          'data-driver-id'?: string;
        },
        HTMLElement
      >;
      'protspace-scatterplot': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'show-tour-button'?: string;
          'data-driver-id'?: string;
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
          title?: string;
          height?: string;
          'show-header'?: string;
          'show-close-button'?: string;
          'show-tips'?: string;
          'auto-sync'?: string;
          'auto-show'?: string;
          'scatterplot-selector'?: string;
        },
        HTMLElement
      >;
    }
  }
}
