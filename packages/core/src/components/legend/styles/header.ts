import { css } from 'lit';

/**
 * The legend header (design decision 12): a 44 px bar holding the title, the predicted mark, the
 * info button, a spacer and two 28 px icon buttons. The title gives way first: it ends in an
 * ellipsis while the buttons keep their size.
 */
export const headerStyles = css`
  .legend-header {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--ps-space-0-5);
    box-sizing: border-box;
    width: 100%;
    height: 44px;
    padding: 0 var(--ps-space-1-5) 0 var(--ps-space-3);
  }

  .legend-title {
    flex: 0 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--ps-text-base);
    font-weight: var(--ps-weight-semibold);
    line-height: var(--ps-leading-tight);
    color: var(--ps-text);
  }

  .legend-predicted {
    display: inline-flex;
    flex: none;
    margin-inline-start: var(--ps-space-1);
    color: var(--ps-text-muted);
  }

  .legend-header protspace-info-popover {
    flex: none;
    margin-inline-start: var(--ps-space-1);
  }

  .legend-header-spacer {
    flex: 1 1 0;
    min-width: 0;
  }

  .legend-header ps-icon-button {
    flex: none;
  }

  .sort-button[hidden] {
    display: none;
  }

  /* The host's own controls (tabs, a fold chevron) keep their size; an empty slot is no flex
     item (a slot is display: contents), so it adds no gap. */
  ::slotted(*) {
    flex: none;
  }

  /* Touch: the ⓘ's 40 px hit area is positioned, so it paints over its neighbours and takes their
     presses. Lifted above it, the tabs before it and the buttons after it keep their own. */
  @media (pointer: coarse) {
    ::slotted(*),
    .legend-header ps-icon-button {
      position: relative;
      z-index: 1;
    }
  }
`;
