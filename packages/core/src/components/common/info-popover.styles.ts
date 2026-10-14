import { css } from 'lit';
import { focusRing } from '../kit/kit-shared.styles';

/**
 * The ⓘ trigger and the bubble's contents. The bubble's surface, border, radius and shadow are
 * ps-popover's panel; this sheet styles only what is slotted into it.
 */
export const infoPopoverStyles = [
  focusRing,
  css`
    :host {
      display: inline-flex;
    }

    .info-button {
      display: inline-flex;
      position: relative;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: none;
      border-radius: var(--ps-radius-full);
      background: transparent;
      color: var(--ps-text-muted);
      cursor: pointer;
      line-height: 1;
    }

    .info-button:hover,
    .info-button.open {
      color: var(--ps-text);
      background: var(--ps-surface-hover);
    }

    /* Touch: a 40 px hit area around the 18 px icon, without growing the row it sits in. */
    @media (pointer: coarse) {
      .info-button::before {
        content: '';
        position: absolute;
        inset: -11px;
      }
    }

    .popover {
      box-sizing: border-box;
      width: max-content;
      max-width: min(260px, calc(100vw - 24px));
      padding: var(--ps-space-2) var(--ps-space-3);
      color: var(--ps-text);
      font-size: var(--ps-text-sm);
      /* Font weight inherits across the shadow boundary: a bold ancestor (a selected dropdown row)
         would otherwise render the bubble bold. */
      font-weight: normal;
      line-height: var(--ps-leading-normal);
      text-align: left;
      white-space: normal;
    }

    .popover-description,
    .popover-detail {
      margin: 0;
    }

    .popover-description + .popover-detail {
      margin-top: var(--ps-space-1-5);
    }

    .popover-link {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-0-5);
      margin-top: var(--ps-space-1-5);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-accent-text);
      font-weight: var(--ps-weight-medium);
      text-decoration: none;
    }

    .popover-link:hover {
      text-decoration: underline;
    }

    /* Read by assistive technology only: the link opens a new tab. */
    .popover-link-hint {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `,
];
