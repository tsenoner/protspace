import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { countNoun, formatCount } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import type { PsButton } from '../kit/button';
import type { ProtspaceData } from './types';
import type { FilterCondition, FilterGroup, FilterQuery, LogicalOp } from './query-types';
import { clearLeadingOpInList, createCondition, createGroup, isFilterGroup } from './query-types';
import { evaluateQuery, evaluateQueryExcluding } from './query-evaluate';
import { applyBlock, applyBlockText, leafConditions } from './query-apply-state';
import { queryBuilderHostStyles, queryBuilderStyles } from './query-builder.styles';
import './query-condition-row';

/**
 * The filter's query builder (design decision 14): conditions and groups, a live count of the
 * proteins the query keeps, and Apply, which says why it is disabled.
 *
 * A host that keeps a draft (the app's Filter panel) owns the query and whether it differs from the
 * filter last applied (`dirty`): Cancel is enabled, and Apply can apply, only while it does. A host
 * that never sets `dirty` (null) keeps the earlier behaviour: Apply follows the count alone.
 *
 * Events:
 * - `query-changed` — the query was edited; detail `{ query: FilterQuery }`. Set `query` back.
 * - `query-apply`   — Apply; detail `{ matchedIndices: Set<number> }` (indices into `data`)
 * - `query-reset`   — Reset
 * - `query-cancel`  — Cancel: return the query to the filter last applied
 * - `query-close`   — the close button or Escape, only when not `embedded`
 */
@customElement('protspace-query-builder')
export class ProtspaceQueryBuilder extends LitElement {
  static styles = [queryBuilderStyles, queryBuilderHostStyles];

  @property({ type: Array }) annotations: string[] = [];
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;
  @property({ type: Array }) query: FilterQuery = [];
  /**
   * The query differs from the filter last applied; set by a host that keeps a draft. null (unset):
   * Apply and Cancel ignore it.
   */
  @property({ attribute: false }) dirty: boolean | null = null;
  /**
   * Hosted by a panel or dialog that brings its own heading (the app's Filter panel): the builder
   * then shows neither its title nor its close button, and leaves Escape to the host.
   */
  @property({ type: Boolean, reflect: true }) embedded = false;

  @state() private _matchedIndices: Set<number> = new Set();
  @state() private _excludedMatchMap: Map<string, Set<number>> = new Map();
  @state() private _totalCount: number = 0;
  /** A count is pending (the 300 ms debounce): Apply waits, with no reason text. */
  @state() private _counting = true;

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  private _onKeydown = (e: KeyboardEvent) => {
    // Embedded, the host owns Escape; a document listener here would dispatch query-close for
    // every Escape on the page.
    if (e.key === 'Escape' && !this.embedded) {
      this._handleClose();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeydown);
  }

