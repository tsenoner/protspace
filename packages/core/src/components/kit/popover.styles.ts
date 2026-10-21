import { css } from 'lit';
import { kitHost, reducedMotion } from './kit-shared.styles';

export const popoverStyles = [
  kitHost,
  reducedMotion,
  css`
    :host {
      display: contents;
    }
    .panel {
      position: fixed;
      inset: auto;
      margin: 0;
      box-sizing: border-box;
      min-width: 160px;
      max-width: min(360px, var(--available-width, calc(100vw - 16px)));
      max-height: min(480px, var(--available-height, calc(100vh - 16px)));
      overflow: auto;
      padding: 0;
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      color: var(--ps-text);
      box-shadow: var(--ps-shadow-lg);
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
      opacity: 0;
      translate: 0 -2px;
      transition:
        opacity var(--ps-duration-fast) var(--ps-ease),
        translate var(--ps-duration-fast) var(--ps-ease),
        overlay var(--ps-duration-fast) allow-discrete,
        display var(--ps-duration-fast) allow-discrete;
    }
    .panel:popover-open {
      opacity: 1;
      translate: 0 0;
    }
    @starting-style {
      .panel:popover-open {
        opacity: 0;
        translate: 0 -2px;
      }
    }

    /* A bottom sheet on a phone (ps-dialog's sheet size): full width on the bottom edge, the top
       corners rounded, a grip, a scrim behind. */
    :host([docked]) .panel {
      inset: auto 0 0;
      width: 100%;
      max-width: none;
      max-height: min(85dvh, calc(100dvh - 48px));
      padding-bottom: env(safe-area-inset-bottom, 0px);
      border-width: 1px 0 0;
      border-radius: var(--ps-radius-lg) var(--ps-radius-lg) 0 0;
    }
    :host([docked]) .panel::before {
      content: '';
      display: block;
      width: 36px;
      height: 4px;
      margin: var(--ps-space-1-5) auto var(--ps-space-1);
      border-radius: var(--ps-radius-full);
      background: var(--ps-border-strong);
    }
    :host([docked]) .panel::backdrop {
      background: var(--ps-scrim);
    }
  `,
];
