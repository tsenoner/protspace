import { LitElement, html, css } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { ProtspaceData } from './types';
import type { FilterQuery, FilterCondition, FilterGroup, LogicalOp } from './query-types';
import { createCondition, createGroup, isFilterGroup } from './query-types';
import { evaluateQuery, evaluateQueryExcluding, hasConfiguredCondition } from './query-evaluate';
import { queryBuilderStyles } from './query-builder.styles';
import { buttonMixin } from '../../styles/mixins';
import { renderCloseIcon } from '../legend/legend-other-dialog';
import './query-condition-row';

/**
 * Main query builder component managing the full query builder UI.
 *
 * Events:
 * - `query-changed` — dispatched whenever the query changes, detail: `{ query: FilterQuery }`
 * - `query-apply`   — dispatched when "Apply Filter" is clicked, detail: `{ matchedIndices: Set<number> }`
 * - `query-reset`   — dispatched when "Reset All" is clicked
 */
@customElement('protspace-query-builder')
class ProtspaceQueryBuilder extends LitElement {
  static styles = [
    buttonMixin,
    queryBuilderStyles,
    css`
      :host {
        width: 100%;
        height: 100%;
      }
    `,
  ];

  @property({ type: Array }) annotations: string[] = [];
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;
  @property({ type: Array }) query: FilterQuery = [];

