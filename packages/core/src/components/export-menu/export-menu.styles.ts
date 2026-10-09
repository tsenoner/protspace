import { css } from 'lit';
import { dataMenuStyles } from '../import-menu/import-menu.styles';

export const exportMenuStyles = [
  dataMenuStyles,
  css`
    .export-menu-header {
      padding-bottom: var(--ps-space-2);
      margin-bottom: var(--ps-space-3);
      border-bottom: 1px solid var(--ps-border);
      color: var(--ps-text-muted);
      font-weight: var(--ps-weight-medium);
    }

    .export-option-group {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
      margin-bottom: var(--ps-space-3);
    }

    .export-option-label {
      color: var(--ps-text-muted);
    }

    .export-format-options {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--ps-space-1);
    }

    .btn-compact {
      padding: var(--ps-space-1) var(--ps-space-2);
      font-size: var(--ps-text-sm);
    }

    .btn-secondary.active {
      border-color: var(--ps-accent);
      background: var(--ps-accent);
      color: var(--ps-text-on-accent);
    }

    .btn-secondary.active:hover:not(:disabled) {
      background: var(--ps-accent-hover);
    }

    .export-checkbox-label {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      cursor: pointer;
      user-select: none;
    }

    .export-checkbox {
      flex: none;
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: var(--ps-accent);
      cursor: pointer;
    }

    .export-parquet-help,
    .export-image-hint {
      margin-top: var(--ps-space-1);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: var(--ps-leading-normal);
    }

    .export-image-actions {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
    }

    .export-image-actions > .btn,
    .export-action-btn {
      width: 100%;
    }
  `,
];
