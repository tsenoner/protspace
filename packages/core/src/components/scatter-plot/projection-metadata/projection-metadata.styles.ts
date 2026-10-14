import { css } from 'lit';
import { srOnlyMixin } from '../../../styles/mixins';

export const projectionMetadataStyles = [
  srOnlyMixin,
  css`
    :host {
      /* Placed by its host (the view bar). Relative, so the card hangs below the trigger; the
         z-index lifts the card over the plot area, which follows in the document. */
      position: relative;
      display: inline-flex;
      z-index: 10;

      /* Gap between the trigger and the card. Read by the card's top offset and by the
         invisible hover bridge that spans it. */
      --card-gap: 0.5rem;
    }

    /* The kit's ghost icon-button look (ps-icon-button size sm). */
    .trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--ps-control-sm);
      height: var(--ps-control-sm);
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--ps-radius);
      background: transparent;
      color: var(--ps-text-muted);
      cursor: pointer;
      transition:
        background-color var(--ps-duration-fast) var(--ps-ease),
        color var(--ps-duration-fast) var(--ps-ease);
    }

    @media (pointer: coarse) {
      .trigger {
        width: var(--ps-touch-target);
        height: var(--ps-touch-target);
      }
    }

    .trigger:hover,
    .trigger[aria-expanded='true'] {
      background: var(--ps-surface-hover);
      color: var(--ps-text);
    }

    .trigger:focus-visible {
      outline: var(--ps-focus-width) solid var(--ps-focus);
      outline-offset: var(--ps-focus-offset);
    }

    .content {
      position: absolute;
      top: calc(100% + var(--card-gap));
      left: 0;
      /* An explicit width, because max-width never applied. :host is position:absolute with
         no width, so it shrink-to-fits around the 32px trigger; this box then shrink-to-fits
         inside that, resolves below the floor, and min-width wins — measured in Chrome at
         242-258px, never the 320px the max-width implies. That is what squeezed the
         metric-name column and forced Calinski-Harabasz onto two lines. */
      width: min(20rem, calc(100vw - 16px));
      min-width: 15rem;
      max-width: 20rem;
      /* The card runs ~700px tall, ~1030px for a cluster column, from a 48px top offset —
         and the scatter-plot host is overflow:hidden (scatter-plot.styles.ts), so the
         overrun was hard-clipped and unreachable rather than merely spilling. The clipped
         region was the annotation-stats block: exactly what the dropdown's STATS badge
         sends people here to read. The info popovers' bubbles sit in the top layer, so
         this overflow never clips them. */
      /* Fallback only: _updateMaxHeight() measures the room left below the card in the
         viewport and sets the real cap inline. */
      max-height: calc(100vh - 8rem);
      overflow-y: auto;
      overscroll-behavior: contain;
      /* Reserve the scrollbar's width up front. Without it the bar is laid over the content
         box on overflow and clips the right-hand value column — "Embedding" and its numbers
         lost their last characters. Stable also means the layout does not shift by ~15px at
         the moment a section appears and tips the card into scrolling. */
      scrollbar-gutter: stable;
      background: var(--ps-surface-raised);
      border: 1px solid var(--ps-border);
      border-radius: 0.5rem;
      box-shadow: var(--ps-shadow-md);
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      /* Fade only. */
      transition:
        opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
        visibility 0.2s;
    }

    /* Invisible bridge that covers the gap between trigger and popover so
     the mouse can travel from the button into the popover without losing
     :host(:hover). */
    .content::before {
      content: '';
      position: absolute;
      bottom: 100%;
      left: 0;
      width: 100%;
      height: var(--card-gap);
    }

    .content.is-pinned,
    .trigger:focus-visible + .content {
      pointer-events: auto;
      opacity: 1;
      visibility: visible;
    }

    /* Hover reveals the card only for a pointer that can hover. After a tap a touch screen keeps
       :hover on the button, so a hover rule would hold the card open past a second tap. */
    @media (hover: hover) {
      :host(:hover) .content {
        pointer-events: auto;
        opacity: 1;
        visibility: visible;
      }
    }

    .header {
      padding: 0.625rem 0.75rem;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--ps-text);
      border-bottom: 1px solid var(--ps-border);
      background: var(--ps-surface-muted);
      border-radius: 0.5rem 0.5rem 0 0;
    }

    dl {
      margin: 0;
      padding: 0.625rem 0.75rem;
    }

    /* The value column is auto-sized and the label absorbs the remainder, not the reverse.
     With "auto 1fr" a long label could not shrink (it was nowrap) so it squeezed the value
     until word-break split the number itself — "0.619" rendered as "0.61" over "9". */
    .item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
      font-size: 0.75rem;
      line-height: 1.5;
      align-items: baseline;
    }

    .item:last-child {
      margin-bottom: 0;
    }

    /* Flex so the ⓘ stays on the label's line. As an inline element after wrapping text it
     was pushed onto a line of its own, which is what left icons stranded under their row. */
    dt {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      min-width: 0;
      font-weight: 500;
      color: var(--ps-text-muted);
    }

    .item-label {
      min-width: 0;
    }

    dd {
      margin: 0;
      color: var(--ps-text-muted);
      text-align: right;
      /* Never break a number across lines. */
      white-space: nowrap;
    }

    /* The card's caption tier: everything that says what a number covers rather than being
       one. Typography once here, box model per class below. Deliberately excludes
       .stat-group-label / .stat-caveat, which sit inside .annotation-stats and inherit its
       1.5 line-height. */
    .scope-heading,
    .section-scope,
    .card-scope {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: 1.35;
    }

    .scope-heading {
      margin: 0.55rem 0 0.3rem;
    }

    /* What a section was computed over, once under its heading. */
    .section-scope {
      margin: 0 0 0.4rem;
    }

    /* Governs every score in the card, so it sits below all of them rather than inside one. */
    .card-scope {
      padding: 0 0.75rem 0.7rem;
    }

    dl > .scope-heading:first-child {
      margin-top: 0;
    }

    /* One grid for the whole block (rows are display: contents) so every metric row shares the
     same column widths; a grid per row would size each row's columns to its own content and
     leave the values visibly ragged. minmax(0, 1fr) lets the label column shrink instead of
     pushing the value columns past the panel's max-width at large text sizes. */
    .annotation-stats {
      display: grid;
      /* min-content, not 0, on the label track. With a 0 minimum the track could size below
         the metric name plus its info icon, and since nothing clips the cell the icon simply
         painted over the value column to its right. min-content lets the name wrap at a word
         boundary and guarantees the icon a place. Measured against the real component: with
         0 the label track collapsed to 36px while its content needed 120px. */
      grid-template-columns: minmax(min-content, 1fr) auto auto;
      gap: 0.15rem 0.5rem;
      padding: 0.625rem 0.75rem;
      font-size: 0.75rem;
      line-height: 1.5;
      color: var(--ps-text-muted);
    }

    .stat-heading,
    .stat-group-label,
    .stat-caveat {
      grid-column: 1 / -1;
    }

    .stat-heading {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      margin-top: 0.35rem;
      font-weight: 500;
      color: var(--ps-text);
      overflow-wrap: anywhere;
    }

    .stat-heading:first-child {
      margin-top: 0;
    }

    /* The selected annotation, inline in the heading. Reads as the input it is rather than as
       a section of its own, and cannot be mistaken for the legend panel's title. */
    .stat-annotation-chip {
      display: inline-block;
      padding: 0.05rem 0.3rem;
      border-radius: 0.25rem;
      background: var(--ps-surface-hover);
      color: var(--ps-text);
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .stat-group-label,
    .stat-caveat {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
    }

    .stat-group-label {
      margin-top: 0.2rem;
    }

    .stat-caveat {
      margin-top: 0.35rem;
    }

    .stat-metric {
      display: contents;
      font-variant-numeric: tabular-nums;
    }

    /* No min-width. It was inert while the embedding heading ("Source embedding") was the wider
     thing sizing this track, but the heading is one word now, so a 4.5rem floor would start
     binding and take the width straight back off the metric-name column. */
    .stat-metric-embedding {
      color: var(--ps-text-muted);
    }

    /* Same reason as the dt rule above: as an inline element the ⓘ was pushed onto its own line
       whenever the metric name wrapped, which every long one does ("Calinski–Harabasz").
       Flex keeps it on the label's first line and lets the name wrap beside it. */
    /* Flex, with the icon aligned to the name's LAST line.
       Measured alternatives, both rejected: inline flow wraps the icon onto a third line of
       its own, because the track's min-content is the longest WORD and reserves nothing for a
       trailing inline-block. flex-start strands it against the first line, so a wrapped name
       reads "Davies- (i) / Bouldin". flex-end puts it beside "Bouldin", where it belongs, and
       is identical to baseline alignment for the single-line names. */
    /* The metric names in the Recovers header, each with its own icon. Baseline-aligned with
       the "N clusters vs" label opposite so the header reads as one line. */
    .recovers-metric-head {
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
      justify-content: flex-end;
      white-space: nowrap;
    }

    /* The category count, inside the name cell rather than a fourth column: it must be able to
       wrap under a long annotation name instead of squeezing the numbers. */
    .recovers-meta {
      color: var(--ps-text-muted);
    }

    /* Coverage, on its own line under the row it qualifies, spanning the full grid. */
    .recovers-coverage {
      grid-column: 1 / -1;
      padding-left: 0.6rem;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
    }

    .recovers-more {
      grid-column: 1 / -1;
      justify-self: start;
      margin-top: 0.25rem;
      padding: 0;
      border: none;
      background: none;
      color: var(--ps-accent-text);
      font: inherit;
      font-size: var(--ps-text-xs);
      cursor: pointer;
    }

    .recovers-more:hover {
      text-decoration: underline;
    }

    .stat-metric-label {
      display: flex;
      align-items: flex-end;
      gap: 0.25rem;
      /* No min-width: 0 — it would hand back the very floor the track above establishes, and
         the icon would overflow into the value column again. */
    }

    /* Deliberately NO min-width: 0 here. With it the name could shrink below its own text,
       and since nothing clips the overflow the text ran on underneath the icon that flex had
       placed at the shrunken box's edge — which is the overlap, not a positioning bug. Left
       at the default min-content, the name wraps at a word boundary instead and the icon
       always follows the text. The label cell above still carries min-width: 0, so the grid
       column itself can still shrink. */
    .stat-metric-name {
      overflow-wrap: break-word;
    }

    /* The icon is furniture, never the thing that gets squeezed. */
    .stat-metric-label protspace-info-popover {
      flex: none;
    }

    /* Both number columns: right-aligned under their headings, and never broken across
       lines. The headings themselves are aligned by .stat-columns span:not(:first-child)
       below, which must not pick up nowrap. */
    .stat-metric-value,
    .stat-metric-embedding {
      text-align: right;
      white-space: nowrap;
    }

    .stat-direction {
      margin-left: 0.15rem;
      color: var(--ps-text-muted);
    }

    .section-heading {
      padding: 0 0.75rem;
      font-size: var(--ps-text-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ps-text-muted);
      margin-top: 0.625rem;
      margin-bottom: 0.25rem;
    }

    /* display: contents (not a nested grid) so these three spans land in \`.annotation-stats\`'s
     own grid columns, the same way \`.stat-metric\`'s cells do. A nested grid here would size its
     own "auto" columns from just these two header words, which would not match the value columns'
     widths below and would only ever occupy the outer grid's first column besides. */
    .stat-columns {
      display: contents;
    }

    .stat-columns span {
      font-size: var(--ps-text-xs);
      color: var(--ps-text-muted);
    }

    .stat-columns span:not(:first-child) {
      text-align: right;
    }
  `,
];
