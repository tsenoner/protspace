import { css } from 'lit';

/** The resource-link row `renderResourceLinks` draws: it wraps in a narrow host, never clips. */
export const resourceLinkStyles = css`
  .resource-links {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--ps-space-1) var(--ps-space-3);
    margin: 0;
    padding: 0 var(--ps-space-3) var(--ps-space-2);
    list-style: none;
    font-size: var(--ps-text-sm);
    line-height: var(--ps-leading-normal);
  }

  .resource-links-item {
    display: inline-flex;
  }

  .header-link {
    display: inline-flex;
    align-items: center;
    gap: var(--ps-space-0-5);
    border-radius: var(--ps-radius-sm);
    color: var(--ps-accent-text);
    font-weight: var(--ps-weight-medium);
    text-decoration: none;
  }

  /* Touch: each link is a 40 px target; the row's gaps keep them apart. */
  @media (pointer: coarse) {
    .header-link {
      min-width: var(--ps-touch-target);
      min-height: var(--ps-touch-target);
    }
  }

  .header-link svg {
    flex: none;
    width: 11px;
    height: 11px;
  }

  .header-link:hover .header-link-label,
  .header-link:focus-visible .header-link-label {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .header-link:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }

  /* Read by assistive technology only. */
  .resource-links-hint {
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
`;
