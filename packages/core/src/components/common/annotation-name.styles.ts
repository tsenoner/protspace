import { css } from 'lit';

/**
 * The PRED badge (annotation-name.ts) in every element that names an annotation: a chip shaped
 * like the Color by list's EAT and STATS badges, tinted amber. The text is the amber deepened
 * toward the text colour, so it keeps 4.5:1 on its own tint in both themes.
 */
export const predictedBadgeStyles = css`
  .predicted-mark {
    flex: none;
    padding: 0 var(--ps-space-1);
    border-radius: var(--ps-radius-sm);
    background: color-mix(in srgb, var(--ps-warning) 12%, transparent);
    color: color-mix(in srgb, var(--ps-warning) 80%, var(--ps-text));
    font-size: var(--ps-text-xs);
    font-weight: var(--ps-weight-semibold);
    letter-spacing: 0.03em;
    line-height: var(--ps-leading-normal);
    white-space: nowrap;
    user-select: none;
  }
`;
