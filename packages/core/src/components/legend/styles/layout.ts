import { css } from 'lit';

/**
 * The legend's frame. The host has no card of its own: it fills the height its container gives
 * it (the workbench sidebar draws the edges), and the list scrolls in what the header and the summary (the
 * EAT note and the score strips, above or below the list) leave.
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

  /* The EAT note and the score strips: stays put while the list scrolls. In a short panel (a
     phone) it gives way before the list does and scrolls on its own, so the categories always
     keep about three rows. */
  .legend-summary {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .legend-summary > * {
    flex: none;
  }

  /* Under the list (summary-placement="bottom"): a rule above it, and the strips' own bottom
     rule would only double the panel's edge. */
  :host([summary-placement='bottom']) .legend-summary {
    border-top: 1px solid var(--ps-border);
  }

  :host([summary-placement='bottom']) .legend-summary .score-strips {
    border-bottom: none;
  }

  /* Under the title the note tucks up to it; under the list it needs its own space. */
  :host([summary-placement='bottom']) .legend-summary .legend-eat-note {
    margin-top: var(--ps-space-2);
  }

  .legend-items {
    display: flex;
    flex: 1;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    /* About three rows (the padding included), whatever the summary takes. */
    min-height: calc(3 * var(--ps-row) + 2 * var(--ps-space-1));
    padding: var(--ps-space-1) 0;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  /* Touch rows are a finger tall: two and a half of them still say there is more. */
  @media (pointer: coarse) {
    .legend-items {
      min-height: calc(2.5 * var(--ps-touch-target) + 2 * var(--ps-space-1));
    }
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
