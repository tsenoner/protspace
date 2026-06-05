// packages/core/src/components/scatter-plot/context-menu.styles.ts
import { css } from 'lit';

export const contextMenuStyles = css`
  :host {
    position: absolute;
    z-index: var(--z-dropdown, 100);
    pointer-events: auto;
  }

  .menu {
    position: absolute;
    background: var(--surface, #fff);
    border: var(--border-width, 1px) solid var(--border, #e2e8f0);
    border-radius: var(--radius, 6px);
    padding: 4px 0;
    min-width: 180px;
    box-shadow: var(--shadow-lg, 0 8px 30px rgba(0, 0, 0, 0.12));
    font-size: var(--text-base, 12px);
    font-family: inherit;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 14px;
    color: var(--text-primary, #334155);
    cursor: pointer;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    font: inherit;
  }

  .menu-item:hover {
    background: var(--primary-light, #eef6fb);
    color: var(--primary, #00a3e0);
  }

  .menu-item[aria-disabled='true'] {
    color: var(--text-tertiary, #a0aec0);
    cursor: default;
    pointer-events: none;
  }

  .menu-item .icon {
    width: 16px;
    text-align: center;
    font-size: 13px;
    flex-shrink: 0;
  }

  .menu-item .shortcut {
    margin-left: auto;
    font-size: var(--text-xs, 10px);
    color: var(--text-secondary, #5b6b7a);
  }

  .separator {
    height: 1px;
    background: var(--border, #e2e8f0);
    margin: 4px 0;
  }
`;
