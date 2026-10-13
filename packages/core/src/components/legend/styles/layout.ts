import { css } from 'lit';

/**
 * The legend's frame. The host has no card of its own: it fills the height its container gives
 * it (the workbench sidebar draws the edges), and the list scrolls in what the header, the EAT
 * block and the score strips leave.
 */
export const layoutStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    background: var(--ps-surface);
    color: var(--ps-text);
    user-select: none;
  }

  .legend-container {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    width: 100%;
    min-height: 0;
  }

  .legend-items {
    display: flex;
    flex: 1;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    padding: var(--ps-space-1) 0;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .legend-empty {
    padding: var(--ps-space-5) var(--ps-space-3);
    color: var(--ps-text-muted);
    text-align: center;
  }

  /*
   * The base every button in the legend's root starts from; the row, its actions and the
   * picker style their own on top. It keeps the neutral part of what the old button mixin set
   * on every button here (no border or background, a centred flex box that ends long text in an
   * ellipsis), on tokens, so none falls back to the browser's grey button.
   */
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--ps-space-1);
    box-sizing: border-box;
    max-width: 100%;
    overflow: hidden;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
`;
