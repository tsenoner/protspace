import { css } from 'lit';

export const proteinTooltipStyles = css`
  :host {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 20;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 0.2s ease,
      visibility 0.2s ease;
  }

  :host(.visible) {
    opacity: 1;
    visibility: visible;
  }

  /* A pinned tooltip takes the pointer, for its action buttons. */
  :host(.pinned) {
    pointer-events: auto;
  }

  /* A tap-pinned card on a short plot is capped to the room the plot's chrome leaves; it scrolls,
     and its actions stay in view at the bottom. */
  :host(.pinned) .tooltip {
    max-height: var(--protspace-tooltip-max-height, none);
    overflow-y: auto;
  }

  :host(.pinned) .tooltip-actions {
    position: sticky;
    bottom: 0;
    background: inherit;
  }

  .tooltip-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ps-space-1-5);
    padding: var(--ps-space-2) var(--ps-space-3);
    border-top: 1px solid var(--ps-border);
  }

  /* A pinned tooltip's resource links: the only way to them while the structure is hidden. */
  .tooltip-links {
    padding-top: var(--ps-space-2);
    border-top: 1px solid var(--ps-border);
  }

  .tooltip {
    box-sizing: border-box;
    background: var(--ps-surface-raised);
    border: 1px solid var(--ps-border);
    border-radius: 0.5rem;
    box-shadow: var(--ps-shadow-md);
    font-size: var(--ps-text-md);
    min-width: 200px;
    max-width: var(--protspace-tooltip-effective-width, 350px);
    width: max-content;
    word-wrap: break-word;
    overflow: hidden;
  }

  .tooltip-header {
    padding: 0.625rem 0.75rem;
    font-size: var(--ps-text-sm);
    font-weight: var(--ps-weight-semibold);
    color: var(--ps-text);
    border-bottom: 1px solid var(--ps-border);
    background: var(--ps-surface-muted);
  }

  .tooltip-content {
    padding: 0.75rem;
  }

  .tooltip-protein-id {
    font-size: var(--ps-text-lg);
    color: var(--ps-text);
  }

  .tooltip-protein-id-main {
    font-size: var(--ps-text-lg);
    font-weight: 700;
  }

  .tooltip-uniprot-separator {
    font-size: var(--ps-text-lg);
    color: var(--ps-text-faint);
  }

  .tooltip-uniprot-id {
    font-size: var(--ps-text-lg);
    font-weight: 400;
    color: var(--ps-text-muted);
  }

  .tooltip-gene-name {
    font-weight: normal;
    color: var(--ps-text-muted);
    font-size: var(--ps-text-sm);
    margin-bottom: 0.25rem;
    display: flex;
    gap: 0.25rem;
  }

  .tooltip-protein-name {
    font-weight: normal;
    color: var(--ps-text-muted);
    font-size: var(--ps-text-base);
    line-height: 1.4;
    margin-bottom: 0.125rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tooltip-content .label {
    color: var(--ps-text);
    font-weight: 500;
    flex-shrink: 0;
  }

  .tooltip-annotations {
    border-top: 1px solid var(--ps-border);
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tooltip-annotation-header {
    font-size: var(--ps-text-xs);
    font-weight: var(--ps-weight-semibold);
    color: var(--ps-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.125rem;
  }

  .tooltip-annotation {
    font-size: var(--ps-text-sm);
    color: var(--ps-text-muted);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
  }

  .tooltip-annotation-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1 1 auto;
  }

  .eat-transferred-row {
    align-items: flex-start;
  }

  .eat-transferred-label {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
    line-height: 1.35;
  }

  .tooltip-annotation-score {
    flex-shrink: 0;
    white-space: nowrap;
    color: var(--ps-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .tooltip-annotation-raw-label {
    flex-shrink: 0;
    color: var(--ps-text-muted);
    font-weight: normal;
  }

  .tooltip-annotation-raw-value {
    flex-shrink: 0;
    white-space: nowrap;
    color: var(--ps-text-muted);
    font-weight: normal;
    font-variant-numeric: tabular-nums;
  }

  .tooltip-annotation-evidence {
    flex-shrink: 0;
    white-space: nowrap;
    color: var(--ps-text-muted);
    font-size: var(--ps-text-xs);
    font-variant-numeric: tabular-nums;
  }

  .eat-provenance {
    display: grid;
    gap: 0.25rem;
    margin: 0.125rem 0 0.25rem;
    padding: 0.375rem;
    border-radius: 0.375rem;
    background: var(--ps-surface-muted);
  }

  .eat-provenance-heading,
  .eat-provenance-source {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: var(--ps-text-xs);
    color: var(--ps-text-muted);
  }

  .eat-provenance-source {
    display: block;
    color: var(--ps-text-muted);
  }

  .eat-confidence-track {
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--ps-border-strong);
  }

  .eat-confidence-track > span {
    display: block;
    height: 100%;
    background: var(--ps-eat);
  }

  /* The compact card a tap pins on a touch screen (the phone mockup's): exactly the width the plot
     places it at, one header line, the name, the colour-by value and the actions. */
  .tooltip.compact {
    width: var(--protspace-tooltip-effective-width, 240px);
    min-width: 0;
  }

  .compact .tooltip-header {
    padding: var(--ps-space-2) var(--ps-space-3) 0;
    border-bottom: 0;
    background: transparent;
  }

  .compact
    :is(
      .tooltip-protein-id,
      .tooltip-protein-id-main,
      .tooltip-uniprot-separator,
      .tooltip-uniprot-id
    ) {
    font-size: var(--ps-text-md);
  }

  .compact .tooltip-content {
    padding: var(--ps-space-1) var(--ps-space-3) var(--ps-space-2);
  }

  .compact .tooltip-protein-name {
    margin-bottom: var(--ps-space-2);
  }

  .tooltip-primary {
    display: flex;
    align-items: center;
    gap: var(--ps-space-2);
    padding-top: var(--ps-space-2);
    border-top: 1px solid var(--ps-border);
    color: var(--ps-text);
    font-size: var(--ps-text-base);
  }

  .tooltip-swatch {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .tooltip-primary-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compact .tooltip-actions {
    padding-top: 0;
    border-top: 0;
  }
`;
