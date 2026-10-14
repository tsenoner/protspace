import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from './kit-shared.styles';

export const dialogStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: contents;
    }
    dialog {
      box-sizing: border-box;
      width: min(480px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      padding: 0;
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      color: var(--ps-text);
      box-shadow: var(--ps-shadow-lg);
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
    }
    :host([size='sm']) dialog {
      width: min(360px, calc(100vw - 32px));
    }
    :host([size='lg']) dialog {
      width: min(720px, calc(100vw - 32px));
    }
    :host([size='full']) dialog {
      width: calc(100vw - 32px);
      height: calc(100dvh - 32px);
    }
    /* A bottom sheet: full width on the bottom edge, its top corners rounded. The body scrolls
       under a header that stays; its rows run edge to edge. */
    :host([size='sheet']) dialog {
      width: 100%;
      max-width: none;
      max-height: min(85dvh, calc(100dvh - 48px));
      margin: auto 0 0;
      padding-bottom: env(safe-area-inset-bottom, 0px);
      border-width: 1px 0 0;
      border-radius: var(--ps-radius-lg) var(--ps-radius-lg) 0 0;
    }
    :host([size='sheet']) .frame {
      max-height: calc(min(85dvh, 100dvh - 48px) - 1px - env(safe-area-inset-bottom, 0px));
    }
    /* The grip the structure sheet shows, so the two sheets read as one kind (decorative). */
    :host([size='sheet']) .frame::before {
      content: '';
      flex: none;
      align-self: center;
      width: 36px;
      height: 4px;
      margin: 4px 0;
      border-radius: var(--ps-radius-full);
      background: var(--ps-border-strong);
    }
    :host([size='sheet']) .body {
      padding: 0;
    }
    dialog::backdrop {
      background: var(--ps-scrim);
    }
    .frame {
      display: flex;
      flex-direction: column;
      max-height: calc(100dvh - 34px);
      height: 100%;
      outline: none;
    }
    header {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      padding: var(--ps-space-3) var(--ps-space-3) var(--ps-space-3) var(--ps-space-5);
      border-bottom: 1px solid var(--ps-border);
    }
    h2 {
      flex: 1;
      margin: 0;
      font-size: var(--ps-text-lg);
      font-weight: var(--ps-weight-semibold);
    }
    .body {
      flex: 1;
      overflow: auto;
      padding: var(--ps-space-5);
      line-height: var(--ps-leading-normal);
    }
    footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--ps-space-2);
      padding: var(--ps-space-3) var(--ps-space-5);
      border-top: 1px solid var(--ps-border);
    }
    footer[hidden] {
      display: none;
    }
  `,
];