  @state() private _matchedIndices: Set<number> = new Set();
  @state() private _excludedMatchMap: Map<string, Set<number>> = new Map();
  @state() private _totalCount: number = 0;

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this._handleClose();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeydown);
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('data') || changedProperties.has('query')) {
      this._scheduleEvaluation(this.query);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeydown);
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  // ─── Match Count (debounced) ──────────────────────────────────────────────

  private _scheduleEvaluation(query: FilterQuery) {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      if (!this.data) return;
      this._matchedIndices = evaluateQuery(query, this.data);
      this._totalCount = this.data.protein_ids?.length ?? 0;

      // Build per-condition "excluded" matched sets for dynamic value counts
      const map = new Map<string, Set<number>>();
      for (const item of query) {
        if (isFilterGroup(item)) {
          for (const cond of item.conditions) {
            map.set(cond.id, evaluateQueryExcluding(query, this.data, cond.id));
          }
        } else {
          map.set(item.id, evaluateQueryExcluding(query, this.data, item.id));
        }
      }
      this._excludedMatchMap = map;
    }, 300);
  }

  // ─── Dispatch helpers ────────────────────────────────────────────────────

  private _dispatchQueryChanged(newQuery: FilterQuery) {
    this.dispatchEvent(
      new CustomEvent('query-changed', {
        detail: { query: newQuery },
        bubbles: true,
        composed: true,
      }),
    );
    // Match count update handled by updated() when query prop flows back down
  }

  // ─── Query mutations ─────────────────────────────────────────────────────

  private _addCondition() {
    const newQuery = [
      ...this.query,
      createCondition({ logicalOp: this.query.length > 0 ? 'AND' : undefined }),
    ];
    this._dispatchQueryChanged(newQuery);
  }

  private _addGroup() {
    const group = createGroup({ logicalOp: this.query.length > 0 ? 'AND' : undefined });
    this._dispatchQueryChanged([...this.query, group]);
  }

  private _addConditionToGroup(groupId: string) {
    const newQuery = this.query.map((item) => {
      if (isFilterGroup(item) && item.id === groupId) {
        return {
          ...item,
          conditions: [
            ...item.conditions,
            createCondition({
              logicalOp: item.conditions.length > 0 ? 'AND' : undefined,
            }),
          ],
        };
      }
      return item;
    });
    this._dispatchQueryChanged(newQuery);
  }

  private _handleConditionChanged(
    e: CustomEvent<{ condition: FilterCondition }>,
    groupId: string | null,
  ) {
    e.stopPropagation();
    const updated = e.detail.condition;
    if (groupId === null) {
      const newQuery = this.query.map((item) =>
        !isFilterGroup(item) && item.id === updated.id ? updated : item,
      );
      this._dispatchQueryChanged(newQuery);
    } else {
      const newQuery = this.query.map((item) => {
        if (isFilterGroup(item) && item.id === groupId) {
          return {
            ...item,
            conditions: item.conditions.map((c) =>
              !isFilterGroup(c) && c.id === updated.id ? updated : c,
            ),
          };
        }
        return item;
      });
      this._dispatchQueryChanged(newQuery);
    }
  }

  private _handleConditionRemoved(e: CustomEvent<{ id: string }>, groupId: string | null) {
    e.stopPropagation();
    const removedId = e.detail.id;
    if (groupId === null) {
      const newQuery = this.query.filter((item) => item.id !== removedId);
      this._dispatchQueryChanged(newQuery);
    } else {
      const newQuery = this.query.map((item) => {
        if (isFilterGroup(item) && item.id === groupId) {
          return { ...item, conditions: item.conditions.filter((c) => c.id !== removedId) };
        }
        return item;
      });
      this._dispatchQueryChanged(newQuery);
    }
  }

  private _removeGroup(groupId: string) {
    this._dispatchQueryChanged(this.query.filter((item) => item.id !== groupId));
  }

  private _handleGroupLogicalOpChange(groupId: string, e: Event) {
    const value = (e.target as HTMLSelectElement).value as LogicalOp;
    const newQuery = this.query.map((item) =>
      isFilterGroup(item) && item.id === groupId ? { ...item, logicalOp: value } : item,
    );
    this._dispatchQueryChanged(newQuery);
  }

  // ─── Apply & Reset ────────────────────────────────────────────────────────

  private _handleApply() {
    if (!this.data) return;
    // An all-no-op query matches everything; applying it would light up the
    // filter-active badge without filtering anything (mirrors the disabled
    // Apply button for callers that bypass the click path).
    if (!hasConfiguredCondition(this.query)) return;
    const result = evaluateQuery(this.query, this.data);
    this.dispatchEvent(
      new CustomEvent('query-apply', {
        detail: { matchedIndices: result },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleReset() {
    this.dispatchEvent(
      new CustomEvent('query-reset', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ─── Group rendering ──────────────────────────────────────────────────────

  private _renderGroup(group: FilterGroup, groupIndex: number) {
    return html`
      <div class="group-container">
        <div class="group-header">
          ${groupIndex > 0
            ? html`<select
                class="logical-op-select"
                .value=${group.logicalOp ?? 'AND'}
                @change=${(e: Event) => this._handleGroupLogicalOpChange(group.id, e)}
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
                <option value="NOT">NOT</option>
              </select>`
            : html`<div class="logical-op-placeholder"></div>`}
          <span>Group</span>
          <button class="condition-remove" @click=${() => this._removeGroup(group.id)}>×</button>
        </div>
        <div class="group-conditions">
          ${group.conditions.map(
            (item, index) => html`
              <protspace-query-condition-row
                .condition=${item}
                .annotations=${this.annotations}
                .data=${this.data}
                .matchedIndices=${this._excludedMatchMap.get(item.id) ?? this._matchedIndices}
                .isFirst=${index === 0}
                @condition-changed=${(e: CustomEvent) => this._handleConditionChanged(e, group.id)}
                @condition-removed=${(e: CustomEvent) => this._handleConditionRemoved(e, group.id)}
              ></protspace-query-condition-row>
            `,
          )}
        </div>
        <button class="btn-link" @click=${() => this._addConditionToGroup(group.id)}>
          + Add group condition
        </button>
      </div>
    `;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  private _handleClose() {
    this.dispatchEvent(
      new CustomEvent('query-close', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="query-builder">
        <div class="query-header">
          <span>Filter Query</span>
          <span class="match-count">
            ${this._matchedIndices.size} of ${this._totalCount} proteins matched
          </span>
          <button
            class="btn-close"
            title="Close"
            aria-label="Close filter query builder"
            @click=${this._handleClose}
          >
            ${renderCloseIcon()}
          </button>
        </div>

        <div class="query-conditions">
          ${this.query.map((item, index) => {
            if (isFilterGroup(item)) {
              return this._renderGroup(item, index);
            }
            return html`
              <protspace-query-condition-row
                .condition=${item}
                .annotations=${this.annotations}
                .data=${this.data}
                .matchedIndices=${this._excludedMatchMap.get(item.id) ?? this._matchedIndices}
                .isFirst=${index === 0}
                @condition-changed=${(e: CustomEvent) => this._handleConditionChanged(e, null)}
                @condition-removed=${(e: CustomEvent) => this._handleConditionRemoved(e, null)}
              ></protspace-query-condition-row>
            `;
          })}
          <div class="query-actions">
            <button class="btn-link" @click=${this._addCondition}>+ Add condition</button>
            <button class="btn-link" @click=${this._addGroup}>+ Add group</button>
          </div>
        </div>

        <div class="query-footer">
          <button class="btn-danger query-footer-reset" @click=${this._handleReset}>
            Reset All
          </button>
          <button class="btn-secondary" @click=${this._handleClose}>Cancel</button>
          <button
            class="btn-primary"
            ?disabled=${this._matchedIndices.size === 0 || !hasConfiguredCondition(this.query)}
            @click=${this._handleApply}
          >
            Apply Filter
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-query-builder': ProtspaceQueryBuilder;
  }
}
