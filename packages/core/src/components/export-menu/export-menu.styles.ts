import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/** The trigger's icons and the menu's note; the panel and items are the kit's ps-menu. */
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

    /* A sentence, not a caption: the kit's menu label is set in small capitals for headings. */
    .export-note {
      max-width: 240px;
      font-weight: normal;
      letter-spacing: normal;
      line-height: var(--ps-leading-normal);
      text-transform: none;
    }
  `,
];
