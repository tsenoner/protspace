import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/** The legend settings popover's content (decision 12); ps-popover draws the panel. */
export const legendSettingsPopoverStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: contents;
    }
    /* Taller than the kit's 480 px cap: the numeric content is about 625 px, Reset at its foot. */
    ps-popover::part(panel) {
      max-height: min(640px, var(--available-height, calc(100vh - 16px)));
    }
    .settings {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-3);
      width: 300px;
      max-width: 100%;
      padding: var(--ps-space-3);
    }
    .title {
      margin: 0;
      overflow: hidden;
      color: var(--ps-text);
      font-size: var(--ps-text-base);
      font-weight: var(--ps-weight-semibold);
      line-height: var(--ps-leading-tight);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .group,
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1-5);
    }
    .label {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
    }
    .hint {
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: var(--ps-leading-normal);
    }
    ps-input,
    ps-select {
      width: 100%;
    }
    ps-switch {
      align-self: flex-start;
    }
    .swatches {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--ps-space-1-5);
    }
    .swatch {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
      min-width: 0;
      padding: var(--ps-space-1-5);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      font: inherit;
      font-size: var(--ps-text-xs);
      text-align: start;
      cursor: pointer;
      transition:
        background-color var(--ps-duration-fast) var(--ps-ease),
        border-color var(--ps-duration-fast) var(--ps-ease);
    }
    .swatch:hover {
      background: var(--ps-surface-hover);
    }
    .swatch[aria-checked='true'] {
      border-color: var(--ps-accent);
      background: var(--ps-accent-tint);
      box-shadow: 0 0 0 1px var(--ps-accent);
    }
    .swatch-chips,
    .swatch-gradient {
      display: flex;
      height: 14px;
      overflow: hidden;
      border-radius: var(--ps-radius-sm);
      /* Over the chips, so light colours keep an edge on a light surface. */
      outline: 1px solid color-mix(in srgb, var(--ps-text) 12%, transparent);
      outline-offset: -1px;
    }
    .chip {
      flex: 1;
    }
    .swatch-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .footer {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ps-space-1);
      padding-top: var(--ps-space-2);
      border-top: 1px solid var(--ps-border);
    }
    @media (forced-colors: active) {
      .swatch[aria-checked='true'] {
        outline: 2px solid Highlight;
      }
    }
  `,
];
