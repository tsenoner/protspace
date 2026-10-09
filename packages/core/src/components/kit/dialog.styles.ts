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
