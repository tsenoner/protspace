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

  .tooltip {
    background: var(--protspace-tooltip-bg, rgba(255, 255, 255, 0.95));
    border: 1px solid var(--protspace-tooltip-border, #d9e2ec);
    border-radius: 0.5rem;
    box-shadow:
      var(--protspace-tooltip-shadow, 0 6px 16px rgba(0, 0, 0, 0.08)),
      0 10px 40px rgba(0, 0, 0, 0.1);
    font-size: 0.875rem;
    min-width: 200px;
    max-width: 350px;
    width: max-content;
    word-wrap: break-word;
    overflow: hidden;
  }

  .tooltip-header {
    padding: 0.625rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #334155;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .tooltip-content {
    padding: 0.75rem;
  }

  .tooltip-protein-id {
    font-size: 1rem;
    color: #0f172a;
  }

  .tooltip-protein-id-main {
    font-size: 1rem;
    font-weight: 700;
  }

  .tooltip-uniprot-separator {
    font-size: 1rem;
    color: #94a3b8;
  }

  .tooltip-uniprot-id {
    font-size: 1rem;
    font-weight: 400;
    color: #475569;
  }

  .tooltip-gene-name {
    font-weight: normal;
    color: #64748b;
    font-size: 0.75rem;
    margin-bottom: 0.25rem;
    display: flex;
    gap: 0.25rem;
  }

  .tooltip-protein-name {
    font-weight: normal;
    color: #64748b;
    font-size: 0.8125rem;
    line-height: 1.4;
    margin-bottom: 0.125rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tooltip-content .label {
    color: #334155;
    font-weight: 500;
    flex-shrink: 0;
  }

  .tooltip-annotations {
    border-top: 1px solid #f1f5f9;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tooltip-annotation-header {
    font-size: 0.625rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.125rem;
  }

  .tooltip-annotation {
    font-size: 0.75rem;
    color: #64748b;
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

  .tooltip-annotation-score {
    flex-shrink: 0;
    white-space: nowrap;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
  }

  .tooltip-annotation-raw-label {
    flex-shrink: 0;
    color: #64748b;
    font-weight: normal;
  }

  .tooltip-annotation-raw-value {
    flex-shrink: 0;
    white-space: nowrap;
    color: #64748b;
    font-weight: normal;
    font-variant-numeric: tabular-nums;
  }

  .tooltip-annotation-evidence {
    flex-shrink: 0;
    white-space: nowrap;
    color: #94a3b8;
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
  }

  .eat-provenance {
    display: grid;
    gap: 0.25rem;
    margin: 0.125rem 0 0.25rem;
    padding: 0.375rem;
    border-radius: 0.375rem;
    background: #f8fafc;
  }

  .eat-provenance-heading,
  .eat-provenance-source {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.6875rem;
    color: #475569;
  }

  .eat-provenance-source {
    display: block;
    color: #64748b;
  }

  .eat-confidence-track {
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: #e2e8f0;
  }

  .eat-confidence-track > span {
    display: block;
    height: 100%;
    background: #7c3aed;
  }
`;