  // Set here rather than in updated(): a state change in willUpdate joins this update, so Apply is
  // disabled in the same frame the query changes instead of trusting the previous count.
  willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('data') || changedProperties.has('query')) {
      this._counting = true;
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('data') || changedProperties.has('query')) {
      this._scheduleEvaluation(this.query);
    }
    // An id reference cannot reach into the button's shadow root: hand it the element.
    const apply = this.renderRoot.querySelector<PsButton>('.query-footer-apply');
    const reason = this.renderRoot.querySelector<HTMLElement>('#apply-reason');
    if (apply && reason && apply.describedBy[0] !== reason) apply.describedBy = [reason];
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
      this._debounceTimer = null;
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
      this._counting = false;
    }, 300);
  }

  // ─── Dispatch helpers ────────────────────────────────────────────────────

  private _dispatch(type: string, detail: unknown = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private _dispatchQueryChanged(newQuery: FilterQuery) {
    // The host sets `query` back, and updated() recounts.
    this._dispatch('query-changed', { query: newQuery });
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
      const filtered = this.query.filter((item) => item.id !== removedId);
      this._dispatchQueryChanged(clearLeadingOpInList(filtered));
    } else {
      const newQuery = this.query.map((item) => {
        if (isFilterGroup(item) && item.id === groupId) {
          const conditions = item.conditions.filter((c) => c.id !== removedId);
          return { ...item, conditions: clearLeadingOpInList(conditions) };
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

  // ─── Apply, Reset, Cancel, Close ──────────────────────────────────────────

  private _handleApply() {
    if (!this.data) return;
    // Evaluated afresh, so a click inside the debounce window applies what the rows say. The same
    // gate as the button, for callers that bypass the click: an unconfigured or unchanged query,
    // or one that keeps no protein or every protein, applies nothing.
    const result = evaluateQuery(this.query, this.data);
    const total = this.data.protein_ids?.length ?? 0;
    if (applyBlock({ query: this.query, matched: result.size, total, dirty: this.dirty })) return;
    this._dispatch('query-apply', { matchedIndices: result });
  }

  private _handleReset() {
    this._dispatch('query-reset');
  }

  private _handleCancel() {
    if (this.dirty === false) return;
    this._dispatch('query-cancel');
  }

  private _handleClose() {
    this._dispatch('query-close');
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  private _renderRow(
    condition: FilterCondition,
    isFirst: boolean,
    numbers: ReadonlyMap<string, number>,
    groupId: string | null,
  ) {
    return html`
      <protspace-query-condition-row
        .condition=${condition}
        .annotations=${this.annotations}
        .data=${this.data}
        .matchedIndices=${this._excludedMatchMap.get(condition.id) ?? this._matchedIndices}
        .isFirst=${isFirst}
        .number=${numbers.get(condition.id) ?? 0}
        @condition-changed=${(e: CustomEvent) => this._handleConditionChanged(e, groupId)}
        @condition-removed=${(e: CustomEvent) => this._handleConditionRemoved(e, groupId)}
      ></protspace-query-condition-row>
    `;
  }

  private _renderGroup(
    group: FilterGroup,
    groupIndex: number,
    numbers: ReadonlyMap<string, number>,
  ) {
    return html`
      <div class="group-container">
        <div class="group-header">
          ${groupIndex > 0
            ? html`<select
                class="logical-op-select"
                aria-label="Operator for the group"
                .value=${group.logicalOp ?? 'AND'}
                @change=${(e: Event) => this._handleGroupLogicalOpChange(group.id, e)}
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
                <option value="NOT">NOT</option>
              </select>`
            : html`<div class="logical-op-placeholder"></div>`}
          <span class="group-label">Group</span>
          <ps-icon-button
            class="condition-remove"
            icon="x"
            size="sm"
            label="Remove group"
            @click=${() => this._removeGroup(group.id)}
          ></ps-icon-button>
        </div>
        <div class="group-conditions">
          ${group.conditions.map((item, index) =>
            this._renderRow(item as FilterCondition, index === 0, numbers, group.id),
          )}
        </div>
        <button type="button" class="btn-link" @click=${() => this._addConditionToGroup(group.id)}>
          + Add group condition
        </button>
      </div>
    `;
  }

  render() {
    const total = this._totalCount;
    const block = applyBlock({
      query: this.query,
      matched: this._counting ? null : this._matchedIndices.size,
      total,
      dirty: this.dirty,
    });
    // The number each condition is called by in the reason text, group leaves included.
    const numbers = new Map(leafConditions(this.query).map((leaf, index) => [leaf.id, index + 1]));
    return html`
      <div class="query-builder">
        ${this.embedded
          ? nothing
          : html`<div class="query-header">
              <span class="query-title">Filter Query</span>
              <ps-icon-button
                class="btn-close"
                icon="x"
                label="Close filter query builder"
                @click=${this._handleClose}
              ></ps-icon-button>
            </div>`}

        <div class="query-conditions">
          ${this.query.map((item, index) =>
            isFilterGroup(item)
              ? this._renderGroup(item, index, numbers)
              : this._renderRow(item, index === 0, numbers, null),
          )}
          <div class="query-actions">
            <button type="button" class="btn-link" @click=${this._addCondition}>
              + Add condition
            </button>
            <button type="button" class="btn-link" @click=${this._addGroup}>+ Add group</button>
          </div>
        </div>

        <div class="query-footer">
          <p class="match-count" role="status" aria-live="polite">
            ${total > 0
              ? `${formatCount(this._matchedIndices.size)} of ${countNoun(total, 'protein', 'proteins')} match`
              : ''}
          </p>
          <p id="apply-reason" class="apply-reason">${block ? applyBlockText(block) : ''}</p>
          <div class="query-footer-buttons">
            <ps-button class="query-footer-reset" variant="danger" @click=${this._handleReset}
              >Reset</ps-button
            >
            <ps-button
              class="query-footer-cancel"
              variant="secondary"
              .disabled=${this.dirty === false}
              @click=${this._handleCancel}
              >Cancel</ps-button
            >
            <ps-button
              class="query-footer-apply"
              variant="primary"
              .disabled=${block !== null}
              @click=${this._handleApply}
              >Apply</ps-button
            >
          </div>
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
