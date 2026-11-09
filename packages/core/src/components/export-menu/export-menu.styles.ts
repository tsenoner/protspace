import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/** The trigger's icons and the panel's layout; the panel itself is the kit's ps-popover. */
export const exportMenuStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: inline-flex;
    }

    .trigger-icon {
      display: inline-flex;
      color: var(--ps-text-muted);
    }

    /* Wide enough for the four choices on one row; a phone's sheet gives it the full width. */
    .export-panel {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-3);
      box-sizing: border-box;
      width: 320px;
      max-width: 100%;
      padding: var(--ps-space-3);
      text-align: left;
    }

    ps-popover[docked] .export-panel {
      width: auto;
    }

    .export-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
      /* The close button's own padding sets it in from the corner. */
      margin: calc(-1 * var(--ps-space-1)) calc(-1 * var(--ps-space-1)) 0 0;
    }

    .export-title {
      margin: 0;
      font-size: var(--ps-text-md);
      font-weight: var(--ps-weight-semibold);
    }

    .export-options {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-2);
    }

    .export-field {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
    }

    .export-field-label {
      color: var(--ps-text-muted);
    }

    .export-note {
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: var(--ps-leading-normal);
    }

    /* Under the checkbox's label: its 16 px box and the 8 px gap after it. */
    .export-settings-help {
      margin-top: calc(-1 * var(--ps-space-1));
      padding-left: calc(16px + var(--ps-space-2));
    }

    .export-file-settings {
      display: flex;
      align-items: flex-start;
      gap: var(--ps-space-1);
    }

    .export-file-settings .ps-icon {
      flex: none;
      margin-top: 1px;
    }

    .export-download::part(button) {
      width: 100%;
    }
  `,
];
